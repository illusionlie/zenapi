# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

质检门槛（2026-09 任务 09-13-remove-site-mode 用户确认）：

- `bun run typecheck` 与 `bun run test` 必须 **exit 0**（tests/ 下 vitest，纯函数单测，node environment，不引入 jsdom）。
- `bun run check`（biome，含 --write 自动安全修复）以「**相对基线零新增**」为准：仓库存在 24 个 apps/ui 存量错误（a11y：noSvgWithoutTitle / noLabelWithoutControl / 点击类，为已知技术债），任何新改动不得增加该计数。
- 判定方法：改动前后各跑一次 `bun run check --reporter=summary` 对比 error 数；对怀疑新增的文件，提取 HEAD 版本单独跑 Biome 逐文件比对（行号会因插入位移，需按规则+数量而非行号判定）。

---

## Known Debt

- apps/ui 存量 24 个 lint 错误（主要 a11y），留待独立的前端质量任务处理；**不要**在无关任务中顺手修改（会污染重构 diff 的回归面）。新增 UI 代码必须 lint 干净——先例：UsersView 可用模型选择器用 `<span>` 替代缺 control 的 `<label>`、checkbox 嵌入 `<label>` 内，零新增 a11y 错误。

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

(To be filled by the team)

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
