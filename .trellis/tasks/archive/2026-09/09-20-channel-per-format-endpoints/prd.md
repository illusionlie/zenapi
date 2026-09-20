# 渠道每格式独立端点覆盖

## Goal

让渠道的每个声明 API 格式可配独立端点（base_url 覆盖），覆盖 coding plan 类上游「不同协议挂在不同 URL 路径、彼此无推导关系」的形态（如 OpenAI 兼容端在 `…/v1`、Anthropic 兼容端在 `…/anthropic`）。`base_url` 保留为主端点与兜底，未覆盖的格式走现有路径推导，存量渠道零迁移感知。

上一任务（09-20-channel-multi-api-format，已归档）交付了多格式能力声明与统一路由矩阵；本任务是它的自然延伸——路由矩阵、转换器、偏好序全部复用，只换「目标格式 → 上游 URL」的解析层。

事实锚点见 `research/recon-endpoints.md`；技术方案见 `design.md`。

## Requirements

- **R1 数据模型**：channels 新增 `endpoint_overrides` JSON 对象列（键白名单 `openai` / `responses` / `anthropic`；`custom` 语义是 base_url 即完整 URL，不可覆盖）；迁移 `0023` 加列，存量渠道为 NULL、行为不变。
- **R2 解析收口**：新增 `resolveEndpointBaseUrl(row, format)` 纯函数——覆盖存在时用覆盖值（anthropic 覆盖走 `normalizeBaseUrl` 语义，openai/responses 覆盖走 trim+去尾斜杠语义），无覆盖时输出与现行各分支逻辑**逐字节一致**；全部 URL 解析点（buildChannelRequest 各格式分支、anthropic-proxy 三分支、逐格式探测、fetch_models / test-model）统一改走该函数。
- **R3 CRUD**：POST/PATCH 接受 `endpoint_overrides`（未知键 / `custom` 键 / 未在 `api_formats` 中声明的键 / 非 http(s) 前缀 → 400 `invalid_endpoint_overrides`；三态：undefined 保留、空串/null 清除该键、非空值设置）；存储规范化按字段语义（anthropic 覆盖 `normalizeBaseUrl`，其余 trim+去尾斜杠）；New API 兼容层不透传（插入 NULL、PUT 保留现值）。
- **R4 探测与测试工具**：连通性测试与模型拉取对每个声明格式用**其解析后端点**探测（anthropic 覆盖端点探 `{norm}/v1/models`）；fetch_models / test-model 请求体接受 `endpoint_overrides` 并参与解析；`/:id/test` 用渠道行解析。
- **R5 UI**：选中非 custom 格式 chip 时出现对应的可选「端点覆盖」输入（留空 = 从 base_url 推导，placeholder 展示推导形态）；提交/回填/拉模型/单模型测试全链路带上；列表徽章不受影响。
- **R6 文档**：AGENTS.md §8/§10 同步；`.trellis/spec` 的 channel-routing spec 增补端点解析契约（Phase 3 沉淀）。

## Acceptance Criteria

- [ ] AC1 零回归：所有既有断言上游 URL 的测试用例**不改一行**通过（无覆盖时解析输出 byte-identical）。
- [ ] AC2 anthropic 覆盖：渠道声明 `["openai","anthropic"]` + anthropic 覆盖 `https://x.example/api/anthropic` → anthropic 入站请求打 `{norm(override)}/v1/messages`，anthropic 探测打 `{norm(override)}/v1/models`；chat 入站不受覆盖影响，仍走 base_url。
- [ ] AC3 openai/responses 覆盖：responses 覆盖时 `/v1/responses` 入站打 `{override}/responses`；openai 覆盖时 chat 入站打 `{override}/chat/completions`（转换）与 `{override}{subPath}`（透传路径）。
- [ ] AC4 CRUD 校验矩阵：未知键、`custom` 键、未声明格式键、非 http(s) 值均 400 `invalid_endpoint_overrides`；三态语义生效（undefined 保留 / 空串·null 清除 / 值设置）；anthropic 覆盖入库经 normalizeBaseUrl，其余保留版本路径。
- [ ] AC5 迁移 `0023` 可重放，存量渠道 `endpoint_overrides` 为 NULL 且行为与迁移前一致。
- [ ] AC6 探测分端点：多格式渠道部分格式覆盖后，各格式探针命中各自端点（`Promise.allSettled` 并集语义不变）。
- [ ] AC7 UI：选中格式出现覆盖输入框、留空回退 base_url 提交为空（清除语义）、回填正确显示已存覆盖；`bun run check / typecheck / test` 与 UI 构建全绿。
- [ ] AC8 新增单测：resolver 纯函数矩阵（覆盖优先 / 兜底 byte-identical / 两种规范化）、CRUD 校验、探测分端点；既有 INSERT 位置断言更新后通过。

## Out of Scope

- 每格式独立 API Key（coding plan 通常一个 plan key 通吃；如某上游分端点发 key，另行立项）。
- `custom` 格式的端点覆盖（base_url 即完整 URL，语义冲突）。
- New API 兼容层透传 `endpoint_overrides`（PUT 保留现值即可）。
- 按格式的模型清单 / 模型-格式亲和路由（延续上一任务的 Out of Scope）。
- `previous_response_id` 等状态语义（不变）。
