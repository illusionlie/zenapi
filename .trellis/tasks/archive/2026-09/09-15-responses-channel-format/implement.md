# 执行计划 — responses 渠道格式与 Chat↔Responses 双向转换

> 前置：`bun install` 完成；每步结束跑该步验证命令；提交前全量门禁。
> 提交策略：每步一个 commit（Conventional Commits），可独立 revert。

## Step 1 类型与配置层（纯类型面，运行时零变化）

- [ ] `apps/worker/src/services/channel-types.ts`：`ChannelApiFormat` 加 `"responses"`
- [ ] `apps/worker/src/routes/newapiChannels.ts:347`：union 断言补 `"responses"`
- [ ] `apps/ui/src/core/types.ts`：同步 `ChannelApiFormat`（`Record<ChannelApiFormat,…>` 处会报缺项，逐个补全）
- [ ] 确认 `bun run typecheck` 通过（不接线，行为无变化）

验证：`bun run typecheck && bun run check`

## Step 2 usage 解析兼容 response.usage

- [ ] `apps/worker/src/utils/usage.ts` `parseUsageFromJson`：取值链加 `data.response?.usage`
- [ ] 新增/扩展单测：`response.completed` 事件形态（`{type:"response.completed", response:{usage:{input_tokens, output_tokens, total_tokens}}}`）、非流式 `{usage}` 回归

验证：`bun run test -- usage`

## Step 3 转换器三件套（最大块，未接线不影响运行时）

- [ ] `apps/worker/src/services/format-converter.ts`：
  - [ ] `openaiToResponsesRequest`（design.md §4.1 映射表逐条）
  - [ ] `responsesToChatResponse`（§4.2，finish_reason 三态）
  - [ ] `createResponsesToChatStreamTransform`（§4.3，tool_call index 映射状态机，参照现有 anthropic 流式 transform 模式）
- [ ] 单测 `tests/format-converter-responses.test.ts`：
  - [ ] 请求：system→instructions、user/assistant/tool→items、tools 扁平化、tool_choice 映射、max_tokens→max_output_tokens、reasoning_effort→reasoning.effort、stream_options 丢弃
  - [ ] 非流式：content 拼接、function_call→tool_calls、usage 换算、finish_reason 三态、未知 output type 忽略
  - [ ] 流式：文本 delta、function_call 增量（item_id→index）、completed 终止 + [DONE] + usage、失败事件闭合
  - [ ] 多轮 tool 往返（assistant tool_calls → function_call → tool → function_call_output）

验证：`bun run test -- format-converter-responses`

## Step 4 路由矩阵精确化

- [ ] `apps/worker/src/routes/proxy.ts`：`allowedFormatsForPath`（design.md §2）替换 `:423-437` 的单条过滤；`/v1/responses` 入站排除 anthropic
- [ ] `apps/worker/src/routes/anthropic-proxy.ts`：候选排除 `"responses"`
- [ ] 单测：路由过滤矩阵（chat 入站全放行 / responses 入站排除 anthropic / anthropic 入站排除 responses / 非 chat path 排除 anthropic；仅剩不兼容渠道时 503 `no_available_channels` 且不发上游请求——mock fetch 断言零调用）

验证：`bun run test -- filter-allowed-channels proxy`

## Step 5 请求构建与响应转换接线

- [ ] `apps/worker/src/routes/proxy.ts` `buildChannelRequest`：新增 `apiFormat === "responses"` 分支（design.md §3 表格三分支；header 走 `applyHeaderPolicy`；alias 命中时 model 替换作用于 `channelParsedBody` 后再转换）
- [ ] `convertResponse` 加 `inboundPath` 参数；responses 渠道 + chat 入站 → 转换（流/非流）；responses/responses 或透传路径 → 原样；调用点 `:541` 传 `responsePath`
- [ ] 确认 playground（复用 `buildChannelRequest`）路径下 targetPath 正确传入
- [ ] 单测：buildChannelRequest responses 分支三分支（目标 URL、body 转换/透传、headers）；convertResponse 接线（chat 入站流式输出为 chat SSE）

验证：`bun run test && bun run typecheck`

## Step 6 渠道测试 / UI / 文档

- [ ] `apps/worker/src/services/channel-testing.ts:37`：`openai || responses` 共用 `/models` 探测分支
- [ ] `apps/ui/src/features/ChannelsView.tsx`：格式下拉加 Responses 项、`baseUrlPlaceholders.responses`、列表徽章显示名
- [ ] `apps/ui/src/features/MonitoringView.tsx`：格式展示同步（如有）
- [ ] `AGENTS.md` §6/§8 补充：responses 渠道格式、路由矩阵、usage 路径；README API 代理章节若提及渠道格式则同步
- [ ] 全量回归：手动 dev 冒烟（chat→responses 渠道流式/非流式、responses 透传）

验证：`bun run check && bun run typecheck && bun run test`

## Review gates

- Step 3 完成后：转换器映射表 vs OpenAI Responses API 规范逐条核对（重点 tool_calls/usage/finish_reason）
- Step 5 完成后：对照 prd.md Acceptance Criteria 逐条核验
- 最终：trellis-check 全量检查（spec 合规 + 门禁）

## 回滚点

- 每步独立 commit；Step 1-2 可随时 revert 无副作用
- Step 3 仅新增未调用代码，revert 无风险
- Step 4/5 为行为变更步，回滚 revert 对应 commit 即可（无迁移、无数据变更）
