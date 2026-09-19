# Turnstile Auth — 登录入口人机验证契约

> 来自任务 `09-19-auth-turnstile`。给任何铸造会话的端点（admin_sessions / user_sessions）接入 Cloudflare Turnstile、或调整 turnstile 配置键 / 错误码 / site-info 字段前必读。

---

## Scenario: 登录/注册端点接入 Turnstile 校验

### 1. Scope / Trigger

- 新增/修改会话铸造端点且需要人机验证。
- 触碰 `turnstile_*` settings 键、`TURNSTILE_DISABLED` env、site-info 的 turnstile 字段、本错误码族。

### 2. Signatures

```ts
// apps/worker/src/services/turnstile.ts —— 单一实现点，路由层不得自行 verify
export type TurnstileVerifyResult = { ok: true; degraded?: boolean } | { ok: false; codes: string[] };

export function isTurnstileEnvDisabled(value: string | undefined): boolean; // "1"/"true"/"yes"，trim + 大小写不敏感
export function isTurnstileEnforced(config, envBindings): boolean;          // enabled && 两键非空 && !envDisabled
export async function verifyTurnstileToken(secret, token, fetchImpl?): Promise<TurnstileVerifyResult>;
export async function enforceTurnstile(c: Context, body: unknown): Promise<Response | null>; // null = 放行
```

### 3. Contracts

- **settings 三键**：`turnstile_enabled`（"true"/"false"）/ `turnstile_site_key`（可公开，GET 回显）/ `turnstile_secret_key`（**任何 GET 零回显**，`GET /api/settings` 只返回 `turnstile_secret_key_set` 布尔，先例 `admin_password_hash`）。
- **env**：`TURNSTILE_DISABLED?: string` —— 紧急逃生开关（密钥配错/平台故障时重新部署关闭），真值时全局跳过且不发 siteverify。
- **`/api/public/site-info` 增量字段**：`turnstile_enabled` = **有效启用判定结果**（非裸存储值，env 开关与键完整性都参与判定）；`turnstile_site_key` 未启用为 `""`。
- **接线位置**：handler 先 `await c.req.json().catch(() => null)` 解析 body，**再把解析结果传入** `enforceTurnstile(c, body)`——body 只能读一次，enforceTurnstile 不自行读；调用点在密码校验之前、注册模式门禁之后。
- **fail-open 边界**：仅 siteverify 2xx + 合法 JSON + `success === false` 才拦截；网络异常 / AbortController 5s 超时 / 非 2xx / 坏响应体一律 degraded 放行 + `console.warn("[turnstile] ...")`。siteverify 不传 `remoteip`（蜂窝 IP 漂移误杀）。

### 4. Validation & Error Matrix

| 条件 | 结果 |
|------|------|
| 未启用 / 配置脏值 / env 禁用 | 放行（不发 siteverify） |
| 启用 + body 无 `turnstile_token`（空/非字符串） | 400 `turnstile_token_missing`（不发 siteverify） |
| siteverify `success=false` | 403 `turnstile_verify_failed` |
| siteverify 网络异常 / 超时 / 非 2xx / 坏响应 | 放行 + warn（fail-open） |
| PUT：enabled=true 而任一键解析后为空 | 400 `turnstile_incomplete`（写前拦截，无部分写入） |
| PUT：site_key / secret 非字符串非 null | 400 `invalid_turnstile_site_key` / `invalid_turnstile_secret_key`（不静默 `String()` 强转） |
| PUT：secret 三态 | 键缺省=保留 / null 或 ""=清除 / 非空字符串=覆盖（`key in body` 判定，契约见 [patch-update-semantics.md](./patch-update-semantics.md)） |

### 5. Good/Base/Bad Cases

- **Good**：新登录端点在密码校验前一行调用 `enforceTurnstile(c, body)`，零重复逻辑。
- **Base**：settings 三键全缺 → 三端点行为与接入前完全一致（存量部署零回归）。
- **Bad**：路由内自行 fetch siteverify；任何 GET 回显 secret；site-info 透出裸 `turnstile_enabled` 存储值而非有效判定。

### 6. Tests Required

- service 层 `tests/turnstile-service.test.ts`（17 用例）：env 真值矩阵、enforced 矩阵、单 SQL `key IN (?,?,?)` 形态与绑定顺序、verify 四路 fail-open + 显式失败、fake-timers 5s 超时。
- 端点层 `tests/turnstile-endpoints.test.ts`（28 用例）：未启用零 siteverify 调用（fetch 断言）、缺 token/显式失败/成功三分支、secret 零回显（`JSON.stringify(body)).not.toContain(secret)`，site-info 与 settings GET 双断言）、PUT 不变量与三态矩阵、非法类型 400。

### 7. Wrong vs Correct

#### Wrong

```ts
// 路由内自行 verify：body 双读崩溃、fail-open 语义漂移、超时缺失
const body = await c.req.json();
const res = await fetch(SITEVERIFY_URL, { method: "POST", ... });
if (!data.success) return jsonError(c, 403, "captcha_failed", "captcha_failed");
```

#### Correct

```ts
const body = await c.req.json().catch(() => null);
const denied = await enforceTurnstile(c, body);
if (denied) return denied;
```

---

## Design Decision: 基建故障 fail-open + 显式失败 fail-closed + env 逃生开关

**Context**：Turnstile 挡在管理员登录前——siteverify 自身故障或 secret 配错都会把管理员锁死在后台外。

**Decision**：区分两类失败：验证服务的**基建故障**（网络异常/超时/5xx）→ 放行 + warn；**显式验证失败**（`success=false`）→ 拦截。`TURNSTILE_DISABLED` env 作为密钥配错时的最终逃生（重新部署生效）。客户端不二次 fail-open：widget 脚本加载失败时表单按钮保持禁用，逃生 = 刷新（loader 单例失败可重试）或 env 开关。读侧宽容（脏配置视为未启用）+ 写侧严格（PUT 不变量禁止「半配置启用」入库），两侧职责对齐 error-handling.md 全局契约。
