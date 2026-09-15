# 代理重试参数迁移到 settings 系统设置

## Goal

将代理重试轮数与重试间隔从 `wrangler.toml` 环境变量（`PROXY_RETRY_ROUNDS` / `PROXY_RETRY_DELAY_MS`）迁移为 `settings` 表业务配置，管理员可在管理台「系统设置」中即时调整，无需重新部署。

## 背景

- 现状：两个参数只存在于 `[vars]`（`apps/worker/wrangler.toml`），修改需要 commit + push + 重新部署（或到 CF Dashboard 改变量生成新版本）。
- 不一致：同类运行时行为参数（日志保留天数、会话时长、全局头策略）均已在 `settings` 表并通过管理台修改；全局头策略甚至在代理热路径上每请求读取，证明 per-request 配置读取成本可接受。
- 风险认知：这两个参数是"故障放大器"（大轮数 × 大间隔会拉长请求挂起时间、放大上游压力），因此必须带范围校验，而非裸迁移。

## Requirements

1. **新增 settings 键**：`proxy_retry_rounds`（整数）、`proxy_retry_delay_ms`（整数，毫秒）。
2. **生效优先级（回退链）**：settings 值 → 环境变量（`PROXY_RETRY_ROUNDS` / `PROXY_RETRY_DELAY_MS`）→ 内置默认值（2 轮 / 200ms，与现 wrangler.toml 一致）。settings 键不存在时，已部署实例行为与迁移前完全一致。
3. **取值范围**：
   - 重试轮数：1–10（表单 min/max、后端 PUT 校验、运行时读取 clamp 三层一致）。
   - 重试间隔：0–60000ms（同上三层一致）。
   - 越界的存量脏值在读取时 clamp，不抛错。
4. **后端 API**：
   - `GET /api/settings` 返回 `proxy_retry_rounds`、`proxy_retry_delay_ms`（返回当前 settings 存储值；键缺失时返回内置默认值）。
   - `PUT /api/settings` 支持两个新字段，越界/非法返回 400 `invalid_proxy_retry_rounds` / `invalid_proxy_retry_delay_ms`（沿用现有 `invalid_{key}` 错误码惯例）。
5. **代理热路径接入**：三条代理路径（`routes/proxy.ts`、`routes/anthropic-proxy.ts`、`routes/playground.ts`）的重试循环改用新配置读取函数；worker 端 `proxy.ts` / `anthropic-proxy.ts` 必须并入现有 `Promise.all` 并行预载，**不得新增串行 DB 往返**。
6. **管理台 UI**：系统设置表单新增「代理重试轮数」「重试间隔（毫秒）」两个数字输入框，随现有保存流程提交。
7. **env 变量保留**：`wrangler.toml` 中 `PROXY_RETRY_ROUNDS` / `PROXY_RETRY_DELAY_MS` 保留不删，降级为回退默认值；`env.ts` 类型不变。
8. **文档同步**：AGENTS.md §8（代理关键行为）与 §11（环境变量表）更新，注明 settings 优先、env 为兼容回退。

## Non-goals

- 不引入配置缓存层（维持"每请求读库"的既有语义，设置修改即时生效）。
- 不迁移其他 env 变量（`CORS_ORIGIN`、OAuth 凭据等保持 env）。
- 不做渠道级重试配置（全局配置即可）。
- 不删除 wrangler.toml 中的 env 变量（留待后续版本决定）。

## Acceptance Criteria

- [ ] `GET /api/settings` 含两个新字段；`PUT` 越界值返回 400 与对应 `invalid_*` 错误码，合法值可保存并经 `GET` 读回。
- [ ] settings 未设置时，代理行为回退到 env / 内置默认（2 轮 / 200ms），与迁移前一致。
- [ ] settings 设置后，三条代理路径（OpenAI / Anthropic / Playground）的重试轮数与间隔均按 settings 值执行。
- [ ] 取值 clamp：轮数 <1 归 1、>10 归 10；间隔 <0 归 0、>60000 归 60000（读取侧单测覆盖，含回退链各分支）。
- [ ] `proxy.ts` / `anthropic-proxy.ts` 中配置读取与渠道查询、头策略预载在同一个 `Promise.all` 内完成，无串行新增。
- [ ] 管理台系统设置出现两个新输入框，保存后刷新读回正确值。
- [ ] `bun run check && bun run typecheck && bun run test` 全绿；新增 getter/回退链逻辑有单测。
- [ ] AGENTS.md 已同步更新。
