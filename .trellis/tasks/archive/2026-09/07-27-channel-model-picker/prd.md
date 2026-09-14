# 渠道模型选择支持拉取与手动输入

## Goal

在管理端「新增渠道 / 编辑渠道」时，用户可点击「拉取模型」按钮，基于当前表单填写的 `base_url` / `api_key` / `api_format` / `custom_headers` 调用上游 `/v1/models`（或 Anthropic `/v1/models`）获取可用模型列表，在弹层中勾选需要的模型后合并写入「模型列表」textarea；同时完全保留原有的手动逐行输入模型 ID 能力。两种输入方式产出的文本格式一致（`id|input_price|output_price|shared|enabled`，可省略后缀），后续 ModelPricingEditor / 保存逻辑无需改动。

## Background（调研确认事实）

- 后端 `apps/worker/src/services/channel-testing.ts` 已实现 `fetchChannelModels(baseUrl, apiKey, apiFormat?, customHeadersJson?)`，支持 `openai`（`${base}/models`，Bearer+x-api-key）、`anthropic`（`${normalizeBaseUrl(base)}/v1/models`，x-api-key + anthropic-version）、`custom`（直接 GET base_url + custom headers）。返回 `{ ok, elapsed, models: string[], payload }`。
- `apps/worker/src/routes/channels.ts` 挂载于 `/api/channels`，走 `adminAuth`（session）。已有 `POST /:id/test`：需渠道已存在，且仅当渠道无现有模型时才写入 `models_json`，不支持「未保存渠道拉取」。
- `apps/worker/src/routes/newapiChannels.ts` 挂载于 `/api/channel`，走 `newApiAuth`（管理员密码 Bearer，放行不走 adminAuth）。已有 `POST /fetch_models` 接受 `{base_url, key}`，但不传 `api_format` / `custom_headers`，且鉴权方式与管理端 session 不兼容，无法直接复用。
- 前端 `apps/ui/src/features/ChannelsView.tsx` 为展示组件（props 来自 `AdminApp.tsx`）：模型列表是 `<textarea>`（每行一个模型，管道符分隔定价/共享/启用），下方有 `ModelPricingEditor` 可视化编辑与每模型别名编辑器。
- `apps/ui/src/AdminApp.tsx`：`handleChannelTest` 调 `POST /api/channels/:id/test`；`handleChannelSubmit` 将 textarea 按行解析为 `{id, input_price?, output_price?, shared?, enabled?}[]` 作为 `models` 字段提交。`channelForm` 字段：`name, base_url, api_key, weight, api_format, custom_headers, models`。
- `ChannelForm` 类型见 `apps/ui/src/core/types.ts:206`，`initialChannelForm` 见 `apps/ui/src/core/constants.ts:43`。
- `channels` 表 `models_json` 存 `ModelPricing[]`（`{id, input_price?, output_price?, shared?, enabled?}`），见 `channel-models.ts`。

## Requirements

### R1 后端：新增「未保存渠道拉取模型」接口
- 在 `apps/worker/src/routes/channels.ts` 新增 `POST /fetch_models`（即 `/api/channels/fetch_models`，走 adminAuth）。
- 请求体：`{ base_url: string, api_key: string, api_format?: ChannelApiFormat, custom_headers?: string }`。
- 复用 `fetchChannelModels(...)`；按 `api_format` 处理 base_url（与创建/更新路由一致：anthropic 走 normalizeBaseUrl，其余 trim 去尾斜杠；custom 直接用）。
- 响应：`{ ok: boolean, models: string[], elapsed: number }`；失败（`result.ok === false`）返回 502 `channel_unreachable`。
- 不写入数据库、不修改任何渠道。

### R2 前端：拉取按钮 + 选择弹层
- 在 `ChannelsView.tsx` 模型列表 textarea 旁/上方增加「拉取模型」按钮。
- 点击时用当前 `channelForm` 的 `base_url` / `api_key` / `api_format` / `custom_headers` 调 `POST /api/channels/fetch_models`。
- 拉取成功后展示选择面板：列出返回的 `models`，每项带复选框（默认全选），提供「全选 / 全不选」与搜索过滤；底部「确认加入」按钮。
- 确认后：将勾选的模型 ID 与 textarea 中已有模型 ID 去重合并（已存在的不重复添加、不覆盖其定价/共享/启用配置），追加到 textarea 末尾。
- 拉取失败：用现有 `setNotice` 提示错误信息，不影响表单。
- 按钮 loading 态、空结果提示。

### R3 保留手动输入
- 原 textarea 手动输入行为、`ModelPricingEditor`、别名编辑器保持不变。
- 拉取合并只追加新 ID，不破坏已有行格式。

## Acceptance Criteria

- AC1：新增渠道（未保存）时填好 base_url + api_key + api_format，点「拉取模型」能成功获取上游模型列表并在弹层中展示。
- AC2：弹层可勾选部分模型，确认后选中模型以纯 ID 行追加到 textarea，与已有模型去重。
- AC3：编辑已存在渠道时同样可拉取并合并，不丢失渠道原有模型的定价/共享/启用配置。
- AC4：不点拉取、纯手动输入模型 ID 的原有流程完全不变。
- AC5：`bun run check && bun run typecheck && bun run test` 全部通过。
- AC6：`api_format` 为 anthropic / custom 时拉取同样按对应鉴权与路径规则工作。

## Out of Scope

- 用户端 `UserChannelsView`（共享贡献渠道）的拉取支持（本轮仅管理端）。
- 拉取结果展示模型定价/描述等额外元数据（上游 /v1/models 通常只返回 id）。
- 批量渠道拉取。
- `custom` 格式拉取语义改造（复用现有 `fetchChannelModels` 行为：直接 GET base_url）。
