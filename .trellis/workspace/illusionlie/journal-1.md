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
