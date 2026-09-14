# 系统设置全局自定义请求头（注入/剔除）与渠道级统一

## Goal

为 ZenAPI 增加**系统级（全局）自定义请求头策略**：管理员在「系统设置」中配置
① **额外注入请求头**（所有代理上游请求附带）与 ② **剔除请求头**（客户端透传头不转发给上游）；
同时将已存在的**渠道级** `custom_headers_json` 统一扩展到全部 api_format 生效，
消除「仅 custom 格式渠道生效且 UI 隐藏」的不一致。

## Background（现状盘点）

- 渠道级 `custom_headers_json` 后端仅在三处 custom 分支生效（`proxy.ts` / `anthropic-proxy.ts`），
  openai 透传分支与 anthropic 分支（含 `/anthropic/v1` 下白名单式构造的 fresh Headers 分支）均忽略。
- 渠道编辑 UI 的「自定义请求头 (JSON)」文本域仅在 `api_format === "custom"` 时渲染
  （`ChannelsView.tsx` 条件渲染），用户几乎不可能发现。
- 系统设置为 `settings` KV 表 + `services/settings.ts` 读写函数 + `routes/settings.ts` GET/PUT +
  `SettingsView.tsx` 表单的成熟模式，本任务完全复用，**无 D1 迁移**。
- `playground.ts` 复用 `buildChannelRequest`；`channel-testing.ts` 的连通性测试已应用渠道级 custom headers。

## Requirements

### R1 全局额外注入请求头
- 管理台「系统设置」新增配置项，JSON 对象形式（`{"Name": "Value"}`），存储于 `settings` 表。
- 生效范围：仅 `/v1/*` 与 `/anthropic/v1/*` 计费代理链路，覆盖渠道的全部三种 api_format 分支
  （openai 透传 / anthropic / custom，含 `/anthropic/v1` 下三个分支）。
- **豁免**：Playground 对话测试、渠道连通性测试、模型拉取不应用全局注入。
- 注入发生在系统内置头（`Authorization` / `x-api-key` / `anthropic-version` / `content-type` 等）设置之后，
  即全局注入可覆盖内置头（管理员显式配置优先；UI 提供警示文案）。

### R2 全局剔除请求头
- 管理台「系统设置」新增配置项，JSON 字符串数组形式（`["Name1", "Name2"]`）。
- 生效范围同 R1；剔除在构造上游请求头时最先执行（对透传式分支有实际效果；
  对 `/anthropic/v1` 下 fresh Headers 分支天然 no-op，但统一调用保持一致性）。
- 豁免范围同 R1。

### R3 渠道级 custom_headers 统一
- 后端：`custom_headers_json` 在 openai / anthropic 分支同样生效（现状仅 custom 分支）。
- 前端：渠道编辑弹窗的「自定义请求头 (JSON)」字段对三种 api_format 常显，不再隐藏。
- 优先级：**渠道级 > 全局注入 > 系统内置头**（同名头后应用者赢；保持现状 custom 分支「渠道级可覆盖鉴权头」的能力不回退）。

### R4 配置校验与容错
- 写入（PUT /api/settings）严格校验：注入必须是「值为全字符串的 JSON 对象」，剔除必须是「字符串数组」；
  非法返回 400，错误码沿用 settings 现有 snake_case 风格。
- 读取宽容：缺失 / 空串 / 解析失败一律视为空配置，不影响代理请求。

### R5 零回归
- 两项全局配置均未设置时，所有请求头行为与现状一致。
- 渠道级已有 custom_headers_json 的 custom 渠道行为不回退。

## Constraints

- 不新增 D1 表 / 迁移文件（复用 `settings` KV 表）。
- 不改变路由挂载点与鉴权边界（`index.ts` 无需改动）。
- 每代理请求至多新增一次 settings 读取，且应与渠道查询并行发起。
- 遵循 Biome（tab 缩进、双引号）；前端 `hono/jsx/dom`；错误码 snake_case。

## Acceptance Criteria

- [ ] AC1 管理台「系统设置」可见「额外注入请求头」「剔除请求头」两个 JSON 文本域，保存后刷新回显一致。
- [ ] AC2 注入配置非对象 / 值含非字符串、剔除配置非字符串数组时，保存被 400 拒绝且错误码可辨识。
- [ ] AC3 `/v1/*` 请求：三种 api_format 渠道，上游收到的请求头含全部全局注入头；被剔除的客户端头不出现在上游请求中。
- [ ] AC4 `/anthropic/v1/*` 请求：三个上游分支同样满足 AC3。
- [ ] AC5 同名头优先级实测为：渠道级 > 全局注入 > 内置头。
- [ ] AC6 Playground 与渠道连通性测试 / 模型拉取的请求不含全局注入头（渠道级照常）。
- [ ] AC7 渠道编辑弹窗三种格式下均显示「自定义请求头 (JSON)」，openai/anthropic 渠道配置后代理请求实际生效。
- [ ] AC8 两项全局配置为空时请求头行为与 main 分支现状一致（code review + 单测基线断言）。
- [ ] AC9 新增头处理逻辑（解析校验、剔除→注入→渠道级合并顺序、三格式矩阵）有 Vitest 单测。
- [ ] AC10 `bun run check && bun run typecheck && bun run test` 全绿。

## Out of Scope

- 按渠道粒度配置全局头豁免（如「此渠道不套用全局头」开关）。
- 头值模板变量（如 `{token}` 插值）。
- 响应方向（上游 → 客户端）的头处理。
