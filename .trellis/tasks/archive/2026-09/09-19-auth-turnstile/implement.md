# Implement — 执行清单

验证命令（每个里程碑后跑对应项，收尾全量）：`bun run check` / `bun run typecheck` / `bun run test`

## 步骤

1. [ ] **后端配置层**：`env.ts` 增 `TURNSTILE_DISABLED?: string`；`services/settings.ts` 增 `getTurnstileConfig`（单 SQL `key IN` 三键）+ 三个 setter；`routes/settings.ts` PUT 扩展（site_key 校验、secret 三态、enabled 枚举、`turnstile_incomplete` 不变量；GET 增 `turnstile_secret_key_set` 且不回显 secret）。
2. [ ] **services/turnstile.ts**：`isTurnstileEnforced`（纯函数）/ `verifyTurnstileToken`（fetch 注入 + AbortController 5s）/ `enforceTurnstile(c, body)` 薄壳（不自行读 body）。
3. [ ] **单测** `tests/turnstile-service.test.ts`：enforced 矩阵、verify 三分支、超时、TURNSTILE_DISABLED。
4. [ ] **路由接线**：`auth.ts` login、`user-auth.ts` login + register（先 `await c.req.json()` 再传参）；`public.ts` site-info 增 `turnstile_enabled` / `turnstile_site_key`。
5. [ ] **集成测试** `tests/turnstile-endpoints.test.ts`：AC1（未启用不调 siteverify）、AC2（三分支）、AC3（fail-open + warn 断言）、AC4、AC5。
6. [ ] **前端基建**：`core/turnstile.ts` 脚本单例 + `Window.turnstile` 类型；`features/Turnstile.tsx`（explicit render、resetSignal、卸载 remove）。
7. [ ] **前端接线**：`App.tsx`（site-info 派生 state、token/resetSignal、`handleAdminLogin` 带 token、失败 reset）+ `LoginView`（widget 区 + 按钮 disabled 时序）；`PublicApp.tsx` / `UserLoginView` / `UserRegisterView`（仅 open 分支）同构接入；任何提交失败一律 resetSignal++。
8. [ ] **管理台**：`SettingsView` Turnstile 卡片（toggle 门控、site_key 回显、secret 三态、测试密钥提示、`turnstile_incomplete` toast）。
9. [ ] **文档**：AGENTS.md §11 增 `TURNSTILE_DISABLED` 行；README 增 Turnstile 配置说明（入口、紧急开关、CF 测试密钥、程序化客户端影响）。
10. [ ] **收尾**：`bun run check && bun run typecheck && bun run test` 全绿；对照 AC1–AC8 逐条勾验；AC7 前端人工验收（启用/未启用两态各过一遍三表单 + 管理台配置流）。

## 风险文件与回滚点

- `routes/settings.ts`：PUT 为逐字段大函数，改动须保证既有字段校验零回归（现有测试 + 全量 check 兜底）。
- `App.tsx`：路由分发核心，仅增量 state 与 props 透传，勿动分支结构。
- 回滚点：步骤 1–5（后端）/ 6–8（前端）可各自独立 revert；运行时逃生：管理台关 enabled 或 `TURNSTILE_DISABLED=1` 重新部署。

## task.py start 前检查

- [ ] `implement.jsonl` / `check.jsonl` 已含真实条目（非 `_example`）。
- [ ] prd / design / implement 三产物已获用户批准。
