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

**What**: 路由文件只做「解析请求 → 调 service / repo → jsonError 或 c.json 返回」。跨渠道业务（模型解析、连通性测试、状态计算）在 `services/`，文件按子域命名（`channel-models.ts`、`channel-testing.ts`、`channel-repo.ts`、`channel-route.ts`、`channel-status.ts`）。

**Why**: services 层无 Context 依赖，Vitest 可直接单测（tests/ 目录的用例就是这么写的）。

---

## New file checklist

- [ ] 路由文件名 kebab-case，与挂载路径语义一致
- [ ] 新表：`db/schema.sql` 与 `migrations/NNNN_xxx.sql` 同一提交内同步（见 database-guidelines）
- [ ] 新中间件：放 `middleware/`，并在本文件与 AGENTS.md §7 补记
- [ ] 请求体类型用 `as XxxPayload | null` + `.catch(() => null)` 解析
