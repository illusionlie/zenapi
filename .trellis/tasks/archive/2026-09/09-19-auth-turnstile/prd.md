# PRD — 登录注册接入 Cloudflare Turnstile 人机验证

## Goal

为 ZenAPI 的三个密码认证入口（管理员登录、用户登录、用户注册）接入 Cloudflare Turnstile，抵御脚本爆破管理员密码、撞库登录与垃圾注册。Turnstile 未配置/未启用时，系统行为与现状完全一致（存量部署零回归）。

## Background（已确认事实，探查于 2026-09-19）

- 代码库当前零人机验证代码（全仓 grep `turnstile|captcha|recaptcha|siteverify` 无命中）。
- 三个插桩点（同时也是各自体系里唯一的会话铸造入口）：
  - `POST /api/auth/login`（`apps/worker/src/routes/auth.ts:18`，管理员，密码哈希存 settings，会话入 `admin_sessions`）。
  - `POST /api/u/auth/login`（`apps/worker/src/routes/user-auth.ts:138`）。
  - `POST /api/u/auth/register`（`user-auth.ts:23`，仅 `registration_mode=open` 时可达；`closed` / `linuxdo_only` 已被 403 `registration_disabled` 拦截）。
- LinuxDO OAuth 回调（`user-auth.ts:355`）同样铸造用户会话，但为浏览器 302 流，无 JSON body 可携带 Turnstile token，且验证责任在 LinuxDO 侧 → 不覆盖。
- 配置基建：`settings` 表 KV（无新表需求，无迁移），`services/settings.ts` 提供 get/set 对；`GET /api/settings` 逐键回显（`ldc_epay_key` 先例），`admin_password_hash` 先例为「不回显、只返回已设置布尔」。
- 公开下发通道：`GET /api/public/site-info`（`public.ts:18`）免鉴权；前端 `App.tsx:65` 顶层拉取。但 `/admin*` 分支不等 site-info 即渲染（`App.tsx:168`），用户侧页面等 `siteInfoLoaded` 才渲染（`App.tsx:195`）。
- 前端三个表单互相独立：`features/LoginView.tsx`（纯展示，提交逻辑在 `App.tsx` `handleAdminLogin:148`）、`UserLoginView` / `UserRegisterView`（提交在 `PublicApp.tsx` `handleLogin:78` / `handleRegister:94`）；错误统一走 toast（`UserRegisterView` 另有内联本地校验错误）。
- 项目无动态第三方脚本加载先例；hono/jsx/dom 的 `useRef`/`useEffect` 非受控 DOM 写入有 `SettingsView.tsx:54-72` 先例。
- 错误响应统一 `jsonError(c, status, message, code)`（`utils/http.ts:7`），code 小写蛇形。
- 出站 fetch 无包装，裸调全局 `fetch`（LinuxDO OAuth 为同型先例）；客户端 IP 全仓未使用过。
- 测试模式：`tests/proxy-retry-settings.test.ts:18-45` 有手写 D1 mock（makeDb），`tests/proxy-responses.test.ts:477` 有 `vi.stubGlobal("fetch")` 模式。

## Requirements

- **FR1 后端校验**：三个端点在密码校验前验证 Turnstile token —— 缺 token → 400 `turnstile_token_missing`（不发起 siteverify）；siteverify 显式判定失败 → 403 `turnstile_verify_failed`。
- **FR2 双保险**（用户决策 D2）：env `TURNSTILE_DISABLED` 为真值时全局跳过校验（紧急逃生，重新部署生效）；siteverify 网络异常/超时/非 2xx 时 fail-open 放行并记 warn 日志（显式 `success=false` 仍拦截）。
- **FR3 配置面**：settings 新增 `turnstile_enabled` / `turnstile_site_key` / `turnstile_secret_key`；管理台系统设置可编辑；secret 永不回显（仅 `turnstile_secret_key_set` 布尔）；site_key 可回显；PUT 侧保证不变量「enabled=true 时两键解析后均非空」，违反 → 400。
- **FR4 公开下发**：site-info 增加 `turnstile_enabled`（有效启用状态）与 `turnstile_site_key`（未启用为空串）；secret 不出现在任何 GET 响应。
- **FR5 前端 widget**：新建 Turnstile 组件（动态注入 `api.js` + explicit render，`theme:"light"`，`size:"flexible"`），三个表单接入；提交携带 token；收到 `turnstile_*` 错误码或任何提交失败时 reset widget（token 一次性）；未启用时不加载任何 Turnstile 资源。
- **FR6 管理员登录页时序**：`/admin*` 不等 site-info 渲染，widget 在 sitekey 到位后挂载；启用时提交按钮在 token 就绪前禁用。
- **FR7 文档同步**：AGENTS.md §11 env 表补 `TURNSTILE_DISABLED`；README 补配置入口、紧急开关、CF 本地测试密钥、程序化客户端影响说明。

## Acceptance Criteria

- [ ] **AC1** settings 未配置时：三端点行为与现状一致（集成测试覆盖「未启用 → 不调用 siteverify」；现有测试全绿）。
- [ ] **AC2** 启用 + 密钥齐全：无 token 请求 400 `turnstile_token_missing`；siteverify 判失败 → 403 `turnstile_verify_failed`；判定成功 → 进入原有密码校验流程（stub fetch 模拟三分支）。
- [ ] **AC3** siteverify fetch 抛异常 / 返回 5xx：请求照常进入密码校验（fail-open），且产生可断言的 warn 日志。
- [ ] **AC4** env `TURNSTILE_DISABLED=1`：settings 已启用也跳过（fetch 不被调用）。
- [ ] **AC5** site-info 正确返回 `turnstile_enabled` / `turnstile_site_key`（反映「有效启用」而非裸存储值）；secret 不出现在任何 GET 响应。
- [ ] **AC6** `PUT /api/settings`：`turnstile_enabled=true` 且两键缺失 → 400；secret 三态（键缺省=保留 / 空值=清除 / 非空=覆盖）生效。
- [ ] **AC7** 前端（人工验收，项目无前端测试基建）：启用时三表单渲染 widget、提交带 token、失败后 widget reset 可重试；未启用时页面无 turnstile 脚本请求；管理台可完整配置并触发出 `turnstile_incomplete` 提示。
- [ ] **AC8** `bun run check && bun run typecheck && bun run test` 全绿。

## Out of Scope

- LinuxDO OAuth 登录/绑定/回调流程（验证责任在 LinuxDO 侧，302 流无 token 载体）。
- `/v1`、`/anthropic/v1` 代理、playground、New API 兼容端点（不铸造登录会话）。
- WAF / IP 限流、忘记密码等衍生能力；Turnstile 企业特性（pre-clearance 等）。

## Key Decisions（用户已确认）

- **D1** 创建 Trellis 任务，规划评审后再实施。
- **D2** 管理员登录同样强制 Turnstile，配双保险：`TURNSTILE_DISABLED` env 紧急开关 + siteverify 基建故障 fail-open。
- **D3** 密钥存 settings 表（与 `admin_password_hash` 同信任域）；secret 不回显，只返回已设置布尔。

## Open Questions

（无 —— 需求已收敛，见 Key Decisions）
