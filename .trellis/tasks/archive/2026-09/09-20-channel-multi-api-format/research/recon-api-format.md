# 侦察报告：api_format 全链路现状（2026-09-20）

> 由 Explore 代理全库侦察产出，作为 design.md / implement.md 的事实依据。所有路径相对仓库根。

## 1. schema 与迁移

- `apps/worker/src/db/schema.sql:16`：`api_format TEXT NOT NULL DEFAULT 'openai'`，无 CHECK/ENUM 约束。
- 引入迁移：`apps/worker/migrations/0002_api_format.sql`（单行 ALTER TABLE）。
- 迁移命名 `NNNN_snake_case_name.sql`，现有 0001–0021，最新 `0021_channel_client_disguise.sql`，下一个可用编号 **0022**。
- `apps/worker/wrangler.toml:10-13` 未显式配置 `migrations_dir`（默认 `migrations/`）。
- channels 表其他相关字段：`base_url`(:4)、`api_key`(:5)、`type INTEGER NOT NULL DEFAULT 1`(:6，管理端写死 1：`routes/channels.ts:163`、`:244`；`newapiChannels.ts:301`)、`models_json`(:12)、`custom_headers_json`(:17)、`disguise_headers_json`(:18)、`disguise_system_prompt`(:19)、`stream_only`(:20)。

## 2. 类型定义（四处硬编码 union）

- Worker：`apps/worker/src/services/channel-types.ts:1` `export type ChannelApiFormat = "openai" | "anthropic" | "custom" | "responses"`；`ChannelRow.api_format`(:18)、`ChannelRecord = ChannelRow`(:27)。
- Repo：`apps/worker/src/services/channel-repo.ts:154`（ChannelInsertInput.api_format）、`:205`（ChannelUpdateInput.api_format）、INSERT SQL(:168)、UPDATE SQL(:219)。
- UI：`apps/ui/src/core/types.ts:1`（同 union）、`:11`（Channel.api_format）、`:74`（MonitoringChannelData.api_format: string）、`:256`（ChannelForm.api_format）。

## 3. 路由过滤（三套独立实现）

- 共享函数 `allowedFormatsForPath(path)`：`apps/worker/src/routes/proxy.ts:119-130`。
  - `/v1/responses` 前缀 → `{openai, responses, custom}`；注释(:113-115)：anthropic 被排除——「its converter cannot map `input` and would produce garbage upstream calls」。
  - `isChatPath`（`CHAT_PATHS = ["/v1/chat/completions", "/v1/responses"]`，:101-108）→ `null`（全格式）。
  - 其余透传路径 → `{openai, responses, custom}`。
  - 应用点：`proxy.ts:625-640`，`allowedFormats.has(ch.api_format ?? "openai")` 过滤后为空 → 503 `no_available_channels`。
- anthropic 入站：`apps/worker/src/routes/anthropic-proxy.ts:156-163` 内联 filter `(ch.api_format ?? "openai") !== "responses"`，注释(:156-157)「no responses→anthropic conversion this phase (design.md D2/D5)」。
- playground：`routes/playground.ts:71-77` 仅按 `channelSupportsModel` 过滤，无 api_format 过滤；targetPath 固定 `/v1/chat/completions`(:80)，复用 proxy.ts 导出的 `buildChannelRequest`/`convertResponse`/`channelSupportsModel`(:9-13)。
- `/v1/models`（proxy.ts:382-479）不按 api_format 过滤。

## 4. 上游请求构造（两套实现）

- `buildChannelRequest`（proxy.ts:153-310），按 `channel.api_format ?? "openai"`(:166) 分支：
  - `anthropic`(:172-202)：`{normalizeBaseUrl(base_url)}/v1/messages`，`x-api-key` + `anthropic-version: 2023-06-01`，body = `openaiToAnthropicRequest(parsedBody)`。
  - `responses`(:204-259)：入站 `/v1/responses` → `{base_url}/responses` 原样透传（R4 注释，:210-223）；chat 入站 → `{base_url}/responses` + `openaiToResponsesRequest`(:224-243)；其他路径 → 去 `/v1` 前缀透传(:244-249)。头 `Authorization: Bearer` + `x-api-key`。
  - `custom`(:261-275)：`base_url` 即完整 URL，body 原样。
  - 默认 `openai`(:277-309)：`{base_url}{subPath}`（subPath 去掉 `^/v1`），`Authorization: Bearer`。
- 响应转换 `convertResponse`（proxy.ts:318-376）：`responses` 且 `isConvertedChatPath(inboundPath)`(:138-141：isChatPath 且非 /v1/responses) → `createResponsesToChatStreamTransform`/`responsesToChatResponse`；`anthropic` → `createAnthropicToOpenaiStreamTransform`/`anthropicToOpenaiResponse`；其余原样(:374-375)。
- anthropic 入站独立内联构造：`anthropic-proxy.ts:214-362`：anthropic→`{base}/v1/messages` 透传(:218-263)；openai→`anthropicToOpenaiRequest`(:86) 发 `{base}/chat/completions`(:271-303)，响应 `openaiToAnthropicResponse`/`createOpenaiToAnthropicStreamTransform`(:305-333)；custom→原样到 base_url(:335-361)。

## 5. CRUD 校验（无白名单校验，全 as 断言）

- POST `routes/channels.ts:146`、PATCH `:213-215`（body → current → "openai" 三级回退）、fetch_models `:296`、test-model `:374-376`。
- base_url 规范化分叉：anthropic 用 `normalizeBaseUrl`（`:154-157`、`:229-234`、`:297-300`、`:377-381`），其余 trim+去尾斜杠。
- `newapiChannels.ts:296` 插入固定 `api_format: "openai"`；`:348-349` PUT 保留 `current.api_format`；`:380/:424/:465` 测试/拉模型传 `channel.api_format`。

## 6. 连通性测试 / 单模型测试 / 模型拉取

- `services/channel-testing.ts:33-104` `fetchChannelModels(baseUrl, apiKey, apiFormat, ...)`：`custom` → GET base_url 本身；`openai`/`responses` → `{base_url}/models`（:49-51）；`anthropic` → `{normalizeBaseUrl}/v1/models` + `x-api-key`/`anthropic-version`(:52-63)。调用方：`routes/channels.ts:290-317`（fetch_models）、`:475-524`（/:id/test）。
- test-model `routes/channels.ts:336-470`：最小 ChannelRecord(:406-417，注释 :403-405 说明 buildChannelRequest 只读字段)，body 由 `buildModelTestRequestBody`（`services/model-testing.ts:26-40`，固定 chat completions 形状、非流式），经 `buildChannelRequest(channelLike, "/v1/chat/completions", ...)`(:425-440)；2xx 后 `convertResponse(..., "/v1/chat/completions")`(:454-461)。

## 7. usage 记录

- `usage_logs` 表无 api_format 列（schema.sql:41-59）；`UsageInput`（`services/usage.ts:3-20`）与 INSERT(:45) 均无。
- 间接痕迹仅 `request_path`：openai 渠道 responses 回退重试记 `"/responses"`（proxy.ts:656-657 `fallbackSubPath`、`:738` responsePath、`:742` lastRequestPath）；anthropic-proxy 固定 `"/anthropic/v1/messages"`(:395)。
- `/v1/responses` 入站 + openai 渠道的 400/404 路径回退：仅 openai 格式渠道（proxy.ts:720-739，`(channel.api_format ?? "openai") === "openai"`），重试 `{normalizeBaseUrl(base_url)}{/responses}`，body 用 `originalRequestText`（若 stream_options 被注入）否则 `channelRequestText`。responses 格式渠道无此回退（AGENTS.md §8 明示）。

## 8. 格式转换器（services/format-converter.ts，2036 行）

| 函数 | 行号 | 方向 |
|---|---|---|
| `openaiToAnthropicRequest` | 296-499 | chat→anthropic |
| `anthropicToOpenaiRequest` | 504-658 | anthropic→chat |
| `mapStopReason` / `mapFinishReason` | 667-684 / 691-707 | 停止原因双向映射 |
| `anthropicToOpenaiResponse` | 752-823 | anthropic→chat 响应 |
| `openaiToAnthropicResponse` | 828-892 | chat→anthropic 响应 |
| `createAnthropicToOpenaiStreamTransform` | 908-1071 | anthropic SSE→chat SSE |
| `createOpenaiToAnthropicStreamTransform` | 1225-1452 | chat SSE→anthropic SSE |
| `openaiToResponsesRequest` | 1506-1717 | chat→responses 请求 |
| `responsesToChatResponse` | 1723-1786 | responses→chat 响应 |
| `createResponsesToChatStreamTransform` | 1792-2035 | responses SSE→chat SSE |

- **不存在** `responsesToOpenaiRequest`（responses 入站→chat 请求）、`openaiToResponsesResponse`、`createOpenaiToResponsesStreamTransform`；也不存在任何 responses↔anthropic 转换（全库 grep 无；见 proxy.ts:113-115、anthropic-proxy.ts:156-157 注释）。
- 契约文档：`.trellis/spec/api-worker/backend/format-conversion.md`（usage 单末 chunk 三值、口径换算、thinking 映射、fail-open 丢弃、`[DONE]` 恰一次、error 事件降级终止）。

## 9. 测试覆盖

- `tests/proxy-responses.test.ts`：`allowedFormatsForPath`(:142)、buildChannelRequest responses 分支(:173)、convertResponse 接线(:342)、路由矩阵集成（responses 入站 + 仅 anthropic → 503 零上游 fetch :476-502；非 chat 透传 + anthropic → 503 :504-521；chat 入站 + responses 渠道 → 转换发 `{base}/responses` :523 起）、anthropic 路由集成(:703：仅 responses 渠道 → 503 :707-732；openai 渠道 → 经 chat completions 转换 :734 起)。
- `tests/format-converter-anthropic.test.ts`（请求 :78 / 响应 :467 / 流式 :591 / 停止原因反向 :969）。
- `tests/format-converter-responses.test.ts`（请求 :58 / 工具往返 :315 / 响应 :389 / 流式 :534）。
- `tests/filter-allowed-channels.test.ts:34`（fixture 固定 `api_format: "openai"` :14，与格式过滤无关）。
- `tests/client-disguise.test.ts:162`、`tests/proxy-headers.test.ts:193`：buildChannelRequest 按四格式分支的伪装/头策略矩阵。
- `tests/model-testing.test.ts`、`tests/usage-responses.test.ts`（Responses usage json/sse 解析 :8/:112/:128）。
- `tests/model-monitoring.test.ts:232-241`：AC3 禁止用户侧模型监控出现 `api_format` 字段。

## 10. 监控

- `routes/monitoring.ts:18` SELECT 携带 `c.api_format`，`GROUP BY c.id, c.name, c.status, c.api_format`(:26)，输出每渠道行 `api_format`(:117)。统计不按格式拆分。
- UI：`features/MonitoringView.tsx:128` 显示 `{channel.api_format}`。

## 11. UI

- 表单单选 select：`features/ChannelsView.tsx:881-916`（openai / responses / anthropic / custom 四 option）；切换后 base_url label/placeholder 联动(:923-934)。
- 常量：`formatLabels`(:255-260)、`formatBadgeColors`(:262-267)、`baseUrlPlaceholders`(:269-274)。
- 列表徽章：desktop `:594-595`/`:618-620`，mobile `:683`/`:700-702`。
- `AdminApp.tsx`：编辑回填 :441、提交 :523、fetch_models 请求体 :697、test-model 请求体 :814。
- 表单初始值 `core/constants.ts:47`（`initialChannelForm.api_format: "openai"`）。
