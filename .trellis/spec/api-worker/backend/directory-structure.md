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

**What**: 所有 `app.route()` 集中在 `index.ts`；`/api/*` 的 adminAuth 由内联中间件 + **放行清单**（`/api/auth/login`、`/api/channel*`、`/api/user*`、`/api/group*`、`/api/public*`、`/api/u/*`、`/api/recharge*`、`/api/monitoring*`）控制。新增路由模块 = 新建 `routes/xxx.ts` + `index.ts` 加一行挂载 + 核对是否需要进放行清单。

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

---

## New file checklist

- [ ] 路由文件名 kebab-case，与挂载路径语义一致
- [ ] 新表：`db/schema.sql` 与 `migrations/NNNN_xxx.sql` 同一提交内同步（见 database-guidelines）
- [ ] 新中间件：放 `middleware/`，并在本文件与 AGENTS.md §7 补记
- [ ] 请求体类型用 `as XxxPayload | null` + `.catch(() => null)` 解析
- [ ] 探测/干跑端点：body 配置字段覆盖库中值（「表单即真相」）；批量探测拆前端逐项调用（见上方两条 Convention）
