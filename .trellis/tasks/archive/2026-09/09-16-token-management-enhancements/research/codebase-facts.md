# 代码事实调查：令牌管理增强

> 任务：09-16-token-management-enhancements（planning）
> 调查日期：2026-09-16 · 调查人：trellis-research
> 性质：**纯事实记录**（代码摘录 + 行号 + 调用关系），不含实现方案。
> 三项需求背景：① 令牌随机部分 24→32 字节；② 令牌级模型白名单（与用户级取交集）；③ 已创建令牌的额度编辑入口。

---

## A. `generateToken` 实现与全仓库调用点

### A1. 实现（`apps/worker/src/utils/crypto.ts:120-126`）

```ts
export function generateToken(prefix = ""): string {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	const base = btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
	return `${prefix}${base}`;
}
```

- 熵源：24 字节（192 bit）；base64url 编码后 24 字节 = 32 字符（无 padding）。若改 32 字节 = 43 字符（44 含 padding，尾部 `=` 被剥离）。
- 同文件另有 `sha256Hex`（L7-13，令牌/会话入库哈希用）与 `md5Hex`（仅 epay 签名）。

### A2. 全仓库调用点（grep `generateToken(`，共 11 处、7 个文件）

| 文件:行 | 调用 | 用途 | 是否属于本任务"令牌" |
|---|---|---|---|
| `routes/tokens.ts:40` | `generateToken("sk-")` | 管理台 API 令牌明文 | ✅ |
| `routes/user-api.ts:124` | `generateToken("sk-")` | 用户端 API 令牌明文 | ✅ |
| `routes/auth.ts:34` | `generateToken("admin_")` | **管理员会话** token | ❌ |
| `routes/channels.ts:142` | `generateToken("ch_")` | 渠道 ID 生成 | ❌ |
| `routes/newapiChannels.ts:273` | `generateToken("ch_")` | New API 兼容渠道 ID | ❌ |
| `routes/user-auth.ts:111` | `generateToken("u_")` | 注册后自动登录会话 | ❌ |
| `routes/user-auth.ts:163` | `generateToken("u_")` | 密码登录会话 | ❌ |
| `routes/user-auth.ts:605` | `generateToken("u_")` | LinuxDO 回调后会话 | ❌ |
| `routes/user-auth.ts:241` | `generateToken("ldo_")` | OAuth state | ❌ |
| `routes/user-auth.ts:323` | `generateToken("ldo_")` | OAuth state（第二处） | ❌ |
| `routes/user-auth.ts:552` | `sha256Hex(generateToken("pwd_"))` | LinuxDO 注册随机密码哈希 | ❌ |

**事实结论**：`generateToken` 是通用随机串生成器，非令牌专用；直接改函数体（24→32 字节）会同时改变管理员/用户会话、渠道 ID、OAuth state、随机密码的长度。邀请码（`routes/invite-codes.ts`）**不**使用此函数（grep 无命中）。

**相关派生事实**：
- 两处令牌创建均取 `keyPrefix = rawToken.slice(0, 8)`（`tokens.ts:44`、`user-api.ts:130`），存 `key_prefix` 列——前 8 字符为 `sk-` + 5 个随机字符，改长度不影响该截取。
- `token_plain` 存完整明文（`schema.sql:28`），`/reveal` 返回它；长度变化不影响 reveal 逻辑。
- 全仓库未发现对令牌字符串长度的校验/硬编码断言。

---

## B. 迁移目录与 tokens 表 schema

### B1. `apps/worker/migrations/` 文件列表（19 个，命名规则 `NNNN_snake_description.sql`，四位零填充递增）

```
0001_init.sql        0008_tip_url.sql           0015_channel_fee.sql
0002_api_format.sql  0009_user_tip_url.sql      0016_withdrawal.sql
0003_users.sql       0010_channel_model_aliases 0017_ldoh_sites.sql
0004_model_aliases   0011_linuxdo_username.sql  0018_channel_restrictions.sql
0005_linuxdo_oauth   0012_checkin.sql           0019_remove_shared_ecosystem.sql
0006_error_details   0013_invite_codes.sql
0007_alias_only.sql  0014_recharge_orders.sql
```

列追加型迁移样例（`0018_channel_restrictions.sql`，全文仅 2 行）：

```sql
-- Add stream_only (仅流式) flag and contribution_note to channels
ALTER TABLE channels ADD COLUMN stream_only INTEGER NOT NULL DEFAULT 0;
ALTER TABLE channels ADD COLUMN contribution_note TEXT;
```

### B2. `apps/worker/src/db/schema.sql:23-36` tokens 表当前完整定义

```sql
CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  token_plain TEXT,
  quota_total INTEGER,
  quota_used INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  allowed_channels TEXT,
  user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

注意：当前**没有** `allowed_models` 列；`quota_total` 可空（NULL = 无限）。

---

## C. `apps/worker/src/middleware/tokenAuth.ts`（全文要点，共 86 行）

### C1. TokenRecord 类型（L11-21）

```ts
export type TokenRecord = {
	id: string;
	name: string;
	quota_total: number | null;
	quota_used: number;
	status: string;
	allowed_channels: string | null;
	user_id: string | null;
	/** User-level model allowlist (parsed); null/undefined = unrestricted. */
	user_allowed_models?: string[] | null;
};
```

### C2. 令牌查询（L30-34）——单条 SELECT，无 JOIN

```ts
const record = await c.env.DB.prepare(
	"SELECT id, name, quota_total, quota_used, status, allowed_channels, user_id FROM tokens WHERE key_hash = ?",
)
	.bind(tokenHash)
	.first<TokenRecord>();
```

### C3. user_allowed_models 加载方式：**二次独立查询**（非子查询），仅当 `record.user_id` 非空（L57-76）

```ts
let userAllowedModels: string[] | null = null;
if (record.user_id) {
	const user = await c.env.DB.prepare(
		"SELECT balance, status, allowed_models FROM users WHERE id = ?",
	)
		.bind(record.user_id)
		.first<{ balance: number; status: string; allowed_models: string | null }>();
	if (!user || user.status !== "active") {
		return jsonError(c, 403, "user_disabled", "user_disabled");
	}
	if (user.balance <= 0) {
		return jsonError(c, 402, "insufficient_balance", "insufficient_balance");
	}
	userAllowedModels = parseAllowlist(user.allowed_models);
}
```

### C4. c.set 变量名：`"tokenRecord"`（L79-85）

```ts
c.set("tokenRecord", {
	...record,
	quota_total: normalized.quotaTotal,
	quota_used: normalized.quotaUsed,
	user_allowed_models: userAllowedModels,
});
```

`user_allowed_models` 是在 c.set 时**注入**的运行时字段（DB 无此列）。quota 归一化用 `normalizeQuota`/`canConsumeQuota`（`services/quota.ts`，签名见 §F3）。

---

## D. `apps/worker/src/routes/proxy.ts`

### D1. import（L31-34）

```ts
import {
	filterModelsByAllowlist,
	isModelAllowed,
} from "../utils/model-allowlist";
```

### D2. `isModelAllowed` 调用点：**仅 1 处**（L419-423，chat 代理 `proxy.all("/*", tokenAuth, ...)` 内）

```ts
	// User-level model allowlist (design.md D2): exact match on the requested
	// model name before any channel routing work
	if (!isModelAllowed(tokenRecord.user_allowed_models, model)) {
		return jsonError(c, 403, "model_not_allowed", "model_not_allowed");
	}
```

全仓库 `model_not_allowed` 仅出现在 proxy.ts:422 与 anthropic-proxy.ts:61（grep 确认）。

### D3. `/v1/models` 端点（L300-400，`proxy.get("/models", tokenAuth, ...)`）

- L305-312：查全部 active 渠道。
- L314-327：解析 `tokenRecord.allowed_channels`，区分 per-model map（对象）与 legacy flat array；flat array 用 `filterAllowedChannels` 预过滤。
- L329-389：按渠道模型集 + 别名（`loadAllChannelAliasesGrouped`）聚合 `modelData`。
- **L391-395：按用户级白名单过滤返回列表**：

```ts
	// User-level model allowlist: only expose callable names the user may use
	const visibleModels = filterModelsByAllowlist(
		modelData,
		tokenRecord.user_allowed_models,
	);
```

- 事实：该端点当前**只**按 `user_allowed_models` 过滤，不存在令牌级模型白名单过滤；`allowed_channels` 只影响候选渠道集，不影响列表中的模型名（per-model map 只剔除"该模型无可用渠道"的组合）。

### D4. `filterAllowedChannels`（L67 定义，exported）

```ts
export function filterAllowedChannels(
	channels: ChannelRecord[],
	tokenRecord: TokenRecord,
	model?: string | null,
): ChannelRecord[] {
	const raw = safeJsonParse<string[] | Record<string, string[]> | null>(
		tokenRecord.allowed_channels,
		null,
	);
	if (!raw) {
		return channels;
	}
	// ...（legacy flat 数组与 per-model map 两种格式）
```

调用点 2 处：
- L327：`/v1/models` 内（legacy flat 预过滤）。
- **L505-509：chat 代理候选渠道选择**（`proxy.all("/*")` 内，位于 `resolveChannelRoute` 未命中后的 else 分支）：

```ts
	} else {
		const allowedChannels = filterAllowedChannels(
			activeChannels,
			tokenRecord,
			model,
		);
		if (model) {
			candidates = allowedChannels.filter((channel) => { /* 模型支持/别名匹配 */ });
		} else {
			candidates = allowedChannels;
		}
	}
```

### D5. chat 候选流程顺序（L480-560）

tokenAuth 注入 tokenRecord → `resolveChannelRoute`（显式渠道路由）→ 未命中则 `filterAllowedChannels` → 按模型支持/别名过滤 → `allowedFormatsForPath` 路由矩阵过滤 → stream_only 过滤。`allowed_channels` 校验失败表现为 404 `model_not_found` / 503 `no_available_channels`（**不是** 403）。

---

## E. `apps/worker/src/routes/anthropic-proxy.ts`

- import：L21 `import { isModelAllowed } from "../utils/model-allowlist";`
- 调用点：**仅 1 处**（L58-62，`anthropicProxy.post("/messages", tokenAuth, ...)` 顶部）：

```ts
	// User-level model allowlist (design.md D2): exact match on the requested
	// model name before any channel routing work
	if (!isModelAllowed(tokenRecord.user_allowed_models, model)) {
		return jsonError(c, 403, "model_not_allowed", "model_not_allowed");
	}
```

---

## F. 令牌相关 handler（worker）

### F1. `apps/worker/src/routes/tokens.ts`（管理台，全文 146 行）

| 端点 | 行号 | 字段/SQL 事实 |
|---|---|---|
| `GET /` | L23-28 | SELECT `tokens.id, name, key_prefix, quota_total, quota_used, status, allowed_channels, user_id, created_at, updated_at` + LEFT JOIN users 取 `user_name/user_email`；**不含** token_plain |
| `POST /` | L31-60 | body 使用：`name`（必需）、`quota_total`（null/undefined→NULL，NaN→NULL）、`status ?? "active"`、`allowed_channels`（`JSON.stringify(body.allowed_channels ?? null)`——缺省时入库字面量 `"null"` 字符串）。INSERT 列：id/name/key_hash/key_prefix/token_plain/quota_total/quota_used/status/allowed_channels/created_at/updated_at。返回 `{ id, token: rawToken }` |
| `PATCH /:id` | L64-113 | 先 `SELECT * FROM tokens WHERE id = ?`（L84）。可更新列：`name`、`quota_total`、`quota_used`、`status`、`allowed_channels`。语义：`body.X ?? existing.X`（undefined=保留）；**注意**：`body.quota_total === null` → 走 `existing.quota_total`（L88-89 三元判断），即 **PATCH 无法用 null 把额度清回无限**；`allowed_channels` 用 `body.allowed_channels ?? existingAllowed ?? null`（L97），`null` 也会落到 existing（**PATCH 无法用 null 清空渠道限定**，只能传 `[]`）。NaN 回退 existing（L95/99） |
| `GET /:id/reveal` | L116-130 | 返回 `token_plain ?? null`，无额外鉴权（依赖挂载点 adminAuth） |
| `DELETE /:id` | L133-142 | 直接 DELETE |

TokenRow 本地类型（L9-19）：id, name, key_prefix, quota_total, quota_used, status, allowed_channels, token_plain?。

### F2. `apps/worker/src/routes/user-api.ts`（用户端，挂 `/api/u`，全部经 userAuth）

| 端点 | 行号 | 事实 |
|---|---|---|
| `GET /tokens` | L104-110 | SELECT 列：id, name, key_prefix, quota_total, quota_used, status, allowed_channels, created_at, updated_at；`WHERE user_id = ?` |
| `POST /tokens` | L117-152 | body 仅使用 `name`（必需）；INSERT 固定 `quota_total=null, quota_used=0, status='active', allowed_channels=null, user_id=userId`。返回 `{ id, token }` |
| `PATCH /tokens/:id` | L155-187 | **仅 `name`**（trim 后非空才更新），UPDATE 带 `AND user_id = ?` 归属校验 |
| `DELETE /tokens/:id` | L190-211 | 带 user_id 归属校验 |
| `GET /tokens/:id/reveal` | L214-231 | 带 user_id 归属校验 |
| `GET /models` | L29-98 | 用户可见模型（含定价/渠道）；L93-96 按 `parseAllowlist(userRecord.allowed_models)` + `filterModelsByAllowlist` 过滤——**当前无令牌维度** |

### F3. 配套：`apps/worker/src/services/quota.ts`（全文 30 行）

```ts
export function canConsumeQuota(quotaTotal: number | null, quotaUsed: number, increment: number): boolean
export function normalizeQuota(quotaTotal?: number | null, quotaUsed?: number | null)  // → { quotaTotal, quotaUsed }
```

额度实际扣减点：`services/usage.ts:71`：

```ts
"UPDATE tokens SET quota_used = quota_used + ?, updated_at = ? WHERE id = ?",
```

### F4. 无关但已核实

- `routes/models.ts`（模型广场）与 `routes/public.ts`（公开模型/定价）**均未引用** allowlist 三函数（grep 全 worker src 无命中）。

---

## G. 白名单工具函数现状

### G1. `apps/worker/src/utils/model-allowlist.ts`（全文 68 行，3 个导出函数）

```ts
export function parseAllowlist(raw: unknown): string[] | null
// 字符串 → safeJsonParse；非数组/元素非字符串 → null（fail-open）
// 空/全空数组 → null（不限制）；元素 trim，空元素剔除
export function isModelAllowed(allowlist: string[] | null | undefined, model: string | null | undefined): boolean
// null/空 → true；model 缺失 → true；否则精确大小写敏感 includes
export function filterModelsByAllowlist<T extends { id: string }>(items: T[], allowlist: string[] | null | undefined): T[]
// null/空 → 原数组（同引用）；否则按 id Set 过滤
```

注释标明语义来自上个任务的 design.md D2：匹配对象是**别名解析前**的客户端原始 `body.model`。

### G2. `apps/worker/src/routes/admin-users.ts` 的 `serializeAllowedModels`（L31-56）

```ts
function serializeAllowedModels(
	input: unknown,
): { ok: true; value: string | null } | { ok: false } {
	// null → {ok, null}；非数组 → {ok:false}
	// 元素非 string → {ok:false}；trim 后为空 → {ok:false}
	// [] → {ok, null}；其余 → {ok, JSON.stringify(models)}
}
```

**复用性事实**：
- 该函数是 admin-users.ts **模块私有**（无 `export`），tokens 路由无法直接 import；其逻辑不依赖 users 上下文，纯输入校验。
- 使用方式参考：POST 中 `if (!allowedModels.ok) return jsonError(c, 400, "invalid_allowed_models", ...)`（L130-134）；PATCH 中 `undefined` = 保留旧值、显式传值才走序列化（L167-179）。
- `admin-users.ts` 列表/创建响应把存储值经 `parseAllowlist` 还原为数组返回前端（L65、L137）。
- `tokens.ts` 当前 import 清单（L1-7）**不含** model-allowlist：`hono, AppEnv, generateToken+sha256Hex, jsonError, safeJsonParse, nowIso`。

---

## H. `apps/ui/src/features/TokensView.tsx`（管理台令牌视图，全文 483 行）

### H1. props 类型（L5-21，完整）

```ts
type TokensViewProps = {
	pagedTokens: Token[];
	tokenPage: number;
	tokenPageSize: number;
	tokenTotal: number;
	tokenTotalPages: number;
	isTokenModalOpen: boolean;
	onCreate: () => void;
	onCloseModal: () => void;
	onPageChange: (next: number) => void;
	onPageSizeChange: (next: number) => void;
	onSubmit: (event: Event) => void;
	onReveal: (id: string) => void;
	onToggle: (id: string, status: string) => void;
	onDelete: (id: string) => void;
};
```

### H2. 结构事实

- 桌面表格列（L46-49）：名称 / 归属用户(user_name, title=user_email) / 状态(启用|禁用徽章) / 已用/额度(`quota_used / quota_total ?? "∞"`) / 前缀 / 创建时间 / 操作。
- 移动端卡片布局（L141-248）：同信息，操作按钮同三枚。
- 分页：页码按钮 + 每页条数 `[10, 20, 50]`（L22）。
- **每行操作按钮：复制(onReveal) / 切换(onToggle) / 删除(onDelete)——没有"编辑"入口**。
- 创建模态框（L279-478，Modal 组件 `sheet`）：标题"生成令牌"；表单字段仅 2 个：
  - `name`（text, required, id=token-name）
  - `quota_total`（number, min=0, label"额度（可选）", placeholder"留空表示无限"）
  - 无 status / allowed_channels / allowed_models / quota_used 字段。
- 模态由 `isTokenModalOpen` 控制，`onSubmit` 走 form submit。

---

## I. 前端类型与 API 封装

### I1. `apps/ui/src/core/types.ts:15-28` Token 类型（完整）

```ts
export type Token = {
	id: string;
	name: string;
	key_prefix: string;
	quota_total: number | null;
	quota_used: number;
	status: string;
	user_id?: string | null;
	user_name?: string | null;
	user_email?: string | null;
	allowed_channels?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
};
```

### I2. `apps/ui/src/core/api.ts`（全文 43 行）

```ts
export type ApiFetch = <T>(path: string, options?: RequestInit) => Promise<T>;
export const createApiFetch = (token: string | null, onUnauthorized: () => void): ApiFetch
```

行为：自动设 `Content-Type: application/json`；token 非空则 `Authorization: Bearer {token}`；非 2xx 时 401 触发 `onUnauthorized()`，抛 `Error(payload.error ?? "HTTP {status}")`（error 取响应 JSON 的 `error` 字段，与 worker `jsonError` 的 code 对齐）。

用法示例（AdminApp.tsx:133-136）：

```ts
const apiFetch = useMemo(
	() => createApiFetch(token, () => updateToken(null)),
	[token, updateToken],
);
```

---

## J. 用户端令牌管理（UserApp.tsx + UserTokensView.tsx）

### J1. `apps/ui/src/UserApp.tsx`（令牌相关 handler，行号为当前文件）

- `handleTokenCreate`（L218-232）：`POST /api/u/tokens`，body 仅 `{ name }`；成功后 secretModal 展示明文 + `loadTokens()`。
- `handleTokenDelete`（L234-245）：`DELETE /api/u/tokens/{id}`。
- `handleTokenReveal`（L247-267）：`GET /api/u/tokens/{id}/reveal`，复制到剪贴板，失败落 secretModal。
- **无 update/编辑 handler**。loadTokens（L136-137）`GET /api/u/tokens` 存入 `tokens` state。
- 传给 UserTokensView 的 props（L314-322）：`tokens` / `onCreate` / `onDelete` / `onReveal`。

### J2. `apps/ui/src/features/UserTokensView.tsx`（全文 213 行）

- 内部自持 state：`showCreateModal`、`tokenName`（L12-13）——与管理台 TokensView（纯受控）不同。
- 表格列（L64-71）：名称 / 前缀 / 已用配额(`quota_used / quota_total ?? " / 无限"`) / **渠道限定**（解析存量 `allowed_channels`，per-model map 显示"N 个模型"徽章，title="存量渠道限定，继续由服务端校验生效"；否则"全部"）/ 状态 / 创建时间 / 操作。
- 行操作：复制 / 删除（**无切换、无编辑**）。
- 创建模态：仅"令牌名称"一个输入（L155-201）。
- 文件尾部有本地 `parseAllowedChannels`（L196-213，JSON parse per-model map）。
- **结论事实：用户端无任何令牌编辑功能。**

---

## K. 测试现状

### K1. `tests/` 文件清单（9 个）

```
channel-models.test.ts        model-testing.test.ts
filter-allowed-channels.test.ts  proxy-headers.test.ts
format-converter-responses.test.ts proxy-responses.test.ts
model-allowlist.test.ts       proxy-retry-settings.test.ts
usage-responses.test.ts
```

### K2. `vitest.config.ts`（根目录，全文）

```ts
export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts"],
		environment: "node",
	},
});
```

### K3. 测试结构：**纯函数测试，无 D1 mock**

- `tests/model-allowlist.test.ts`（112 行）：直接 import `apps/worker/src/utils/model-allowlist`，3 个 describe（isModelAllowed / parseAllowlist / filterModelsByAllowlist），全部纯输入输出断言（大小写敏感、fail-open、trim 等语义已覆盖）。
- `tests/filter-allowed-channels.test.ts`（97 行）：import `filterAllowedChannels`（routes/proxy）+ 类型 TokenRecord/ChannelRecord，用 `makeChannel`/`makeToken` fixture 构造内存对象，纯函数断言（含 per-model map、malformed JSON fail-open 等）。

即：新增白名单交集逻辑若抽成纯函数，现成测试模式可直接套用；涉及 DB 的路径目前没有 mock 基建。

---

## L. `apps/ui/src/AdminApp.tsx` 令牌相关 state / handler 全清单

| 成员 | 行号 | 事实 |
|---|---|---|
| `tokenPage` / `tokenPageSize` state | L97-98 | 分页 state，默认 1 / 10 |
| `isTokenModalOpen` state | L124 | `useState(false)`，仅控制创建模态 |
| `loadTokens` | L164-167 | `GET /api/tokens` → `data.tokens` |
| tab 预载 | L227 | `if (tabId === "tokens") await loadTokens();` |
| `handleTokenPageChange` / `handleTokenPageSizeChange` | L293-300 | 分页回调 |
| `openTokenCreate` / `closeTokenModal` | L338-340 / L410 | 仅 set `isTokenModalOpen` |
| `handleTokenSubmit` | L505-535 | FormData → `POST /api/tokens` body `{ name, quota_total: payload.quota_total ? Number(...) : null }`；成功→ secretModal 展示明文、`form.reset()`、关模态、`setTokenPage(1)`、`loadTokens()` |
| `handleTokenDelete` | L824-836 | confirm → `DELETE /api/tokens/{id}` |
| `handleTokenReveal` | L838-859 | `GET /api/tokens/{id}/reveal` → 剪贴板，失败落 secretModal |
| `handleTokenToggle` | L861-876 | `toggleStatus(status)`（core/utils）→ `PATCH /api/tokens/{id}` body `{ status: next }` |
| `tokenTotal` / `tokenTotalPages` / `pagedTokens` | L1051-1059 | 前端内存分页 memo |
| 页码回夹 | L1065-1067 | `setTokenPage(min(prev, tokenTotalPages))` |
| TokensView 渲染 | L1147-1165 | 传参全集：`pagedTokens, tokenPage, tokenPageSize, tokenTotal, tokenTotalPages, isTokenModalOpen, onCreate=openTokenCreate, onCloseModal=closeTokenModal, onPageChange, onPageSizeChange, onSubmit=handleTokenSubmit, onReveal=handleTokenReveal, onToggle=handleTokenToggle, onDelete=handleTokenDelete` |

**已有编辑参照模式**（渠道）：`editingChannel` state（L99）+ `channelForm` state（L100-102）+ `isChannelModalOpen`（L103）+ `startChannelEdit`（L342）——管理台渠道编辑是"编辑态 state + 同一模态复用"的模式。

**模型候选来源**（UsersView 白名单 UI 所用）：AdminApp L211-213：

```ts
const loadModelCandidates = useCallback(async (): Promise<string[]> => {
	const result = await apiFetch<{ models: ModelItem[] }>("/api/models");
	return result.models.map((m) => m.id);
}, [apiFetch]);
```

### L2. UsersView 的用户级白名单 UI（现存唯一 allowlist 编辑界面，参考实现）

`apps/ui/src/features/UsersView.tsx`：
- props `onFetchModelCandidates: () => Promise<string[]>`（L16）；
- `selectedModels: Set<string>`（L41）+ `candidates`（L49）+ 搜索过滤（L142-157，候选=接口候选 ∪ 已配置值）；
- 提交时与 initial 排序比对，有变化才把 `patch.allowed_models = [...selectedModels]`（L90-93）；
- 编辑模态内 checkbox 列表（L600 附近）。

---

## 附 1：新增 `tokens.allowed_models` 列需触碰的文件清单（事实性）

> 只列文件与现状关联点，不含方案。

**Worker（后端）**
1. `apps/worker/migrations/0020_*.sql` —— 需新建；现状无此文件，编号规则见 §B1，列追加范式见 0018。
2. `apps/worker/src/db/schema.sql` —— tokens 表定义（L23-36）需同步加列；现状无 `allowed_models`。
3. `apps/worker/src/middleware/tokenAuth.ts` —— 现状 SELECT 列清单（L32）不含新列；`TokenRecord` 类型（L11-21）需承载令牌级白名单；`user_allowed_models` 注入模式（L79-85）为现成先例。
4. `apps/worker/src/routes/proxy.ts` —— `isModelAllowed` 现仅吃 `user_allowed_models`（L421）；`/v1/models` 过滤现仅用户级（L392-395）；import 自 model-allowlist（L31-34）。
5. `apps/worker/src/routes/anthropic-proxy.ts` —— L60 同上，仅用户级。
6. `apps/worker/src/routes/tokens.ts` —— POST INSERT 列（L51）与 PATCH UPDATE 列（L102）现无 `allowed_models`；GET 列（L26）同；该文件尚未 import model-allowlist 工具。
7. `apps/worker/src/routes/user-api.ts` —— `GET /tokens` 列（L107）、POST INSERT 固定值（L131-147）无新列；`GET /models` 过滤（L93-96）现仅用户级。
8. `apps/worker/src/utils/model-allowlist.ts` —— 现有 3 函数均为单 allowlist 语义（null=不限制），无"双白名单取交集"函数。
9. `apps/worker/src/routes/admin-users.ts` —— `serializeAllowedModels`（L31-56）模块私有未导出，是现存的"数组→JSON 串"校验实现。

**UI（前端）**
10. `apps/ui/src/core/types.ts` —— `Token`（L15-28）无 `allowed_models` 字段。
11. `apps/ui/src/features/TokensView.tsx` —— 表格/模态现无模型白名单展示或编辑（§H2）。
12. `apps/ui/src/AdminApp.tsx` —— `handleTokenSubmit` body 仅 name+quota_total（L515-522）；模型候选加载器已存在（L211-213）。
13. `apps/ui/src/features/UserTokensView.tsx` —— 用户端表格无白名单列；无编辑入口（§J2）。
14. `apps/ui/src/UserApp.tsx` —— `handleTokenCreate` 仅传 name（L221-224）；无 update handler。

**测试**
15. `tests/model-allowlist.test.ts` —— 现覆盖单白名单语义；无交集语义测试。vitest 为 node 环境、纯函数模式（§K）。

**核对过的"无需触碰"事实**：`services/usage.ts`（额度扣减，L71）与白名单无关；`routes/models.ts`、`routes/public.ts` 不引用 allowlist；`newapiChannels.ts` 的 `generateToken("ch_")` 与令牌无关。

---

## 附 2：实现「令牌编辑 UI」（额度 quota_total/quota_used 等）需触碰的文件清单（事实性）

1. `apps/ui/src/features/TokensView.tsx` —— 现状：仅创建模态（name + quota_total 两字段，L279-478）；行操作仅复制/切换/删除，无编辑按钮；props 无编辑回调（L5-21）。
2. `apps/ui/src/AdminApp.tsx` —— 现状：`isTokenModalOpen` 为单一布尔（L124），无编辑态/表单 state；`handleTokenSubmit` 仅 POST（L505-535）；PATCH 通路已被 `handleTokenToggle` 使用（L861-876，body 仅 status）；渠道编辑的参照模式为 `editingChannel` + `channelForm` + `isChannelModalOpen`（L99-103、L342）。
3. `apps/worker/src/routes/tokens.ts` —— `PATCH /:id` 已支持 `name / quota_total / quota_used / status / allowed_channels`（L102 UPDATE）；两个现存语义边界（事实，非方案）：
   - `body.quota_total === null` 时回退 existing（L88-90）→ 无法通过 PATCH 把额度清回无限；
   - `body.allowed_channels` 传 `null` 落到 existing（L97）→ 无法用 null 清空；`quota_used` 同理无 null 清零语义（undefined=保留）。
4. `apps/ui/src/core/types.ts` —— `Token` 已含 `quota_total/quota_used`（L19-20），编辑表单可直接消费；无 Token 更新专用表单类型（渠道有 `ChannelForm`，令牌没有对应 `TokenForm`）。
5. `apps/worker/src/services/quota.ts` —— `normalizeQuota`/`canConsumeQuota`（全文 30 行）为 quota 语义的现存定义点；`services/usage.ts:71` 为 `quota_used` 的并发扣减点（编辑 quota_used 需 awareness，仅列事实）。
6. （若用户端同步开放编辑）`apps/ui/src/features/UserTokensView.tsx` + `apps/ui/src/UserApp.tsx` + `apps/worker/src/routes/user-api.ts` —— 现状：用户端 PATCH 仅 name（user-api.ts L155-187），前端无编辑入口（§J）。

**无需触碰的事实**：`/reveal`、`DELETE`、`tokenAuth`、`proxy.ts` 对额度编辑无耦合；`key_prefix`/`key_hash`/`token_plain` 与编辑无关。
