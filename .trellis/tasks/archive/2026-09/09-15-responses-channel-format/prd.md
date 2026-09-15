# 新增 responses 渠道格式与 Chat↔Responses 双向转换

## Goal

为渠道 `api_format` 新增显式 `responses` 类型（OpenAI Responses API 协议上游）：
`/v1/chat/completions` 入站可路由到 responses 渠道（双向转换，含流式）；
`/v1/responses` 入站路由矩阵精确化，修复当前会误路由到 anthropic 渠道产出垃圾请求的缺陷；
usage 解析兼容 Responses 格式；anthropic↔responses 转换本期不做，用候选过滤挡住。

## 背景与问题（现状缺陷）

1. **误路由缺陷**：`/v1/responses` 入站属于 `CHAT_PATHS`（proxy.ts:92），anthropic 格式渠道保留在候选中，
   但 `buildChannelRequest` 的 anthropic 分支只会按 Chat Completions 结构转换请求体（`openaiToAnthropicRequest`
   不认 `input` 字段），转发到 `/v1/messages` 必然失败 —— 静默产生无效请求并消耗重试轮次。
2. **usage 漏采**：Responses 格式 SSE 的 usage 在 `response.completed` 事件的 `response.usage` 字段，
   `parseUsageFromJson` 只找顶层 `usage` / `data.usage`，透传场景计费漏采。
3. **语义模糊**：`/v1/responses` 能否被某 openai 渠道服务不可知，只能靠 400/404 盲试 `/responses` 回退；
   管理员无法显式声明「此渠道说 Responses 协议」。

## Requirements

- R1 渠道类型扩展：`ChannelApiFormat` 新增 `"responses"`；管理 CRUD、New API 兼容渠道接口、UI 全链路支持。
- R2 路由矩阵精确化（按入站协议过滤候选渠道格式）：
  - `/v1/chat/completions` 入站：全部格式可用（responses 渠道走转换）。
  - `/v1/responses` 入站：`openai` / `responses` / `custom` 可用，**排除 `anthropic`**。
  - 其他 `/v1/*` 透传路径（embeddings 等）：`openai` / `responses` / `custom` 按现有 openai 透传规则，排除 `anthropic`（维持现状）。
  - `/anthropic/v1/messages` 入站：`openai` / `anthropic` / `custom` 可用，**排除 `responses`**（本期不做转换）。
  - 过滤后无候选 → 503 `no_available_channels`（现有错误路径）。
- R3 Chat↔Responses 双向转换（responses 渠道）：
  - 请求：chat messages → responses input/instructions/tools 映射（详见 design.md 映射表）。
  - 响应：responses output → chat completion 结构（content / tool_calls / usage / finish_reason）。
  - 流式：responses SSE 事件流 → chat SSE（content delta、tool_calls 增量、finish_reason、usage、[DONE]）。
  - Playground（复用 `buildChannelRequest`）自动获得同等能力。
- R4 透传语义：`/v1/responses` 入站 → responses 渠道原样转发（含 `store`/`previous_response_id` 等字段，ZenAPI 不解释不缓存，状态由上游承担）。
- R5 usage 解析兼容：`parseUsageFromJson` 支持 `response.usage` 路径；转换场景经 chat 格式 SSE 自动入账；`input_tokens/output_tokens` 口径归一到现有 `promptTokens/completionTokens`。
- R6 渠道测试 / 模型拉取：responses 渠道按 openai 语义探测（`GET {base_url}/models` + Bearer），base_url 规范化与 openai 相同（去尾斜杠，保留版本路径）。
- R7 UI：ChannelsView 格式下拉新增「Responses」选项、base_url placeholder（`https://api.openai.com/v1`）、类型定义同步。

## 约束

- custom 渠道行为完全不变（原样转发）。
- openai 渠道现有的 `/v1/responses` 400/404 → `/responses` 探测式回退**保留**（对未声明 responses 的上游仍是兜底）。
- 无 DB 迁移（`api_format` 为无约束 TEXT，新增枚举值不涉及 schema 变更）。
- 不给 openai 渠道加 `supports_responses` 开关（避免配置面膨胀，靠显式格式 + 现有回退覆盖）。
- 不做 responses→anthropic 转换（reasoning 签名体系、工具形态不对齐，无保真映射；路由层排除后不会发生）。
- 错误形态沿用 `jsonError` / `ERR` 风格与现有 503 `no_available_channels`。

## Acceptance Criteria

- [ ] chat 入站 + responses 渠道（非流式）：返回合法 Chat Completions 结构 —— `choices[0].message.content`、`usage.prompt_tokens/completion_tokens/total_tokens`、`finish_reason`（有 function_call → `tool_calls`，截断 → `length`，否则 `stop`）。
- [ ] chat 入站 + responses 渠道（流式）：输出合法 chat SSE（`choices[].delta.content` 增量、tool_calls 增量、终止 `finish_reason` + usage、`data: [DONE]`），usage 正确入账（`usage_logs` 有记录）。
- [ ] chat 入站 + responses 渠道 + tool 调用往返：assistant `tool_calls` → responses `function_call` item → chat `tool` 消息 → responses `function_call_output` item，多轮对话可续。
- [ ] responses 入站 + responses 渠道：原样透传成功（请求体不转换），usage 经 `response.usage` 路径入账。
- [ ] responses 入站 + 仅 anthropic 渠道：503 `no_available_channels`，**不发任何上游请求**。
- [ ] anthropic 入站 + 仅 responses 渠道：503 `no_available_channels`。
- [ ] 回归不破坏：chat→openai 透传、chat→anthropic 转换、anthropic→openai 转换、非 chat path 过滤、openai 渠道 /responses 回退、Playground。
- [ ] 渠道 CRUD / fetch_models / test 对 `api_format: "responses"` 正常工作（连通性测试走 `/models`）。
- [ ] UI 渠道表单可选择 Responses 格式并有正确 placeholder；类型无 `as any`。
- [ ] `bun run check && bun run typecheck && bun run test` 全绿；新增单测覆盖转换器三件套、路由过滤矩阵、usage 解析。
