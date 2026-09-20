# implement.md — 渠道每格式独立端点覆盖

> 执行清单。锚点见 `research/recon-endpoints.md`；契约见 `design.md` 与 `.trellis/spec/api-worker/backend/channel-routing.md`。按 Phase 粒度提交（回滚点），每阶段末尾跑验证命令。

## Phase A — 数据层（回滚点 A：加列 + 纯新增）

- [ ] A1 迁移 `apps/worker/migrations/0023_channel_endpoint_overrides.sql`（单条 ALTER TABLE，design §2.1）+ schema.sql 同步。
- [ ] A2 `channel-types.ts`：`ChannelRow.endpoint_overrides: string | null`；`parseEndpointOverrides`（白名单键过滤 + 畸形容错 → `{}`）。
- [ ] A3 `channel-routing.ts`：`resolveEndpointBaseUrl(row, format)`（design §2.2 表；无覆盖分支必须与现行逻辑逐字节等价）。
- [ ] A4 `channel-repo.ts`：`ChannelInsertInput`/`ChannelUpdateInput` 增 `endpoint_overrides: string | null`；INSERT 列串+bind、UPDATE SET 串+bind 同步；**同步更新 `tests/channel-testing.test.ts` 的 INSERT 位置断言（args[2]/args[12]/args[13] 会位移）**。
- [ ] A5 `tests/channel-endpoints.test.ts`：parseEndpointOverrides（畸形 JSON / 白名单外键 / 正常）；resolveEndpointBaseUrl 矩阵（三格式 × 有/无覆盖 × 规范化形态；无覆盖与现行输出逐字节等价的对照断言）。
- [ ] 验证：`bun run typecheck && bun run test -- run`。

## Phase B — Worker 接线（回滚点 B；AC1 护栏在此验证）

- [ ] B1 proxy.ts：buildChannelRequest anthropic/responses/openai 三分支换 `resolveEndpointBaseUrl`（custom 不动）；querySuffix/cfSafeUrl/路径拼接零改动。
- [ ] B2 anthropic-proxy.ts：anthropic/openai 分支换 resolver（custom 分支不动）。
- [ ] B3 channel-testing.ts：`probeChannelFormat` 与 `fetchChannelModels` 改为按行片段逐格式 resolve（custom 过滤语义不变）；`/:id/test`、newapiChannels test 调用点适配（newapi 渠道无覆盖 → 行为不变）。
- [ ] B4 验证既有 URL 断言用例**零改动通过**（AC1）；新增覆盖生效用例：anthropic 覆盖 → `/v1/messages` 与 `/v1/models` 命中覆盖端点；responses 覆盖 → `/responses`；openai 覆盖 → `/chat/completions`（AC2/AC3/AC6）。
- [ ] 验证：`bun run typecheck && bun run test -- run`。

## Phase C — CRUD（回滚点 C）

- [ ] C1 `routes/channels.ts`：POST/PATCH 接受 `endpoint_overrides`（校验矩阵 + 三态 + 存储规范化，design §4）；校验所用的「生效 api_formats」= body 声明 ?? DB 现值；空对象存 NULL。
- [ ] C2 fetch_models / test-model：body 增 `endpoint_overrides` 透传解析；test-model 的 channelLike 补 `endpoint_overrides`。
- [ ] C3 newapiChannels：POST 存 NULL、PUT 保留现值（不透传）。
- [ ] C4 测试：校验矩阵四类 400、三态、规范化存储、fetch_models/test-model 覆盖透传。
- [ ] 验证：`bun run typecheck && bun run test -- run`。

## Phase D — UI（回滚点 D）

- [ ] D1 `core/types.ts`（ChannelForm 增 `endpoint_overrides`；Channel 增 wire 字段）+ `core/utils.ts parseEndpointOverrides`（与 worker 同构）。
- [ ] D2 ChannelsView：选中非 custom 格式渲染可选覆盖输入（placeholder 展示推导形态；未选中格式不渲染不提交）；AdminApp 回填/提交/拉模型/单模型测试链路带上（选中但清空 → 传 `""` 清除）。
- [ ] D3 验证：`bun run check && bun run typecheck && cd apps/ui && bun run build`。

## Phase E — 收尾

- [ ] E1 AGENTS.md：§8 增「每格式端点覆盖」条目（解析规则、校验、规范化）、§10 channels 域描述补列。
- [ ] E2 全量门禁：`bun run check && bun run typecheck && bun run test -- run`。
- [ ] E3 Phase 3：trellis-check 全范围验收 → channel-routing spec 增补「端点解析」节 → 提交、归档、journal。

## 风险文件与回滚

| 文件 | 风险 | 回滚 |
|---|---|---|
| `routes/proxy.ts` | 三个分支的 baseUrl 来源替换 | Phase B 独立提交 revert；AC1 既有用例护栏 |
| `services/channel-testing.ts` | 签名变更波及调用点 | 调用点清单见 recon §1c/1d |
| `tests/channel-testing.test.ts` | INSERT 位置断言位移 | Phase A 同步更新（机械） |

## task.py start 前检查

- [ ] prd.md / design.md / implement.md 已获用户审阅批准。
- [ ] implement.jsonl / check.jsonl 已含真实条目（无 `_example` 残留）。
