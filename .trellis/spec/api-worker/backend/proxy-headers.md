# Proxy Headers — 上游请求头策略契约

> 来自任务 `09-14-global-custom-headers`。改动两条代理链路的请求头行为、或新增
> settings 配置项之前必读。

---

## Scenario: 上游请求头策略（全局注入 / 全局剔除 / 渠道级）

### 1. Scope / Trigger

- 任何需要修改"发往上游的请求头"的工作（`proxy.ts`、`anthropic-proxy.ts`、`playground.ts`）。
- 任何新增 settings 配置项的工作（本任务建立的标准链路，见 §8）。

### 2. Signatures

```ts
// apps/worker/src/utils/proxy-headers.ts —— 头策略唯一入口
export type ProxyHeaderPolicy = {
	extraHeaders: Record<string, string>; // 全局注入
	removeHeaders: string[]; // 全局剔除
};
export function parseExtraHeaders(raw: string | null | undefined): Record<string, string> | null;
export function parseRemoveHeaders(raw: string | null | undefined): string[] | null;
export async function loadProxyHeaderPolicy(db: D1Database): Promise<ProxyHeaderPolicy>;
export function applyHeaderPolicy(
	headers: Headers,
	policy: ProxyHeaderPolicy | null,
	channelCustomJson: string | null | undefined,
): void;

// buildChannelRequest 第 9 参（可选，默认 null）
buildChannelRequest(channel, targetPath, querySuffix, incomingHeaders,
	requestText, parsedBody, isStream, apiKey?, policy?)
```

### 3. Contracts

- settings KV（无迁移，key 缺失 = 空配置）：
  - `proxy_extra_headers`：JSON 对象字符串，值必须全为字符串。
  - `proxy_remove_headers`：JSON 字符串数组。
- 存储原文 JSON 字符串；**写入严格校验、读取宽容**（解析失败按空配置，不阻断代理请求）。
- API：`GET /api/settings` 返回 `proxy_extra_headers` / `proxy_remove_headers`（string，未设置为 `""`）；
  `PUT` 空串 = 清空。
- UI 字段流转链路（新增 settings 项必须全通）：
  `services/settings.ts get/set` → `routes/settings.ts GET/PUT` →
  `ui core/types.ts (Settings + SettingsForm)` → `core/constants.ts initialSettingsForm` →
  `AdminApp.tsx (loadSettings ?? "" 映射 + handleSettingsSubmit)` → `SettingsView.tsx` 表单。
- KV 键常量单点定义于 `utils/proxy-headers.ts`，service/route 引用常量，不要散落字符串字面量。

### 4. Validation & Error Matrix

| 条件 | 结果 |
|------|------|
| 注入值非字符串 / JSON 非对象 | 400 `invalid_proxy_extra_headers` |
| 剔除非字符串数组 / JSON 非数组 | 400 `invalid_proxy_remove_headers` |
| 空串 `""` | 合法 = 清空 |
| 运行时读到非法 JSON | 按空配置继续，不报错 |

### 5. Good/Base/Bad Cases

- **Good**：`loadProxyHeaderPolicy` 与渠道查询 `Promise.all` 并行预载；每请求一次，重试轮复用。
- **Base**：两项配置缺失 + 渠道无 custom_headers → 请求头与历史版本行为完全一致（零回归基线，测试有断言）。
- **Bad**：在分支内联 merge 渠道级头 / 在 `buildChannelRequest` 内部自动读 settings（会污染 Playground 豁免）。

### 6. Tests Required

`tests/proxy-headers.test.ts`（25 用例）断言点：
- parse 容错矩阵（null / 空串 / 标量 / 值非字符串 / 非数组）。
- `applyHeaderPolicy` 顺序：剔除 → 全局注入 → 渠道级；policy=null 仅渠道级；大小写不敏感删除。
- `buildChannelRequest` 三格式 ×（policy 注入 + 渠道级覆盖）矩阵；不传 policy 的零回归基线。

### 7. Wrong vs Correct

#### Wrong
```ts
// 分支内联 merge（历史写法，已删除）——行为会在 6 个分支间漂移
if (channel.custom_headers_json) {
	const custom = safeJsonParse<Record<string, string>>(channel.custom_headers_json, {});
	for (const [k, v] of Object.entries(custom)) headers.set(k, v);
}
```

#### Correct
```ts
// 内置头设置完之后、fetch/return 之前，统一调用（policy 可为 null）
applyHeaderPolicy(headers, policy, channel.custom_headers_json);
```

---

## Gotchas（踩过的坑）

> **Warning：「后应用者赢」贯穿始终。**
> 应用顺序固定为 剔除 → 全局注入 → 渠道级，后写者可覆盖内置鉴权头
> （`Authorization` / `x-api-key`）。这是刻意保留的能力（历史 custom 分支即如此），
> 不要加"保护名单"回退它；风险由 UI 警示文案兜底。

> **Warning：`/anthropic/v1` 三个分支是 fresh Headers 白名单式构造。**
> 客户端头本来就不透传，剔除操作是 no-op，但仍必须统一调用 `applyHeaderPolicy`
> （一致性 + 防未来分支改动遗漏）。全局注入在这些分支同样生效。

> **Warning：Playground 的 `incomingHeaders` 是空的 `new Headers()`。**
> 它从不透传客户端头（现状），因此"全局剔除"在 Playground 无测试面；豁免仅指
> 不传 policy（全局注入/剔除均不生效），渠道级头在统一后**会**生效（预期行为）。

> **Warning：连通性测试 / 拉取模型（`channel-testing.ts`）不走本策略。**
> `fetchChannelModels` 保持自己的 custom-only 渠道级 merge——若强行收敛到
> `applyHeaderPolicy`，openai/anthropic 渠道的连通性测试会开始带渠道级头，属行为外溢。

---

## 8. 新增 settings 配置项 Checklist（本任务建立的标准链路）

1. `services/settings.ts`：`get/set` 函数对（存原文，模式照抄 `setAnnouncement`）。
2. `routes/settings.ts`：GET 返回（`?? ""`）+ PUT 校验分支（snake_case 400 错误码）。
3. UI `types.ts`：`Settings` **和** `SettingsForm` 各加字段（两处都改，漏一个类型报错）。
4. UI `constants.ts`：`initialSettingsForm` 补默认值。
5. UI `AdminApp.tsx`：`loadSettings` 映射 + `handleSettingsSubmit` 提交。
6. UI `SettingsView.tsx`：表单字段 + 说明文案。
7. 无需 D1 迁移（settings 是 KV 表）；本地冒烟可用 `bunx wrangler d1 execute api-worker --local --json`（须在 `apps/worker/` 目录下执行，否则找不到 DB）。
