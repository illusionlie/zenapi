# 技术设计：令牌管理增强

> 事实依据见 `research/codebase-facts.md`（下称「调研 §X」，行号均指向该文件摘录）。

## D1 令牌长度：参数化 `generateToken`，不改全局默认

**决策**：`apps/worker/src/utils/crypto.ts` 的 `generateToken` 增加第二参数：

```ts
export function generateToken(prefix = "", byteLength = 24): string
```

- 两处 API 令牌调用点（`routes/tokens.ts:40`、`routes/user-api.ts:124`）改为 `generateToken("sk-", 32)`。
- 其余 9 处调用（管理员会话、用户会话×3、渠道 ID×2、OAuth state×2、随机密码）**保持默认 24**，输出不变（PRD R1 约束）。

**备选与取舍**：新建 `generateApiToken()` 专用函数也可行，但与现有「prefix 参数化」风格割裂且多一个导出；参数化是更小的改动面。**不**把默认值改成 32——那会静默改变会话/渠道 ID 长度，属隐性破坏。

派生影响：`key_prefix = rawToken.slice(0, 8)`（`sk-` + 5 随机字符）逻辑不变；`token_plain` / `key_hash` / `/reveal` 均无长度假设（调研 §A2）。

## D2 数据库：迁移 0020 + schema 同步

- 新建 `apps/worker/migrations/0020_token_allowed_models.sql`：

```sql
ALTER TABLE tokens ADD COLUMN allowed_models TEXT;
```

- `apps/worker/src/db/schema.sql` tokens 表（L23-36）在 `allowed_channels TEXT,` 后追加 `allowed_models TEXT,`。
- 范式对齐 0018（调研 §B1）。存量行该列为 NULL = 不限制，天然向后兼容（AC2）。

## D3 白名单语义：双清单独立校验，不计算交集数组

**核心决策**：令牌级与用户级白名单**不合并成交集数组**，而是逐清单独立校验后取 AND：

```ts
// utils/model-allowlist.ts 新增
export function isModelAllowedByAll(
	allowlists: (string[] | null | undefined)[],
	model: string | null | undefined,
): boolean {
	return allowlists.every((list) => isModelAllowed(list, model));
}
```

**为什么不计算交集数组**：`isModelAllowed` 对空数组 fail-open（调研 §G1），若两清单交集为空（如令牌限 `gpt-4`、用户限 `claude-3`）合并结果 `[]` 会被误判为「不限制」→ 全放行，属安全反转。独立校验则每条清单各自 fail-open/fail-closed，语义与现有单清单完全一致。`/v1/models` 过滤同理用链式 `filterModelsByAllowlist(filterModelsByAllowlist(items, tokenList), userList)`——组合两个已测函数，零新逻辑。

## D4 鉴权链路：tokenAuth 注入解析后的令牌级白名单

`apps/worker/src/middleware/tokenAuth.ts`：

- `TokenRecord` 类型新增：`allowed_models: string | null`（DB 原始列）与 `token_allowed_models?: string[] | null`（运行时解析注入，命名对齐现有 `user_allowed_models` 先例，调研 §C1/C4）。
- 主 SELECT（L32）列清单追加 `allowed_models`。
- `c.set("tokenRecord", ...)` 处追加 `token_allowed_models: parseAllowlist(record.allowed_models)`。

消费点：

- `routes/proxy.ts` L419-423：现有单清单校验改为
  `isModelAllowedByAll([tokenRecord.token_allowed_models, tokenRecord.user_allowed_models], model)`，错误码维持 403 `model_not_allowed`。
- `routes/proxy.ts` `/v1/models` L391-395：链式双重过滤（见 D3）。
- `routes/anthropic-proxy.ts` L58-62：同 proxy.ts 校验改造。
- `routes/user-api.ts` `GET /models`（L93-96）**不动**：该端点是用户维度（无令牌上下文），令牌维度过滤已由 token 化的 `/v1/models` 承担。

## D5 令牌 CRUD：三态 PATCH + 校验抽纯函数

### D5.1 `serializeAllowedModels` 下沉复用

`routes/admin-users.ts:31-56` 的模块私有 `serializeAllowedModels`（null→null、[]→null、元素 trim 非空校验，调研 §G2）**移至** `utils/model-allowlist.ts` 导出（改名 `serializeAllowlist`），`admin-users.ts` 改为 import。行为逐分支保持不变——它是现存的唯一「数组→JSON 串」校验实现，tokens 路由直接复用，避免复制。

### D5.2 新建 `apps/worker/src/services/token-update.ts`（纯函数，可测）

```ts
export type TokenUpdateInput = {
	name?: string;
	quota_total?: number | null;
	quota_used?: number | null;
	status?: string;
	allowed_channels?: unknown;
	allowed_models?: unknown;
};

export function resolveTokenUpdate(
	body: unknown,
	existing: { name: string; quota_total: number | null; quota_used: number; status: string; allowed_channels: string | null; allowed_models: string | null },
): { ok: true; values: {...全部列的最终值...} } | { ok: false; error: "invalid_quota" | "invalid_allowed_models" | "invalid_status" | ... };
```

三态语义（对 PRD R3）：

| 字段 | undefined | null | 值 |
|------|-----------|------|----|
| `name` | 保留 | 保留（视为 undefined） | 非空字符串，否则 invalid |
| `quota_total` | 保留 | **NULL（无限）** | 有限数字 ≥ 0，否则 invalid_quota |
| `quota_used` | 保留 | 保留（null 无意义） | 整数 ≥ 0（UI 清零发 `0`） |
| `status` | 保留 | 保留 | `"active" \| "disabled"`，否则 invalid_status |
| `allowed_channels` | 保留 | NULL（清除） | 透传现有格式（JSON 串化），不解释 |
| `allowed_models` | 保留 | NULL（不限制） | 经 `serializeAllowlist` 校验，失败 invalid_allowed_models |

`routes/tokens.ts` PATCH 改为：读 existing → `resolveTokenUpdate(body, existing)` → 失败 400（错误码原样透出）→ 成功用 values 拼 UPDATE（列清单加 `allowed_models`）。替换现有「NaN 静默回退 existing」的行为（PRD R3：非法值必须 400）。

- GET `/` 列清单追加 `tokens.allowed_models`，响应中经 `parseAllowlist` 还原为**数组**返回（对齐 admin-users 响应格式，调研 §G2 末条）。
- POST `/`：body 支持 `allowed_models`（经同一 serializer 校验，缺省 → NULL）。**顺带修正**：现有 `JSON.stringify(body.allowed_channels ?? null)` 缺省时入库字面量 `"null"` 字符串（调研 §F1），改为 NULL —— 仅限新令牌，存量不动（`safeJsonParse("null")` → null，fail-open，无行为差异）。

### D5.3 `routes/user-api.ts`（用户端）

- `GET /tokens`（L107）：SELECT 追加 `allowed_models`，响应还原数组。
- `POST /tokens`（L117-152）：接受 `allowed_models`（可选，经 serializer），INSERT 加列；**不接受任何 quota/status 字段**（现固定值不变）。
- `PATCH /tokens/:id`（L155-187，现仅 name）：扩展支持 `allowed_models`（三态同上）。**拒绝 `quota_total` / `quota_used` / `status` / `allowed_channels`**：body 中出现即 400 `field_not_editable`——白名单只能收窄、额度只能管理员改（PRD R2/R3）。
- 白名单配置入口对用户开放但校验在服务端：用户可提交任意模型名数组，运行时与用户级白名单取交集兜底（D3/D4），不构成提权面。

## D6 管理台 UI

### D6.1 共享组件 `apps/ui/src/features/ModelAllowlistPicker.tsx`（新建）

从 `UsersView.tsx` 的白名单编辑 UI（候选 ∪ 已配置、搜索过滤、checkbox 列表，调研 §L2）抽取：

```tsx
type ModelAllowlistPickerProps = {
	selected: Set<string>;
	onChange: (next: Set<string>) => void;
	fetchCandidates: () => Promise<string[]>;
	initialModels?: string[]; // 已配置值并入候选集（编辑态可见存量项）
};
```

`UsersView` 重构为消费该组件（行为保持，属机械搬移）。四处使用：管理台创建/编辑模态、用户端创建/编辑模态。

### D6.2 AdminApp 状态模型（参照渠道编辑先例，调研 §L1）

- 新增 state：`editingToken: Token | null`（非 null 即打开编辑模态）、`tokenForm: { name, quota_total, quota_used, allowed_models: string[] }`。
- 新增 handler：`openTokenEdit(t)`（回填 tokenForm）、`closeTokenEdit()`、`handleTokenEditSubmit`（PATCH `/api/tokens/:id`，quota_total 空串→null、quota_used 数字、allowed_models 数组）。
- `handleTokenSubmit`（创建）body 追加 `allowed_models`。
- 新增 prop 传递：`onFetchModelCandidates`（复用现有 `loadModelCandidates`，AdminApp:211-213）+ 编辑相关四项 → `TokensView`。

### D6.3 TokensView

- props 追加：`editingToken`、`onEdit`、`onCloseEditModal`、`onEditSubmit`、`onFetchModelCandidates`。
- 行操作追加「编辑」按钮（复制/编辑/切换/删除）。
- 桌面表格与移动卡片新增「模型限制」列：无限制显示「全部」，有限制显示「N 个模型」徽章（title 列出明细），样式对齐 UserTokensView 现存渠道徽章（调研 §J2）。
- 创建模态追加白名单 picker；新建编辑模态（字段：名称 / 额度总额(空=无限) / 已用额度 / 白名单 picker）。

### D6.4 types

`core/types.ts` `Token` 追加 `allowed_models?: string[] | null`（服务端已还原为数组）。

## D7 用户端 UI

- `UserApp.tsx`：`handleTokenCreate` body 追加 `allowed_models`；新增 `handleTokenEdit`（PATCH `/api/u/tokens/:id`，仅 name + allowed_models）；候选来源用用户可见模型（`GET /api/u/models` 的 id 列表，天然已被用户级白名单过滤）。
- `UserTokensView.tsx`：表格加「模型限制」列（解析逻辑同其现存 `parseAllowedChannels` 徽章做法）；创建模态加 picker；新增编辑模态（名称 + 白名单，**无额度字段**）。

## D8 兼容与回滚

- **存量令牌**：新列 NULL → 不限制；`key_hash` 校验与长度无关 → 旧令牌照常可用（AC2）。
- **API 兼容**：所有新字段可选；旧客户端不传 `allowed_models` 行为不变。PATCH 三态中 null 语义是行为修正（原先 null 等效 undefined）——唯一可能依赖旧行为的调用方是管理台自身（现 UI 从不发 null），风险可忽略。
- **回滚形状**：代码回滚即可恢复；`allowed_models` 列遗留无害（SQLite ADD COLUMN 无破坏性）。迁移无需降级脚本（与既有迁移一致）。
- **部署顺序**：backend 迁移先行（列存在但代码未用 = 无影响），UI 随后；CI 单工作流 both 场景天然满足。

## D9 测试设计（沿用纯函数模式，调研 §K）

| 文件 | 覆盖 |
|------|------|
| `tests/model-allowlist.test.ts`（扩展） | `isModelAllowedByAll`：全 null 放行 / 单清单拦截 / 双清单交集 / 空串模型 / 与空数组（parse 后为 null）组合 |
| `tests/crypto-token.test.ts`（新建） | `generateToken("sk-", 32)` 长度 46、charset base64url；默认 24 字节长度 35（回归护栏：其他用途不变） |
| `tests/token-update.test.ts`（新建） | `resolveTokenUpdate` 三态矩阵：undefined 保留 / null 清除 / 非法值 400 错误码 / quota_used 负数拒绝 / allowed_models 经 serializer 校验 |
| 路由层（D1 依赖） | 不建 mock 基建，依赖纯函数测试 + AC 手工验证清单（implement.md §V2） |
