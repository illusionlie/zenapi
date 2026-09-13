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

**代理链路错误码契约**（tokenAuth/proxy/anthropic-proxy）：`token_required` 401 / `invalid_token` 401 / `token_disabled` 403 / `quota_exceeded` 402 / `insufficient_balance` 402 / `user_disabled` 403 / `model_not_allowed` 403（用户级白名单，2026-09 新增）/ `model_not_found` 404 / `no_available_channels` 503。

### Convention: JSON-in-TEXT 读取 fail-open，写入边界严格校验

**What**: 库内 JSON-in-TEXT 字段（tokens.allowed_channels、users.allowed_models）读取时经 `safeJsonParse` 解析，畸形/非法输入**返回 null = 不限制**（fail-open）；写入侧（管理端 API）严格校验，非法输入 400（如 `invalid_allowed_models`）。

**Why**: 读侧宽松保证存量脏数据/历史格式不炸线上请求；写侧严格保证库内只沉淀干净数据。两侧职责不同，不要在读取侧加抛错逻辑。先例：`utils/model-allowlist.ts` 的 `parseAllowlist`（含非字符串元素的数组整体返回 null，而非静默过滤部分限制）。

**Example**:
```typescript
// 读侧：fail-open
const allowlist = parseAllowlist(row.allowed_models); // null = 不限制
if (!isModelAllowed(allowlist, model)) return jsonError(c, 403, "model_not_allowed", "model_not_allowed");
// 写侧：fail-closed
if (!Array.isArray(body.allowed_models) || body.allowed_models.some((m) => typeof m !== "string" || !m.trim()))
	return jsonError(c, 400, "invalid_allowed_models", "invalid_allowed_models");
```

---

## Common Mistakes

<!-- Error handling mistakes your team has made -->

(To be filled by the team)
