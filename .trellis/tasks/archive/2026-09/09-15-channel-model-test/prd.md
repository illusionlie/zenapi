# 渠道模型测试功能：编辑弹窗内嵌真实请求测试

## Goal

在渠道管理的「编辑渠道」弹窗内嵌一个「模型测试」区块：管理员勾选该渠道配置的若干模型后，系统向该渠道逐个模型发送真实对话请求，实时展示每个模型的成功/失败、耗时与响应摘要。全局默认「测试文本」在系统设置中自定义，弹窗内可临时覆盖。

## Background

- 现有 `POST /api/channels/:id/test` 仅做连通性探测（GET `/v1/models`），无法验证某个模型真实可对话（401/404/限流/模型不存在等问题探测不出来）。
- `playground.ts` 已验证可复用 `proxy.ts` 的 `buildChannelRequest` / `convertResponse` 按渠道 `api_format` 构建请求与转换响应；模型测试面向单一指定渠道，逻辑更简单（无权重排序、无重试轮询）。
- 用户已确认的决策：入口在编辑弹窗内嵌；前端逐模型并发调用（规避 Workers 子请求上限、结果实时呈现）；测试文本 = 全局设置默认值 + 弹窗内可临时覆盖。

## Requirements

### R1 后端测试端点

- 新增 `POST /api/channels/test-model`（挂载于 `/api/channels`，走现有 `adminAuth`，无需改放行清单）。
- 请求体：`{ id?, base_url?, api_key?, api_format?, custom_headers?, model, text? }`。
  - `id` 与 `base_url` 至少其一：有 `id` 读库取渠道配置；无 `id`（或同时提供）时以 body 中的配置为准。
  - 前端始终传编辑表单当前值：既支持「未保存的新渠道」直接测试，也避免「表单已改但测的是库中旧配置」的不一致。
  - `text` 缺省时服务端回退到 settings `model_test_prompt`。
- 按 `api_format`（openai / anthropic / responses / custom）构建非流式对话请求，发送 1 次，无重试轮询。
- 不记 usage、不扣费、不写渠道连通性测试结果、不受用户白名单/令牌体系影响（纯管理员工具）。

### R2 成功判定与结果回显

- HTTP 2xx 且能解析出回复内容 → `{ ok: true, elapsed, content }`（content 为模型回复文本摘要）。
- HTTP 2xx 但解析不出标准 choices（custom 格式上游可能返回任意 JSON/文本）→ 仍算成功，返回原始响应片段（截断）。
- 非 2xx 或网络错误/超时 → `{ ok: false, elapsed, error }`（含状态码与错误响应片段，截断）。
- 单模型测试超时上限 30 秒。

### R3 全局测试文本设置

- `settings` 表新增键 `model_test_prompt`（key-value，无需迁移）。
- `GET /api/settings` 返回该键；`PUT /api/settings` 支持更新（空值校验：允许任意非 null 字符串，trim 后为空则用默认值）。
- 系统设置页（SettingsView）新增「模型测试文本」编辑项，随现有设置保存流程持久化。
- 服务端内置默认文本（如「你好，请直接回复 OK 以确认服务可用。」），未配置时使用。

### R4 前端编辑弹窗内嵌测试区块

- 「编辑渠道」与「新增渠道」弹窗底部新增「模型测试」区块：
  - 候选模型 = 编辑表单模型 textarea 当前解析出的模型 ID 列表（`parseModelLines` 同源），支持关键字过滤与全选/反选。
  - 测试文本输入框：初始值取系统设置 `model_test_prompt`，本次运行可临时修改（不写回设置）。
  - 「开始测试」按钮：对勾选模型以固定并发（4 路）逐个调用测试端点，逐模型实时更新状态。
  - 每模型结果行：待测 / 测试中（loading）/ 成功（耗时 ms + 回复摘要）/ 失败（错误信息摘要）；支持对单个失败模型单独重测。
  - 顶部汇总：`x/y 成功`；测试进行中可「停止」后续未开始的测试。
- 无候选模型时显示空态提示；`base_url` 或 `api_key` 为空时禁用开始按钮并提示。

## Constraints

- Cloudflare Workers 环境：无 Node API；单次调用子请求上限是逐模型并发方案选择的根因（每模型一次独立 API 调用，各自在自己的 Worker 调用内，仅 1 个子请求）。
- 不发送 `max_tokens`（部分推理模型拒绝 `max_tokens`，要求 `max_completion_tokens`；测试成本由短测试文本控制）。
- 遵循 Biome（tab 缩进、双引号）、错误码 `ERR_{模块}_{含义}` 风格（沿用 channels 路由现有 error code 命名习惯，如 `model_test_invalid_request`）。
- 新增后端纯函数逻辑（请求体构建、响应判定）须有单测，置于 `tests/`。

## Non-Goals

- 不做定时/自动批量测试、不做测试历史持久化（结果仅存在于当前弹窗会话）。
- 不支持流式测试、不支持多模态（图片/音频）测试。
- 不在渠道列表行加测试入口（用户已选编辑弹窗内嵌）。

## Acceptance Criteria

- [ ] 编辑弹窗内可勾选模型并批量测试，结果逐模型实时呈现（成功含耗时与摘要，失败含原因）。
- [ ] 未保存的新渠道（表单已填 base_url/api_key）也能直接测试；`id` + 表单配置同时传递时以表单配置为准。
- [ ] openai / anthropic / responses 三种格式渠道测试请求正确构建并得到 OpenAI 风格回显；custom 格式 best-effort（2xx 即成功，附原始片段）。
- [ ] 系统设置页可配置全局测试文本并持久化；未配置时使用内置默认值；弹窗内覆盖只影响当次运行。
- [ ] 测试请求不产生 usage 记录、不扣费、不更新渠道连通性测试时间/状态。
- [ ] 并发受控（4 路），单个模型失败/超时不影响其他模型。
- [ ] `bun run check && bun run typecheck && bun run test` 全绿；新增逻辑单测覆盖请求体构建与成功判定。
