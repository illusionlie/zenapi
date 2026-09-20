# 侦察报告：格式 → 上游 URL 解析链路现状（2026-09-20）

> 为任务「渠道每格式独立端点覆盖」收集的事实基线，行号以当时 main（fbb89d4 之后）为准。

## 1. 格式 → 上游 URL 的全部解析点

### a) `routes/proxy.ts` `buildChannelRequest`（144-329）
- 入口读目标格式：`const apiFormat = channel.api_format ?? "openai"`（157）。
- **anthropic 分支**（163-193）：`normalizeBaseUrl(channel.base_url)`（164，剥尾斜杠+剥 `/v1`），`target = cfSafeUrl(\`${baseUrl}/v1/messages\`)`（165），无 querySuffix；头 `x-api-key` + `anthropic-version`。
- **responses 分支**（195-250）：`channel.base_url.replace(/\/+$/, "")`（197，保留版本路径）：
  - `/v1/responses` 入站透传：`${baseUrl}/responses${querySuffix}`（207）；
  - chat 入站转换：同 URL（219）；
  - 其余透传：`${baseUrl}${subPath}${querySuffix}`（238，subPath 去 `^/v1`）。
- **custom 分支**（252-266）：`target = cfSafeUrl(\`${channel.base_url}${querySuffix}\`)`（254），base_url 即完整 URL，不规范化。
- **默认 openai 分支**（268-328）：`channel.base_url.replace(/\/+$/, "")`（270）：
  - `/v1/responses` 入站转 chat：`${baseUrl}/chat/completions${querySuffix}`（276）；
  - 其余：`${baseUrl}${subPath}${querySuffix}`（300）。
- querySuffix 由主 handler 拼（710-712）。

### b) `routes/anthropic-proxy.ts`（handler 52-527）
- 路由浅拷贝覆盖（164-167），responses-only 渠道丢弃。
- anthropic 原生分支（225-277）：`normalizeBaseUrl(channel.base_url)`（227）→ `${baseUrl}/v1/messages`（228）。
- openai 转换分支（278-341）：`channel.base_url.replace(/\/+$/, "")`（280）→ `${baseUrl}/chat/completions`（281）。
- custom 分支（342-369，else）：`cfSafeUrl(channel.base_url)`（344）。

### c) `services/channel-testing.ts`
- `probeChannelFormat`（50-119）：custom → `target = baseUrl`（63）；openai/responses → `${baseUrl.replace(/\/+$/, "")}/models`（66）；anthropic → `${normalizeBaseUrl(baseUrl)}/v1/models`（69）。伪装头对全格式生效（85-88），探针不收敛 applyHeaderPolicy（注释 46-48）。
- `fetchChannelModels`（130-224）：过滤 custom（137-139），`Promise.allSettled` 逐格式（142-152）。

### d) `routes/channels.ts`
- POST `/fetch_models`（369-406）：`normalizeChannelBaseUrl(apiFormats, body.base_url)`（383）→ `fetchChannelModels(baseUrl, apiKey, apiFormats, custom_headers, disguise_headers)`（387-393）。
- POST `/test-model`（425-571）：`targetFormat = selectTargetFormat(declaredFormats, "chat") ?? "openai"`（476）；baseUrl 来自 body（478，经 normalizeChannelBaseUrl）或 DB 原值（479）；channelLike（506-518，`api_format: targetFormat`、`api_formats: JSON.stringify(declaredFormats)`）→ `buildChannelRequest(channelLike, "/v1/chat/completions", "", ...)`（530-541）。
- POST `/:id/test`（576-630）：`fetchChannelModels(String(channel.base_url), ..., parseApiFormats(channel), channel.custom_headers_json, channel.disguise_headers_json ?? null)`（583-589）。

## 2. base_url 规范化与 schema

- `normalizeBaseUrl`（`utils/url.ts:10-16`）：空→""；trim → 去全部尾部 `/` → 再剥一个尾部 `/v1`（大小写不敏感）。只剥 `/v1`。
- `normalizeChannelBaseUrl`（`routes/channels.ts:120-128`）：纯 anthropic（length===1 且 ==="anthropic"）→ normalizeBaseUrl；否则 trim+去尾斜杠（保留版本路径）。调用点：channels.ts:231（POST）、310-313（PATCH）、383（fetch_models）、478（test-model）。
- `normalizeBaseUrlInput`（`services/newapi.ts:285-292`）：仅 trim+去尾斜杠。
- `cfSafeUrl`（`utils/url.ts:52-63`）：裸 IP host 改写 `*.sslip.io`，与格式无关。
- schema（`db/schema.sql`）：`base_url TEXT NOT NULL`（4）、`api_format` 镜像（16）、`api_formats`（20）。最新迁移 **0022**，下一个可用 **0023**。

## 3. channel-repo.ts

- SELECT 均 `SELECT *`（listChannels:72、listActiveChannels:117、getChannelById:128），新列自动带出，`ChannelRow` 需加字段。
- `ChannelInsertInput`（166-185）/`ChannelUpdateInput`（220-237）字段清单；`toApiFormatColumns` 双写派生（151-164）。
- INSERT 显式列串+bind（194-216）、UPDATE SET 串+bind（247-268）——加列需同步。
- **注意**：`tests/channel-testing.test.ts` INSERT 参数位置断言 `args[2]`（base_url，307/325）、`args[12]/args[13]`（api_format 镜像与 api_formats JSON，310-312/330-331/337）——**列序变化会移动这些索引**。

## 4. channel-routing.ts / channel-types.ts 导出面

- `channel-routing.ts`：`InboundProtocol`（10-14）、`FORMAT_PREFERENCE`（28-34）、`inboundProtocolForPath`（40-52）、`selectTargetFormat`（59-71）。
- `channel-types.ts`：`ChannelApiFormat`（1）、`ChannelRow`（3-27，`base_url` 6、`api_format` 18、`api_formats` 20）、`parseApiFormats`（79-100）、`normalizeApiFormats`（114-127）、`API_FORMAT_WHITELIST`（32-37）、`CANONICAL_ORDER`（43-48）。
- 浅拷贝覆盖点三处：proxy.ts:680-694、anthropic-proxy.ts:164-167、playground.ts:84-85。

## 5. 头策略 / 伪装

- `applyHeaderPolicy`（`utils/proxy-headers.ts:111-142`）只操作 Headers，不读 base_url。
- 伪装模板 `resolveDisguiseTemplate`（`utils/client-disguise.ts:150-158`）与 URL 无关。
- buildChannelRequest 每分支各自调 applyHeaderPolicy（proxy 170-175 / 243-248 / 259-264 / 303-308；anthropic-proxy 243-248 / 285-290 / 350-355）。
- usage 记录与 base_url 无关。

## 6. UI

- `ChannelsView.tsx`：`baseUrlPlaceholders`（260-265：openai/responses `https://api.openai.com/v1`、anthropic `https://api.anthropic.com/anthropic`、custom 完整 URL）；`selectedFormats`（382）、`hasCustom`（383）、`isPureAnthropic`（384-385）、`baseUrlPlaceholder` 三态（389-393）；`toggleApiFormat`（394-411）；chips（902-938）；base_url input（939-965，label 944、placeholder 950、含 anthropic 非纯提示 959-964）。
- `AdminApp.tsx`：回填（437-448，`base_url: channel.base_url ?? ""` 439）、提交 body（525-539，`base_url` 527、`api_formats` 531）、fetch_models body（708-715）、test-model body（832-841）。
- `core/types.ts`：`Channel`（3-20）、`ChannelForm`（264-277）。`core/constants.ts`：`initialChannelForm`（43-53）、`CHANNEL_API_FORMATS`（56-61）。
- `core/utils.ts parseChannelApiFormats`（60-91）读侧兜底（api_formats wire 形态为 TEXT JSON 字符串）。

## 7. 测试（URL 断言点）

- `proxy-responses.test.ts`：`makeChannel` 夹具 `base_url: "https://upstream.example/v1"`（16）；target 断言 191、207、232、290、548、621、686、731、814、928、990、1071、1132、1184。
- `channel-testing.test.ts`：custom 探测 URL（195）；INSERT 位置断言（307/310-312/325/330-331/337）；`makeChannelRow`（58-71）。
- `proxy-headers.test.ts` / `client-disguise.test.ts`：不断言 target。
- 纯函数测试不受影响：channel-routing.test.ts、channel-formats.test.ts。

## 8. newapiChannels.ts

- POST（257-306）：`normalizeBaseUrlInput`（281-283）、`api_formats: ["openai"]` 硬编码（297）。
- PUT（308-358）：`api_formats: parseApiFormats(current)` 保留（350）。
- test（370-409/411-）：`fetchChannelModels(String(channel.base_url), ..., parseApiFormats(channel), channel.custom_headers_json)`（377-382）——未传第 5 参。
- 新字段不透传（POST/PUT 均未涉及），需显式决定透传策略。
