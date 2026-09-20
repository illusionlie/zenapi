# design.md — 渠道多 API 格式与 responses 自动降级转换

> 技术设计。事实锚点见 `research/recon-api-format.md`；转换器契约红线见 `.trellis/spec/api-worker/backend/format-conversion.md`。

## 1. 核心模型：格式即能力声明

`api_formats` JSON 数组 = 该上游**原生支持**的端点集合。路由规则：入站协议命中「原生声明 ∩ 该协议可服务集合」即可路由到该渠道；命中多个时按协议固定偏好序选唯一目标格式（target format），后续请求构造/响应转换全部以目标格式为准。

引入概念 **InboundProtocol**（入站协议四分类）：

| 协议 | 判定 | 可服务集合（= 声明 ∩ 集合非空则渠道合格） |
|---|---|---|
| `chat` | `/v1/chat/completions` | openai、responses、anthropic、custom |
| `responses` | `/v1/responses` | responses、openai（**新增转换**）、custom；anthropic 排除 |
| `anthropic` | `/anthropic/v1/*` | anthropic、openai、custom；responses 排除 |
| `passthrough` | 其他 `/v1/*`（embeddings 等） | openai、responses、custom；anthropic 排除 |

## 2. 数据契约

### 2.1 迁移 `0022_channel_api_formats.sql`（下一个可用编号 0022）

```sql
ALTER TABLE channels ADD COLUMN api_formats TEXT;
UPDATE channels SET api_formats = json_array(api_format) WHERE api_formats IS NULL;
```

- `schema.sql` 同步加列（注释：JSON 数组，能力声明；镜像列 `api_format` 存首元素）。
- **`api_format` 列保留不删，作为镜像双写**（见 2.3），保证旧代码回滚可用、monitoring GROUP BY（`monitoring.ts:26`）与 New API 兼容层零改动。

### 2.2 类型与纯函数（`services/channel-types.ts`）

- `ChannelRow` 增 `api_formats: string | null`。
- `parseApiFormats(row): ChannelApiFormat[]`：读侧兜底链 `api_formats`（JSON.parse + 白名单过滤 + 去重）→ `[api_format]` → `["openai"]`。
- `normalizeApiFormats(input: unknown): { ok: true; value: ChannelApiFormat[] } | { ok: false; reason: string }`：写侧校验——白名单过滤后去重；空/全非法 → !ok；含 `custom` 且长度 > 1 → !ok（custom 独占）；输出按**规范序** `[openai, responses, anthropic]` 排序（custom 单独），保证镜像首元素确定。

### 2.3 channel-repo 双写

- SELECT 增 `api_formats` 列。
- INSERT / UPDATE 同时写 `api_formats`（全量数组 JSON）与 `api_format`（镜像 = 规范化数组首元素）。
- `ChannelInsertInput` / `ChannelUpdateInput` 增 `api_formats`；`api_format` 入参废弃（保留字段仅在 repo 内部派生镜像）。

## 3. 统一路由：`services/channel-routing.ts`（新服务）

按 directory-structure 规范下沉到 services，routes 只消费。

```ts
export type InboundProtocol = "chat" | "responses" | "anthropic" | "passthrough";
export function inboundProtocolForPath(path: string): InboundProtocol;
export function selectTargetFormat(declared: ChannelApiFormat[], inbound: InboundProtocol): ChannelApiFormat | null;
```

偏好序常量（`selectTargetFormat` 按「偏好序中第一个 ∈ declared」选取；null = 渠道不合格）：

| InboundProtocol | 偏好序（高→低） |
|---|---|
| chat | openai > responses > anthropic > custom |
| responses | responses > openai > custom |
| anthropic | anthropic > openai > custom |
| passthrough | openai > responses > custom |

- custom 排末位仅防御（校验层已禁组合），保证单 custom 渠道行为与现状一致。
- **单格式行为保持验证表**（实现时逐格对照，B2 测试锁定）：chat 入站 openai/responses/anthropic/custom → 各自原生/既有转换；responses 入站 responses → 透传、custom → 原样（既有 `allowedFormatsForPath` 含 custom）；anthropic 入站 anthropic/openai/custom → 现状三分支；passthrough → 与 `allowedFormatsForPath` 非 chat 分支（`{openai, responses, custom}`）一致。

### 3.1 三处消费点替换

| 现状 | 改造 |
|---|---|
| `proxy.ts:625-640` `allowedFormatsForPath` + `allowedFormats.has(...)` | 逐渠道 `selectTargetFormat(parseApiFormats(ch), inboundProtocolForPath(path))`；全 null → 503 `no_available_channels`（错误码/语义不变）。选中的目标格式随渠道传递到 buildChannelRequest/convertResponse |
| `anthropic-proxy.ts:156-163` 内联 filter | 同上，inbound = "anthropic" |
| `playground.ts:71-77` 无过滤 | 显式 inbound = "chat"（targetPath 恒为 chat completions；各单格式行为与现状等价） |

`allowedFormatsForPath` 与 `CHAT_PATHS`/`isConvertedChatPath` 中被替代的部分删除或收编（`isConvertedChatPath` 语义转为「目标格式 responses 且入站 chat」判断，见 §4）。

## 4. 新增转换器（`services/format-converter.ts`）

命名沿用仓库惯例（openai = chat 格式名），三个新导出：

| 函数 | 方向 | 用途 |
|---|---|---|
| `responsesToOpenaiRequest` | responses 请求 → chat 请求 | responses 入站 + openai 目标的请求侧 |
| `openaiToResponsesResponse` | chat 响应 → responses 响应 | 同上非流式响应侧 |
| `createOpenaiToResponsesStreamTransform` | chat SSE → responses SSE | 同上流式响应侧 |

### 4.1 `responsesToOpenaiRequest` 映射契约

- `instructions` → system 消息（前置）；`input` 为字符串 → 单 user 消息。
- `input` 数组项：`message`（`input_text`/`output_text` → text；`input_image` → `image_url`，url 与 data URL 直通）→ 对应 role 消息；`function_call` → assistant 消息 + `tool_calls`（arguments 为 JSON 字符串）；`function_call_output` → `role:"tool"` 消息；其余项类型（reasoning item、local_shell_call 等）fail-open 丢弃 + `console.warn("[format-converter]", …)`。
- `tools`：Responses 扁平 function 形状 → chat 嵌套 `{type:"function", function:{name,description,parameters}}`；`tool_choice`：`"auto"/"none"/"required"` 直传，`{type:"function", name}` → 嵌套形状。
- `reasoning.effort` → `reasoning_effort`；`reasoning.summary` 等无对应物 → 丢弃 + warn。
- `max_output_tokens` → `max_tokens`；`temperature`/`top_p`/`parallel_tool_calls`/`stream` 直传。
- **stateful 字段**（`store`/`previous_response_id`/`conversation`/`background` 等）→ 丢弃 + 单条汇总 warn（chat 无状态承载，与既有 chat↔responses 转换的 state 语义口径一致）。
- 未知顶层字段：白名单外丢弃（与 fail-open 同哲学）；响应侧 client 直发的 `stream_options` 属客户端参数不透传。

### 4.2 `openaiToResponsesResponse` 契约

- 产出 `object:"response"`、`status:"completed"`、`output` 数组：文本 → `message` 项（`content:[{type:"output_text", text, annotations:[]}]`）；`tool_calls` → `function_call` 项；shape 以 `tests/format-converter-responses.test.ts` 既有 Responses fixture 与 `responsesToChatResponse` 的消费形状为准（互为逆变换）。
- usage 口径：`prompt_tokens → input_tokens`、`completion_tokens → output_tokens`、`total_tokens` 直传；`prompt_tokens_details.cached_tokens → input_tokens_details.cached_tokens`、`completion_tokens_details.reasoning_tokens → output_tokens_details.reasoning_tokens`。
- `finish_reason` 经 `mapFinishReason` 映射为 Responses 侧 `incomplete_details`/status 语义（照 `responsesToChatResponse` 反向）。

### 4.3 `createOpenaiToResponsesStreamTransform` 契约

- 事件序列：`response.created` → `response.output_item.added` →（`response.output_text.delta` | `response.function_call_arguments.delta`）* → `response.output_item.done` → `response.completed`；事件带递增 `sequence_number`。
- **usage 单末事件**：仅 `response.completed` 的 `response.usage` 携带完整三值（spec §3.1 last-wins 契约）；chat 上游流若无 usage 则 `response.completed.usage` 为零值对象，不虚构。
- `delta.reasoning_content` → `response.reasoning_summary_text.delta`（+ reasoning output item 包络）；无则不发。
- chat 上游的 `data: [DONE]` 作为流结束信号消费，**不向客户端透传**（Responses 协议无 [DONE]，以 `response.completed` 终止）；上游流内 `error`/异常中断 → 发 `response.failed` 事件后终止（流已 200 无法改状态码，与 spec §3.5 同哲学：显式终止优于悬挂）。
- chat 上游首个 chunk 前需缓冲至知道 role/id（`response.created` 需要这些字段）；id/model 取自上游 chat 响应。

### 4.4 与既有契约的交接

- chat 上游流式 usage 依赖 `stream_options.include_usage` 注入：现有注入条件 keyed on chat 入站，需放宽为「**目标格式为 openai 且流式**」（否则 responses→chat 转换流拿不到 usage）。客户端落库读取路径不变：responses SSE 的 `response.completed` 已被 `parseUsageFromSse` 支持（`tests/usage-responses.test.ts:112`）。
- 伪装（disguise）/头策略（applyHeaderPolicy）按**目标格式**分支的既有矩阵保持（`tests/client-disguise.test.ts:162`、`tests/proxy-headers.test.ts:193` 夹具补 `api_formats` 即可）。

## 5. 请求构造接线

维持 proxy / anthropic-proxy 两个入口，但 URL + 基础鉴权头按「目标格式」取自共享的端点描述（收敛到 `channel-routing.ts` 或 converter 旁的纯函数），消除两套构造的分叉面：

| 目标格式 | URL | 基础鉴权头 |
|---|---|---|
| openai | `{base_url}{subPath 去 ^/v1}` | `Authorization: Bearer` |
| responses | 入站 responses → `{base_url}/responses` 原样；入站 chat → `{base_url}/responses` + `openaiToResponsesRequest`；其他透传 → 去 `/v1` 前缀 | Bearer + `x-api-key`（现状 :204-259 保持） |
| anthropic | `{normalizeBaseUrl(base_url)}/v1/messages` | `x-api-key` + `anthropic-version: 2023-06-01` |
| custom | `base_url` 原样 | 现状 :261-275 保持 |

`buildChannelRequest` 新增分支：入站 responses + 目标 openai → body = `responsesToOpenaiRequest(parsedBody)`，URL = `{base_url}/chat/completions`。`convertResponse` 新增分支：入站 responses + 目标 openai → `openaiToResponsesResponse` / `createOpenaiToResponsesStreamTransform`。

**删除**：`fallbackSubPath` 与 400/404 路径回退块（`proxy.ts:656-657`、`:720-739`）——responses 入站 + openai 渠道改为转换后该组合的透传不复存在；声明 responses 的渠道维持「显式声明支持、无路径回退」语义。

## 6. CRUD / 测试工具 / 拉模型

- `routes/channels.ts` POST/PATCH：接受 `api_formats: ChannelApiFormat[]` 走 `normalizeApiFormats`（!ok → 400 `ERR_CHANNEL_INVALID_FORMATS`）；**双接受** legacy 单值 `api_format`（映射为单元素数组，两者同供时 `api_formats` 优先）；PATCH 三态：`undefined` 保留、提供值即整体替换、`null`/`[]`/非法 → 400（格式声明不可为空，遵循 patch-update-semantics 精神：不可空字段不给「清除」态）。响应载荷同时含 `api_formats` 与镜像 `api_format`。
- `newapiChannels.ts`：插入固定 `["openai"]`；PUT 保留现有 `api_formats`（镜像由 repo 派生，`:348-349` 的 `current.api_format` 改为 formats）。
- `channel-testing.ts fetchChannelModels`：改为接受格式数组；`Promise.allSettled` 逐非 custom 格式探测（各格式 URL/头规则不变，见 recon §6），成功结果按模型 id 去重取并集；部分失败 → 结果附 `probe_warnings: string[]`，全部失败 → 抛首个错误（整体失败语义不变）。`/api/channels/:id/test` 响应增逐格式 `results: [{api_format, ok, model_count, error?}]`，整体 ok = 全部声明格式 ok。
- test-model（`channels.ts:336-470`）：目标格式 = `selectTargetFormat(formats, "chat")`，构造 channel-like 时以目标格式覆盖（`:406-417` 的最小 ChannelRecord 机制直接复用），buildChannelRequest/convertResponse 链路零改动。

## 7. UI（apps/ui）

- `core/types.ts`：`Channel` / `ChannelForm` 增 `api_formats: ChannelApiFormat[]`（`api_format` 字段保留读兼容或移除，以提交链路改造最小为准）。
- `ChannelsView.tsx`：单选 select（:881-916）→ 多选 chips/checkbox 组（复用 `formatLabels`）；勾选 custom → 清空并禁用其余选项；base_url label/placeholder 联动改为「按所含格式集合」（含 anthropic 显示 anthropic 提示）。列表徽章（desktop :594-620 / mobile :683-702）渲染全部格式。
- `AdminApp.tsx` 回填(:441)/提交(:523)/fetch_models(:697)/test-model(:814) 请求体改传 `api_formats`。
- `MonitoringView.tsx:128` 徽章改读 `api_formats`；`core/constants.ts:47` 初始值 `api_formats: ["openai"]`。
- 交互规范遵循 `.trellis/spec/api-worker-ui/frontend/`（a11y、色系、容器集中持有状态）。

## 8. 兼容与迁移

- **存量数据**：迁移回填后语义与迁移前逐渠道等价（单元素数组）。
- **API 兼容**：单值 `api_format` 提交仍被接受；响应双字段；旧客户端/脚本不破坏。
- **回滚**：代码回滚旧版读镜像列 `api_format`（首元素 = 规范序首选），渠道仍以主格式路由，仅丢失次格式能力——降级可用，不崩。
- **明示行为变更**（唯一）：responses 入站 + openai 单格式渠道从「裸透传 + 路径回退」改为「自动转换 chat」。原依赖透传语义（上游真支持 responses 但未声明）的用户应改声明 `["openai","responses"]` 获得透传。AGENTS.md §8 对应条目重写。

## 9. 权衡记录

- **D1 双写镜像而非删列**：删列更干净但使回滚不可用、且 monitoring/newapi 需同改；镜像成本 = repo 层两个 SQL 参数。选镜像。
- **D2 自动转换（用户拍板）** vs 保持透传：转换修复 chat-only 上游 404 主痛点；状态字段（previous_response_id）不支持与既有转换口径一致。
- **D3 responses↔anthropic 延后（用户拍板）**：转换器语义映射重（input items、reasoning item 无对应物），本期多格式渠道可借声明 openai 覆盖聚合器场景。
- **D4 共享模型列表 + 并集探测（用户拍板）** vs 按格式模型表：并集简单且覆盖主场景；模型-格式亲和路由留待后续任务。
- **D5 custom 独占、usage_logs 不加列（评估默认，用户未反对）**：custom 无转换语义不可组合；request_path 已有间接痕迹。
- **D6 偏好序 openai 优先**：原生直通保真度最高；responses 排 anthropic 前因 OpenAI 系语义更近（tool/reasoning 参数直传），且 anthropic 目标本期对 responses 入站本就不可服务。
- **D7 新转换器命名沿用 openai=chat 惯例**：与既有 10 个导出命名一致，避免同义双词。

## 10. 风险

- proxy.ts 为核心代理路径，行为变更集中在 D 阶段（见 implement.md），以既有集成测试 + 新增端到端用例护栏；`fallbackSubPath` 删除是本期唯一的功能性移除。
- format-converter.ts 已 2036 行，新增三函数 + 辅助后接近 2600 行；如实现时膨胀超预期，可拆 `format-converter-responses-inbound.ts` 独立模块（导出面不变）。
- `normalizeBaseUrl` 在 anthropic 与回退路径语义存在分叉（recon §7），移除回退后该分叉仅剩 anthropic 一处，不再扩散。
