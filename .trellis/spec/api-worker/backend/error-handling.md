# Error Handling

> How errors are handled in this project.

---

## Overview

<!--
Document your project's error handling conventions here.

Questions to answer:
- What error types do you define?
- How are errors propagated?
- How are errors logged?
- How are errors returned to clients?
-->

(To be filled by the team)

---

## Error Types

<!-- Custom error classes/types -->

(To be filled by the team)

---

## Error Handling Patterns

<!-- Try-catch patterns, error propagation -->

(To be filled by the team)

---

## API Error Responses

### Convention: jsonError 统一错误响应

**What**: 所有路由用 `utils/http.ts` 的 `jsonError(c, status, message, code?)`，响应体 `{ error: string, code?: string }`；code 用小写下划线蛇形（如 `model_not_allowed`、`invalid_allowed_models`），通常 message 与 code 同值。

**代理链路错误码契约**（tokenAuth/proxy/anthropic-proxy）：`token_required` 401 / `invalid_token` 401 / `token_disabled` 403 / `quota_exceeded` 402 / `insufficient_balance` 402 / `user_disabled` 403 / `model_not_allowed` 403（令牌级 + 用户级白名单交集，逐清单独立校验，2026-09）/ `model_not_found` 404 / `no_available_channels` 503。

### Convention: PATCH 资源更新的错误码族

**What**: 资源更新端点（PATCH）的非法值错误码统一 `invalid_{key}`（如 `invalid_name` / `invalid_quota` / `invalid_status` / `invalid_allowed_models`），与 POST 共用同一套 key 命名；body 非法（非对象/缺 body）→ `missing_body`；目标资源不存在 → 404 `{resource}_not_found`（如 `token_not_found`）。**判定顺序：先查资源存在性（404），再校验 body（400）**——资源不存在时不需要暴露校验细节。

**权限边界错误码**：低权限端点收到越权字段时用 `field_not_editable`（400），用「键存在性检查」（`key in body`）而非值判断——`JSON.stringify` 会丢弃 undefined 值，键出现即代表显式提交。先例：`/api/u/tokens/:id` 拒绝 `quota_total`/`quota_used`/`status`/`allowed_channels`（2026-09）。

### Convention: JSON-in-TEXT 读取 fail-open，写入边界严格校验

**What**: 库内 JSON-in-TEXT 字段（tokens.allowed_channels、tokens.allowed_models、users.allowed_models）读取时经 `safeJsonParse`/`parseAllowlist` 解析，畸形/非法输入**返回 null = 不限制**（fail-open）；写入侧（管理端 API）严格校验，非法输入 400（如 `invalid_allowed_models`）。

**Why**: 读侧宽松保证存量脏数据/历史格式不炸线上请求；写侧严格保证库内只沉淀干净数据。两侧职责不同，不要在读取侧加抛错逻辑。先例：`utils/model-allowlist.ts` 的 `parseAllowlist`（含非字符串元素的数组整体返回 null，而非静默过滤部分限制）。

**Example**:
```typescript
// 读侧：fail-open
const allowlist = parseAllowlist(row.allowed_models); // null = 不限制
if (!isModelAllowed(allowlist, model)) return jsonError(c, 403, "model_not_allowed", "model_not_allowed");
// 写侧：fail-closed（经 utils/model-allowlist.ts 的 serializeAllowlist）
const serialized = serializeAllowlist(body.allowed_models);
if (!serialized.ok) return jsonError(c, 400, "invalid_allowed_models", "invalid_allowed_models");
```

### Don't: 多白名单合并成交集数组后再校验

**Problem**:
```typescript
// Don't：把令牌级与用户级白名单先算交集再交给 isModelAllowed
const merged = intersect(tokenList, userList); // 交集为空时 → []
if (!isModelAllowed(merged, model)) { ... }
```

**Why it's bad**: `isModelAllowed` 对 null/空数组 fail-open（视为不限制）。两条不相交的白名单（如令牌限 `gpt-4`、用户限 `claude-3`）算出的交集 `[]` 会被误判为「不限制」→ **全放行**，安全语义反转。计算交集的方桁在 2026-09 令牌级白名单任务中被明确否决。

**Instead**:
```typescript
// Do：逐清单独立校验取 AND（utils/model-allowlist.ts 的 isModelAllowedByAll）
if (!isModelAllowedByAll([tokenRecord.token_allowed_models, tokenRecord.user_allowed_models], model)) {
	return jsonError(c, 403, "model_not_allowed", "model_not_allowed");
}
// /v1/models 列表过滤同理：链式调用两个单清单过滤函数
const visible = filterModelsByAllowlist(
	filterModelsByAllowlist(modelData, tokenRecord.token_allowed_models),
	tokenRecord.user_allowed_models,
);
```

每条清单各自保持完整的 fail-open/fail-closed 语义（null=不限制，非空=精确匹配），组合后语义与单清单完全一致。

---

## Common Mistakes

<!-- Error handling mistakes your team has made -->

(To be filled by the team)
