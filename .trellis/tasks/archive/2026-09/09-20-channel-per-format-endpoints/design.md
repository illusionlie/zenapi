# design.md — 渠道每格式独立端点覆盖

> 事实锚点见 `research/recon-endpoints.md`；前置契约见 `.trellis/spec/api-worker/backend/channel-routing.md`（本任务完成后需增补端点解析节）。

## 1. 核心语义：覆盖式端点解析

`base_url` 保持主端点地位；新增 `endpoint_overrides`（JSON 对象，键为格式名）声明某格式的专用端点。解析规则一句话：**`resolveEndpointBaseUrl(row, format) = overrides[format] ? 规范化(overrides[format], format) : 现行 base_url 推导`**，且无覆盖时输出与现行分支逻辑逐字节一致（AC1 红线）。

## 2. 数据契约

### 2.1 迁移 `0023_channel_endpoint_overrides.sql`

```sql
ALTER TABLE channels ADD COLUMN endpoint_overrides TEXT;
```

- 无回填（存量语义即「全部走 base_url 推导」，NULL 表达）。schema.sql 同步加列 + 注释。
- JSON 形态：`{"anthropic": "https://x.example/api/anthropic"}`；键白名单 `openai | responses | anthropic`（`custom` 拒绝）。

### 2.2 类型与解析（`services/channel-types.ts` + `services/channel-routing.ts`）

- `ChannelRow` 增 `endpoint_overrides: string | null`；`ChannelInsertInput` / `ChannelUpdateInput` 增 `endpoint_overrides: string | null`（repo 直存规范化后 JSON 串，解析派生走读侧函数）。
- `parseEndpointOverrides(row): Partial<Record<"openai"|"responses"|"anthropic", string>>`：JSON.parse + 键白名单过滤 + try/catch 容错（畸形 → `{}`），与 `parseApiFormats` 同哲学。
- `resolveEndpointBaseUrl(row: {base_url, endpoint_overrides}, format): string`——返回各分支**当前实际消费的形态**：

| format | 无覆盖（byte-identical 红线） | 有覆盖 |
|---|---|---|
| anthropic | `normalizeBaseUrl(base_url)` | `normalizeBaseUrl(override)` |
| openai / responses | `base_url.replace(/\/+$/, "")` | `override.replace(/\/+$/, "")`（保留版本路径） |
| custom | `base_url` 原样（无覆盖可能） | — |

- 落位 `channel-routing.ts`（与能力声明同域；spec 同文件增补）。

## 3. 接线点改造（6 处，全部换 resolver）

| # | 位置 | 现状 | 改造 |
|---|---|---|---|
| 1 | proxy.ts buildChannelRequest anthropic 分支（:163-193） | `normalizeBaseUrl(channel.base_url)` | `resolveEndpointBaseUrl(channel, "anthropic")` |
| 2 | proxy.ts responses 分支（:195-250） | `channel.base_url.replace(...)`（:197） | `resolveEndpointBaseUrl(channel, "responses")` |
| 3 | proxy.ts openai 分支（:268-328） | 同上（:270） | `resolveEndpointBaseUrl(channel, "openai")` |
| 4 | anthropic-proxy.ts 三分支（:227/:280/:344） | anthropic/openai/custom 各自拼 | anthropic/openai 换 resolver；custom 不动 |
| 5 | channel-testing.ts probeChannelFormat（:63/:66/:69） | 直接用 baseUrl 参数 | 签名改为接受 `{base_url, endpoint_overrides}` 行片段（或等价），逐格式 resolve |
| 6 | channels.ts fetch_models（:383）/ test-model（:478-479）/ `/:id/test`（:583-589） | 单一 baseUrl | 传解析所需的行片段（body 的 overrides 或 DB 行） |

- querySuffix、`cfSafeUrl`、路径拼接逻辑全部不动——resolver 只替换「baseUrl 前缀从哪来」。
- playground 复用 buildChannelRequest，自动生效，无需单独接线。

## 4. CRUD 契约（routes/channels.ts）

- 请求体增 `endpoint_overrides?: Record<string, string | null>`。
- **校验矩阵**（!ok → 400 `invalid_endpoint_overrides`，snake_case 与 `invalid_api_formats` 一致）：
  - 键不在 `{openai, responses, anthropic}` → 400（显式拒绝，防手误静默失效）；
  - 键 = `custom` 或键对应格式不在**本次生效的 api_formats**（body 声明 ?? DB 现值）→ 400；
  - 值非空字符串且不以 `http://` / `https://` 开头 → 400；
  - 值 = `null` / `""` → 删除该键（清除态）；键不存在 → 不变；字段整体 `undefined` → 保留现值。
- **存储规范化**（写前）：anthropic 键值走 `normalizeBaseUrl`（其消费语义即 `normalizeBaseUrl` 后拼 `/v1/*`）；openai/responses 键值 trim + 去尾斜杠（保留版本路径）。空对象序列化为 `NULL`。
- newapiChannels：POST 固定 NULL；PUT 保留现值（不透传，Out of Scope）。

## 5. UI（apps/ui）

- `ChannelForm` 增 `endpoint_overrides: { openai?: string; responses?: string; anthropic?: string }`（字符串留空 = 未覆盖）。
- ChannelsView：base_url 输入框下方，按 `selectedFormats` 渲染非 custom 格式的可选输入（label 如「Anthropic 端点覆盖（可选）」，placeholder 展示推导形态：anthropic `留空则按 Base URL 推导（…/v1/messages）`、responses `留空则按 Base URL 推导（…/responses）`、openai `留空则按 Base URL 推导（…/chat/completions）`；格式未选中时不渲染该输入且值不提交）。
- 提交 body：仅提交**当前选中且非空**的键 + 显式清空的键（选中但清空 → 该键传 `""` 以触发清除；未选中格式不出现）。回填：`parseEndpointOverrides` 同构读侧（core/utils.ts）。
- fetch_models / test-model 请求体带 `endpoint_overrides`（仅选中格式的键）。
- a11y 与组件规范遵循 frontend spec（label/htmlFor 关联）。

## 6. 兼容与迁移

- 存量渠道 NULL → 解析函数走兜底 → 行为逐字节不变；AC1 由既有 URL 断言用例**不改一行**验证。
- wire 形态：GET /api/channels 经 `SELECT *` 返回 TEXT JSON 字符串，UI 端解析——与 `api_formats` 同款约定。
- 回滚：新列 Nullable，旧代码不读不写，无破坏。

## 7. 权衡记录

- **D1 覆盖 map 而非全量端点 map**：base_url 保留主端点与兜底，存量零感知、UI 少三个必填框；代价是解析多一层「覆盖优先」判断（一个纯函数，值得）。
- **D2 显式 400 拒绝未知键/未声明键** vs 静默忽略：端点配置错配静默失效=请求打到错误上游，fail-fast 更符合 fail-open 仅用于运行时脏数据的分层哲学。
- **D3 custom 不可覆盖**：base_url 即完整 URL 的既有语义，允许覆盖会产生两个"完整 URL"来源。
- **D4 New API 层不透传**：该层是 New API schema 兼容面，非本字段的目标用户入口；保留现值避免破坏其幂等 PUT。
- **D5 不做每格式独立 API Key**：coding plan 普遍单 key 通吃；确有分端点 key 的上游再立项（PRD Out of Scope 已声明）。
- **D6 resolver 落位 channel-routing.ts**：与能力声明/偏好序同域，避免新模块碎片化；spec 同文件增补。

## 8. 风险

- `tests/channel-testing.test.ts` 的 INSERT 位置断言（args[2]/args[12]/args[13]）会因列序位移而碎——Phase A 同步更新（已知、机械）。
- URL 断言用例（proxy-responses 14 处 target 断言）是 AC1 的护栏，Phase C 不得弱化其断言。
- anthropic 覆盖的 normalizeBaseUrl 语义（剥 `/v1`）与覆盖值本身带 `/v1` 的输入（如 `https://x/anthropic/v1`）交互：规范化后拼 `/v1/messages` 会得到 `/anthropic/messages`——属用户配置错误，由文档 placeholder 引导（「填到协议根，勿含 /v1」），不做运行时纠偏（与 base_url 同等宽容度）。
