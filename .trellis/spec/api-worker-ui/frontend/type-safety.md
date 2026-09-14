# Type Safety

> TypeScript conventions in the UI package.

---

## Overview

tsconfig：`strict: true`、`moduleResolution: "Bundler"`、前端 `jsxImportSource: "hono/jsx/dom"`。`bun run typecheck`（`tsc --noEmit`）是提交门禁之一，必须 0 error。类型体系刻意**薄**：领域类型集中一处，字段直用后端 snake_case，靠严格检查而非映射层。

---

## Conventions

### Convention: 全部领域类型集中在 core/types.ts

**What**: `ChannelForm`、`SettingsForm`、`User`、`ModelPricing` 等跨视图类型都定义在 `core/types.ts`（`export type Xxx = {...}`，不用 interface）。组件 props 类型就地定义在视图文件内（`type ChannelsViewProps = {...}`），不导出复用。

**Why**: 单一类型事实源 + props 类型跟随组件，改字段时 tsc 直接暴露所有受影响调用点（这是「props 必须全透传」体系的地基）。

### Convention: API 字段保持 snake_case，不建 camelCase 映射层

**What**: 类型字段与后端 JSON 完全一致（`base_url`、`allowed_models`、`models_json` 解析后的 `input_price`）。前端组件、表单 state、请求体全程 snake_case。

**Why**: 省掉映射层 = 省掉一类「字段名对不上」的静默 bug；代价是 TS 惯例上不寻常，新人需知晓这是**刻意决策**。

### Convention: JSON 解析统一 `as T | null` + catch 兜底

**What**: 网络侧 `createApiFetch<T>` 用泛型标注返回；响应错误体解析用 `(await response.json().catch(() => null)) as { error?: string } | null`。表单初值来自 constants 的 `initialXxxForm`，字段全 string（金额/数字在提交时转换）。

**Why**: 表单字段用 string 是为了 textarea/input 双向绑定不与 number 打架；解析层断言 + 兜底防止上游非 JSON 导致未捕获异常。

---

## Rules

- 新类型先找 `core/types.ts` 是否已有（含近义），避免重复定义。
- `as` 断言仅限边界（JSON 解析、DOM 查询）；业务代码内禁止 `as unknown as` 双跳转。
- 可空字段显式 `| null` / `?`，与后端 schema 对齐（如 `linuxdo_id?: string | null`）。
- 泛型 fetch：调用处始终显式 `apiFetch<T>("/path")`，不依赖推断。
- 改后端 API 形状时，同步改 `core/types.ts`——两端字段漂移是本仓最高频 bug 源。
