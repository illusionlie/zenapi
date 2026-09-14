# 修复 apps/ui 存量 a11y lint 错误（24E + 6W）

## Goal

清偿 `apps/ui` 的全部存量 lint 错误（24 个，均为 a11y 类），使 `bun run check` 在全仓达到 **0 error**；同时把质检门槛从「零新增」升级为「全绿」，关闭 09-13-remove-site-mode 任务留下的技术债。

## Background

- 技术债来源：09-13-remove-site-mode 重构前即存在，当时因「不混入无关改动、控制回归面」决策留债（用户确认），并记录在 `.trellis/spec/api-worker-ui/frontend/quality-guidelines.md` 的 **Known Debt** 节。
- 基线取证（2026-09-14，clean working tree，`bunx biome check apps/ui --reporter=summary`）：

| 规则 | 数量 | 级别 |
|---|---|---|
| `lint/a11y/noLabelWithoutControl` | 14 | error |
| `lint/a11y/noSvgWithoutTitle` | 6 | error |
| `lint/a11y/noStaticElementInteractions` | 2 | error |
| `lint/a11y/useKeyWithClickEvents` | 2 | error |
| `lint/style/noNonNullAssertion` | 2 | warning |
| `lint/correctness/noUnusedVariables` | 1 | warning |
| `lint/correctness/noUnusedImports` | 2 | warning |
| `lint/complexity/useOptionalChain` | 1 | warning |

- 涉及文件（错误集中区）：`UsersView.tsx`（8E，创建/编辑模态的 `<label>` 缺 control）、`UserRegisterView.tsx`（2E）、`App.tsx`（a11y 点击/SVG，原 :319-328 区段附近）等；⚠️ 行号会漂移，以实施时 `bunx biome check apps/ui` 实际输出为准。
- 先例参考：09-14 前身任务中 UsersView「可用模型」选择器已示范零新增 a11y 的写法（`<span>` 替代缺 control 的 `<label>`、checkbox 嵌入 `<label>` 内）。

## Requirements

### R1 修复全部 24 个 error（强制）

- `noLabelWithoutControl`（14）：为每个 `<label>` 关联真实控件（`htmlFor`+`id`、嵌套控件、或改用非 label 元素）。**禁止**用 `aria-label` 伪装后保留空 label 结构。
- `noSvgWithoutTitle`（6）：SVG 加 `<title>` + `role="img"` + `aria-labelledby`，或装饰性 SVG 改 `aria-hidden="true"`（按语义选择：纯装饰用 hidden，信息性用 title）。
- `noStaticElementInteractions`（2）+ `useKeyWithClickEvents`（2）：可点击的静态元素改为 `<button>`，或补齐 `role` + `tabIndex` + 键盘事件；优先改语义化标签。

### R2 顺带修复 6 个 warning（鼓励，不阻塞验收）

- `noUnusedVariables` / `noUnusedImports` / `noNonNullAssertion` / `useOptionalChain`——均为低风险机械修复；若某个 warning 修复需要行为判断且证据不足，可留置并在汇报说明。

### R3 门槛升级（spec 同步）

- 完成后更新 `.trellis/spec/api-worker-ui/frontend/quality-guidelines.md`：Known Debt 节标记已清偿，Overview 中质检门槛由「相对基线零新增」改为「`bun run check` 全仓 0 error」。
- 注：全仓 0 error 的唯一例外是 `.pi/extensions/trellis/index.ts` 的 1 个 `noSelfAssign`（Trellis 基建文件，`trellis update` 来源，本任务范围外，README/spec 不要求覆盖它）。

## Constraints

- **零行为变更**：a11y 修复只改 DOM 结构/属性，不改任何业务逻辑、数据流、接口调用；视觉上除可访问性改善外不应有可感知差异。
- Biome（tab、双引号）、TS strict。
- 完成标准：`bun run check`（全仓）0 error、`bun run typecheck` 0 error、`bun run test` 49 用例全绿、`vite build` 成功。

## Acceptance Criteria

- [ ] `bunx biome check apps/ui` 0 error 0 warning（或 warning 修复情况已在汇报中逐条说明）。
- [ ] `bun run check`（全仓）error 数为 1（仅 `.pi/extensions/trellis/index.ts` 基建例外）或 0。
- [ ] `bun run typecheck` exit 0；`bun run test` 全绿；`cd apps/ui && bunx vite build` 成功。
- [ ] 手动冒烟：登录/注册表单 label 点击聚焦正常；管理台各模态（用户编辑、渠道编辑）表单可用；无键盘操作回归。
- [ ] quality-guidelines.md 的 Known Debt 与质检门槛已同步更新。

## Out of Scope

- `.pi/extensions/trellis/index.ts` 的 `noSelfAssign`（Trellis 基建，等 trellis 上游修复）。
- 任何视觉重设计、组件重构、测试基建（jsdom/组件测试）——保持纯 lint 清偿。
- worker 侧（本就 0 error）。
