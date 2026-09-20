# 技术设计 — Chat Completions ↔ Anthropic Messages 转换器补全

> 全部映射基于 2026-09-20 文档实抓（[research/anthropic-conversion-surface.md](./research/anthropic-conversion-surface.md)）与代码实勘（main @ 16172a4），行号锚点以实勘为准。改动集中在一个文件：`apps/worker/src/services/format-converter.ts`；`proxy.ts` / `anthropic-proxy.ts` 接线零改动。

## 1. 决策记录（D1–D8）

| # | 决策 | 理由 |
|---|------|------|
| D1 | PRD D1：建任务、评审后实施 | Trellis 流程 |
| D2 | PRD D2：主方向 chat→anthropic；反方向仅共享函数联动 + 回归锁定 | 用户受影响方向优先；反方向多模态是独立可验证交付物，混入会膨胀评审面 |
| D3 | PRD D3：thinking 回传 `reasoning_content`，默认开启，无配置开关 | 额外 JSON 字段对旧客户端无副作用；DeepSeek 系约定已是事实标准（研究 §4） |
| D4 | **budget_tokens 主路径，不做 adaptive 自动选择**：effort → `thinking:{type:"enabled", budget_tokens}`；客户端直发 `thinking` 对象直通（逃生舱，覆盖 adaptive/精确预算） | 模型代际网关侧不可靠可知；adaptive 仅 4.6+，存量最广的 4.5 代（claude-sonnet-4-5 等）不支持 adaptive 会直接 400；budget 在 4.5/4.6 均可用。现代模型由逃生舱覆盖，无需代际猜测 |
| D5 | **生成 thinking 时剥离 `temperature` / `top_p`**（客户端直发 thinking 同样剥离）；未生成时二者照旧直通 | 旧模型：temperature/top_k 与 thinking 不兼容、top_p 仅允许 0.95–1；新代模型：非默认采样一律 400——剥离是两代公共安全集。非 thinking 场景的 temperature 代际问题 Out of Scope（PRD） |
| D6 | **usage 合并到末 chunk + 口径换算**：`prompt_tokens = input + cache_read + cache_creation`，附 `prompt_tokens_details.cached_tokens` / `completion_tokens_details.reasoning_tokens`（有值时） | Anthropic input_tokens 不含缓存 token、OpenAI prompt_tokens 是总量——口径相反（研究 §6）；不换算则 ZenAPI 计费与客户端展示双错 |
| D7 | **保守丢弃多模态部件**：解析失败的 image/file 部件丢弃并 console.warn，绝不让单个脏部件 400 整个请求 | 与伪装模块 fail-open 哲学一致（client-disguise.ts 模块注释）；可解析的 audio 显式丢弃（Anthropic 无音频输入，研究 §3） |
| D8 | **流内 `error` 事件 → 终止 chunk + warn 日志**，不尝试恢复 | 流已 200 无法改状态码；OpenAI 流式协议无错误事件类型，终止 chunk（finish_reason:"stop"）+ 日志是唯一不悬挂客户端的选择 |

## 2. 请求转换 `openaiToAnthropicRequest`（改动核心）

### 2.1 字段映射矩阵

| Chat 入参 | Anthropic 映射 | 现状 → 变更 |
|---|---|---|
| `model` / `stream` | 同名直通 | 不变 |
| `max_tokens` / `max_completion_tokens` | `max_tokens`（必填） | 现仅读 max_tokens、缺省 4096 → **`max_completion_tokens ?? max_tokens ?? 8192`**（优先级与 responses 方向 openaiToResponsesRequest:1128 一致；缺省提到 8192，研究结论 4096 对推理模型偏小） |
| `temperature` / `top_p` | 同名直通；**生成 thinking 时剥离** | 变更见 D5 |
| `stop` | `stop_sequences` | 不变 |
| `reasoning_effort` / `reasoning.effort` | `thinking`（§2.2） | 现丢弃 → 新增 |
| `thinking`（客户端直发，非标字段） | 最小校验后**直通**（对象且 `type` 为合法值；逃生舱覆盖 adaptive / 自定义预算） | 现丢弃 → 新增；直通同样触发 D5 剥离 |
| `tools[{type:function,function}]` | `{name,description,input_schema}` | 不变（非 function 工具继续丢弃） |
| `tool_choice:"none"` | `{type:"none"}` | 现「删 tools」→ **直发**（2025 原生值，研究 §5；语义更准：保留 tools 声明只是禁止调用） |
| `tool_choice:"auto"/"required"/{function}` | auto/any/tool | 不变 |
| `messages[role=system]` / **`developer`** | 顶层 `system`（多条 `\n\n` 拼接） | **developer 从 else 分支改入 system 提取**（与 openaiToResponsesRequest:1211 对齐；OpenAI 官方语义 developer 替代 system） |
| assistant 消息 + tool_calls | text 块 + tool_use 块 | 不变 |
| `messages[role=tool]` | user 消息含 tool_result 块 | content 数组形态改为**取 text 部件拼接**（现仅取字符串，数组时落空串）；tool_result 其余不变 |
| 连续同角色合并 | 现有逻辑 | 不变 |

### 2.2 thinking 档位表（D4）

入站 effort → `budget_tokens`，采用 OpenRouter 公开比例式（研究 §2），clamp 到 `[1024, max_tokens - 1]`：

| `reasoning_effort` | ratio | 产物（例：max_tokens=8192） |
|---|---|---|
| `minimal` | 0.1 | 1024（clamp 触底） |
| `low` | 0.2 | 1638 |
| `medium` | 0.5 | 4096 |
| `high` | 0.8 | 6553 |
| `xhigh` / `max` | 0.95 | 7782 |
| `none` | — | **不发 thinking 字段**（语义对齐 OpenAI：关闭推理；不发 `disabled` 以兼容最老上游） |
| 数字型 effort（extractReasoningEffort 已容忍） | — | 视为显式 budget：clamp 到 `[1024, max_tokens-1]` 后直用 |
| 未传 | — | 不发 thinking（现状行为，零回归） |

- 优先级复用 `utils/reasoning.ts` 的 `extractReasoningEffort`（`reasoning_effort` → `reasoningEffort` → `reasoning.effort`），转换器内联同规则（保持 format-converter 无新依赖；或直接 import——实施时取 import，避免两处漂移）。
- budget 生成后若 `budget_tokens >= max_tokens`（max_tokens 被客户端压得很低），clamp 保证 `< max_tokens`；不再上浮 max_tokens（不静默改写用户预算，超小预算行为由上游语义决定）。
- 采样剥离（D5）：`delete result.temperature; delete result.top_p`——**仅当**本次产物含 thinking 字段。

### 2.3 多模态部件转换（user 消息 content 数组）

现 :215-221 else 分支原样透传 → 改为逐部件映射：

| OpenAI 部件 | Anthropic 产物 | 丢弃条件 |
|---|---|---|
| `{type:"text", text}` | `{type:"text", text}` | text 非字符串时按空串处理（不丢块） |
| `{type:"image_url", image_url}`（对象或裸字符串） | url 为 `https?://` → `{type:"image", source:{type:"url", url}}`；data URL `data:<mime>;base64,<data>` 且 mime ∈ jpeg/png/gif/webp → `{type:"image", source:{type:"base64", media_type, data}}` | 非 http(s) 且非 data URL、mime 不支持、data 段缺失 → 丢块 + warn（D7；data: URI 放 url source 文档未认可，按不支持处理，研究 §3） |
| `{type:"file", file:{file_data, filename?}}` | file_data 为 base64 PDF（data URL `data:application/pdf;base64,` 或裸 base64 且 filename 以 .pdf 结尾，两条件取其一判定）→ `{type:"document", source:{type:"base64", media_type:"application/pdf", data}}` | 无法判定为 PDF → 丢块 + warn |
| `{type:"input_audio", ...}` | **丢弃** + warn（Anthropic 无音频输入，研究 §3） | 恒丢弃 |
| 未知部件类型 | 丢弃（维持白名单哲学，不再透传） | — |

- `image_url.detail` 无 Anthropic 对应，丢弃（Anthropic 自动降采样）。
- 转换后 content 数组为空时，回退为单空 text 块，避免产出 Anthropic 400 的空 content 消息。

## 3. 非流式响应 `anthropicToOpenaiResponse`

| Anthropic 响应 | Chat 产物 | 变更 |
|---|---|---|
| `content[] text` 块 | `message.content` 拼接 | 不变 |
| `content[] thinking` 块 | **`message.reasoning_content`**（各 thinking 块文本以 `\n\n` 拼接；有才出现该字段） | 现丢弃 → 新增（D3）；`redacted_thinking` 不回传 |
| `content[] tool_use` | `message.tool_calls` | 不变 |
| `stop_reason` | `mapStopReason` 补全：refusal→**content_filter**、model_context_window_exceeded→**length**、pause_turn→stop | 现 fallback 一律 stop → 逐值映射（研究 §5） |
| `usage` | `prompt_tokens = input + cache_read + cache_creation`；`completion_tokens = output`；`total_tokens` 求和；`prompt_tokens_details.cached_tokens = cache_read`（>0 时）；`completion_tokens_details.reasoning_tokens = output_tokens_details.thinking_tokens`（有值时） | 现仅 input/output 两值 → 口径换算（D6） |

## 4. 流式转换 `createAnthropicToOpenaiStreamTransform`

| 上游事件 / delta | 产物 | 变更 |
|---|---|---|
| `message_start` | role chunk（**不再携带 usage**） | 变更：usage 全部移至末 chunk（D6 + OpenAI 惯例单 chunk usage；现拆两个 chunk 是 prompt_tokens 恒 0 的根因） |
| `content_block_start(thinking)` | 无输出（记入状态：thinking 块开启） | 新增状态跟踪 |
| `thinking_delta` | `delta.reasoning_content` 增量 chunk | 现丢弃 → 新增（D3；多 thinking 块顺序拼接，与上游块序一致） |
| `signature_delta` / `citations_delta` | 无输出 | 显式忽略（PRD FR2） |
| `content_block_start(tool_use)` / `input_json_delta` / `text_delta` | 现有 tool_calls / content 增量 | 不变 |
| `message_delta` | 终止 chunk：`delta:{}` + `finish_reason`（mapStopReason 补全后）+ **完整 usage**（`message_start` 累计的 input/cache 三项 + `message_delta.usage.output_tokens`；`message_delta.usage` 为累计值，直接取用，研究 §7） | 变更 usage 口径 |
| `message_stop` | `data: [DONE]` | 保持 |
| `flush()` | **不再补发 `[DONE]`**（仅在上游既无 message_stop 又正常关流时无输出——`message_stop` 已覆盖正常路径；双发根因即此处无条件补发） | 修复双 `[DONE]` |
| `error` 事件 | 终止 chunk（`finish_reason:"stop"`、`delta:{}`）+ `console.warn("[format-converter] upstream stream error", ...)`，随后不发 `[DONE]` 之外的输出 | 现静默丢弃 → D8 |

- 实现注意：`message_start` 的 usage 需缓存 `input_tokens / cache_read_input_tokens / cache_creation_input_tokens` 三值供末 chunk 合并；`output_tokens_details.thinking_tokens` 若出现在 `message_delta.usage` 一并映射。

## 5. 不动的部分（明确边界）

- `anthropicToOpenaiRequest` / `openaiToAnthropicResponse` / `createOpenaiToAnthropicStreamTransform`（反方向三件套）：仅因共享 `mapStopReason` / `mapFinishReason` 获得枚举补全收益，其余不动（PRD D2）。反方向已知缺口（image/document 块丢弃、thinking 请求参数丢弃、flush 缺 message_delta、reasoning_content→thinking 块的签名风险）记录于本节，作为潜在子任务输入。
- `proxy.ts` / `anthropic-proxy.ts` / `utils/usage.ts`：零改动——`parseUsageFromSse` 取末 chunk 的行为在 usage 合并后即为正确口径。
- 伪装注入（`injectSystemPromptAnthropic`）：转换后注入 `system`，与新增 thinking/多模态逻辑无字段交集，不动。

## 6. 兼容性 / 回滚

- 不发 `reasoning_effort` 的请求：转换产物与现状唯一差异是 `[DONE]` 单发与末 chunk usage 口径——前者修复缺陷，后者修复计费；客户端行为面无破坏。
- `reasoning_content` 为新增字段：OpenAI 官方 SDK 忽略未知字段；识别该字段的客户端（DeepSeek 系、主流国产前端）从「无思考显示」变为「有思考显示」，即本任务目标。
- usage 末 chunk 化：依赖「usage 在最后一个 chunk」的客户端（OpenAI 官方语义）从错变对；极端依赖「message_start 带 usage」的自写客户端会丢 prompt 计数——非兼容性承诺范围（OpenAI 官方从不这样发）。
- 步骤化提交（见 implement.md），每步可独立 revert；纯 services 层函数变更，无 schema / 配置面 / 路由改动。

## 7. 测试设计（`tests/format-converter-anthropic.test.ts`）

模式照抄 `format-converter-responses.test.ts`（直接调用纯函数 + `runStreamTransform` helper + `parseSseData` 断言），分组：

1. `openaiToAnthropicRequest`：字段矩阵（§2.1）逐行、thinking 档位表逐档（AC1）、采样剥离两分支（AC2）、多模态四类部件 + 非法部件（AC7）、tool_choice none、developer、max_completion_tokens 三态（AC5）。
2. `anthropicToOpenaiResponse`：thinking→reasoning_content、redacted_thinking 不出现、stop_reason 七值（AC6）、usage cache 口径（AC4 非流式半边）。
3. `createAnthropicToOpenaiStreamTransform`：thinking_delta 逐块 reasoning_content（AC3）、signature/citations 静默、usage 末 chunk 完整三值 + cache（AC4 流式半边 + `parseUsageFromSse` 联动断言）、`[DONE]` 计数恰一（AC3）、error 事件终止（AC8）、既有回归（tool_use 索引映射、message_start role chunk、ping 吞掉）。
4. `mapStopReason` / `mapFinishReason`：直接单测锁定反方向联动（AC9）。

## 8. 已知限制（记录不做的事）

- thinking + 工具往返的签名回传：chat 协议不携带 thinking 块/signature，无法满足 Anthropic「完整未修改回传」要求（研究 §1）；adaptive 可放宽但 D4 已排除自动选择。按 PRD D5 降级：映射仅在无 tool 历史请求上保证，工具往返场景不承诺。
- thinking 历史回传：客户端把 `reasoning_content` 发回时（assistant 历史），转换器**不**映射为 thinking 块（无 signature 必被 400），维持丢弃——同属 §D5 边界。
- 缓存差价计费：calculateCost 单一 input_price，cache read 0.1x 的真实差价不反映——既有全局限制，非本任务引入。
- temperature 4.6+ 只收 1.0：非 thinking 场景照旧直通，上游 400 会原样透传给客户端（Out of Scope，PRD）。
