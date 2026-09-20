# implement.md — 渠道多 API 格式与 responses 自动降级转换

> 执行清单。每个 Phase 末尾为验证命令与回滚点；全部锚点见 `research/recon-api-format.md`，契约红线见 design.md 与 `.trellis/spec/api-worker/backend/format-conversion.md`。

## 前置

- 分支：trunk-based 直接在 main 作业（Conventional Commits），按 Phase 粒度提交，便于按提交回滚。
- 每阶段提交前：`bun run check`（Biome）；整体门禁见 G2。

## Phase A — 数据层（回滚点 A：加列 + 纯新增，可整体 revert）

- [ ] A1 迁移 `apps/worker/migrations/0022_channel_api_formats.sql`（design §2.1，幂等：WHERE api_formats IS NULL）+ `schema.sql` 同步加列（database-guidelines：两者必须同改）。
- [ ] A2 `services/channel-types.ts`：`ChannelRow.api_formats: string | null`；`parseApiFormats`（design §2.2 读兜底链）；`normalizeApiFormats`（白名单/去重/非空/custom 独占/规范序）。
- [ ] A3 `services/channel-repo.ts`：SELECT 增列；INSERT/UPDATE 双写 `api_formats` + `api_format` 镜像（首元素）；Input 类型增 `api_formats`。
- [ ] A4 `tests/channel-formats.test.ts`：normalize/parse 单测（空、非法值过滤、custom 组合拒绝、规范序、读侧三级兜底）。
- [ ] 验证：`bun run typecheck && bun run test`。

## Phase B — 路由能力函数（回滚点 B：纯新增服务，未接线）

- [ ] B1 新建 `services/channel-routing.ts`：`InboundProtocol`、`inboundProtocolForPath`、`selectTargetFormat` + 偏好序常量（design §3）。
- [ ] B2 `tests/channel-routing.test.ts`：**单格式行为保持矩阵**（4 格式 × 4 协议 = 16 格逐格断言，含 responses×custom=custom、passthrough×anthropic=null）+ **多格式偏好矩阵**（`["openai","anthropic"]` × chat/responses/anthropic、`["openai","responses"]` × responses=responses 等）。
- [ ] 验证：`bun run test -- channel-routing`。

## Phase C — 转换器（回滚点 C：纯新增导出，无接线）

- [ ] C1 `services/format-converter.ts`：`responsesToOpenaiRequest` / `openaiToResponsesResponse` / `createOpenaiToResponsesStreamTransform`（契约 design §4；红线：usage 单末事件三值、`[DONE]` 不外泄、fail-open 丢弃 + `[format-converter]` warn、上游 error → `response.failed` 终止）。shape 互逆参照既有 `openaiToResponsesRequest`/`responsesToChatResponse` 及其 fixture。
- [ ] C2 `tests/format-converter-responses-inbound.test.ts`（模式照抄 `tests/format-converter-responses.test.ts`：纯函数直调 + `runStreamTransform` + `parseSseData`）：请求映射（instructions/input 字符串/message/function_call/function_call_output/tools/tool_choice/reasoning/stateful 丢弃）、响应映射（usage 口径、tool_calls→function_call、finish 映射）、流式（事件序列、sequence_number、usage 仅 response.completed、reasoning_content→summary delta、无 [DONE]、error→response.failed）。
- [ ] 验证：`bun run test -- format-converter`。

## Phase D — 代理接线（高风险阶段，行为变更集中于此）

- [ ] D1 `routes/proxy.ts`：
  - 资格过滤换 `selectTargetFormat(parseApiFormats(ch), inboundProtocolForPath(path))`，目标格式随渠道传递；全 null → 503 `no_available_channels`（错误形态不变）。
  - `buildChannelRequest`：新分支「入站 responses + 目标 openai」→ `responsesToOpenaiRequest` + `{base_url}/chat/completions`；端点/鉴权头规则按 design §5 表收敛（anthropic/responses/custom 分支行为逐字保持）。
  - `convertResponse`：新分支「入站 responses + 目标 openai」→ `openaiToResponsesResponse`/`createOpenaiToResponsesStreamTransform`。
  - `stream_options.include_usage` 注入条件放宽为「目标 openai 且流式」（design §4.4）。
  - **删除** `fallbackSubPath` 与 400/404 路径回退块（:656-657、:720-739）及其 `lastRequestPath` 关联（AC8）；`allowedFormatsForPath` 被替代后删除或收编。
- [ ] D2 `routes/anthropic-proxy.ts`（内联 filter 换共享函数，三分支行为不变）与 `routes/playground.ts`（显式 inbound="chat"）。
- [ ] D3 更新受影响既有测试：`tests/proxy-responses.test.ts`（responses 入站 + openai 渠道透传断言改为转换断言；回退重试用例移除/改写）；`tests/client-disguise.test.ts`、`tests/proxy-headers.test.ts` 夹具补 `api_formats`；`tests/filter-allowed-channels.test.ts` 依赖读侧兜底应无需改动（验证即可）。
- [ ] D4 新增集成用例（扩 `tests/proxy-responses.test.ts`）：AC3 端到端（非流式 + 流式，断言上游 URL/体、响应协议形状、`parseUsageFromSse` prompt_tokens>0）、AC4 透传、AC6 anthropic 原生直通、AC7 偏好序、AC5 503 维持。
- [ ] 验证：`bun run typecheck && bun run test`（全量）。**审查门：本阶段 diff 单独提交，人工过一遍 proxy.ts 行为变更面。**

## Phase E — CRUD / 测试工具 / 拉模型

- [ ] E1 `routes/channels.ts`：POST/PATCH 接 `api_formats`（`normalizeApiFormats` !ok → 400 `ERR_CHANNEL_INVALID_FORMATS`）；legacy `api_format` 双接受（api_formats 优先）；PATCH 三态（undefined 保留 / 值替换 / null/[]/非法 400）；响应双字段。base_url 规范化分支改按「声明含 anthropic」判定（多格式渠道两种规范化需兼容——anthropic 端点用 normalizeBaseUrl，openai 端点用 trim 去尾斜杠；实现时以两分支现状为准收敛，不改变存量单格式行为）。
- [ ] E2 `services/channel-testing.ts`：`fetchChannelModels` 接受格式数组，`Promise.allSettled` 并集去重 + `probe_warnings`，全失败抛错；`/:id/test` 响应增逐格式 `results`。
- [ ] E3 test-model：目标格式 = `selectTargetFormat(formats, "chat")` 覆盖 channel-like。
- [ ] E4 `routes/newapiChannels.ts`：插入 `["openai"]`；PUT 保留 formats。
- [ ] E5 测试：校验纯函数（已在 A4）+ fetch_models 并集/部分失败用例（mock fetch，参照 `tests/` 既有 fetch mock 模式）。
- [ ] 验证：`bun run typecheck && bun run test`。

## Phase F — UI（apps/ui）

- [ ] F1 `core/types.ts`：`Channel`/`ChannelForm` 增 `api_formats`；提交链路字段梳理（`AdminApp.tsx` :441 回填 / :523 提交 / :697 / :814）。
- [ ] F2 `features/ChannelsView.tsx`：格式多选 chips（custom 独占：勾选即清空禁用其余）；base_url 联动按格式集合；列表徽章全格式（desktop/mobile 两处）。
- [ ] F3 `features/MonitoringView.tsx:128` 徽章改 formats；`core/constants.ts:47` 初始值。
- [ ] F4 遵循 frontend spec（a11y htmlFor/aria、Tailwind 色系、容器集中状态）。
- [ ] 验证：`bun run check && bun run typecheck && bun run build`（ui 构建通过）。

## Phase G — 收尾

- [ ] G1 AGENTS.md 更新：§6 routes 表（如新增 service 不涉及路由则仅 §8）、§8 代理关键行为（路由矩阵条目重写为能力声明 + 偏好序表；删除「/v1/responses + openai 回退」条目；新增 api_formats 双写与 custom 独占说明）、§10 数据库核心域描述。
- [ ] G2 全量门禁：`bun run check && bun run typecheck && bun run test`。
- [ ] G3 本地迁移演练（如本地库存在）：`bun run --filter api-worker db:migrate`，确认 0022 可重放、回填正确。
- [ ] G4 Phase 3 收尾：spec 沉淀（format-conversion.md 增补 responses→chat 契约；视情况新增 channel-routing spec）、journal 记录、提交。

## 风险文件与回滚

| 文件 | 风险 | 回滚 |
|---|---|---|
| `routes/proxy.ts` | 核心代理路径，D 阶段行为变更 | 按 Phase D 独立提交 revert |
| `services/format-converter.ts` | 2036 行契约文件 | Phase C 纯新增导出，revert 无副作用 |
| `routes/anthropic-proxy.ts` | 双实现之一 | D2 行为不变断言护栏 |
| `migrations/0022_*.sql` | 加列 + 回填 | 加列向后兼容，镜像双写保证旧代码可读 |

## task.py start 前检查

- [ ] prd.md / design.md / implement.md 已获用户审阅批准。
- [ ] implement.jsonl / check.jsonl 已含真实条目（≥1 条 spec/research，无 `_example` 残留）。
