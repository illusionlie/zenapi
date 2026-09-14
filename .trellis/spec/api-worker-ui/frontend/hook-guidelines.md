# Hook Guidelines

> React-hook conventions in this Hono JSX DOM codebase (evidence-based).

---

## Overview

**不使用自定义 hook**——全仓没有 `useXxx` 自定义 hook 定义。逻辑组织方式：顶层容器组件（AdminApp/UserApp/App）内联 hooks，展示组件（features/*View）零 hooks。不引入 react-query / swr / hookform 等库。

框架是 `hono/jsx/dom`（不是 React）：`import { useState, useEffect, useCallback } from "hono/jsx/dom"`，入口 `render(<App />, root)`。API 兼容 React hooks，但**不要**从 "react" 导入。

---

## Conventions

### Convention: 容器内 hooks 用量排序与惯用法

**What**: 实测分布 `useState`(110) > `useCallback`(86) > `useMemo`(31) > `useEffect`(21) > `useRef`(7)。惯例：

- **每个下发到 View 的回调都包 `useCallback`**（`handleChannelSubmit`、`handleChannelTest` 等，命名统一 `handleXxx`）。
- 派生列表（过滤、分组、分页统计）用 `useMemo`。
- 数据加载 effect 依赖 `activeTab`/token 等触发源，加载函数本身是 `useCallback` 的 `loadXxx`。
- 修正型 effect 模式：`useEffect(() => setXxxPage(p => Math.min(p, totalPages)), [totalPages])`。

**Why**: View 是纯 props 组件，引用稳定性靠容器的 useCallback/useMemo 保证，避免无关重渲染。

### Convention: state 初始化用 lazy initializer 读外部源

**What**: 从 localStorage / location 读取初值时用 `useState(() => localStorage.getItem("admin_token"))`、`useState(() => normalizePath(window.location.pathname))` 形态，不在模块顶层读。

**Why**: 组件可能被测试或 SDK 多实例化，惰性求值保证每次挂载取到最新外部状态。

### Convention: 外部事件订阅在 effect 中同步 + 清理

**What**: popstate 等浏览器事件在 `useEffect` 内 `addEventListener` 并 return 清理函数；`window.location.pathname` 只在 effect/回调里读，不存 render 值。

---

## Anti-patterns

- 在 features/*View 里写 useEffect/useState（破坏纯展示契约；新增交互状态提到容器）。
- 自定义 hook 抽取（现有代码刻意不抽；如确需抽取先在本文件记录决策）。
- 从 "react" 导入任何东西。
- 在 render 期间读 localStorage / location（用 lazy initializer 或 effect）。
