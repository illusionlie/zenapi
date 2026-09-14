# Journal - illusionlie (Part 1)

> AI development session journal
> Started: 2026-07-26

---



## Session 1: Remove site mode & shared ecosystem, add per-user model allowlist

**Date**: 2026-09-13
**Task**: Remove site mode & shared ecosystem, add per-user model allowlist
**Branch**: `main`

### Summary

Fixed ZenAPI to service-only mode: removed site_mode mechanism (17 backend anchors), entire shared ecosystem (withdrawal/LDOH/contributions/shared flags/fee-review settings, 5 route files deleted), channels legacy columns; added per-user allowed-models allowlist (users.allowed_models TEXT, 403 model_not_allowed in both proxies, list filtering, admin picker UI) with migration 0019 (DROP 5 tables/6 cols/8 settings keys, models_json shared cleanup via json_each CASE guards). 49 new unit tests; typecheck/test/build green; lint zero-new (38->24 baseline debt). Key lessons captured into specs: D1 JSON-in-TEXT bulk rewrite traps, DROP COLUMN single-run semantics, fail-open parse/fail-closed write convention, frontend lint-debt gate. 5 AC items pending online smoke test after deploy (403 intercept, / redirect, public models, 3 registration modes, admin whitelist interaction). Deploy contract: migration before code in same CI run, backup first.

### Git Commits

| Hash | Message |
|------|---------|
| `7fd36c3` | (see git log) |
| `a71dd93` | (see git log) |
| `1c338e0` | (see git log) |
| `4fac541` | (see git log) |

### Status

[OK] **Completed**


## Session 2: 修复 apps/ui 存量 a11y lint 错误（24E+6W）

**Date**: 2026-09-14
**Task**: 修复 apps/ui 存量 a11y lint 错误（24E+6W）
**Branch**: `main`

### Summary

清偿 apps/ui 全部 24 个存量 a11y lint error（14 noLabelWithoutControl 用 htmlFor+id 真实关联并以 create/edit 前缀隔离模态 id、6 noSvgWithoutTitle 按语义分流 aria-hidden/role=img、4 处点击类改语义化 button）并顺带清偿 6 个 warning；质检门槛升级为 bun run check 全仓 0 error（仅 .pi/trellis 基建 noSelfAssign 例外）；沉淀 a11y 实战约定与 check --write 簿记 gotcha 到 frontend spec。验收：biome check apps/ui 0E0W、typecheck 0E、49/49 tests、vite build 全过。

### Git Commits

| Hash | Message |
|------|---------|
| `f6f9a9d` | (see git log) |
| `0b09027` | (see git log) |
| `01fa423` | (see git log) |

### Status

[OK] **Completed**


## Session 3: 清账归档两个挂起任务 + 补全 spec 空模板

**Date**: 2026-09-14
**Task**: 07-27-channel-model-picker（验收归档）、00-bootstrap-guidelines（补全后归档）
**Branch**: `main`

### Summary

盘点发现两个 in_progress 任务实为「已完成未归档」：channel-model-picker 代码早已随 9692fa3 提交（仅差 checkbox 与归档）；bootstrap-guidelines 走了「随任务按需捕获」路线但留下 6 个空模板 + 11 个与包性质不符的空壳目录。处理：归档前从真实代码提炼补全 7 个有效 spec（logging/quality/directory-structure、UI 的 directory/hook/state/type-safety，要点：console 前缀标签惯例、jsonError snake_case 错误码、零状态库容器集中持有、hono/jsx-dom 无自定义 hook、类型直通 snake_case）；api-worker/frontend 与 api-worker-ui/backend 整体标注 N/A；刷新 4 个 index 状态表。验收：check 1E（spec 豁免项）、typecheck 0E、49/49 tests。归档后 0 active tasks。

### Git Commits

| Hash | Message |
|------|---------|
| `9f91211` | chore(task): archive 07-27-channel-model-picker |
| `9adcb42` | chore(task): archive 00-bootstrap-guidelines |
| (本次) | docs(trellis): fill spec templates & mark N/A dirs |

### Status

[OK] **Completed**

## Session 4: 全局通知改造——notice banner 迁移为底部 Toast

**Date**: 2026-09-14
**Task**: 09-14-toast-notification-refactor（全流程：规划→实施→检查→归档）
**Branch**: `main`

### Summary

痛点：notice banner 渲染在 main 文档流（无定位无 z-index），被 11 个 z-50 modal 的遮罩盖死，「成功才关弹窗」类弹窗的失败提示 100% 不可见。方案（用户四项决策：创建任务/底部 toast/分层迁移/区分类型）：自研轻量 toast——core/toast.ts 模块级 store（success 3s/error 5s/info 3s、堆叠上限 5、两段式退场）+ ToastHost createPortal 挂 body（z-[100]）+ Tailwind v4 @theme 动画。71 处 setNotice 全量迁移 + UserDashboard 补充 8 处（签到/充值反馈，实施中发现规划漏盘点），7 处手工 clear 删除，4 份 notice state/6 处 banner/3 条 props 链拆除。明文类 5 处（令牌/邀请码）升级 SecretValueModal（展示+复制）。分层保留：注册表单校验/充值金额校验（改红色语义）、Playground 对话区错误。

### Key learnings

1. hono/jsx/dom 原生支持 createPortal（4.13.7 验证），但 ToastHost 不能挂在有 early return 的 App 组件返回树里（分支切换会卸载）——用 fragment 包 `<ToastHost/><AppRoutes/>`，顺带修复 401 登出组件卸载丢 notice 的问题（store 独立于组件树生命周期）。
2. Tailwind v4 @theme 内嵌 @keyframes 会被 Biome 拒绝，需 biome.json 开 `css.parser.tailwindDirectives` 且 keyframes 提到顶层。
3. 同文件混两个功能的提交分离：checkout HEAD 版本 → 重放 A 功能 hunk → commit A → 还原完整版 → commit B（注意 A 的上下文行若被 B 改过，patch 不能直接 apply，须手工重放）。
4. a11y：动态 toast 容器补 `role="status" aria-live="polite"`（WAI-ARIA toast 标准模式）。
5. spec 翻转约定：「不引入 toast 库」→「不引入第三方 toast 库」，state-management.md 三处已同步。

### Git Commits

| Hash | Message |
|------|---------|
| `a1bb0b4` | feat(ui): 拉取模型默认仅预勾选已存在模型（上个任务遗留改动分离提交） |
| `98b4127` | feat(ui): 全局通知迁移为底部 toast，明文信息升级弹窗 |
| `501347d` | chore(task): archive 09-14-toast-notification-refactor |

### Status

[OK] **Completed**（遗留：浏览器手动冒烟清单已交用户，代码层机制经 check 全量验证）

## Session 5: 令牌「查看」改直接复制，明文弹窗降级为兜底

**Date**: 2026-09-14
**Task**: 09-14-token-reveal-direct-copy（轻量任务：PRD-only，规划→实施→检查→归档）
**Branch**: `main`

### Summary

上一任务把令牌 reveal 主路径改成了 SecretValueModal，用户反馈过重（参考 newapi：直接复制即可）。本任务纠正交互主次：令牌列表按钮「查看」→「复制」，点击 fetch reveal → clipboard.writeText → toast 反馈；仅复制失败（Safari/iOS 用户激活过期、非安全上下文 clipboard 为 undefined）回落 SecretValueModal 兜底。管理台 TokensView 2 处按钮文案 + AdminApp/UserApp 两处 handleTokenReveal；UserTokensView 文案本就是「复制」只改行为。无后端改动（token_plain 存库可重复获取）。一次性展示弹窗（新令牌创建、邀请码导出）保留不动；明文不进 toast 文案。

### Key learnings

1. **兜底不能升主路径**：上个任务为救「复制失败无处看明文」把弹窗当唯一出口，本任务纠正——高频动作（复制）必须是零摩擦主路径，弹窗只留给低频/一次性场景。spec state-management.md 已把明文展示分成「一次性弹窗」与「可重复获取走复制优先」两类。
2. `await fetch` 后调 `navigator.clipboard.writeText` 在 Chrome/Firefox 无碍（transient activation 窗口约 5s），Safari/iOS 可能拒绝；内层 catch 弹窗兜底顺带覆盖非安全上下文（http 部署下 clipboard 为 undefined 同步抛 TypeError）。
3. `bun run check`（`biome check --write .`）会顺手重排仓库内不合规范的簿记 JSON（归档 task.json 2 空格→tab），quality-guidelines 预告过：不回滚，随任务提交。

### Git Commits

| Hash | Message |
|------|---------|
| `da45d78` | feat(ui): 令牌查看改为直接复制，明文弹窗降级为失败兜底 |
| `80b18db` | chore(task): biome 重排归档任务 task.json 缩进 |
| `3a4a684` | chore(task): archive 09-14-token-reveal-direct-copy |

### Status

[OK] **Completed**（check 全绿：PRD R1-R6 逐项合规、Admin/User handler 同构、三命令 0 error / 49 用例通过；浏览器手动冒烟建议用户自验）

---

## Session 6 — 全局自定义请求头（注入/剔除）与渠道级统一

**Date**: 2026-09-15
**Task**: 09-14-global-custom-headers（复杂任务：PRD + design + implement，规划→实施→检查→冒烟→归档）
**Branch**: `main`

### Summary

系统设置新增两个全局头策略（仅 /v1 与 /anthropic/v1 计费代理生效，Playground 与连通性测试豁免）：① proxy_extra_headers 注入（JSON 对象）② proxy_remove_headers 剔除（JSON 字符串数组）。核心是新建 utils/proxy-headers.ts 单点 applyHeaderPolicy（固定顺序：剔除 → 全局注入 → 渠道级，后应用者赢），两条代理链路全部 6 个上游 fetch 分支统一接入；顺带把渠道级 custom_headers_json 从 custom-only 扩展到全格式并把 ChannelsView 编辑字段常显（用户此前根本看不到该字段——条件渲染 + 后端仅 custom 分支生效的双重隐藏）。buildChannelRequest 加可选第 9 参 policy 保住 Playground 豁免边界。settings KV 原文存储，零迁移。实施派 trellis-implement（TDD 25 用例）、核查派 trellis-check（抓出 placeholder 非法 JSON 真 bug），最后本地 wrangler dev + 回显上游做端到端冒烟（6 分支 × 注入/剔除/覆盖矩阵全 PASS）。

### Key learnings

1. **跨层契约改动必须先盘全部分支**：动手前逐分支盘点（design §2 接入矩阵）避免了遗漏——anthropic-proxy 的 openai 转换分支是 fresh Headers 白名单式，不看代码根本想不到剔除在那里是 no-op。
2. **豁免边界用参数显式化**：全局配置若在共享函数内自动读库，Playground 这类复用方无法豁免；改为调用方传 policy（null = 仅渠道级），边界清晰且读库时机（与渠道查询 Promise.all）由调用方控制。
3. **「后应用者赢」保持现状能力**：历史 custom 分支渠道级就能覆盖 x-api-key，统一时不加保护名单回退它，规则单一 + UI 警示兜底。
4. **冒烟断言也会拿错对象**：两次 FAIL 都是断言脚本自身错位（拿 custom 渠道行为断言 openai 渠道、拿渠道级值判全局豁免），先看原始日志再下结论。
5. wrangler d1 execute --local 必须在 apps/worker/ 目录下执行；本地 dev D1 有历史管理员密码时，直接往 admin_sessions 插已知 hash 的会话是最无侵入的冒烟通道。

### Git Commits

| Hash | Message |
|------|---------|
| `c7e1e18` | feat(worker): 全局自定义请求头注入/剔除与渠道级 custom_headers 全格式生效 |
| `a4f6825` | feat(ui): 系统设置新增请求头注入/剔除配置，渠道级自定义请求头常显 |
| `21d3148` | chore(task): archive 09-14-global-custom-headers |
| `686c623` | docs(spec): 沉淀上游请求头策略契约与 settings 新增配置项标准链路 |

### Status

[OK] **Completed**（check/typecheck/test 全绿：74 用例、0 error；端到端冒烟 6 分支矩阵全 PASS，AC1–AC10 逐项达成；spec 沉淀至 api-worker/backend/proxy-headers.md + cross-layer guide checklist）
