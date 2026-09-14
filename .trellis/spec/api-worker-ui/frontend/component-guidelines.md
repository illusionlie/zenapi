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

<!-- How styles are applied (CSS modules, styled-components, Tailwind, etc.) -->

(To be filled by the team)

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
