# 渠道多 API 格式与 responses 自动降级转换

## Goal

把渠道的 API 格式从单值 `api_format` 升级为多值能力声明 `api_formats`，并让 `/v1/responses` 入站在渠道不具备 responses 原生格式时自动降级到该渠道声明中可转换的最优格式（本期覆盖 chat）。

用户价值：

1. 一个上游同时原生暴露 `/v1/chat/completions` 与 `/v1/messages`（典型聚合器）不再需要建两个渠道。
2. responses 请求打到 chat-only 上游不再大概率 404（现状是裸透传 + 400/404 路径重试兜底），而是自动降级为 chat completions 转换调用。

事实依据（file:line 锚点全文）见 `research/recon-api-format.md`；技术方案见 `design.md`。

## Background（关键现状）

- `channels.api_format` 为单值 TEXT（`schema.sql:16`），四处硬编码 union（`channel-types.ts:1`、UI `core/types.ts:1`、`ChannelsView.tsx:881-916` 下拉、`newapiChannels.ts` 内联断言）。
- `/v1/responses` 入站打到 openai 格式渠道是**裸透传**（`proxy.ts:277-281` 去前缀转发 body），靠上游 400/404 时重试 `{base}/responses` 兜底（`proxy.ts:720-739`）；chat-only 上游大概率失败。
- 转换器已有 chat↔anthropic 双向、chat→responses 请求、responses→chat 响应（流式全覆盖）；**缺** responses 入站方向的 `responsesToOpenaiRequest` / `openaiToResponsesResponse` / 流式，以及全部 responses↔anthropic。
- 路由过滤三套独立实现：`allowedFormatsForPath`（proxy.ts:119-130）、anthropic-proxy 内联 filter（:156-163）、playground 无过滤（:71-77）。

## Requirements

- **R1 数据模型**：渠道支持声明多个 API 格式（`api_formats` JSON 数组）；`custom` 只能独占（不得与其他格式组合）；存量渠道迁移后语义不变（单格式 → 单元素数组）。
- **R2 统一路由矩阵**：入站协议（chat / responses / anthropic / 其他透传）× 渠道格式集的资格判定与目标格式选择收敛为一个共享函数，proxy、anthropic-proxy、playground 三处共用；单格式渠道在各协议下的既有路由结果**逐一保持**。
- **R3 responses 自动降级**：`/v1/responses` 入站 + 仅声明 openai 的渠道 → 自动转换为 chat completions 调用（新增 responses→chat 双向转换：请求、非流式响应、流式响应）；响应/SSE 以 Responses 协议回给客户端，usage 正常落库。声明了 `responses` 的渠道维持原生透传；仅 anthropic 渠道维持 503 排除。
- **R4 格式偏好序**：命中多个可服务格式时按每协议固定偏好序选择（详见 design.md §3）：chat 入站 openai > responses > anthropic > custom；responses 入站 responses > openai > custom；anthropic 入站 anthropic > openai > custom；其他透传 openai > responses > custom。
- **R5 CRUD 与校验**：渠道创建/编辑接受 `api_formats`（白名单校验、去重、非空、custom 独占；非法/空 → 400）；兼容接受旧的单值 `api_format` 字段（`api_formats` 优先）；PATCH 三态语义遵循项目规范；New API 兼容渠道路由行为不变。
- **R6 连通性与模型拉取**：多格式渠道逐声明格式探测，模型列表取并集去重；部分失败不整体失败（返回警告），全部失败才报错；连通性测试返回逐格式结果；单模型对话测试按偏好序选目标格式。
- **R7 UI**：渠道表单格式多选（custom 独占约束可见）；渠道列表与监控徽章展示全部格式；监控后端统计不受影响。
- **R8 遗留清理**：openai 渠道 responses 路径回退（`fallbackSubPath`）随透传语义一同移除，不留死代码；AGENTS.md §6/§8/§10 同步更新。

## Acceptance Criteria

- [ ] AC1 单格式渠道回归：四种格式 × 三类入站的既有路由/转换矩阵测试全部通过，唯一例外为 AC3 的明示行为变更。
- [ ] AC2 渠道可保存多格式（如 `["openai","anthropic"]`）；含 custom 的组合、空数组、白名单外值均 400；单值 `api_format` 字段仍可提交并被接受。
- [ ] AC3 responses 入站 + openai 单格式渠道：上游收到 `{base}/chat/completions` 的 chat 请求（非裸透传）；非流式与流式响应均以 Responses 协议返回客户端；流式 usage 仅出现在 `response.completed` 且 prompt/completion/total 三值齐全；usage 落库 prompt_tokens > 0。
- [ ] AC4 responses 入站 + 声明 `["openai","responses"]` 的渠道：原生透传 `{base}/responses`，无路径回退重试。
- [ ] AC5 responses 入站 + 仅 anthropic 渠道：503 `no_available_channels`，零上游请求（维持现状）。
- [ ] AC6 anthropic 入站 + 声明 `["anthropic","openai"]`：走原生 `/v1/messages` 直通，不触发 openai 转换路径。
- [ ] AC7 chat 入站 + 声明 `["openai","anthropic"]`：选 openai 原生直通（偏好序生效）。
- [ ] AC8 代理代码中无 `fallbackSubPath` 残留；`/v1/responses` + openai 渠道的 400/404 路径重试逻辑整体移除且测试同步更新。
- [ ] AC9 多格式渠道 fetch_models 返回各声明格式模型并集（按 id 去重）；单格式探测失败返回警告字段，全部失败才报错；连通性测试响应含逐格式结果。
- [ ] AC10 UI：格式字段为多选交互，勾选 custom 时其余选项不可用；列表徽章展示全部声明格式；`bun run check && bun run typecheck && bun run test` 全绿。
- [ ] AC11 迁移 `0022` 可重放（幂等），执行后存量渠道 `api_formats = [原 api_format]`；代码回滚到旧版本时仍能读到 `api_format` 镜像列（双写保证）。
- [ ] AC12 新增单测覆盖：`selectTargetFormat` 全矩阵（单格式行为保持 + 多格式偏好）、三个新转换函数（含 fail-open 丢弃与 warn）、CRUD 校验纯函数。
- [ ] AC13 playground 行为不变：全部格式渠道均可路由（经既有转换路径）。

## Out of Scope

- responses↔anthropic 直接转换（responses 入站 → anthropic-only 渠道仍排除；用户已拍板延后）。
- 按格式独立的模型清单 / 模型-格式亲和路由（本期共享模型列表 + 并集）。
- `usage_logs` 增加 api_format 列（`request_path` 已有间接痕迹）。
- `custom` 格式参与多格式组合（保持"base_url 即完整 URL"独占语义）。
- 既有已知限制不变（thinking+工具往返签名、adaptive 不自动选择、非 thinking 场景 temperature 代际适配等）。
