# 实施计划：渠道模型测试

## 前置

- [ ] 阅读规范：`.trellis/spec/api-worker/backend/index.md`、`.trellis/spec/api-worker-ui/frontend/index.md` 及其引用细则（before-dev 流程）
- [ ] 分支：基于 `main`（trunk-based），单 feature 提交

## Step 1 后端：model-testing 服务纯函数 + 单测（TDD 优先）

- [ ] 新建 `apps/worker/src/services/model-testing.ts`
  - `MODEL_TEST_DEFAULT_PROMPT`、`MODEL_TEST_TIMEOUT_MS` 常量
  - `buildModelTestRequestBody(model, text)`
  - `parseModelTestResponse(response)`（含 200 字符截断）
- [ ] 新建 `tests/model-testing.test.ts`：请求体形状 / openai 成功体 / 无 choices 2xx / 非 JSON 2xx / 4xx / 截断
- [ ] 验证：`bun run test tests/model-testing.test.ts`

## Step 2 后端：settings 键 `model_test_prompt`

- [ ] `apps/worker/src/services/settings.ts`：仿 announcement 模式加 `MODEL_TEST_PROMPT_KEY` / `getModelTestPrompt`（空回退默认值）/ `setModelTestPrompt`
- [ ] `apps/worker/src/routes/settings.ts`：GET 响应加 `model_test_prompt`；PUT 处理 `body.model_test_prompt`
- [ ] 验证：`bun run typecheck`

## Step 3 后端：`POST /api/channels/test-model`

- [ ] `apps/worker/src/routes/channels.ts` 新增端点（复用 `getChannelById` / `buildChannelRequest` / `parseModelTestResponse`；policy 传 null；错误码 `model_test_invalid_request` / `channel_not_found`）
- [ ] 核对 `buildChannelRequest` 实际访问的 `ChannelRecord` 字段，构造最小渠道对象（必要时窄类型/断言，以 typecheck 为准）
- [ ] `AbortSignal.timeout` 兼容性确认；失败则降级 `AbortController + setTimeout`
- [ ] 验证：`bun run typecheck && bun run test`；`bun run dev:worker` 用 curl 对本地渠道发一次真实请求（openai 格式）

## Step 4 前端：类型 / 常量 / 设置页

- [ ] `apps/ui/src/core/types.ts`：`Settings` + `SettingsForm` 加 `model_test_prompt`；新增 `ModelTestStatus` / `ModelTestResult`
- [ ] `apps/ui/src/core/constants.ts`：`initialSettingsForm.model_test_prompt: ""`
- [ ] `apps/ui/src/features/SettingsView.tsx`：新增「模型测试文本」textarea（参照 announcement / proxy_headers 区块的样式与 ref 同步模式）
- [ ] `apps/ui/src/AdminApp.tsx`：`loadSettings` / `handleSettingsSave` 接入新字段
- [ ] 验证：`bun run dev:ui` 系统设置页保存并刷新回显

## Step 5 前端：编辑弹窗测试区块

- [ ] `apps/ui/src/AdminApp.tsx`：`modelTestResults` 状态 + `runModelTests`（并发 4 worker-pool + 停止标记）/ `stopModelTests` / `retryModelTest`；弹窗关闭时清理
- [ ] `apps/ui/src/features/ChannelsView.tsx`：编辑 Modal 内新增「模型测试」折叠区块
  - 模型多选（parsedModelIds + 搜索 + 全选）+ 测试文本（初始 settings 值，可临时改）+ 开始/停止 + 结果行（状态徽标/耗时/摘要/重试）+ 汇总
  - 空态（无模型）与禁用态（base_url/api_key 为空）
- [ ] 请求体始终携带表单当前 `base_url/api_key/api_format/custom_headers` 与 `editingChannel?.id`
- [ ] 验证：手工走查——新增模式测试 / 编辑模式测试 / 失败重试 / 停止 / 关弹窗清理

## Step 6 收尾

- [ ] `bun run check && bun run typecheck && bun run test` 全绿
- [ ] AGENTS.md / README 若涉及 API 清单变更：README「渠道管理」端点表补 `POST /api/channel/test-model`?（注意：本端点挂在 `/api/channels`，README 该表记录的是 `/api/channel` NewAPI 兼容端点——确认归档位置，必要时仅在 README `/api/channels` 相关节补充）
- [ ] 提交（Conventional Commits）：`feat(worker,ui): 渠道模型测试——编辑弹窗内嵌真实请求测试 + 全局测试文本设置`

## 验证命令汇总

```bash
bun run test tests/model-testing.test.ts
bun run check && bun run typecheck && bun run test
bun run dev:worker & bun run dev:ui   # 手工验收
```

## 回滚点

- 每 Step 一个逻辑单元；任一步失败可独立 revert。无 DB 迁移，回滚无数据残留。
