# 执行计划：移除站点模式与共享模式 + 用户级模型限制

> 前置：`prd.md`（需求与验收）、`design.md`（D1-D6 决策）、两份 inventory（file:line 锚点）。
> 执行顺序按层分组、组内按依赖排序；每步末尾附验证命令。全程遵守 Biome（tab、双引号）。

## Stage 0：基线验证

- [ ] `bun install` 后确认基线干净：`bun run typecheck && bun run check && bun run test`（当前零测试 → vitest 空跑）。
- [ ] `python .trellis/scripts/task.py current` 确认任务激活（in_progress）。

## Stage 1：后端 — 站点模式移除（R1）

- [ ] `src/services/settings.ts`：删 `SITE_MODE_KEY` / `SiteMode` / `VALID_SITE_MODES` / `getSiteMode` / `setSiteMode`（settings.ts:113-141±）。
- [ ] `src/middleware/tokenAuth.ts`：删 import + `siteMode === "personal"` 拦截（tokenAuth.ts:4,58-63），**保留** user status/balance 校验。
- [ ] `src/routes/user-auth.ts`：删 register 与 LinuxDO 新用户两处 personal 拦截（≈:21-24、≈:527），registration_mode 校验不动。
- [ ] `src/routes/settings.ts`：删 GET 返回 `site_mode` 与 PUT 校验写入（:19,26,43,62,86,152-156）。
- [ ] `src/routes/public.ts`：`/site-info` 删 `site_mode` 字段；`/models` 删 personal 403 与 shared 分支（:14,23,30,47-49,72-73）；`/contributions` 整端点删除（:133-170）。
- [ ] `src/routes/channels.ts`：删 `/:id/test` 内 `getSiteMode` + `defaultShared` 分支（:17,316-317,330,338-339）。
- [ ] `src/routes/newapiChannels.ts`：删两处 test 与 fetch_models 的 `defaultShared` 分支（:31,393-404,442-453,486,492）。
- [ ] 验证：`bun run typecheck`（预期报 shared/withdrawal 相关级联错误 → 属 Stage 2 范围，本步以「site_mode 零残留」为准：`grep -rn "site_mode\|SiteMode\|getSiteMode\|setSiteMode" apps/worker/src` 仅允许命中尚未到 Stage 2 的行）。

## Stage 2：后端 — 共享生态移除（R2）

- [ ] 删除整文件：`src/routes/withdrawal.ts`、`src/routes/ldoh.ts`、`src/routes/ldoh-user.ts`、`src/routes/user-channels.ts`、`src/services/ldoh-blocking.ts`。
- [ ] `src/index.ts`：删 5 个 import（:12-13,29-30）+ 4 处挂载（:146,155,156,158）；adminAuth 放行清单**不动**。
- [ ] `src/services/settings.ts`：删 `withdrawal_enabled` / `withdrawal_fee_rate` / `withdrawal_mode` / `ldoh_cookie` / `channel_fee_enabled` / `channel_review_enabled` / `user_channel_selection_enabled` 全部 get/set（settings.ts:326-360,422-440±）。
- [ ] `src/routes/proxy.ts`：
  - 删 `channelSupportsSharedModel`（:62-72）、两处 `useSharedFilter`（:244,373）、`model_not_shared` 403（:392-393）、supportsFn 三元（:411-412,426-427）、`/models` 的 shared 候选过滤（:249-250）——固定 `channelSupportsModel` / `extractModelPricings`；
  - 删 strict 提现扣费分支与 `getWithdrawalMode`（:674-691），普通扣费 SQL 去掉 `withdrawable_balance` 引用；
  - 删分成入账块（:692-723）与 `getChannelFeeEnabled`。
- [ ] `src/routes/anthropic-proxy.ts`：镜像删除（:17-18,35,83,105-108,118-119,132-133,419-461）。
- [ ] `src/routes/recharge.ts`：回调 SQL 改为只加 `balance`（:191-196）⚠️ 必改。
- [ ] `src/middleware/userAuth.ts`：`UserRecord` 与 SELECT 删 `withdrawable_balance`、`tip_url`（:13,17,48）。
- [ ] `src/routes/user-auth.ts`：登录响应删 `tip_url`（:224）。
- [ ] `src/routes/user-api.ts`：删 `PATCH /profile`（:32-47）；`/models` 删 shared 分支与 `site_mode` 字段（:8,77-78,~125）；dashboard 删 7 字段（violations/contributions/withdrawal_*/user_channel_selection_enabled/channel_review_enabled，:519-541）；用户令牌 POST/PATCH 删 `allowed_channels` 接收与门控（:154-190±,243）。
- [ ] `src/services/channel-models.ts`：`ModelPricing` 删 `shared`、`modelsToJson` 停写、删 `extractSharedModelPricings` / `extractSharedModels` / `collectUniqueSharedModelIds`（实现前先 `grep -rn "collectUniqueSharedModelIds" apps/` 确认调用点）。
- [ ] `src/services/channel-types.ts`：删 `contributed_by` / `charge_enabled` / `contribution_note`（:20-23）。
- [ ] `src/services/channel-testing.ts`：删 `defaultShared` 与全量 shared 标记逻辑（:97,144-156）。
- [ ] 验证：`bun run typecheck && bun run check`；`grep -rn "withdrawal\|ldoh\|contributed_by\|charge_enabled\|contribution_note\|SharedModel\|useSharedFilter\|defaultShared\|tip_url" apps/worker/src` 仅允许 `ldc_payment_enabled`/`ldc_*`（LDC 充值汇率系保留项，勿误删）。

## Stage 3：数据库 — 迁移 + schema（R3）

- [ ] 新建 `apps/worker/migrations/0019_remove_shared_ecosystem.sql`（design.md §4 五段：DROP 5 表 → DROP 6 列 → DELETE 8 settings 键 → models_json json_remove 清 shared → ADD `users.allowed_models TEXT`）。⚠️ 先核对 `withdrawable_balance` 引入迁移号（0016）。
- [ ] `src/db/schema.sql`：删 5 表+3 索引（:167-230±）、users 两列（:84,:88）、channels 四列（:18-21±）；users 表加 `allowed_models TEXT`。
- [ ] 本地验证：`bunx wrangler d1 execute DB --local --file apps/worker/migrations/0019_remove_shared_ecosystem.sql --cwd apps/worker`（或 `bun run --filter api-worker db:migrate`），重复执行验证报错面仅限 DROP COLUMN 幂等性。
- [ ] 回滚点：迁移文件独立、未部署前可整文件删除回退。

## Stage 4：后端 — 用户级模型限制（R4）

- [ ] `src/middleware/tokenAuth.ts`：user 查询加 `allowed_models`，解析后并入 `c.set("tokenRecord", {…, user_allowed_models})`；`TokenRecord` 类型加字段。
- [ ] `src/middleware/userAuth.ts`：SELECT + `UserRecord` 加 `allowed_models`。
- [ ] `src/routes/proxy.ts`：模型提取后校验白名单（403 `model_not_allowed`，design.md D2）；`/v1/models` 按白名单过滤。
- [ ] `src/routes/anthropic-proxy.ts`：同校验（`parsedBody.model`）。
- [ ] `src/routes/user-api.ts`：`/api/u/models` 按当前用户白名单过滤。
- [ ] `src/routes/admin-users.ts`：GET 返回 `allowed_models`；POST/PATCH 支持（undefined=不改，null/[]=清空）。
- [ ] **新增单测** `tests/`（vitest 已配置 include）：
  - `tests/channel-models.test.ts`：modelsToJson / extractModelPricings（shared 移除后）、五段→纯 JSON 行为；
  - `tests/user-model-limit.test.ts`：白名单解析（NULL/空/非空）、403 判定纯函数、与 allowed_channels 的组合行为（如校验逻辑抽为可导出纯函数）。
- [ ] 验证：`bun run test`（首次非空跑，须全绿）；`bun run typecheck`。

## Stage 5：前端（R1/R2/R4，锚点见 frontend-docs-inventory.md）

- [ ] `core/types.ts`：删 `SiteMode`、Settings/SettingsForm 的 site_mode、withdrawal_* ×3、ldoh_cookie、三设置项、`UserDashboardData` 7 字段、`LdohSite` 三类型、`ContributionChannel/ContributionEntry`、`User.tip_url`、`UserTabId` 的 `"channels"`、`TabId` 的 `"ldoh"`；`User` 加 `allowed_models?: string[] | null`；`/api/u/models` 响应类型删 `site_mode`。
- [ ] `App.tsx` / `PublicApp.tsx` / `UserRegisterView.tsx` / `AdminApp.tsx` / `core/constants.ts`：删 siteMode prop/state/传递与 `?? "personal"` 回退；App.tsx 删 `siteMode === null` 阻塞（:197-200，保留一个轻量加载标记防登录表单闪烁，实现时定）与 personal 重定向（:203-208）。
- [ ] `SettingsView.tsx`：删站点模式选择器与 `!== "personal"` 包裹（改为无条件渲染注册模式/签到/初始额度/邀请码）；删分成/审核/LDOH/提现四块（:297-480±）。
- [ ] 整文件删除：`features/LdohView.tsx`、`features/UserChannelsView.tsx`。
- [ ] `AdminApp.tsx`：删 LDOH tab/state/loadLdoh/handleLdoh*（:15-17,32,63,76,115-121,217-260,278,585-693,1244-1262）；settings 初始化/提交删 8 键（:180-194,703-714）；channels 下发 siteMode 删除（:1158）。
- [ ] `UserApp.tsx` / `UserDashboard.tsx` / `UserTokensView.tsx`：删 channels tab 与 visibleTabs 简化；删提现卡片/可提现展示/ContributionBoard/违规耻辱墙/tip_url 表单；删 channelSelectionEnabled prop 与渠道选择模态（决策 C）。
- [ ] `ChannelsView.tsx`：`ParsedModel` 删 `shared`；parseModelLines/rebuildModelsText 4 段（兼容读 5 段，design.md D6）；删共享工具栏与共享/私有 pill。
- [ ] `UsersView.tsx`：编辑模态新增「可用模型」多选（复用渠道拉取模型弹窗骨架：搜索+全选+checkbox+已选计数，候选 `GET /api/models`；空=不限制），patch 追加 `allowed_models`。
- [ ] 删除根目录 `ldc-reward.user.js`（决策 B）。
- [ ] 验证：`bun run typecheck && bun run check`。

## Stage 6：文档

- [ ] `AGENTS.md`：§1 简介、§3 布局（删 withdrawal/ldoh 路由行）、§6 速查表（删 4 行挂载）、§8 代理行为（删 strict 提现/shared 过滤；补用户级模型限制）、§10 表清单（删 withdrawal_orders、ldoh_*；提 allowed_models）、§11 不变。同步修正「tests/ 现状」表述（§5 单测要求已落地）。
- [ ] `README.md`：删站点模式/共享模式/提现/LDOH 章节；部署章节补「迁移先于代码部署」契约（design.md §4）。
- [ ] 验证：通读两文件与实际路由挂载一致。

## Stage 7：全量质检（对应 workflow 2.2 最后一轮全范围）

- [ ] `bun run check && bun run typecheck && bun run test` 全绿。
- [ ] 本地冒烟（`dev:worker` + `dev:ui` + 已迁移库）：
  - 未登录 `/` → 登录页；注册/登录/登出/me 正常；
  - `/admin` 系统设置无站点模式选择器，其余设置项可保存；
  - 模型广场公开可见价格；用户端模型列表正常；
  - 管理台编辑用户 `allowed_models`；被限用户 `/v1/chat/completions` 与 `/anthropic/v1/messages` 白名单外 → 403 `model_not_allowed`；`/v1/models` 只见白名单内；
  - 令牌级 allowed_channels 存量约束仍生效；
  - `/api/ldoh`、`/api/u/withdrawal` 等返回 404。
- [ ] 验收清单逐条对照 `prd.md` Acceptance Criteria。

## 风险文件与回滚点

| 风险 | 缓解 |
|---|---|
| `proxy.ts` / `anthropic-proxy.ts`（核心链路，Stage 2/4 双改） | 每次改动后 typecheck；单测覆盖新校验；扣费/入账 SQL 逐行核对 |
| `0019` 迁移（不可逆 DROP） | Stage 3 本地库先行验证；部署顺序契约（migration → deploy 同 run）；备份数据库后再上线（README 说明） |
| `recharge.ts` 回调 SQL | 必改点清单显式列出；冒烟覆盖充值回调 |
| 前端 App.tsx 路由分发 | 仅删两个分支，`/` 重定向与 admin/user 路由锚点不动（frontend §1.1） |
| settings 键误删 `ldc_*` | Stage 2 验证 grep 显式区分 `ldc_`（保留）与 `ldoh_`（删除） |
