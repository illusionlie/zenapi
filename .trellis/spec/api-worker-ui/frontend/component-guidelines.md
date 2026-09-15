# Component Guidelines

> How components are built in this project.

---

## Overview

<!--
Document your project's component conventions here.

Questions to answer:
- What component patterns do you use?
- How are props defined?
- How do you handle composition?
- What accessibility standards apply?
-->

(To be filled by the team)

---

## Component Structure

<!-- Standard structure of a component file -->

(To be filled by the team)

---

## Props Conventions

<!-- How props should be defined and typed -->

(To be filled by the team)

---

## Styling Patterns

### 动效约定：motion tokens + 枚举过渡属性（09-15-ui-motion-polish 沉淀）

**What**: 全站过渡类禁止 `transition-all`，必须按实际过渡属性枚举；hover 位移类一律用 `ease-smooth-out`。

**Why**: `transition-all` 让无关属性（color/border）蹭车过渡，且 `hover:shadow-*` 场景逐帧重绘开销大；`ease-in-out` 的语义是 icon/text swap，不是 hover 位移。token 单一事实源在 `apps/ui/src/styles.css`。

**Token 位置**：
- `@theme` 内：`--ease-smooth-out`（Tailwind v4 自动生成 `ease-smooth-out` utility）、`--animate-toast-*`（生成 `animate-toast-*`）
- `:root` 内：`--modal-*` / `--dropdown-*` / `--panel-*`（t-* 片段变量，运行时 JS 用 `getComputedStyle` 读取保持同源）

**Example**:

```tsx
// hover 位移 + 阴影（lift 类）
class="transition-[transform,box-shadow] duration-200 ease-smooth-out hover:-translate-y-0.5 hover:shadow-lg"
// hover 纯变色
class="transition-colors duration-200"
// hover 变色 + 阴影
class="transition-[color,background-color,border-color,box-shadow] duration-200"
```

**Reduced-motion**: 全局守卫在 styles.css 末尾（`prefers-reduced-motion: reduce` 时长归零），t-* 片段各自 guard 不得删。新增循环动画无需单独处理，但新增 t-* 片段必须连带其 guard。

---

## Modal 与进出场动画约定（09-15-ui-motion-polish 沉淀）

### Convention: 模态一律用 features/Modal.tsx 壳

**What**: 新增模态禁止手写 `fixed inset-0` 结构，用 `<Modal isOpen onClose sheet? backdropClass? panelClass?>`；容器持有 `isOpen` state、**常驻渲染**（不条件挂载），关闭动画由 Modal 内部状态机（closing → `--modal-close-dur` 后卸载）完成。

**Why**: 条件挂载 `{cond && <Modal isOpen>}` 会让出场动画失效（卸载即消失）；Modal 壳统一提供 backdrop fade、Esc（栈顶优先，防叠层连关丢草稿）、bottom-sheet 断点适配。

**移动端形态**：`sheet` prop（贴底 rise，`items-end md:items-center` 布局 + `.t-modal-sheet` 断点变换）；桌面居中 scale 走 `.t-modal` 原样。非 sheet 模态在移动端也会贴底（统一规格）。

### Gotcha: hono/jsx/dom 的 data-* 布尔属性与 React 语义不同

> **Warning**: `data-open={someBool}` 在 hono 4.x dom renderer 下 `true` 渲染为 `data-open=""`、`false` 直接移除属性 —— CSS 选择器 `[data-open="true"]` 永远不匹配，开关型动画静默失效。

必须传字符串：`data-open={isOpen ? "true" : "false"}`（先例：AppLayout / UserApp 抽屉）。需要布尔属性语义的场合同理适用。

### Gotcha: .t-modal 的 transform 会为 fixed 后代创建 containing block

> **Warning**: `.t-modal` 恒有 `transform` + `will-change`，嵌套在它内部的 `fixed` 定位后代会被面板盒（含 `overflow-y-auto`）裁剪，不再是相对视口定位。

叠层浮层（如模型选择器叠在编辑模态上）必须作为编辑模态的**兄弟节点**渲染，不能嵌套进 `<form>` / overflow 容器内（先例：ChannelsView 模型选择浮层从 form 内外提）。同理注意 closing 期容器 state 置 null 会导致内容空洞 —— 需在 children 加 guard（先例：ChannelsView `fetchedModels !== null`、UsersView `showEditModal && editingUser`）。

### Convention: 关键帧动画 token 对齐 transitions.dev 口径

toast 出入场（350ms/250ms + `cubic-bezier(0.22,1,0.36,1)` + 16px rise + cross-blur）是全站 toast 的既定节奏；新动效优先对齐 `@theme`/`:root` 既有 token，不要新造硬编码时长。入场可带 cross-blur，退场从简（只 fade + 回落）。

---

## Accessibility

本节为 09-14-fix-ui-a11y-lint 清偿 24 个存量 a11y 错误后沉淀的实战约定，新 UI 代码直接沿用（ Biome a11y 规则全绿是质检门槛，见 quality-guidelines.md）。

### 表单 label：真实关联，不用 aria-label 伪装

`noLabelWithoutControl` 的正确修法是让 `<label>` 真正关联控件：`htmlFor`+`id`（首选）或控件嵌套进 `<label>`。禁止加 `aria-label` 后保留空 label 结构骗过 lint——点击聚焦是 label 的原生职责。

```tsx
// Correct：htmlFor+id 真实关联
<label htmlFor="user-create-name">用户名</label>
<input id="user-create-name" ... />

// Correct：纯提示文字不是 label，用 span
<span>可用模型（留空不限制）</span>

// Wrong：aria-label 伪装，点击不聚焦，骗 lint 而已
<label aria-label="用户名">用户名</label>
```

**模态内 id 必须加前缀防冲突**：创建/编辑双模态渲染同类表单时，用 `user-create-*` / `user-edit-*` 前缀隔离，避免重复 id 导致 htmlFor 关联错乱（先例：UsersView）。

### SVG：按语义分流

- **装饰性**（紧邻可读文本、纯视觉）：`aria-hidden="true"`，外加 icon-only button 场景在按钮层补 `aria-label`。
- **信息性**（图表、独立含义）：`role="img"` + `aria-label` 描述含义（先例：ModelsView 迷你趋势图）。不要一刀切全加 hidden。

### 可点击静态元素：直接改 `<button>`，不要 role="button"

> **Warning**：给 div 补 `role="button"` + `tabIndex` + 键盘事件虽然满足 `useKeyWithClickEvents`，但会立刻触发 Biome `useSemanticElements` 报错——等于从一个坑跳进另一个。

正确做法是直接语义化 `<button type="button">`：

- 行为等价性靠样式补齐：Tailwind v4 preflight 已重置 button 的 border/padding/background，原 div 类名照搬即可视觉零差异（先例：MonitoringView 柱条 div→button）。
- 模态背景点击关闭用 `absolute inset-0` 的 `<button>` + 内容层 `relative z-10`（先例：UsersView / App.tsx AnnouncementModal）——比 `e.target === e.currentTarget` 判断多出原生键盘可达性。

---

## Common Mistakes

<!-- Component-related mistakes your team has made -->

(To be filled by the team)
