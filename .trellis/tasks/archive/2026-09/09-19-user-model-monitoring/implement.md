# 实施清单：用户端监控改为模型可用性并收紧 monitoring 鉴权

前置阅读顺序：`implement.jsonl` 清单 → `prd.md` → `design.md` → 本文件。
规范基线：Biome tab 缩进 + 双引号；错误码 `ERR_{模块}_{含义}`；提交前 `bun run check && bun run typecheck && bun run test`。

## Step 1 worker：RANGE_CONFIG 抽取（design D2）

- [ ] 新建 `apps/worker/src/utils/monitoring.ts`：导出 `RANGE_CONFIG` 与 `resolveMonitoringRange`。
- [ ] `apps/worker/src/routes/monitoring.ts` 改为导入，删除本地定义；行为零变化。
- 验证：`bun run typecheck`。

## Step 2 worker：收紧 /api/monitoring（design D1）

- [ ] `apps/worker/src/index.ts` 放行清单删除 `p.startsWith("/api/monitoring")`。
- 验证：`grep -n monitoring apps/worker/src/index.ts` 确认仅剩 import 与 route 挂载两行。

## Step 3 worker：纯聚合函数 + 单测（design D3）

- [ ] 新建 `apps/worker/src/utils/model-monitoring.ts`：`buildModelMonitoring`（行映射、舍入、allowlist 过滤、active_models）。
- [ ] 新建 `tests/model-monitoring.test.ts`：
  - 行→字段映射与舍入（success_rate 空请求 = null；有请求 = 百分比两位小数）；
  - allowlist 非空：行与趋势均被过滤，受限模型名不得出现在输出；
  - allowlist NULL/空：全部保留；
  - `active_models` 只统计有流量模型；
  - 输出键集合断言：不含 `channel` / `error_message` 字样（防回归）。
- 验证：`bun run test -- model-monitoring`。

## Step 4 worker：/api/u/monitoring 端点（design D3）

- [ ] `apps/worker/src/routes/user-api.ts` 新增 `userApi.get("/monitoring")`：
      参数解析 → 4 条 SQL（按模型汇总 / 模型×槽趋势 / 全局+近15m 汇总 / 近15m 按模型）→ `buildModelMonitoring`。
- 验证：`bun run typecheck`。

## Step 5 前端：共享工具抽取 + 类型（design D4/D5）

- [ ] 新建 `apps/ui/src/features/monitoring-shared.ts`：`generateSlots` / `formatSlotLabel` / `barColor` 从
      `MonitoringView.tsx` 纯移动；`MonitoringView.tsx` 改导入，其余不动。
- [ ] `apps/ui/src/core/types.ts` 新增 `ModelMonitoringModel` / `ModelMonitoringTrend` / `ModelMonitoringData`。
- 验证：`bun run typecheck`。

## Step 6 前端：ModelMonitoringView + UserApp 接线（design D6/D7）

- [ ] 新建 `apps/ui/src/features/ModelMonitoringView.tsx`（状态横幅 / 三卡片 / 非交互按模型 uptime 条 / 范围切换 / 空态）。
- [ ] `apps/ui/src/UserApp.tsx`：替换组件、state 类型、`loadMonitoring` 指向 `/api/u/monitoring?range=15m`。
- 验证：`bun run typecheck && bun run check`。

## Step 7 文档同步（design D8）

- [ ] AGENTS.md §6：放行清单句删 `/api/monitoring*`；`/api/monitoring` 行标注管理员专用；`/api/u` 行补模型可用性监测。
- [ ] AGENTS.md 与实现如有出入以代码为准并同步本文件 §3/§6。

## Step 8 全量质量门（review gate）

- [ ] `bun run check`（Biome）
- [ ] `bun run typecheck`
- [ ] `bun run test`
- [ ] 手工冒烟（可选，如本地起 dev）：管理员监控页正常；用户端状态页只出现模型名。

## 回滚点

- 每个 Step 独立可编译；整体单 commit，回滚 `git revert <sha>` 即可，无迁移/数据回滚负担。

## AC ↔ Step 对照

| AC | 覆盖 |
|----|------|
| AC1/AC2 | Step 2（鉴权收紧；无路由集成测试基建，靠放行清单删除 + 代码审查保证） |
| AC3 | Step 3 输出键断言 + Step 4 无 channel 字段的响应契约 |
| AC4 | Step 5/6 |
| AC5 | Step 3 allowlist 单测 |
| AC6 | Step 2（管理端仍走 adminAuth + admin session；管理端代码零改动） |
| AC7 | Step 3 |
| AC8 | Step 8 |
