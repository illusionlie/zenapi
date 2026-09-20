# 调研报告 — OpenAI Chat Completions ⇄ Anthropic Messages 转换面核查

> 调研于 2026-09-20 由 sub-agent 完成全部文档实抓（非训练记忆），本地代码比对 format-converter.ts @ main 16172a4。
> 文档域名迁移：`docs.claude.com` → `platform.claude.com`；`platform.openai.com/docs` → `developers.openai.com`。

## 1. Extended thinking 今日形态（PRD Q1 答案）

来源：platform.claude.com/docs/en/build-with-claude/extended-thinking、/thinking、/effort

- **手动模式仍在**：`thinking: {type: "enabled", budget_tokens: N}`；`budget_tokens` 最小 **1024**、必须 **< max_tokens**；budget 是目标非硬上限。
- **adaptive thinking 是新主路径**：`thinking: {type: "adaptive"}`（可带 `display`），配 **`output_config: {effort: "low"|"medium"|"high"|"xhigh"|"max"}`** 控制深度。
- **兼容性关键**：Opus 4.5 是唯一「仅 extended-thinking 但支持 effort」的模型；**4.6 代上 `enabled+budget_tokens` 已弃用（仍可用），4.7+ 直接 400**。即 adaptive 为 4.6+ 能力，存量部署最广的 4.5 代（claude-sonnet-4-5 等）**不支持 adaptive**。
- **采样参数约束（现行文档原话）**："non-default `temperature`, `top_p`, or `top_k` values return a 400 error on every request, regardless of whether thinking is used"（适用于 Fable 5.1/Mythos 5.1/Fable 5/Mythos 5/Opus 5/Opus 4.8/4.7/Sonnet 5）；旧模型：temperature、top_k 与 thinking 不兼容，top_p 允许 0.95–1。**`temperature` 参数本身已标 deprecated：Opus 4.6+ 只接受 1.0，其它值 400。**
- **tool use 回传规则**：返回 tool result 时必须把 assistant 消息的 thinking 块**完整未修改**回传；手动模式额外要求最后一个 assistant turn 以 thinking 块开头（**adaptive 放宽此要求**）；修改过的 thinking 块 400。
- **redacted_thinking**：`{type: "redacted_thinking", data: "<opaque>"}`；必须原样回传——只过滤 thinking 块会 "silently drops redacted_thinking blocks and breaks the multi-turn protocol"。
- 手动模式下 `tool_choice` 仅支持 auto/none。
- 思考开销经 `usage.output_tokens_details.thinking_tokens` 监控（流式仅在最终 `message_delta` 出现）。

## 2. OpenAI reasoning_effort 当前全集（PRD Q1 另一半）

来源：developers.openai.com/api/reference/resources/chat、/docs/guides/reasoning

- 全集：`"none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"`；非所有模型支持所有值；gpt-5.5 默认 medium。
- **budget_tokens 折算参考**（OpenRouter 公开实现约定，非官方规定，openrouter.ai/docs/use-cases/reasoning-tokens）：`budget_tokens = clamp(max_tokens × ratio, ≥1024)`，ratio：max/xhigh 0.95、high 0.8、medium 0.5、low 0.2、minimal 0.1；要求 `max_tokens > budget_tokens`。

## 3. 内容块与多模态（PRD Q「图片/视频等」答案）

来源：platform.claude.com/docs/en/api/messages、/build-with-claude/vision、/pdf-support

- **图像**：source 三种 —— `base64`（jpeg/png/gif/webp，单图 ≤10MB，≤8000×8000）、`url`（`{type:"url", url}`）、`file`（Files API file_id）。**data: URI 能否放 url 字段文档未提（UNVERIFIED），示例均为 https，按不支持处理。** Bedrock/GCP 仅 base64。
- **文档**：source 五种 —— `base64`（**仅 application/pdf**）、`url`、`file`、`text`（纯文本 .txt/.csv/.md）、`content`。上限 600 页/请求、32MB。xlsx/docx 不支持。
- **音频 / 视频：均不支持**（Messages 端点自述 "text and/or image content"；16 种 ContentBlockParam 无 audio/video；SDK audio feature request 仍 open）。
- 输入块全集：text、image、document、search_result（仍在）、tool_use、tool_result、thinking、redacted_thinking、server_tool_use、web_search_tool_result、container_upload、bash_code_execution_result、code_execution_result、encrypted_code_execution_result、tool_search_tool_result、mcp_tool_use/result（beta）。

## 4. OpenAI Chat Completions 部件

来源：developers.openai.com/api/reference/resources/chat

- `text`、`image_url`（`{url, detail?}`，url 可为 http URL 或 base64 data）、`input_audio`（`{data(base64), format: wav|mp3}`）、`file`（`{file_data?(base64), file_id?, filename?}`）。
- **`developer` role**："With o1 models and newer, developer messages replace the previous system messages"——语义同 system。
- Chat Completions **无视频部件类型**。
- **`reasoning_content` 非 OpenAI 官方字段**（DeepSeek 事实约定，api-docs.deepseek.com/guides/thinking_mode）：流式走 `delta.reasoning_content`；DeepSeek 有 tools 时必须完整回传否则 400。OpenRouter 用 `reasoning` 请求参数 + `message.reasoning`（`reasoning_content` 是其别名）+ `reasoning_details`。

## 5. stop_reason / finish_reason 全集

- Anthropic（7 值全量）：`end_turn`、`max_tokens`、`stop_sequence`、`tool_use`、`pause_turn`、`refusal`、`model_context_window_exceeded`。
- OpenAI：`stop`、`length`、`tool_calls`、`content_filter`、`function_call`(deprecated)。
- 推荐 →chat：end_turn/stop_sequence→stop；max_tokens→length；tool_use→tool_calls；**refusal→content_filter**；**model_context_window_exceeded→length**；**pause_turn→stop**。
- 推荐 →anthropic：stop→end_turn；length→max_tokens；tool_calls→tool_use；**content_filter→refusal**（mapFinishReason 现状 default→end_turn）。
- `tool_choice` 的 **`"none"` 为 2025 新增原生值**（release notes），现转换器「删 tools」的 workaround 可改直发 `{type:"none"}`。

## 6. usage 与缓存口径（关键差异）

来源：platform.claude.com/docs/en/build-with-claude/prompt-caching、/api/messages

- Anthropic Usage 字段：`input_tokens`、`output_tokens`、`cache_creation_input_tokens`、`cache_creation{ephemeral_5m/1h}`、`cache_read_input_tokens`、`server_tool_use`、`service_tier`、`output_tokens_details{thinking_tokens}`。
- **口径相反**：Anthropic `input_tokens` "represents only the tokens that come after the last cache breakpoint"（**不含**缓存 token）；`total_input = input + cache_read + cache_creation`。OpenAI `prompt_tokens` 是**总量**（`prompt_tokens_details.cached_tokens` 是其中子集）。
- → chat 转换：`prompt_tokens = input_tokens + cache_read_input_tokens + cache_creation_input_tokens`；`prompt_tokens_details.cached_tokens = cache_read_input_tokens`；`completion_tokens_details.reasoning_tokens = output_tokens_details.thinking_tokens`。
- 计价：5m 写 1.25x、1h 写 2x、读 0.1x（新模型读价 0.025x）——ZenAPI calculateCost 单一 input_price 口径对缓存不敏感，属既有全局限制。

## 7. SSE 事件与 delta 全集

来源：platform.claude.com/docs/en/build-with-claude/streaming

- 顶层事件：`message_start`、`content_block_start/delta/stop`、`message_delta`、`message_stop`、`ping`（任意次）、**`error`**（可流中出现，如 overloaded）——现转换器对 error 事件静默丢弃。
- delta 全集：`text_delta`、`input_json_delta`、`citations_delta`、`thinking_delta`、`signature_delta`（signature 紧贴 content_block_stop 之前）。
- **`message_delta.usage` 是累计值非增量**（文档明确警告）；`stop_reason` 仅在 `message_delta.delta` 交付。

## 8. UNVERIFIED（诚实声明）

- Anthropic `url` source 是否接受 data: URI（按不支持处理）。
- Usage 第 9 字段身份（疑 context_management）；MessageDeltaUsage 完整构成。
- 图像/PDF url source、tool_choice none、纯文本文档的精确发布日期。
- effort↔budget 折算、refusal→content_filter 等「推荐映射」均为业界实现约定/最佳实践推断，非文档条文。
