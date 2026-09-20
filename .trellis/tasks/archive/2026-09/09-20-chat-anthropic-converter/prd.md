# PRD — Chat Completions ↔ Anthropic Messages 转换器补全：thinking 映射与多模态内容

## Goal

修复「chat completions 入站 → anthropic 渠道」方向的转换缺陷，使其达到与 responses 方向（09-15-responses-channel-format）同等的转换保真度：

1. **思考等级透传**：`reasoning_effort` / `reasoning.effort` 映射为 Anthropic `thinking` 参数（当前完全丢弃，用户已实测受影响）；
2. **流式体感与计费修复**：thinking 阶段静默吞没导致的「假非流式」、`[DONE]` 重复、流式 usage 拆分导致的 prompt_tokens 恒 0（计费低估）；
3. **多模态与字段面补全**：图片、文档（PDF）等内容部件的正确转换，`max_completion_tokens`、`developer` 角色、`tool_choice`/`stop_reason` 新枚举等字段级缺口。

## Background（已确认事实，实勘于 2026-09-20，main @ 16172a4）

**用户实测现象**：调用项目以 chat completions 格式调 anthropic 渠道，`reasoning_effort` 未传到上游；流式表现为长时间无输出后一次性出全文（「变为非流式」体感）。

**代码实勘结论**（均有 file:line 锚点）：

- `openaiToAnthropicRequest`（`apps/worker/src/services/format-converter.ts:91-249`）为白名单式转换，仅搬运 `model / stream / max_tokens / temperature / top_p / stop / tools / tool_choice / messages`；`reasoning_effort`、`reasoning.effort`、客户端直发的 `thinking` 字段全部丢弃。对照先例：responses 方向 `openaiToResponsesRequest`（同文件 :1134-1142）有 reasoning 透传——anthropic 方向为不一致的遗漏。
- **bun 实测验证**（临时脚本，已清理）：
  - `reasoning_effort: "high"` 的转换产物无任何 thinking 痕迹；
  - 流式转换器 `createAnthropicToOpenaiStreamTransform` 对增量输入逐块输出（时间戳 95/505/588/752ms 递增），**整体链路无缓冲**，转换器不是「非流式」的元凶；
  - `[DONE]` 输出两次：`message_stop` 分支（:645）与 `flush()`（:682）各发一次；
  - `thinking_delta` / `thinking` 内容块在流式（:755-791 只认 `text_delta`/`input_json_delta`）与非流式（:444-504 只拼 `text` 块）响应侧均被静默丢弃 → 若上游默认开启思考（GLM/Kimi 类 Anthropic 兼容端点常见），整段思考期客户端收不到任何字节，即「假非流式」体感的来源。
- **计费 bug**：`parseUsageFromSse`（`apps/worker/src/utils/usage.ts:158-161`）取最后一个含 usage 的 chunk；而 anthropic 流式转换把 prompt 放 `message_start` chunk、completion 放 `message_delta` chunk → chat→anthropic 流式请求落库 `prompt_tokens` 恒 0，`calculateCost` 低估输入成本。OpenAI 官方惯例是 usage 仅出现在最后一个 chunk 且含完整三值。
- `max_completion_tokens` 不被识别（:101 仅读 `max_tokens`，缺省回退 4096）；`developer` 角色落入 else 分支被当作 user 消息（:215-221）；`image_url` 部件原样透传（:215-221）→ Anthropic 400。
- **反方向复用同一文件**：`anthropic-proxy.ts` 使用 `anthropicToOpenaiRequest` / `openaiToAnthropicResponse` / `createOpenaiToAnthropicStreamTransform`（:7-10）。本任务反方向仅回归锁定，不做对称补齐（D2）。
- 路由矩阵：`/v1/responses` 入站排除 anthropic 渠道，chat completions 是 anthropic 渠道唯一的 OpenAI 协议入口——本任务方向是唯一缺口。
- 伪装系统提示词在转换完成后注入 `system` 字段（`proxy.ts:195-200`），与 thinking 映射无字段冲突。
- **anthropic 方向转换器零单测**：`tests/` 仅有 `format-converter-responses.test.ts`（24 例）；测试基建先例：手写 D1 mock（`proxy-retry-settings.test.ts:18-45`）、`vi.stubGlobal("fetch")`（`proxy-responses.test.ts:477`）。

**文档调研结论**（详见 [research/anthropic-conversion-surface.md](./research/anthropic-conversion-surface.md)，全部为 2026-09-20 文档实抓）：

- thinking 现行形态：手动 `thinking:{type:"enabled", budget_tokens}`（≥1024 且 < max_tokens）仍被 4.5/4.6 代接受（4.6 弃用、4.7+ 拒绝）；**adaptive**（`thinking:{type:"adaptive"}` + `output_config:{effort}`）为 4.6+ 新路径，**存量部署最广的 4.5 代不支持**。
- OpenAI `reasoning_effort` 全集：`none|minimal|low|medium|high|xhigh|max`。
- **采样参数**：`temperature` 已标 deprecated（4.6+ 只收 1.0）；新代模型非默认 temperature/top_p/top_k 一律 400；旧模型 temperature/top_k 与 thinking 不兼容 → thinking 请求必须剥离采样参数。
- **usage 口径相反**：Anthropic `input_tokens` 不含缓存 token（`total_input = input + cache_read + cache_creation`）；OpenAI `prompt_tokens` 是总量 → →chat 转换必须三项求和，cache_read 映射 `prompt_tokens_details.cached_tokens`、`thinking_tokens` 映射 `completion_tokens_details.reasoning_tokens`。
- 图像：`base64` / `url` / `file` 三种 source（data: URI 放 url 字段文档未认可，按不支持处理）；文档：base64（仅 PDF）/ url / file / text / content 五种；**音频、视频均不支持**（文档实抓确认）。
- `stop_reason` 全枚举：end_turn、max_tokens、stop_sequence、tool_use、pause_turn、refusal、model_context_window_exceeded（现转换器后三种一律 fallback→stop）；`tool_choice:"none"` 已原生支持（现用删 tools 的 workaround）；流式 `message_delta.usage` 为累计值；流内 `error` 事件存在但现转换器静默丢弃。

## Requirements

- **FR1 thinking 请求映射**：入站 `reasoning_effort` / `reasoning.effort`（含 `none|minimal|low|medium|high|xhigh|max` 全集）映射为 `thinking: {type: "enabled", budget_tokens}`（档位表见 design.md；`none` → 不发 thinking 字段）；客户端直发 Anthropic 风格 `thinking` 对象时最小校验后直通（逃生舱，覆盖 adaptive / 精确预算场景）；生成 thinking 字段时同步剥离 `temperature` / `top_p`（两代模型约束的公共安全集）。不做 adaptive 自动选择（D4）。
- **FR2 thinking 响应回传**：非流式 `thinking` 块与流式 `thinking_delta` 映射为 `reasoning_content` / `delta.reasoning_content`（DeepSeek 系事实标准，未知字段对旧客户端无副作用）；`redacted_thinking` 与 `signature_delta` 不回传；`citations_delta` 丢弃。
- **FR3 流式修复与计费口径**：`[DONE]` 恰好一次；usage 合并为单个末 chunk，`prompt_tokens = input + cache_read + cache_creation`、`prompt_tokens_details.cached_tokens = cache_read`、`completion_tokens_details.reasoning_tokens = thinking_tokens`（有值时），使 `parseUsageFromSse` 落库口径恢复正确；流内 `error` 事件不再静默——发终止 chunk（finish_reason: "stop"）并记 warn 日志。
- **FR4 字段与枚举补全**：`max_completion_tokens` 优先于 `max_tokens`（均缺省时回退 8192，研究结论 4096 对推理模型偏小）；`developer` 角色并入 system 提取；`tool_choice: "none"` 直发 `{type:"none"}`（不再删 tools）；`stop_reason` 补全映射 refusal→content_filter、model_context_window_exceeded→length、pause_turn→stop（`mapStopReason` 为共享纯函数，反方向自动受益）。
- **FR5 图片转换**：chat `image_url` 部件 → Anthropic `image` block（http(s) URL → `url` source；data URL → 解析 mime + `base64` source）；无法解析的部件丢弃并继续（不产生上游 400）。
- **FR6 文档转换**：chat `file` 部件 `file_data`（base64 PDF）→ Anthropic `document` block（base64/application/pdf）；非 PDF 或无法解析的 file 部件丢弃。
- **FR7 音频/视频**：`input_audio` 部件显式丢弃（Anthropic 无音频输入，文档实抓确认）；视频两侧均无部件类型，仅在 AGENTS.md 记录，无代码。
- **FR8 单测补齐**：新建 `tests/format-converter-anthropic.test.ts`（请求/非流式响应/流式 SSE 三件套），覆盖上述全部映射与既有行为回归（消息合并、tool 往返、stop_reason、tool_use 流式索引映射）。
- **FR9 文档同步**：AGENTS.md §8 补记转换行为（thinking 映射与采样剥离、多模态支持面、usage 口径、已知限制）；README 如有对应章节同步。

## Acceptance Criteria

- [x] **AC1** `reasoning_effort` 各档位（none/minimal/low/medium/high/xhigh/max + `reasoning.effort` 对象形式）逐档断言转换产物：none 无 thinking 字段，其余 budget_tokens 按档位表且满足 ≥1024、< max_tokens；未传 effort 时产物不含 thinking。
- [x] **AC2** 生成 thinking 时产物不含 temperature/top_p；未生成 thinking 时二者照旧直通。客户端直发 `thinking` 对象直通且同样触发采样剥离。
- [x] **AC3** 上游 SSE 含 `thinking_delta` 时，客户端收到逐块 `delta.reasoning_content`；`signature_delta`/`citations_delta` 不产出；整流 `[DONE]` 恰好一次。
- [x] **AC4** 末 chunk usage 含完整 prompt/completion/total 且 cache 字段按 §FR3 口径；`parseUsageFromSse` 落库 `prompt_tokens` > 0（单测断言）；非流式 usage 同口径且不回归。
- [x] **AC5** `max_completion_tokens` 优先级断言（单独出现 / 与 max_tokens 同在 / 均缺省回退 8192）；`developer` 并入 system；`tool_choice:"none"` 产物含 `tool_choice:{type:"none"}` 且 tools 保留。
- [x] **AC6** `stop_reason` 七值映射逐值断言（含 refusal→content_filter、model_context_window_exceeded→length、pause_turn→stop）。
- [x] **AC7** `image_url` http URL 与 data URL 两种 source 形态逐种断言；非法部件丢弃不崩溃；`file`（PDF base64）→ document block；`input_audio` 丢弃且请求其余部分完好。
- [x] **AC8** 流内 `error` 事件产出终止 chunk 且不产出 `[DONE]` 以外的悬挂输出（单测断言）。
- [x] **AC9** 反方向（anthropic 入站 → openai 渠道）现有行为不回归：`mapStopReason`/`mapFinishReason` 变更的存量断言更新 + 既有语义锁定。
- [x] **AC10** `bun run check && bun run typecheck && bun run test` 全绿。

## Out of Scope

- anthropic↔responses 转换（既有决策 D2/D5 不变，路由矩阵继续排除）。
- adaptive thinking 的自动选择 / 模型代际探测（D4，见 design.md）；`output_config.format`（response_format 映射）。
- 非 thinking 场景的 temperature 代际适配（4.6+ 只收 1.0 的问题属渠道/模型层策略，不在此转换器任务内解决，文档记录）。
- citations / server tools / container_upload / mcp_servers 等内容块的双向映射。
- prompt caching（`cache_control`）透传与缓存差价计费（calculateCost 单一价格口径为既有全局限制）。
- 反方向多模态补齐（`anthropicToOpenaiRequest` 的 image/document 块 → image_url/file、入站 thinking 历史块处理、openai→anthropic 流式 flush 缺 message_delta）——D2，需要时另立子任务。
- 渠道级/全局级 thinking 开关等新配置面（映射纯请求驱动，无新增 settings）。

## Key Decisions

- **D1**（用户已确认）创建 Trellis 任务，规划评审通过后再实施。
- **D2** 主方向 = chat→anthropic（用户受影响方向）；反方向仅做「共享纯函数的必要联动 + 回归锁定」，不做对称的全量多模态补齐。
- **D3** thinking 回传采用 `reasoning_content` 约定、默认开启：额外 JSON 字段对不认识的客户端无副作用；不新增配置开关。
- **D4**（研究定档，回填原 Q1）thinking 映射以 `budget_tokens` 为主路径（4.5/4.6 代可用，存量兼容面最大），不做 adaptive 自动选择——模型代际在网关侧不可靠可知，adaptive 仅 4.6+ 支持；现代模型场景由 `thinking` 字段直通逃生舱覆盖。
- **D5**（研究定档，回填原 Q2）thinking + tool use 多轮的签名回传问题：chat 协议客户端不携带 thinking 块/signature，无法满足「完整未修改回传」要求，属协议固有保真上限——设计上按「thinking 映射仅在无 tool 历史的请求上保证、工具往返场景的兼容性不做承诺」处理，design.md 记录降级行为与原因。

## Open Questions

（无——Q1/Q2 已由文档调研定档，见 research/ 与 design.md；其余决策已收敛。）
