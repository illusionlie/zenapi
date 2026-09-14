# 令牌操作「查看」改为直接复制（弹窗降级为兜底）

## Goal

参考 New API 的交互：令牌列表操作中的「查看」改为「复制」，点击后直接将令牌明文写入剪贴板并以 toast 反馈；`SecretValueModal` 从主路径降级为复制失败时的兜底出口，消除"拿一次令牌还要过一道弹窗"的冗余交互。

## Background

- 上一任务（09-14-toast-notification-refactor）为解决"复制失败时明文无处展示"，把 reveal 主路径改成了弹窗——兜底手段成了主路径，本任务纠正。
- 后端 `tokens.token_plain` 直接存库，`/api/tokens/:id/reveal` 与 `/api/u/tokens/:id/reveal` 均可重复返回明文，无一次性查看限制，直接复制无后端障碍。
- 用户端 `UserTokensView` 按钮文案已是「复制」，但行为仍是打开弹窗，文案与行为不一致，一并修正。

## Requirements

- R1 管理台 `TokensView.tsx`（桌面表格 + 移动卡片共 2 处按钮）：文案「查看」→「复制」，点击 → fetch reveal → 写剪贴板 → `toast.success("令牌已复制到剪贴板")`。
- R2 用户端 `UserTokensView.tsx`：文案保持「复制」，行为改为直接复制（同 R1 流程）。
- R3 复制失败兜底：`navigator.clipboard.writeText` 抛错时（典型如 Safari/iOS 异步间隙后用户激活过期）回落打开 `SecretValueModal`（标题「令牌详情」），弹窗内复制逻辑维持现状。
- R4 其余 `SecretValueModal` 用例保留不动：新令牌创建（管理台/用户端）、邀请码导出兜底。
- R5 明文不进 toast 文案（旧版 banner 曾把明文拼进通知文案；toast 全局短暂可见，不适合承载明文）。
- R6 无后端改动：不新增/修改路由、表、迁移；reveal 404（未找到令牌）维持 `toast.error` 现状。

## Acceptance Criteria

- [ ] 管理台令牌列表按钮文案为「复制」，点击后剪贴板获得完整令牌明文并出现成功 toast，全程无弹窗
- [ ] 用户端令牌列表点击「复制」行为同上
- [ ] 剪贴板写入失败时弹出 `SecretValueModal`，明文可见且弹窗内「复制」可用
- [ ] 新令牌创建后仍弹出明文弹窗；邀请码导出兜底行为不变
- [ ] `bun run check && bun run typecheck && bun run test` 全部通过

## Notes

- 轻量任务，PRD-only；技术方案已在上轮讨论中确认（fetch 后复制 + 弹窗兜底）。
- 关键文件：`apps/ui/src/features/TokensView.tsx`、`apps/ui/src/features/UserTokensView.tsx`、`apps/ui/src/AdminApp.tsx`、`apps/ui/src/UserApp.tsx`（后两者的 `handleTokenReveal`）。
