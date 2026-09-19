# 技术设计：用户端监控改为模型可用性并收紧 monitoring 鉴权

## D1 鉴权边界（worker）

`apps/worker/src/index.ts` 的 `adminAuth` 放行清单中删除 `p.startsWith("/api/monitoring")` 一行。
此后 `/api/monitoring*` 落入 `adminAuth`，匿名与用户 session 均被拒（AC1/AC2）。

- 管理端无感：`AdminApp` 的 `createApiFetch` 携带 admin session token，
  `adminAuth` 接受 `Authorization: Bearer {session}`（AGENTS.md §7），管理端监控页零改动（AC6）。
- 部署间隙（新 worker + 旧 UI）用户端状态页会短暂显示「暂无数据」
  （MonitoringView 对非 2xx 静默忽略、`monitoring` 保持 null），可接受，随前端一起部署即消失。

## D2 共享范围配置抽取（worker）

`routes/monitoring.ts` 顶部的 `RANGE_CONFIG` 提取到新文件 `apps/worker/src/utils/monitoring.ts`：

```ts
export const RANGE_CONFIG: Record<string, { ms: number; sqlSlice: number }>;
export function resolveMonitoringRange(range: string | undefined | null): {
	ms: number;
	sqlSlice: number;
};
```

`routes/monitoring.ts` 改为导入（行为不变，纯移动）；新端点复用，杜绝两份配置漂移。

## D3 新端点 `GET /api/u/monitoring`（worker，userAuth）

落在 `routes/user-api.ts`（该 router 已 `userApi.use("/*", userAuth)`，天然满足 R3/R6）。

查询参数：`range`（15m/1h/1d/7d/30d，缺省 `7d`，经 `resolveMonitoringRange` 归一）。

SQL（全部只查 `usage_logs`，**不 join `channels`**，按 `COALESCE(model,'unknown')` 分组）：

1. 范围内按模型汇总：requests / success / errors / avg_latency / MAX(created_at) AS last_seen
2. 范围内按模型 × 时间槽趋势（`substr(created_at,1,sqlSlice)`，同管理端 slotExpr 逻辑）
3. 全局汇总（范围内）与近 15 分钟全局汇总（recentStatus 语义与管理端一致）
4. 近 15 分钟按模型汇总（填充 `recent_success_rate` / `recent_avg_latency_ms`）

白名单过滤（与 `/api/u/models` 同语义）：`parseAllowlist(userRecord.allowed_models)` 得 `allowlist`，
对模型行与趋势行逐条 `isModelAllowed(allowlist, model)` 过滤（复用 `utils/model-allowlist`，精确匹配、NULL/空 = 不限制）。
过滤同时作用于行与趋势，保证响应体内不残留受限模型名（AC5）。

纯函数聚合便于单测：`apps/worker/src/utils/model-monitoring.ts` 导出

```ts
export type ModelMonitoringInput = {
	modelRows: Row[]; trendRows: Row[]; globalRow: Row | null;
	recentRow: Row | null; recentModelRows: Row[];
	allowlist: string[] | null; range: string;
};
export function buildModelMonitoring(input: ModelMonitoringInput): ModelMonitoringPayload;
```

负责行→响应映射、成功率舍入（`Math.round(x*10000)/100`，与管理端一致）、allowlist 过滤、`active_models` 计数。
路由 handler 只做参数解析、四条 SQL、调用聚合。

响应契约（**无任何 channel 字段**）：

```jsonc
{
	"summary": {
		"total_requests": 0, "total_success": 0, "total_errors": 0,
		"avg_latency_ms": 0, "success_rate": 100, "active_models": 0
	},
	"recentStatus": { "total_requests": 0, "total_success": 0, "total_errors": 0,
		"avg_latency_ms": 0, "success_rate": 100 },
	"models": [ { "model": "gpt-4o", "total_requests": 0, "success_count": 0, "error_count": 0,
		"success_rate": null, "avg_latency_ms": 0, "last_seen": null,
		"recent_success_rate": null, "recent_avg_latency_ms": null } ],
	"dailyTrends": [ { "model": "gpt-4o", "day": "...", "requests": 0, "success": 0,
		"errors": 0, "success_rate": 0, "avg_latency_ms": 0 } ],
	"range": "15m"
}
```

设计取舍：

- `summary` 不含 `total_models` 分母：可见模型全集需走 `listActiveChannels` + 定价提取，代价高且与
  「服务状态」语义无关；卡片只展示「有流量模型数」。
- `summary` / `recentStatus` 为平台全局聚合（不受 allowlist 过滤）：状态页语义是平台健康度，聚合数不含任何模型/渠道名。
- 不提供用户侧 slot-details：`error_message` 可能含上游端点信息，不做面向用户的错误明细端点（R6）。

## D4 前端类型（apps/ui）

`core/types.ts` 新增 `ModelMonitoringModel` / `ModelMonitoringTrend` / `ModelMonitoringData`（结构同 D3 契约）。
现有 `MonitoringData` 等管理端类型不动；`UserApp` 不再 import `MonitoringData`。

## D5 前端共享工具抽取（apps/ui）

`MonitoringView.tsx` 内部的三个纯函数提取到 `apps/ui/src/features/monitoring-shared.ts`：
`generateSlots(range)` / `formatSlotLabel(slot, range)` / `barColor(rate)`。
`MonitoringView.tsx` 改为导入（纯移动，管理端渲染零变化）；新视图同样导入，避免槽位逻辑三份漂移。

## D6 新视图 `ModelMonitoringView.tsx`（apps/ui）

`features/ModelMonitoringView.tsx`，props：`{ monitoring: ModelMonitoringData | null; token: string | null; onLoaded }`
（与 MonitoringView 同构，内部自取数、范围切换、`onLoaded` 回升状态到 UserApp）。

- 状态横幅：同管理端阈值（≥99 正常 / ≥95 降级 / 其余异常），基于 `recentStatus`。
- 汇总卡片：近 15m 成功率、平均延迟（附 `summary.total_requests` 次请求）、有流量模型数（`summary.active_models`）。
- 按模型 uptime 条：`trendMap` key 为 `model|slot`，条色 `barColor(success_rate)`；
  条为非交互 div（R6，无下钻、无 hover 详情面板），底部保留范围起止标签。
- 空态：`monitoring === null` 时显示「暂无数据」卡片（同管理端样式）。

## D7 UserApp 接线（apps/ui）

- `UserApp.tsx`：`MonitoringView` → `ModelMonitoringView`；`monitoring` state 类型改 `ModelMonitoringData | null`；
  `loadMonitoring` 请求 `/api/u/monitoring?range=15m`（走 `apiFetch`，自动带用户 session）。
- `core/constants.ts` 的 `userTabs` 不变（`id: "monitoring"`、label「状态」，id 稳定性优先）。
- `userTabToSkeletonVariant.monitoring` 保持 `"generic"`。

## D8 文档同步

AGENTS.md：
- §6 放行清单句：从「不走 adminAuth」列表中删去 `/api/monitoring*`；
- §6 `/api/monitoring` 行职责改为「渠道健康 / 成功率 / 延迟（管理员专用）」；
- §6 `/api/u` 行职责补「模型可用性监测」。

## D9 兼容与回滚

- 无 DB 迁移、无 settings 变更；单 commit 粒度，回滚 = `git revert`。
- 旧 UI + 新 worker：用户端状态页短暂「暂无数据」（见 D1）；新 UI + 旧 worker：404 静默空态。均无崩溃路径。
