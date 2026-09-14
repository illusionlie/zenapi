# 执行计划 — 系统设置全局自定义请求头（注入/剔除）与渠道级统一

> 前置：PRD（需求/AC）与 design.md（技术方案）已定稿。
> 门禁命令：`bun run check && bun run typecheck && bun run test`
> 全程无需 D1 迁移、无需改 `index.ts`。

## Step 1 头策略核心模块（TDD）

- [ ] 新建 `apps/worker/src/utils/proxy-headers.ts`：
      `ProxyHeaderPolicy` 类型、`parseExtraHeaders`、`parseRemoveHeaders`、
      `loadProxyHeaderPolicy`、`applyHeaderPolicy`（签名见 design §4）。
- [ ] 新建 `tests/proxy-headers.test.ts`：parse 容错矩阵 + applyHeaderPolicy 顺序断言
      （design §9 条目 1–3）。先写测试（红），再实现（绿）。
- 验证：`bun run test -- proxy-headers`
- 回滚点：独立纯函数，可直接删除文件。

## Step 2 settings 读写链路

- [ ] `services/settings.ts`：新增 `get/setProxyExtraHeaders`、`get/setProxyRemoveHeaders`（存原文）。
- [ ] `routes/settings.ts`：GET 返回 `proxy_extra_headers` / `proxy_remove_headers`（默认 `""`）；
      PUT 校验（parse 失败 → 400 `invalid_proxy_extra_headers` / `invalid_proxy_remove_headers`）。
- 验证：`bun run typecheck`；dev 起服务 curl GET/PUT 冒烟。
- 回滚点：service/route 各自独立 revert。

## Step 3 代理链路接入（worker 核心）

- [ ] `proxy.ts`：
  - `buildChannelRequest` 末位加可选参数 `policy?: ProxyHeaderPolicy | null`；
  - 三分支 return 前统一 `applyHeaderPolicy(headers, policy, channel.custom_headers_json)`，
    custom 分支删除内联 merge；
  - handler 内 `loadProxyHeaderPolicy` 与渠道查询 `Promise.all` 并行，结果传入重试循环。
- [ ] `anthropic-proxy.ts`：handler 并行预载 policy；三分支 fetch 前调用 `applyHeaderPolicy`，
  custom 分支删除内联 merge。
- [ ] `playground.ts`：确认 `buildChannelRequest` 调用不传 policy，补豁免注释。
- [ ] 扩展 `tests/proxy-headers.test.ts`：`buildChannelRequest` 三格式矩阵（design §9 条目 4）。
- **Review 关口 A**：对照 design §2 接入矩阵逐分支核对；`bun run test` 全绿。
- 回滚点：Step 3 为单个逻辑单元，出问题整体 revert `proxy.ts` + `anthropic-proxy.ts`。

## Step 4 前端设置与渠道表单

- [ ] `core/types.ts`：`Settings` / `SettingsForm` 加 `proxy_extra_headers`、`proxy_remove_headers`。
- [ ] `core/constants.ts`：`initialSettingsForm` 补空串。
- [ ] `AdminApp.tsx`：`loadSettings` 映射（`?? ""`）+ `handleSettingsSubmit` 提交。
- [ ] `features/SettingsView.tsx`：两个 JSON 文本域（`lg:col-span-2`、`font-mono`、placeholder、
      作用范围/优先级/鉴权头覆盖警示文案，位置在公告字段之后）。
- [ ] `features/ChannelsView.tsx`：删除 `api_format === "custom"` 条件使渠道级字段常显，更新说明文案。
- 验证：`bun run dev:ui` + `dev:worker` 手动走查（见 Step 5）。

## Step 5 全量门禁 + 手动冒烟

- [ ] `bun run check && bun run typecheck && bun run test` 全绿（AC10）。
- [ ] 手动冒烟清单：
  - [ ] 系统设置保存合法/非法 JSON（AC1/AC2，非法被 400 拒绝）；
  - [ ] 配置注入 `{ "X-Trace-Id": "zen" }` + 剔除 `["user-agent"]`，
        用 openai 渠道走 `/v1/chat/completions`，上游（可用 httpbin 类回显服务或渠道日志）确认头生效（AC3）；
  - [ ] 同名头渠道级覆盖全局（AC5）；
  - [ ] Playground 请求不携带全局注入头（AC6）；
  - [ ] 渠道编辑弹窗三种格式下字段常显（AC7）。
- **Review 关口 B**：对照 PRD AC1–AC10 逐条勾验；跑 trellis-check。

## 提交拆分（Conventional Commits）

1. `feat(worker): 全局自定义请求头注入/剔除与渠道级 custom_headers 全格式生效`
   （Step 1–3 + 测试）
2. `feat(ui): 系统设置新增请求头注入/剔除配置，渠道级自定义请求头常显`
   （Step 4）
3. `chore(trellis): 归档任务与 spec 增补`（Phase 3 产物）

## 回滚策略

- 代码层：两个 feature commit 独立 revert。
- 数据层：无迁移；残留 settings 键无害，可在管理台清空两文本域即恢复默认行为。
