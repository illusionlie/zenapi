# 实施计划：用户端「我的令牌」完全对齐管理端

## 前置

- [x] 阅读规范：`.trellis/spec/api-worker-ui/frontend/*`、`.trellis/spec/api-worker/backend/error-handling.md`、`patch-update-semantics.md`
- [x] 基线确认：`bun run check && bun run typecheck && bun run test` 全绿后再动手

## S1 Worker：PATCH 放开 status（design D4）

- [x] `apps/worker/src/services/token-update.ts` 新增 `resolveUserTokenUpdate`（纯函数，语义见 design D4.1；风格对齐 `resolveTokenUpdate`）
- [x] `apps/worker/src/routes/user-api.ts`：
  - forbidden 清单缩小为 `["quota_total", "quota_used", "allowed_channels"]`
  - existing SELECT 追加 `status`
  - PATCH 主体改用 `resolveUserTokenUpdate`，UPDATE 语句写入 `status`
  - 更新函数头注释（admin-only 范围表述）
- [x] `tests/token-update.test.ts` 补 `resolveUserTokenUpdate` 用例（design D5 全部 7 条）

**验证**：`bun run test -- token-update`；`bun run typecheck`

## S2 前端：UserTokensView 重构（design D1）

- [x] `apps/ui/src/features/TokensView.tsx`：`renderModelLimit` 改为 `export`
- [x] `apps/ui/src/features/UserTokensView.tsx` 整体重写：
  - Props 扩展（design D1.1）
  - Grid 表格 / 移动端卡片 / 徽章 / 药丸按钮 / 分页控件 / sheet 模态（design D1.2，逐段对照 TokensView 抄样式）
  - 删除 `parseAllowedChannels` 与「渠道限定」列
  - `renderModelLimit` 改为从 TokensView 导入
  - 保留创建模态内部状态与 `onCreate(name, allowedModels)` 签名
- [x] `apps/ui/src/features/UserApp.tsx`：
  - 分页状态 + `pagedTokens` useMemo + clamp（design D2）
  - 新增 `handleUserTokenToggle`（PATCH `{status}` → reload → toast）
  - `<UserTokensView>` 传参更新

**验证**：`bun run typecheck`；`bun run lint`

## S3 行为验收（PRD AC1–AC7）—— 2026-09-16 playwright + curl 实测全部通过

- [x] AC1 桌面 Grid / 移动卡片（截图验收：user-tokens-desktop.png / user-tokens-mobile.png）
- [x] AC2 分页：11 条 · 2 页、翻页、删除末页唯一令牌后页码回退 clamp（curl 批量建 10 + UI 实测）
- [x] AC3 启停：toast「令牌已停用」+ 徽章/按钮切换 + 启用回切
- [x] AC4 curl 实测：`{"status":"enabled"}` → 400 `invalid_status`；`{"quota_total":100}` / `{"allowed_channels":"{}"}` → 400 `field_not_editable`；`{"status":"active"}` → 200
- [x] AC5 界面无渠道限定列（桌面/移动截图 + grep 零残留）
- [x] AC6 停用后 `/v1/models` → 403 `token_disabled`；启用后放行至余额检查（402 insufficient_balance，新用户零余额预期）
- [x] AC7 全量门禁三连绿（check / typecheck / 202 tests）

## S4 收尾

- [x] 过程偏差已回写 design.md（D1.1 onCreate 签名矛盾澄清、D1.2 创建按钮/删除按钮/启停文案规格修正）
- [x] trellis-check 全量检查（10 项检查通过，1 处修复：创建令牌按钮改为 TokensView 同款药丸样式）

## 回滚点

- 每个 S 步骤独立可编译；任一步失败 `git checkout -- <files>` 回退该步
- 全部改动单 commit 提交，出问题整体 revert
