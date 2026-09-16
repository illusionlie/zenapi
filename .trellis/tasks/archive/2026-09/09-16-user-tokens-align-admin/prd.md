# PRD：用户端「我的令牌」与管理端「令牌管理」完全对齐

## 背景

用户端「我的令牌」（`apps/ui/src/features/UserTokensView.tsx`）与管理端「令牌管理」（`apps/ui/src/features/TokensView.tsx`）功能高度相似，但 UI 处于两个不同代次：

| 维度 | 管理端 TokensView（新） | 用户端 UserTokensView（旧，与 UsersView 同代） |
|------|------------------------|------------------------------------------|
| 表格 | CSS Grid + `divide-y` 行 | 原生 `<table>` |
| 操作按钮 | 药丸按钮（`rounded-full` 边框底色） | 纯文字链接 |
| 移动端 | 专属卡片布局（`md:hidden`） | 仅 `overflow-x-auto` |
| 分页 | 有（页码 + 每页条数） | 无（全量渲染） |
| 状态徽章 | 带边框 pill | 无边框 pill |
| 启停开关 | 有 | 无 |
| 渠道限定列 | 无 | 有（存量 `allowed_channels` 展示） |

用户决策：**用户端向管理端完全对齐（视觉 + 分页 + 启停开关 + 移除渠道限定列）**。

## 需求

- **R1 视觉对齐**：用户端令牌列表改为管理端同款 Grid 表格、带边框状态徽章、药丸操作按钮、移动端专属卡片布局。
- **R2 分页**：与管理端同款分页控件（页码、每页条数 10/20/50、总条数/总页数），前端切片实现（与管理端一致）。
- **R3 启停开关**：用户可启用/停用**自己的**令牌；后端 `PATCH /api/u/tokens/:id` 放开 `status` 字段；操作后有 toast 反馈且列表状态即时刷新。
- **R4 移除「渠道限定」存量列**：用户端列表不再展示存量 `allowed_channels`；服务端对存量数据的校验行为**保持不变**。
- **R5 模态对齐**：创建/编辑模态采用管理端同款 sheet 布局、uppercase label、amber focus ring、药丸关闭/提交按钮。

## 设计决策变更（显式记录）

- **推翻既有决策 D5.3**（`.trellis/tasks/archive/2026-09/09-16-token-management-enhancements/design.md`）中「`status` 字段 admin-only、用户 PATCH 出现即 400」的规则：用户可启停自己的令牌。
  - 理由：令牌是用户自有资源，启停是常见自助能力（one-api / New API 均支持）；`tokenAuth` 已拒绝非 `active` 令牌（`middleware/tokenAuth.ts` L44），启用/停用即刻生效，无新增提权面。
  - 权限边界**不变**的部分：`quota_total` / `quota_used` / `allowed_channels` 仍为 admin-only，body 中出现即 400 `field_not_editable`。

## 非目标

- 不改动管理端 TokensView / UsersView 的任何行为。
- 不做后端分页（与管理端保持同一模式：`GET /api/u/tokens` 全量返回 + 前端切片；用户令牌数量级小）。
- 不允许用户编辑额度与渠道限定。
- 不改动存量 `allowed_channels` 的服务端校验逻辑（fail-open 解析行为保留）。
- 不改动 `/v1` 代理路径与 `tokenAuth`。

## 验收标准

- **AC1** 用户端令牌列表为 Grid 风格：桌面表格行、移动端卡片、带边框状态徽章、药丸操作按钮（复制/编辑/启停/删除），与管理端 TokensView 同款。
- **AC2** 分页控件可用：页码跳转（含省略号）、每页条数切换（切页大小重置回第 1 页）、「共 N 条 · M 页」展示；删除令牌后页码越界自动回退（与管理端同款 clamp）。
- **AC3** 用户端每行有启停按钮，点击后 PATCH `{status}` 成功 → toast「令牌已启用/停用」→ 列表刷新为最新状态。
- **AC4** `PATCH /api/u/tokens/:id`：`status` 合法值仅 `"active"` / `"disabled"`（undefined=保持不变）；非法值 → 400 `invalid_status`；body 含 `quota_total` / `quota_used` / `allowed_channels` → 仍 400 `field_not_editable`；`allowed_models` 三态语义不变（undefined=保留 / null=清除 / 数组=替换）。
- **AC5** 用户端列表不再出现「渠道限定」列及相关展示代码。
- **AC6** 停用后的令牌经 `/v1/*` 调用被 `tokenAuth` 拒绝（复用现有逻辑，验证无需改动）。
- **AC7** 新增/更新单测覆盖用户端 PATCH 扩展语义；`bun run check && bun run typecheck && bun run test` 全绿。
