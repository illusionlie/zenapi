# State Management

> Where state lives and how it flows (evidence-based).

---

## Overview

**零外部状态库**（无 redux/zustand/jotai/context-provider）。依赖只有 `hono/jsx/dom`。状态模型是「顶层容器集中持有 + props 单向下发」：

```
App.tsx          ── adminToken/userToken (localStorage 同步)、身份、站点公告
  ├─ AdminApp    ── 管理端全部领域数据 (data: AdminData)、表单、分页、notice
  └─ UserApp     ── 用户端领域数据、表单、notice
       └─ features/*View ── 零状态，纯 props
```

---

## Conventions

### Convention: 服务端数据按 Tab 域聚合在容器 state

**What**: AdminApp 用 `useState<AdminData>(initialData)` 持有聚合数据对象，`loadTab(activeTab)` 按当前 Tab 拉取并 `setData`；表单用独立 state（`channelForm`、`settingsForm`，初值来自 `core/constants.ts` 的 `initialXxxForm`）；用户反馈统一走 `notice: string` state。

**Why**: 一个 Tab 一个加载入口，数据源可追溯；不搞按组件粒度的缓存失效。

### Convention: token 是唯一全局持久状态，localStorage 手工同步

**What**: `admin_token` / `user_token` 存 localStorage。App.tsx 用 lazy initializer 读入，更新走 `updateAdminToken`/`updateUserToken`（`useCallback` 包裹：setState + setItem/removeItem 同步）。API 调用统一经 `createApiFetch(token, onUnauthorized)`——401 时回调清 token 登出。

**Why**: token 生命周期只在 App.tsx 一处管理；子组件永远不直接碰 localStorage。

### Convention: 客户端路由 = useState(path) + popstate 订阅

**What**: 无路由库。App.tsx `useState(() => normalizePath(window.location.pathname))`，`useEffect` 订阅 `popstate` 更新；导航用 history API + setState。Admin/User 内部 Tab 用 `activeTab: TabId` state + constants 里的路径映射表。

---

## Data flow rules

1. 服务端数据只进容器 state，View 通过 props 读取。
2. 变更流：View 触发 `onXxx` prop → 容器 `handleXxx` → `apiFetch` POST → 成功后重新 `loadXxx` → setData。
3. 错误流：apiFetch throw → handleXxx catch → `setNotice(错误信息)`；不引入 toast 库。
4. 跨 Tab 无共享可变缓存——切 Tab 重新拉取是预期行为，勿优化成全局 store。
