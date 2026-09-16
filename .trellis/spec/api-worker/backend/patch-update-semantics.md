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
