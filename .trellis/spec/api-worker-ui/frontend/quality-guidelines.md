# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

质检门槛（2026-09 任务 09-14-fix-ui-a11y-lint 起，由「相对基线零新增」升级为全绿）：

- `bun run typecheck` 与 `bun run test` 必须 **exit 0**（tests/ 下 vitest，纯函数单测，node environment，不引入 jsdom）。
- `bun run check`（biome，含 --write 自动安全修复）必须 **全仓 0 error**；唯一例外是 `.pi/extensions/trellis/index.ts` 的 1 个 `noSelfAssign`（Trellis 基建文件，来自 `trellis update` 上游，项目代码不修改、不要求覆盖它）。
- 判定方法：改动后跑 `bun run check --reporter=summary`，error 数应为 0（或 1，仅上述基建例外）；apps/ui 存量 a11y 错误已全部清偿，任何新改动不得重新引入。

> **Warning**：`bun run check`（含 `--write`）的 biome `files.includes: ["**/*"]` 覆盖全仓，会顺手把 `.trellis/` 下文件（如 archive 的 task.json）缩进从 2 空格重排为 tab。这类簿记 diff 是必然产物，**不要回滚**（回滚后 check 会在该文件重新报错），直接随任务一并提交即可。

---

## Known Debt

- ~~apps/ui 存量 24 个 lint 错误~~ **已清偿**（2026-09-14 任务 09-14-fix-ui-a11y-lint：14 处 `noLabelWithoutControl` 用 `htmlFor`+`id` 真实关联、6 处 `noSvgWithoutTitle` 按语义改 `aria-hidden` 或 `role="img"`+`aria-label`、点击类交互改语义化 `<button>`；同时顺带清偿 6 个 warning）。当前 `bunx biome check apps/ui` 为 0 error 0 warning，新增 UI 代码必须保持全绿。
- 零新增 a11y 的先例写法仍然有效，新代码直接沿用：缺 control 的提示文字用 `<span>` 替代 `<label>`；checkbox 嵌入 `<label>` 内；表单 label 用 `htmlFor`+`id` 关联；装饰性 SVG 加 `aria-hidden="true"`；信息性 SVG 加 `role="img"`+`aria-label`；模态背景点击关闭用 `absolute inset-0` 的 `<button>` 先例（UsersView/App.tsx AnnouncementModal）。

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
