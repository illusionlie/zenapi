# 技术设计 — responses 渠道格式与 Chat↔Responses 双向转换

> 本设计的路由矩阵、映射表均基于当前代码实勘（分支号 main @ 9a8f61a）。关键插入点全部给出文件与行号级锚点。

## 1. 决策记录（D1–D5）

| # | 决策 | 理由 |
|---|------|------|
| D1 | 显式 `responses` 渠道格式，而非 openai 渠道加能力开关 | 语义前置到配置面：路由过滤、usage 解析、连通性测试都需要格式级区分；开关方案让这些逻辑继续靠猜 |
| D2 | Phase 1 只做 chat↔responses；anthropic↔responses 用**候选过滤**挡住（503 `no_available_channels`） | anthropic 入站遇到 responses 渠道在路由层就排除，根本不会选中 → 503 语义比 400 `unsupported_conversion` 更准确（问题是"无可用渠道"而非"转换不支持"）；转换本身 ROI 低（见 D5） |
| D3 | 不加 `supports_responses` 开关，保留 openai 渠道 400/404→`/responses` 回退 | 回退已是探测式兜底；避免配置面膨胀 |
| D4 | 非聊天透传路径（如 `/v1/embeddings`）对 responses 渠道 = openai 式透传 | OpenAI 官方上游同时服务这些端点，透传语义合理；不为第三方 responses-only 上游做特殊排除 |
| D5 | 明确不做 responses→anthropic 全保真转换 | Responses `reasoning.encrypted_content` 与 Anthropic thinking signature 体系不对齐；web_search/file_search 工具形态迥异；tool_result 必须紧跟 tool_use 的严格校验 → 静默转换必然产出上游 400 垃圾 |

## 2. 路由矩阵（改动核心之一）

现有过滤：`proxy.ts:423-437` 仅一条规则——非 CHAT_PATHS 排除 anthropic。改为**按入站协议计算允许的格式集合**：

```ts
// proxy.ts（OpenAI 入站）
function allowedFormatsForPath(path: string): Set<ChannelApiFormat> | null {
	// null = 不过滤（等价全部允许）
	const lower = path.toLowerCase();
	if (lower.startsWith("/v1/responses")) {
		return new Set(["openai", "responses", "custom"]); // R2：排除 anthropic，修复缺陷
	}
	if (isChatPath(lower)) {
		return null; // chat/completions：全部格式（responses 走转换）
	}
	// 非 chat 透传（embeddings 等）：维持排除 anthropic；responses 按 D4 放行
	return new Set(["openai", "responses", "custom"]);
}
```

- `anthropic-proxy.ts`：候选处排除 `"responses"`（现有三分支 anthropic/openai/custom 不动；responses 渠道不进循环）。
- `stream_only` 过滤、权重排序、key 轮换逻辑全部不动。

## 3. 请求构建 — `buildChannelRequest` 新分支（proxy.ts:107）

`apiFormat === "responses"` 分支（与 openai 分支并列，header 策略走同一 `applyHeaderPolicy`）：

| 入站 targetPath | target | body |
|---|---|---|
| `/v1/responses`（大小写不敏感） | `base_url`（去尾斜杠）+ `/responses` + querySuffix | `requestText` 原样（alias 命中时 `channelRequestText` 已含替换后的 model） |
| CHAT_PATHS（chat/completions） | 同上 `/responses` | `JSON.stringify(openaiToResponsesRequest(channelParsedBody))` —— 转换器内丢弃 `stream_options` |
| 其他透传路径 | openai 同规则：`base_url + subPath`（`subPath = targetPath.replace(/^\/v1\b/, "")`） | `requestText` 原样 |

- headers：`Authorization: Bearer` + `x-api-key`（与 openai 分支一致），`host`/`content-length` 删除逻辑复用。
- **fallback 不适用**：现有 `fallbackSubPath` 仅在入站为 `/v1/responses` 且渠道为 openai 时触发（proxy.ts:452,517），responses 渠道天然支持、显式跳过，不改这段。

## 4. 转换器 — `services/format-converter.ts` 新增三件套

### 4.1 `openaiToResponsesRequest(body)` — chat → responses 请求

| Chat 字段 | Responses 映射 | 备注 |
|---|---|---|
| `messages[role=system]` | `instructions`（多条按序 `\n\n` 拼接） | developer 角色同 system 处理 |
| `messages[role=user]` content text | `{role:"user", content:[{type:"input_text", text}]}` | content 数组中 `image_url` → `{type:"input_image", image_url}`；`audio` 丢弃 |
| `messages[role=assistant]` text | `{role:"assistant", content:[{type:"output_text", text}]}` | |
| `assistant.tool_calls[]` | `{type:"function_call", call_id, name, arguments}` items（按原顺序插在 assistant 文本 item 后） | |
| `messages[role=tool]` | `{type:"function_call_output", call_id, output}` | `tool_call_id` → `call_id` |
| `model` / `temperature` / `top_p` / `parallel_tool_calls` / `stream` / `user` | 直通 | |
| `max_tokens` / `max_completion_tokens` | `max_output_tokens` | 同时存在取 max_completion_tokens |
| `tools[].function{name,description,parameters}` | `{type:"function", name, description, parameters}`（扁平化） | 非 function 类型 tool 丢弃 |
| `tool_choice: "auto"/"none"/"required"` | 直通 | `{type:"function",function:{name}}` → `{type:"function", name}` |
| `response_format: {type:"json_object"/"json_schema", json_schema}` | `text: {format: {...}}`（schema 扁平化为 `{type, name, schema, strict}`） | |
| `reasoning_effort` / `reasoning.effort` | `reasoning: {effort}` | |
| `stop` / `n` / `logprobs` / `stream_options` | **丢弃** | responses 无对应或网关不需要；转换器对未知字段保守丢弃 |

### 4.2 `responsesToChatResponse(data)` — responses → chat 非流式响应

| Responses 字段 | Chat 映射 |
|---|---|
| `id` / `model` / `created_at` | `id` / `model` / `created` |
| `output[type=message].content[type=output_text].text` 拼接 | `choices[0].message.content`；`refusal` 内容 → `message.refusal` |
| `output[type=function_call]` | `choices[0].message.tool_calls[]`：`{id: call_id, type:"function", function:{name, arguments}}` |
| `output[type=reasoning]` | 忽略（Phase 1 不映射 reasoning_content） |
| `usage{input_tokens, output_tokens, total_tokens}` | `usage{prompt_tokens, completion_tokens, total_tokens}` |
| `finish_reason` | `output` 含 function_call → `"tool_calls"`；`status === "incomplete"` 且 `incomplete_details.reason === "max_output_tokens"` → `"length"`；否则 `"stop"` |
| `object: "response"` | `object: "chat.completion"`，`choices: [..]`（恒 1 个，n 不支持） |
| `output[type≠message/function_call/reasoning]`（web_search_call 等） | 忽略 |

### 4.3 `createResponsesToChatStreamTransform()` — responses SSE → chat SSE（风险最高的一块）

输入：Responses 事件流（`data: {type: "response.*"}` 行）。输出：标准 chat SSE（`data: {choices:[{delta}]}` + 终止 `data: [DONE]`）。

| 上游事件 | 输出 |
|---|---|
| `response.created` | 首个 chunk：`{id, model, choices:[{index:0, delta:{role:"assistant"}, finish_reason:null}]}` |
| `response.output_item.added`（item.type=function_call） | delta：`{tool_calls:[{index: <递增>, id: call_id, type:"function", function:{name, arguments:""}}]}` |
| `response.output_text.delta` | delta：`{content: delta}` |
| `response.function_call_arguments.delta` | delta：`{tool_calls:[{index: <对应>, function:{arguments: delta}}]}`（item_id → index 映射表） |
| `response.completed` | 终止 chunk：`delta:{}` + `finish_reason`（同 4.2 规则）+ `usage`（4.2 口径），随后 `data: [DONE]` |
| `response.failed` / `response.incomplete` | `response.error` 时产出终止 chunk（finish_reason: "stop"，错误信息经 `usage_logs` 的 error 路径由外层状态码处理——流已 200，记 warn 日志 + 正常闭合） |
| 其他事件（`response.output_item.added(type=message)`、`response.content_part.*`、`response.reasoning_*`） | 吞掉不透出 |

实现模式参照 `createAnthropicToOpenaiStreamTransform` / `createOpenaiToAnthropicStreamTransform`（TransformStream，内部状态机累积 tool_call index 映射）。首 token 延迟由外层 `parseUsageFromSse` 统计，transform 无需关心。

## 5. 响应转换接线 — `convertResponse`（proxy.ts:165）

签名扩展：`convertResponse(channel, response, isStream, inboundPath: string)`。

- `apiFormat === "responses"` 且 inboundPath 是 CHAT_PATHS（即请求被转换过）：
  - 流式 → `pipeThrough(createResponsesToChatStreamTransform())`，回 `text/event-stream` Response（与 anthropic 分支同构）。
  - 非流式 → `responsesToChatResponse(await response.json())`。
- `apiFormat === "responses"` 且 inboundPath 为 `/v1/responses` 或透传路径 → 原样返回 response（R4）。
- anthropic / openai / custom 分支不变。调用点 proxy.ts:541 传 `responsePath`。

## 6. usage 解析 — `utils/usage.ts`

- `parseUsageFromJson`（:73）取值链扩展：`data.usage ?? data.data?.usage ?? data.response?.usage`。
  - 覆盖：Responses SSE `response.completed` 事件（`{type, response:{usage}}`）与非流式透传响应（顶层 `usage` 已覆盖）。
- `normalizeUsage` 已兼容 `input_tokens/output_tokens`（:38-40），无需改。
- chat 入站 + responses 渠道的流式：SSE 已被 transform 转成 chat 格式（终止 chunk 带 usage），现有解析器自动工作。

## 7. 渠道 CRUD / 测试 / UI

- `channels.ts`：`api_format` 无枚举白名单校验（直接类型断言），新增值不需改校验；base_url 规范化分支（:140,204,270 的 `apiFormat === "anthropic"` 三元）responses 走 openai 同侧（去尾斜杠），仅当 anthropic 时走 `normalizeBaseUrl` —— 现有写法天然满足，加测试锁定。
- `services/channel-testing.ts:37`：`else if (format === "openai")` → `else if (format === "openai" || format === "responses")`（探测 `/models` + Bearer）。
- `routes/newapiChannels.ts:347`：union 断言补 `"responses"`。
- UI：
  - `core/types.ts`：`ChannelApiFormat` 加 `"responses"`（`Record<ChannelApiFormat,...>` 结构会强制补全所有映射，编译器兜底）。
  - `features/ChannelsView.tsx`：格式下拉加选项（:742 附近三个 `RadioItem` 模式照抄）；`baseUrlPlaceholders.responses = "https://api.openai.com/v1"`（:249）；列表格式徽章（:429,442,531）显示名同步。
  - `features/MonitoringView.tsx` 若有格式展示一并同步。

## 8. 兼容性 / 回滚

- 无 schema/迁移变更；存量渠道默认 openai，行为零变化。
- 步骤化提交（见 implement.md），每步可独立 revert；步骤 3（转换器）合入但未接线前对运行时无影响。
- New API 兼容层（newapiChannels）仅类型面变化。

## 9. 已知边界（记录不做的事）

- anthropic↔responses 转换不做（D2/D5）；responses 渠道不出现在 anthropic 入站候选。
- chat 的 `n>1`、`logprobs`、`stop` 不映射；reasoning 内容不回传（需上游开 summary，Phase 2 再议）。
- responses 渠道的 400/404 无探测式回退（显式声明即承诺支持）。
- `store`/`previous_response_id` 透传不拦截；依赖上游状态的行为由调用方自担（README 不承诺）。
