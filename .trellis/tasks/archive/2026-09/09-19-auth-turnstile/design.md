# Design — Turnstile 接入技术设计

## 总体结构

- 后端：`services/turnstile.ts`（配置加载 + 有效启用判定 + siteverify 客户端 + 校验薄壳）→ 三路由接线 → `routes/settings.ts` / `routes/public.ts` 扩展。无新表、无迁移（复用 settings KV，不触发「新表必须加 schema.sql + 迁移」规则）。
- 前端：`core/turnstile.ts`（脚本加载单例 + 类型声明）+ `features/Turnstile.tsx`（widget 壳）→ 三表单接线 → 管理台 `SettingsView` 配置卡片。

## 配置契约（settings 表）

| key | 形态 | 说明 |
|-----|------|------|
| `turnstile_enabled` | `"true"` / `"false"` 字符串 | 总开关（先例：`require_invite_code`） |
| `turnstile_site_key` | 字符串 | 站点密钥，公开性质，GET 回显 |
| `turnstile_secret_key` | 字符串 | 服务端密钥，GET **不回显**，仅返回 `turnstile_secret_key_set` 布尔（先例：`admin_password_hash`） |

- `services/settings.ts`：`getTurnstileConfig(db)` 单条 SQL `key IN` 三键读取（参照 `loadProxyRetryConfig` 的 SQL 形态，防多次串行读）；三个 setter 走 `upsertSetting`。
- **有效启用判定**（纯函数 `isTurnstileEnforced`）：`enabled === true && siteKey 非空 && secretKey 非空 && env.TURNSTILE_DISABLED 非真值`。读侧宽容：任何脏值/缺键一律视为未启用（与 error-handling.md「读宽写严」一致），site-info 的 `turnstile_enabled` 即此判定结果（与「GET 返回有效值」同理，env 不透显进表单）。
- `env.ts` Bindings 增 `TURNSTILE_DISABLED?: string`；真值集合 `"1" / "true" / "yes"`（大小写不敏感）。

## PUT /api/settings 扩展

- `turnstile_site_key`：字符串 trim，长度 ≤ 200，空串 = 清除；非法 → 400 `invalid_turnstile_site_key`。
- `turnstile_secret_key` **三态**（patch-update-semantics.md 契约）：键缺省 = 保留；`null` 或 `""` = 清除；非空 = 覆盖。
  - **实施修正（2026-09-19）**：原句「UI 恒传全量可编辑字段，密钥框留空 → 提交 `null`」与本文件 SettingsView 一节的「已设置时 placeholder『留空保持不变』」自相矛盾，且与写侧不变量互斥——若 UI 留空恒提交 `null`，则 secret 已设置 + enabled=true 的部署每次保存任意设置都会触发 `turnstile_incomplete`。实现按「留空保持不变」为准：UI 留空 = **不提交该键**（键缺省 → 服务端保留现值），仅在输入了新值时提交覆盖；`null`/`""` = 清除仍保留为 API 层语义（测试覆盖）。
- `turnstile_enabled`：仅 `"true"` / `"false"`，非法 → 400 `invalid_turnstile_enabled`。
- **写侧不变量（fail-closed）**：合并三态解析后，若 `enabled=true` 而 site/secret 任一为空 → 400 `turnstile_incomplete`（提示先填齐两键再开启）。保证库内不存在「半配置启用」脏状态，读取侧因此无需兜底分支。
  - **实施修正（2026-09-19）**：三态合并校验未抽取独立纯函数 resolver，按本仓 settings PUT 逐字段内联的既有风格落在路由内（implement.md 已将此文件列为风险点，零回归由存量测试 + 全量门禁兜底）；secret/site_key 对非字符串值显式 400 `invalid_turnstile_secret_key` / `invalid_turnstile_site_key`（与 site_key 对称，不做 `String()` 静默强转）。AC6 语义以 `tests/turnstile-endpoints.test.ts` 的 settingsApp 集成测试覆盖——「测试设计」节本就许可「纯函数/集成测试」二选一。

## siteverify 客户端（services/turnstile.ts）

- `POST https://challenges.cloudflare.com/turnstile/v0/siteverify`，`Content-Type: application/json`，body `{ secret, response }`。**不传 `remoteip`**：Turnstile 自身已含强校验，附带 IP 会引入蜂窝网络 IP 漂移误杀（项目也从未采集 IP）。
- `AbortController` 5s 超时；fetch 异常 / 超时 / 非 2xx → 返回 `{ ok: true, degraded: true }` 并 `console.warn("[turnstile] siteverify unavailable, fail-open")`（logging 前缀标签惯例）。
- 响应 `success=false` → `{ ok: false, codes }`；`fetch` 经参数注入（默认全局 fetch）便于单测。

## 路由接线

- 共用薄壳 `enforceTurnstile(c, body): Promise<Response | null>`（置于 services/turnstile.ts，返回 jsonError 或 null）：
  1. `getTurnstileConfig` → 非 enforced → null（未启用时仅一条 settings 查询，零额外开销）。
  2. body 无 `turnstile_token`（或非字符串/空串）→ 400 `turnstile_token_missing`。
  3. verify 失败 → 403 `turnstile_verify_failed`；成功（含 degraded）→ null。
  - **注意 body 只能读一次**：路由先 `await c.req.json()` 再把解析结果传入，enforceTurnstile 自身不读 body。
- `auth.ts` login：body 解析后、密码校验前调用。`user-auth.ts` login / register：同位接入（register 仅 open 分支可达，天然覆盖）。
- 新错误码族：`turnstile_token_missing`(400) / `turnstile_verify_failed`(403) / `turnstile_incomplete`(400，settings PUT) / `invalid_turnstile_site_key` / `invalid_turnstile_enabled`(400)。

## /api/public/site-info

- 返回体新增 `turnstile_enabled: boolean`（有效启用）与 `turnstile_site_key: string`（未启用为 `""`）。secret 永不下发。

## 前端

- `core/turnstile.ts`：`loadTurnstileScript()` 单例 Promise（并发去重，失败后允许重试）；`declare global { interface Window { turnstile?: ... } }` 最小类型声明置于本文件。
- `features/Turnstile.tsx`：props `{ siteKey, onToken(token: string), resetSignal: number }`。explicit render 到 ref 容器（`SettingsView` 非受控先例）；回调 `callback` / `expired-callback`；卸载时 `turnstile.remove`。reset 用 **resetSignal 计数 prop**（effect 监听变化调 `turnstile.reset()` 并 `onToken("")`），规避 forwardRef 兼容性不确定性。
- 状态放置（state-management.md：容器集中持有 + props 单向下发）：
  - `App.tsx`：site-info 派生 `turnstileEnabled` / `turnstileSiteKey` state；token + resetSignal 持有于 AppRoutes；`handleAdminLogin` body 加 `turnstile_token`；收到 `turnstile_*` 错误码 → toast + resetSignal++。`LoginView` 在密码框与提交按钮之间插 widget 区；启用时按钮 disabled 直到 token 就绪（FR6）。
  - `PublicApp.tsx`：同构接入 `handleLogin` / `handleRegister`；`UserLoginView` 插 widget；`UserRegisterView` 仅 open 完整表单分支插 widget（closed / linuxdo_only 分支不提交密码注册）。
- **失败一律 reset**：siteverify 成功即消耗 token，密码错误等后续失败重试也需新 token —— 任何提交失败（非本地校验错误）都 resetSignal++，不区分错误码。
- **已知权衡（实施落档）**：Turnstile 脚本（api.js）加载失败时客户端**静默失败**——widget 不渲染、无报错提示；启用态下管理员登录按钮因 token 永不就绪而保持禁用，直到刷新页面重试。逃生通道：① 刷新页面（`loadTurnstileScript` 单例在失败后清空缓存、允许重试）；② `TURNSTILE_DISABLED=1` 重新部署全局跳过。「启用态断网打开登录页」列为 AC7 人工验收实测场景。
- a11y：widget 容器加 aria 标签描述（component-guidelines.md）；纯亮色主题，widget 固定 `theme: "light"`。

## 管理台 SettingsView

- 新增「Turnstile 人机验证」卡片：enabled toggle（两键未齐时 disabled 并提示）、site_key input（回显）、secret_key input（已设置时 placeholder「留空保持不变」，提交空值=清除）、Cloudflare dashboard 链接 + 本地测试密钥提示（site `1x00000000000000000000AA` / secret `1x0000000000000000000000000000000AA`，always-pass）。
- 保存走现有 `PUT /api/settings` 流程；`turnstile_incomplete` 错误 toast 展示。

## 兼容与回滚

- 兼容：未配置部署零行为变化；响应字段全增量；无迁移。程序化调用影响：三端点本为浏览器页面专用（New API 兼容端点不含登录），启用后必须先过 Turnstile —— 属预期变化，README 标注。
- 回滚：运行时 = 管理台关 enabled（或 `TURNSTILE_DISABLED=1` 重新部署）；代码 = revert 单 commit。

## 测试设计

- `tests/turnstile-service.test.ts`（纯函数 + 注入 fetch）：enforced 判定矩阵（三键组合 × env 开关 × 脏值）、verify 三分支（成功 / 显式失败 / 网络异常 degraded）、超时分支。
- `tests/turnstile-endpoints.test.ts`（`app.request` 集成，makeDb 模式参照 `tests/proxy-retry-settings.test.ts`）：AC1–AC5 对应用例；AC6 以 settings PUT 解析逻辑的纯函数/集成测试覆盖。
- 保底退化：若集成 mock 成本失控，路由保持薄壳 + 纯函数全覆盖，端点行为以 AC7 人工验收清单兜底（不含 AC2/AC4 的核心分支必须留自动测试）。
