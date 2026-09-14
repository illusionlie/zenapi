# Directory Structure

> UI package (`apps/ui`) layout — Hono JSX DOM SPA.

---

## Layout

```
apps/ui/src/
  App.tsx         # 顶层分发：按路径/身份路由到 Admin / User / Public
  AdminApp.tsx    # 管理后台主组件（状态容器，~900+ 行）
  UserApp.tsx     # 用户端主组件（状态容器）
  PublicApp.tsx   # 公开页主组件（站点信息、模型广场）
  core/           # 与视图无关的基础设施
    api.ts        # createApiFetch：绑定 token 的类型化 fetch 封装
    constants.ts  # initialChannelForm 等表单初始值、路径→Tab 映射
    types.ts      # 全部领域类型（ChannelForm、SettingsForm、User...）
    utils.ts      # 金额格式化等纯函数
  features/       # 展示组件（*View.tsx）+ AppLayout 布局
  styles.css      # Tailwind v4 入口
  dist/           # 构建产物，由 Worker Static Assets 托管——勿手动改
```

---

## Conventions

### Convention: 视图组件纯展示，props 全部由 App 容器下发

**What**: `features/*View.tsx` 不自己 fetch、不持有服务端数据；数据与回调经 props 传入（如 `ChannelsViewProps`）。AdminApp/UserApp 是唯一状态容器，所有 `handleXxx` 回调也定义在容器里用 `useCallback` 包好后下发。

**Why**: 新增 props 必须在容器调用处全部透传，漏传会被 `tsc --noEmit` 捕获——这是刻意的类型安全链路。

### Convention: Admin 与 User 视图物理隔离，不共享组件

**What**: 用户端视图以 `User` 前缀命名（`UserDashboard`、`UserLoginView`、`UserModelsView`、`UserRegisterView`），与管理端 `*View` 并列放在 `features/` 下。

**Why**: 两端权限与数据面完全不同，强行抽象共享组件会造成耦合；重复代码量目前可接受。

### Convention: 核心类型集中在 core/types.ts，字段保持 snake_case

**What**: 所有跨视图类型在 `core/types.ts` 定义（`export type Xxx = {...}`），字段名与后端 JSON 一致（`base_url`、`allowed_models`），不做 camelCase 映射层（见 type-safety.md）。

---

## Adding a new view

1. `features/XxxView.tsx`：`type XxxProps = {...}` + `export const XxxView = ({...}) => ...`
2. 容器加 state 与 `handleXxx`，props 透传
3. 路径/Tab 接入：constants 的映射表 + 容器路由 effect
4. 若涉及新 API：`core/types.ts` 补类型；鉴权头由 `createApiFetch` 统一注入
