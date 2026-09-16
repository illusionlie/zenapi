# PATCH Update Semantics

> 资源更新端点的三态语义与纯函数 resolver 模式。来源：2026-09 令牌管理增强任务（`services/token-update.ts` 先例）。

---

## Scenario: PATCH 资源更新三态语义

### 1. Scope / Trigger

- 触发：任何「部分更新资源」的 PATCH 端点（跨层契约：请求体字段语义 → DB 列 → UI 表单往返）。
- 本规范解决两个存量 bug 级问题：① `null` 被静默回退旧值导致「清回无限/清空」不可表达；② 非法值静默回退旧值导致用户以为保存成功。

### 2. Signatures

```typescript
// services/<resource>-update.ts —— 纯函数，不 import Hono/D1
export function resolveResourceUpdate(
	body: unknown,
	existing: Row, // DB 现值
): { ok: true; values: FullRow } | { ok: false; error: ErrorCode };
```

路由层保持薄壳：读 existing（404 判定）→ `resolveXxxUpdate` → 失败 `jsonError(c, 400, resolved.error)` → 成功用 `values` 全列 UPDATE。

### 3. Contracts

| body 字段取值 | 语义 | 例 |
|---|---|---|
| `undefined`（键不存在） | 保留 existing | 部分更新 |
| `null` | **清除**（存 NULL，恢复「无限制/空」语义） | `quota_total: null` → 额度无限 |
| 具体值 | 设置（经校验） | 数字 ≥ 0 / 枚举 / 数组经 serializer |

- 键存在性判定用 `key in body`（`JSON.stringify` 会丢弃 undefined 值，键出现即显式提交）。
- 数组类字段统一走 serializer 纯函数（先例：`utils/model-allowlist.ts` 的 `serializeAllowlist`，`[]` → null = 不限制）。
- UI 往返约定：编辑模态把 NULL 回填为空串，提交时空串 → `null`；「恒传全量可编辑字段」而非 diff 提交（降低服务端状态推断负担）。

### 4. Validation & Error Matrix

| 条件 | 结果 |
|---|---|
| body 非对象/解析失败 | `{ ok: false, error: "missing_body" }` → 400 |
| 资源 id 不存在 | 404 `{resource}_not_found`（**先于** body 校验判定） |
| 数值字段非法（负数/NaN/超界） | `invalid_{key}` → 400（**不静默回退**） |
| 枚举字段非法 | `invalid_{key}` → 400 |
| 低权限端点收到越权字段（键存在） | `field_not_editable` → 400 |

### 5. Good/Base/Bad Cases

- **Good**: `PATCH /api/tokens/:id` `{"quota_total": null}` → 额度清回无限；`{"quota_used": 0}` → 清零。
- **Base**: `{}` 或 `{}` 带未知键 → 全字段保留 existing，200。
- **Bad**: `{"quota_total": -5}` → 400 `invalid_quota`（旧实现静默回退旧值，已废除）。

### 6. Tests Required

- 纯函数测试（本仓库无 D1 mock 基建，路由层不测）：`tests/token-update.test.ts` 模式——三态矩阵逐字段（undefined 保留 / null 清除 / 值设置）、非法值返回对应错误码、`values` 不突变 existing（不可变性断言）。
- 断言点：错误码字符串精确匹配；null 路径产出 SQL NULL（values 中为 `null` 而非 existing 值）。

### 7. Wrong vs Correct

#### Wrong（2026-09 之前的存量实现）

```typescript
const quotaTotalUpdate =
	body.quota_total === null || body.quota_total === undefined
		? existing.quota_total // null 静默回退 → 「清回无限」不可表达
		: Number(body.quota_total);
// ...
Number.isNaN(quotaTotalUpdate) ? existing.quota_total : quotaTotalUpdate // NaN 静默回退
```

#### Correct

```typescript
const resolved = resolveTokenUpdate(body, existing);
if (!resolved.ok) return jsonError(c, 400, resolved.error, resolved.error);
await db.prepare("UPDATE tokens SET name=?, quota_total=?, ... WHERE id=?").bind(...);
```

**Why**: 三态语义集中在一个可单测的纯函数里，路由层零分支；非法值显式 400，杜绝「保存假成功」。

---

## Scenario: 低权限 PATCH 端点的子集 resolver 模式

> 来源：2026-09 用户端「我的令牌」对齐任务（`resolveUserTokenUpdate` 先例）。

### 1. Scope / Trigger

- 触发：同一资源存在多个权限等级的 PATCH 端点（管理端全字段 / 用户端字段子集），且低权限端点需放开新字段时。
- 问题：把全量 resolver 直接透传给低权限端点（或加 options 参数做字段过滤），会把权限边界散落到 resolver 参数里，新增管理端字段时容易漏掉低权限端的拦截。

### 2. Signatures

```typescript
// services/<resource>-update.ts —— 与全量 resolver 同文件，独立纯函数
export function resolveUserTokenUpdate(
	body: unknown,
	existing: { name: string; status: string; allowed_models: string | null }, // 仅子集字段
): { ok: true; values: { name: string; status: string; allowed_models: string | null } }
| { ok: false; error: "missing_body" | "invalid_name" | "invalid_status" | "invalid_allowed_models" };
```

路由层顺序固定：**forbidden 键存在性检查（`field_not_editable`）前置于 resolver**，resolver 只见过自己有权处理的字段。

### 3. Contracts

- forbidden 清单与 resolver 字段集**互斥且互补**：字段要么在 forbidden 清单（出现即 400），要么在 resolver 三态语义内。两端必须同步演进——放开一个字段 = 从 forbidden 清单移除 + resolver 增加该字段的三态分支 + 单测。
- 子集 resolver 的三态语义与全量 resolver 逐字段同构（undefined 保留 / null 语义按字段定义 / 非法值 400 不静默回退），保证两端 UI 往返行为一致。
- 决策变更（如 status 从 admin-only 放开为用户可编辑）必须在 PRD 显式记录「推翻既有决策」及权限影响分析，不能只改代码。

### 4. Tests Required

- 纯函数三态矩阵逐字段（含 `null` 在不同字段上的不对称语义：`status: null` = 保留，`allowed_models: null` = 清除）。
- forbidden 字段路由级不测（无 D1 mock 基建），以纯函数测试 + 人工验收为准；错误码字符串精确匹配。

### 5. Wrong vs Correct

#### Wrong

```typescript
// 管理端全量 resolver 透传给用户端 —— 权限边界失守
const resolved = resolveTokenUpdate(body, existing); // 用户可改 quota/status/channels！
```

#### Correct

```typescript
// forbidden 前置 + 子集 resolver
const forbiddenFields = ["quota_total", "quota_used", "allowed_channels"];
if (forbiddenFields.some((f) => f in body)) return jsonError(c, 400, "field_not_editable", "field_not_editable");
const resolved = resolveUserTokenUpdate(body, existing);
if (!resolved.ok) return jsonError(c, 400, resolved.error, resolved.error);
```
