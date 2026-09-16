# UI 选项卡切换过渡动画与骨架屏加载态

## Goal

管理台（AdminApp）与用户端（UserApp）的视图切换、加载态目前是"瞬时硬切 + 静态文字"，观感生硬。本任务为全站 UI 补齐一套与既有动效语言（`.t-modal` / `.t-panel-slide` / toast 节奏）一致的过渡动画与骨架屏加载态，提升感知流畅度。

## Background（现状问题）

1. **Tab 切换零过渡**：`AdminApp.tsx` / `UserApp.tsx` 用 `<div key={activeTab}>{renderContent()}</div>` 切换视图，key 变化导致整棵子树瞬间重挂载，无任何动画。
2. **主加载态为纯静态文字**：`renderContent()` 开头 `if (loading) return <div>加载中...</div>`，直接顶掉整个内容区。
3. **页面标题瞬切**：`AppLayout.tsx` 的 `<h1>{activeLabel}</h1>` 在 tab 切换时瞬间替换。
4. **零散小加载态**：`MonitoringView.tsx` 两处静态"加载中..."（时间范围切换提示、slot 详情面板）。
5. **登录态切换硬切**：`App.tsx` 的 `AppRoutes` 在 LoginView / AdminApp / UserApp / PublicApp 之间条件渲染，无过渡。

## Requirements

### R1 主内容区入场式过渡（核心）

- tab 切换时，新内容区以入场动画浮现：fade(0→1) + translateY(4px→0) + blur(2px→0)，约 250ms，缓动复用 `ease-smooth-out`（`cubic-bezier(0.22, 1, 0.36, 1)`）。
- 采用**入场式**（enter-only）：旧内容即时替换，不等待退场。不做交叉淡入淡出。
- AdminApp 与 UserApp 均需覆盖。

### R2 骨架屏加载态（核心）

- 替换 AdminApp / UserApp 主加载分支的静态"加载中..."文字为骨架屏：按内容布局形状的灰块占位 + shimmer 微光扫过动画。
- 骨架形状按视图归类参数化（统计卡片网格 / 表格 / 表单 / 通用），不要求逐视图 1:1 复刻布局。
- 骨架屏自身也需淡入，避免与内容切换动画叠加时闪烁。
- 骨架屏必须占位真实高度，加载完成后无布局跳动（至少近似）。

### R3 页面标题过渡

- `AppLayout` 的 h1 标题在 tab 切换时随内容区同步淡入（key 重挂载 + 入场动画，与 R1 呼应）。

### R4 零散小加载态升级

- MonitoringView 时间范围切换：按钮旁的静态"加载中..."改为轻量加载动画（如三点 bounce，对齐 PlaygroundView 已有三点样式）。
- MonitoringView slot 详情面板：静态"加载中..."改为迷你骨架行（2–3 行 shimmer）。
- 抽取可复用的小型加载组件（如三点 loader），避免每处内联重复。

### R5 登录态切换过渡

- App.tsx 各顶层分支（LoginView / AdminApp / UserApp / PublicApp）挂载时带入场动画。
- `return null` 的等待分支（siteInfoLoaded / userChecked 前）**保持现状**，不得为等待期添加可见动画（避免闪屏加重）。
- 登录→应用是整页级切换，动画时长/位移幅度可略大于 R1，但必须复用同一缓动。

## Constraints

- **复用既有动效基建**：新动画必须对齐 `apps/ui/src/styles.css` 的既有 token（`--ease-smooth-out`、toast 关键帧节奏 16px rise + blur），不新造硬编码时长；新增 token 定义在 styles.css 统一管理。
- **禁用 `transition-all`**：按实际过渡属性枚举（spec：component-guidelines.md）。
- **`prefers-reduced-motion`**：新增动画类必须被 reduced-motion 处理覆盖（既有全局守卫兜底 + 新类显式声明，二选一或都做，以 design.md 为准）。
- **a11y**：骨架屏区域对读屏器友好（`aria-hidden` 或 `role="status"` + `aria-label`，以 design.md 为准）；不引入新的 a11y 违规，保持全绿门禁。
- **技术栈不动**：hono/jsx/dom，无路由库、无第三方动画库；不引入 framer-motion 等依赖。
- **改动范围仅前端**：`apps/ui/`，不碰 worker。
- 提交前通过 `bun run check && bun run typecheck && bun run test`。

## Acceptance Criteria

- [ ] Admin/User 两端切换任意 tab：新内容有入场动画（fade + 上移 + blur，~250ms），旧内容即时替换无等待感。
- [ ] 首次进入有数据加载的 tab：显示骨架屏（非"加载中..."文字），含 shimmer 动画，加载完成后替换为真实内容。
- [ ] tab 切换时页面标题同步淡入，与内容区动画节奏一致。
- [ ] MonitoringView 时间范围切换与 slot 详情面板加载时，不再是静态文字。
- [ ] 登录→管理台/用户端、登出→登录页：页面有入场过渡；`userChecked`/`siteInfoLoaded` 等待期仍为空白（无闪烁）。
- [ ] `prefers-reduced-motion: reduce` 下所有新动画被禁用（≤0.01ms）。
- [ ] `bun run check`、`bun run typecheck`、`bun run test` 全绿；a11y 门禁无新增违规。
- [ ] 快速连续点击 tab 无动画残影/布局异常（key 重挂载语义下动画类自动重放）。

## Out of Scope

- 交叉淡入淡出（退场动画）——评估过，需要 Modal 级 phase 状态机 + 双树共存，复杂度高且拖慢感知速度。
- 各视图内部的数据刷新动画（如表格行增删动画）。
- 侧边栏 tab 指示器滑动动画（active 态已有 transition-colors）。
- 后端任何改动。
