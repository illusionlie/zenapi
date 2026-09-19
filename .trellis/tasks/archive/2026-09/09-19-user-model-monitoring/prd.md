# 用户端监控改为模型可用性并收紧 monitoring 鉴权

## Goal

用户面板不再暴露渠道维度的可用性信息（渠道名、渠道状态、api_format、含上游语义的错误详情），
改为展示**模型可用性**；同时将 `/api/monitoring*` 从匿名可访问收紧为管理员专用，消除接口层面的渠道数据泄露。

## Background

现状（代码事实）：

1. 用户端「状态」标签页（`userTabs` 中 `id: "monitoring"`）与管理端共用 `MonitoringView` 组件和
   `/api/monitoring` 接口，按渠道名逐一展示 uptime 条、渠道状态、api_format，
   时间槽下钻（`/api/monitoring/slot-details`）还会返回含 `error_message` 的错误明细。
2. `/api/monitoring*` 在 `apps/worker/src/index.ts` 的 `adminAuth` 放行清单中
   （`p.startsWith("/api/monitoring")`），路由内无任何鉴权 —— 匿名可拿到全量渠道名/状态/错误详情。
3. `/api/u/models` 与 `/api/public/models` 的 `channels[].name` 属有意设计（按渠道定价展示），本次不动。

用户决策（已确认）：

- 用户端「状态」页**替换为模型可用性视图**（非直接删除）。
- `/api/monitoring` **收紧为管理员专用**。

## Requirements

- R1 用户端「状态」页不再出现任何渠道维度信息：渠道名、渠道 ID、渠道状态、api_format、错误消息明细。
- R2 用户端「状态」页展示模型可用性：整体状态横幅 + 汇总卡片 + 按模型的 uptime 条（成功率/请求数/延迟），
  支持与现有一致的 5 档时间范围切换（15m/1h/1d/7d/30d）。
- R3 新增 `GET /api/u/monitoring`（挂在现有 `userAuth` 之下），按模型聚合 `usage_logs`，
  响应中不得含渠道名/渠道 ID 字段；模型行按**用户级 `allowed_models` 白名单**过滤
  （语义与 `/api/u/models` 一致：NULL/空 = 不限制）。
- R4 `/api/monitoring` 与 `/api/monitoring/slot-details` 移出 `adminAuth` 放行清单，仅管理员可访问。
- R5 管理端监控页行为不变（管理端取数走 admin session token，`adminAuth` 天然放行）。
- R6 用户端不做时间槽下钻（不新增面向用户的错误详情端点，避免 `error_message` 上游信息外泄）。

## Acceptance Criteria

- [x] AC1 匿名 `GET /api/monitoring` 被拒绝（401/403），不再返回渠道数据。
- [x] AC2 用户 session token 请求 `GET /api/monitoring` 同样被拒绝（非管理员）。
- [x] AC3 用户 session token 请求 `GET /api/u/monitoring` 返回 200；对响应做全文检查，
      不含 `channel_name` / `channel_id` / `api_format` / `error_message` 字样。
- [x] AC4 用户端状态页渲染：状态横幅、汇总卡片、按模型的 uptime 条与范围切换，全程无渠道字样。
- [x] AC5 `allowed_models` 非空的用户只能看到清单内模型的可用性行；清单为空/NULL 的用户看到全部有流量的模型。
- [x] AC6 管理端监控页在收紧后功能不变（admin session 正常取数）。
- [x] AC7 聚合/过滤核心逻辑有单测（`tests/*.test.ts`）。
- [x] AC8 `bun run check && bun run typecheck && bun run test` 全绿。

## Out of Scope

- 模型广场（`/api/u/models`、`/api/public/models`）中按渠道定价展示的 `channels[].name`。
- 用户端 slot 级下钻 / 错误详情。
- 管理端 `MonitoringView` 的任何行为变更。
