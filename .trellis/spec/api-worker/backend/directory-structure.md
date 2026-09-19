# Directory Structure

> Worker package layout and the rules that keep it navigable.

---

## Layout

```
apps/worker/src/
  index.ts        # 入口：中间件链 + 路由挂载 + /health + SPA notFound 回退
  env.ts          # Bindings / Variables / AppEnv 类型（DB、CORS_ORIGIN、PROXY_* 等）
  routes/         # 每个挂载点一个文件，kebab-case（21 个领域路由）
  middleware/     # adminAuth / newApiAuth / tokenAuth / userAuth
  services/       # 领域业务逻辑（channel-*.ts 按子域拆分）
  utils/          # http.ts(jsonError)、url 规范化等纯函数
  db/schema.sql   # D1 全表 schema（建库事实来源）
apps/worker/migrations/  # NNNN_name.sql 编号迁移，d1_migrations 表跟踪
```

---

## index.ts 是唯一挂载点

### Convention: 路由先挂载、鉴权先核对，再写业务

**What**: 所有 `app.route()` 集中在 `index.ts`；`/api/*` 的 adminAuth 由内联中间件 + **放行清单**（`/api/auth/login`、`/api/channel*`、`/api/user*`、`/api/group*`、`/api/public*`、`/api/u/*`、`/api/recharge*`）控制。新增路由模块 = 新建 `routes/xxx.ts` + `index.ts` 加一行挂载 + 核对是否需要进放行清单。`/api/monitoring*` **不在**放行清单（管理员专用，2026-09 收紧：渠道名/渠道状态属管理侧敏感数据，曾匿名可读）；用户侧可用性走 `/api/u/monitoring`（见下方 Convention）。

**Why**: 挂载点分散会导致鉴权边界失控——放行清单只在此处可见。

### Convention: routes 薄壳，逻辑下沉 services

**What**: 路由文件只做「解析请求 → 调 service / repo → jsonError 或 c.json 返回」。跨渠道业务（模型解析、连通性测试、状态计算）在 `services/`，文件按子域命名（`channel-models.ts`、`channel-testing.ts`、`model-testing.ts`、`channel-repo.ts`、`channel-route.ts`、`channel-status.ts`）。

**Why**: services 层无 Context 依赖，Vitest 可直接单测（tests/ 目录的用例就是这么写的）。

### Convention: 管理端真实请求探测的固定组合

**What**: 凡向真实上游发对话请求的管理功能（Playground、渠道模型测试），固定复用同一条链路，禁止重新实现按格式的请求构建：

1. `buildChannelRequest(channelLike, "/v1/chat/completions", "", new Headers({"content-type": "application/json"}), bodyText, parsedBody, false, apiKey, null)` — `policy=null` 豁免全局头注入/剔除（见 proxy-headers.md），四种 `api_format` 全部由它分派；
2. 响应**仅 2xx** 过 `convertResponse(channelLike, response, false, "/v1/chat/completions")` 归一化为 OpenAI 风格（anthropic/responses 渠道不转换则 `choices` 提取必然落空）；非 2xx 直接走错误分支；
3. `AbortSignal.timeout(30_000)` 兜底；不写 usage、不扣费、不更新渠道测试状态。

**Why**: 按格式构建请求的分支逻辑（含 Chat↔Responses/Anthropic 转换器）有 24+ 单测兜底，重写必错且不可测。

### Convention: 探测/干跑类端点「表单即真相」

**What**: 测试未持久化实体配置的端点（`POST /api/channels/fetch_models`、`POST /api/channels/test-model`），body 显式提供的配置字段（`base_url/api_key/api_format/custom_headers`）一律覆盖库中值；`id` 可选，仅作库值回退。前端始终传表单当前值。

**Why**: 避免两个陷阱——「表单已改但测的是库中旧配置」的不一致，以及「未保存渠道无法测试」。与 PATCH 的部分覆盖语义同构。

### Convention: 批量上游探测 = 前端逐项调用 + worker-pool 并发

**What**: 需要对多个模型/渠道发真实上游请求的功能，API 按单对象设计（一请求一上游调用），批量调度由前端 worker-pool（并发 ~4）驱动；禁止后端单次调用内串/并发 N 个上游子请求。

**Why**: Workers 单次调用有子请求上限（免费版 50），批量接口选大渠道必炸；前端逐项调用各自独立 invocation（每请求 1 个子请求），且天然获得逐项实时结果与故障隔离。

### Convention: 用户可见监测端点的「无渠道泄露」不变量

**Scope / Trigger**: 任何面向用户/公开侧的监测、统计类端点（先例 `GET /api/u/monitoring`，`routes/user-api.ts`）。

**Signatures / Contracts**:
- `GET /api/u/monitoring?range=15m|1h|1d|7d|30d`（userAuth；SQL 只查 `usage_logs`，按 `COALESCE(model,'unknown')` 分组，**禁止 join `channels`**）。
- 范围解析统一走 `utils/monitoring.ts` 的 `resolveMonitoringRange(range)`（与 `routes/monitoring.ts` 共享 `RANGE_CONFIG`，两份配置必漂移）；`sqlSlice` 只能来自该固定表后拼入 `substr(...)`，原始 query 参数禁止进 SQL 文本。
- 响应形状 `ModelMonitoringData`（`summary` / `recentStatus` / `models[]` / `dailyTrends[]` / `range`），**键集合不得含** `channel_name` / `channel_id` / `api_format` / `error_message`——`error_message` 可能含上游端点信息，用户侧不提供 slot 下钻端点。
- 模型行与趋势行都必须过 `isModelAllowed(parseAllowlist(userRecord.allowed_models), model)`（NULL/空 = 不限制，精确匹配）；`summary`/`recentStatus` 为平台全局聚合，不过滤（不含任何名称，语义即平台健康度）。
- 行→响应映射、舍入（`Math.round(x*10000)/100`）、过滤集中在纯函数 `utils/model-monitoring.ts#buildModelMonitoring`，路由 handler 只做参数解析 + SQL + 调用。

**Validation & Error Matrix**: 未认证/他人 session → `userAuth` 401；非法 range → 归一为 7d（不报错）。

**Tests**: `tests/model-monitoring.test.ts`——舍入与零流量 null、行+趋势双过滤、`active_models` 计数、`JSON.stringify(payload)` 全文不含 `channel*`/`error_message` 的防回归断言（新增用户侧统计端点时照此补同构断言）。

**Wrong vs Correct**:
```ts
// Wrong：用户端统计直接复用管理端聚合（join channels 取渠道名做分组键）
SELECT c.name AS channel_name FROM usage_logs u JOIN channels c ON ...
// Correct：只按模型聚合，渠道身份永不出现在用户可见响应
SELECT COALESCE(model, 'unknown') AS model FROM usage_logs WHERE created_at >= ?
```

---

## New file checklist

- [ ] 路由文件名 kebab-case，与挂载路径语义一致
- [ ] 新表：`db/schema.sql` 与 `migrations/NNNN_xxx.sql` 同一提交内同步（见 database-guidelines）
- [ ] 新中间件：放 `middleware/`，并在本文件与 AGENTS.md §7 补记
- [ ] 请求体类型用 `as XxxPayload | null` + `.catch(() => null)` 解析
- [ ] 探测/干跑端点：body 配置字段覆盖库中值（「表单即真相」）；批量探测拆前端逐项调用（见上方两条 Convention）
