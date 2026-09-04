# Implement — 渠道模型选择支持拉取与手动输入

## 实现顺序

### 1. 后端：新增 `POST /api/channels/fetch_models`
- 文件：`apps/worker/src/routes/channels.ts`
- 在 `export default channels;` 之前、`POST /:id/test` 之后插入新路由。
- 复用已 import 的 `fetchChannelModels`、`parseApiKeys`、`normalizeBaseUrl`、`jsonError`、`ChannelApiFormat` 类型。
- 逻辑见 design.md「后端接口」。
- 路由顺序注意：`POST /fetch_models` 必须在 `POST /` 之后、不影响 `PATCH/DELETE /:id`；Hono 字面量优先，安全。

### 2. 前端 AdminApp：状态 + 回调 + props 透传
- 文件：`apps/ui/src/AdminApp.tsx`
- 新增 state（见 design.md）。
- 新增 `handleFetchModels`、`confirmFetchedModels`、`cancelFetchedModels`、`toggleFetchedModel`、`toggleAllFetched`、`onFetchedSearchChange`（useCallback）。
- 在 `<ChannelsView ... />` 调用处透传新 props。
- 复用 `apiFetch`；错误走 `setNotice`。

### 3. 前端 ChannelsView：按钮 + 弹层 UI
- 文件：`apps/ui/src/features/ChannelsView.tsx`
- 扩展 `ChannelsViewProps`。
- 模型列表 label 区右侧加「拉取模型」按钮（`type="button"`）。
- 模型 textarea 下方、`ModelPricingEditor` 之前渲染弹层（`fetchedModels !== null` 时）。
- 弹层样式与现有模态框（`isChannelModalOpen`）风格一致：固定遮罩 + 白色卡片 + 圆角 + amber 强调色。
- 复用现有 Tailwind class 风格（stone/amber 色系）。

### 4. 校验
- `bun run check`（Biome）
- `bun run typecheck`（tsc）
- `bun run test`（Vitest）

## 验证命令

```bash
bun run check
bun run typecheck
bun run test
```

## 风险点 / 回滚点

- **Hono 路由冲突**：`POST /fetch_models` vs `POST /`（不冲突，不同路径）vs `POST /:id/test`（不冲突，`fetch_models` 无 `/test`）。若误判可在路由注册后用 `curl -X POST /api/channels/fetch_models` 验证。
- **前端 props 漏传**：ChannelsView 是纯展示组件，新增 props 必须在 AdminApp 调用处全部透传，否则 TS 编译失败（typecheck 会捕获）。
- **多 key 文本**：`api_key` textarea 支持多行多 key，拉取只取第一个（与 `:id/test` 一致）。
- 回滚：见 design.md「回滚」。

## 跟进检查（task.py start 前）

- [ ] prd.md 已通过收敛检查，无遗留 Open Questions。
- [ ] design.md / implement.md 已就绪。
- [ ] 用户已审阅或明确同意进入实现。
