# 技术设计：渠道模型测试

## 1. 总体架构与数据流

```
[ChannelsView 编辑弹窗]                [AdminApp]                     [Worker /api/channels]
┌──────────────────────┐   props   ┌──────────────────┐   fetch   ┌─────────────────────┐
│ 模型多选 + 测试文本    │──────────▶│ runModelTests()  │──────────▶│ POST /test-model     │
│ 开始/停止 + 结果行    │◀──────────│ 并发4 + 状态机    │◀──────────│ buildChannelRequest  │
└──────────────────────┘  逐个回调  └──────────────────┘  逐个响应  │ → fetch → convert判定 │
                                                                    └─────────────────────┘
[SettingsView] → PUT /api/settings {model_test_prompt} → settings 表
```

一次模型测试 = 一次独立 HTTP 调用 = 一次独立 Worker invocation（1 个子请求），前端控制并发上限 4。规避单次调用 50 子请求上限；任何一模型失败不波及他人。

## 2. 后端设计（api-worker）

### 2.1 新文件 `apps/worker/src/services/model-testing.ts`

纯逻辑层，可单测：

```ts
// 构建发往 buildChannelRequest 的 OpenAI 风格请求体
export function buildModelTestRequestBody(model: string, text: string): {
	bodyText: string; parsedBody: Record<string, unknown>;
}
// → { model, messages: [{ role: "user", content: text }], stream: false }
// 不含 max_tokens / stream_options（推理模型兼容性，见 prd Constraints）

// 判定响应结果（非流式）
export type ModelTestOutcome =
	| { ok: true; content: string }
	| { ok: false; error: string };

export async function parseModelTestResponse(
	response: Response,
): Promise<ModelTestOutcome>
// response.ok：
//   解析 JSON → choices[0].message.content 为非空 string → ok:true, content（截断 200 chars）
//   JSON 但无 choices（或 custom 格式任意结构）→ ok:true, content = 原始 body 截断 200 chars
//   JSON 解析失败 → ok:true, content = 原始文本截断 200 chars（custom best-effort）
// !response.ok → ok:false, error = `HTTP {status}: {body 截断 200 chars}`
// 异常（网络）→ ok:false, error = 异常消息

export const MODEL_TEST_TIMEOUT_MS = 30_000;
export const MODEL_TEST_DEFAULT_PROMPT = "你好，请直接回复 OK 以确认服务可用。";
```

### 2.2 路由 `apps/worker/src/routes/channels.ts` 新增端点

```
POST /api/channels/test-model
```

- 鉴权：随 `/api/channels` 走 `adminAuth`（`index.ts` 放行清单不含 `/api/channels`，无需改动）。
- Body 校验：`model` 必填；`id` 与 `base_url` 至少其一 → 否则 400 `model_test_invalid_request`。
- 渠道配置解析：有 `id` → `getChannelById`（404 `channel_not_found`）；body 显式提供 `base_url` / `api_key` / `api_format` / `custom_headers` 时**覆盖**库中值（表单即真相，支持未保存渠道与脏表单）。
- 执行：
  ```ts
  const { bodyText, parsedBody } = buildModelTestRequestBody(model, text);
  const { target, headers, body } = buildChannelRequest(
      channelLike, "/v1/chat/completions", "",
      new Headers({ "content-type": "application/json" }),
      bodyText, parsedBody, false, apiKey, null,   // policy=null：豁免全局头注入/剔除（同 Playground）
  );
  const start = Date.now();
  const response = await fetch(target, { method: "POST", headers, body,
      signal: AbortSignal.timeout(MODEL_TEST_TIMEOUT_MS) });
  const outcome = await parseModelTestResponse(response);
  return c.json({ ...outcome, elapsed: Date.now() - start });
  ```
- `channelLike` 类型：`buildChannelRequest` 入参是 `ChannelRecord`；构造一个满足其字段访问的最小对象（base_url/api_key/api_format/custom_headers_json）。若类型要求全字段，用 `as unknown as ChannelRecord` 或在 model-testing.ts 定义入参窄类型——实现时以 typecheck 为准。
- `text` 缺省 → `getModelTestPrompt(db)`（settings 服务），再缺省 → `MODEL_TEST_DEFAULT_PROMPT`。
- 不调用 `updateChannelTestResult`，不写 usage_logs。

### 2.3 settings 扩展 `apps/worker/src/services/settings.ts` + `routes/settings.ts`

- 仿照 `ANNOUNCEMENT_KEY` 模式：`MODEL_TEST_PROMPT_KEY = "model_test_prompt"`，`getModelTestPrompt`（空返回 `MODEL_TEST_DEFAULT_PROMPT`）/`setModelTestPrompt`。
- `GET /` 响应加 `model_test_prompt`；`PUT /` 支持 `body.model_test_prompt`（`typeof string` 即接受，`String(body)` 存库；trim 空串存空串，读取时回退默认值——保持与 announcement 一致的宽容语义）。
- `settings` 表为 key-value，**无需迁移**。

## 3. 前端设计（api-worker-ui）

### 3.1 类型与常量

- `core/types.ts`：`Settings` 加 `model_test_prompt: string`；`SettingsForm` 加 `model_test_prompt: string`；新增
  ```ts
  export type ModelTestStatus = "pending" | "running" | "success" | "failed";
  export type ModelTestResult = { status: ModelTestStatus; elapsed?: number; content?: string; error?: string };
  ```
- `core/constants.ts`：`initialSettingsForm.model_test_prompt: ""`。

### 3.2 AdminApp.tsx（状态与处理器）

- 设置加载/保存流程追加 `model_test_prompt` 字段（`loadSettings` / `handleSettingsSave` 的 PUT body）。
- 新增状态 `modelTestResults: Record<string, ModelTestResult>` 与运行标记；处理器：
  - `runModelTests(models: string[], text: string)`：初始化全部为 `pending` → 并发池 4（简单 worker-pool：递归取下一个）逐个 `apiFetch("/api/channels/test-model", { method: "POST", body: { id: editingChannel?.id, base_url, api_key, api_format, custom_headers, model, text } })`，每个完成即写入该模型结果触发渲染；组件卸载/弹窗关闭时通过 abort 标记停止调度未开始项。
  - `stopModelTests()`：置停止标记，未开始的保持 `pending` 并结束。
  - `retryModelTest(model, text)`：单模型重测（复用同一执行函数）。
- 传参给 ChannelsView：`modelTestResults`、`modelTestRunning`、`onRunModelTests`、`onStopModelTests`、`onRetryModelTest`、`modelTestPrompt`（settings 值，作初始文本）。

### 3.3 ChannelsView.tsx（编辑弹窗内嵌区块）

- 位置：渠道编辑 Modal 表单内、底部按钮区之前，折叠面板（`<details>` 或受控折叠，与别名编辑器视觉风格一致）。
- 组成：
  - 候选模型列表：复用 `parsedModelIds`（表单 textarea 解析），本地 `useState` 勾选集合 + 搜索过滤 + 全选/反选（交互仿 fetched-models 弹窗）。
  - 测试文本 `<textarea>`：`useState` 初始值 = props 传入的 settings 值（弹窗打开时随 `editingChannel` 变化重置）。
  - 「开始测试」：无勾选 / `base_url` 或 `api_key` 为空 → 按钮 disabled + 提示文案；运行中变为「停止」。
  - 结果列表：每模型一行，状态徽标（pending 灰 / running 琥珀 spin / success 绿 `823ms · OK…` / failed 红 `HTTP 401: …`），失败行尾「重试」按钮。
  - 汇总行：`{success}/{total} 成功`。
- 新增渠道模式同样渲染（base_url/api_key 已填即可测），无模型的空态提示「请先在上方填写模型列表」。

## 4. 关键取舍

| 决策 | 选择 | 理由 | 放弃项 |
|------|------|------|--------|
| 执行模型 | 前端逐模型调用（并发 4） | 规避 Workers 子请求上限；实时逐个出结果；故障隔离 | 后端批量（上限风险 + 长阻塞） |
| 入站配置 | body 传表单当前值，id 可选 | 未保存渠道可测；表单脏状态不撒谎 | 仅按 id 读库（脏表单陷阱） |
| 请求形态 | 非流式、无 max_tokens、单次无重试 | 推理模型兼容；实现最小；重试交给用户按钮 | 流式（需 SSE 解析）；自动重试（掩盖真实失败） |
| 成功判定 | 2xx 即成功，尽力解析 content | custom 格式上游结构不可知；与 playground best-effort 一致 | 强校验 choices（custom 必假阴性） |
| 结果持久化 | 无（组件内存） | Non-Goal；避免新表/迁移 | usage_logs / 新表 |
| 超时 | AbortSignal.timeout(30s) | 防止挂死并发池；Workers 支持 | 无限等待 |

## 5. 兼容性与回滚

- 纯新增：新端点、新 settings 键、新 UI 区块。无 schema 变更、无既有接口签名变更；旧客户端不受影响（settings 响应新增字段向后兼容）。
- 回滚 = revert 提交即可，无数据残留（settings 键残留无害）。
- 风险点：
  - `AbortSignal.timeout` 在 Workers 运行时可用（兼容性日期足够新）；若 typecheck 报错则降级为 `AbortController + setTimeout` 手动实现。
  - `buildChannelRequest` 对 `ChannelRecord` 的字段依赖面：实现时核对其内部访问的字段（base_url/api_key/api_format/custom_headers_json），构造最小对象或放宽入参类型。
  - 上游限流（429）：并发 4 已缓解；失败行提供手动重试，不做自动退避。

## 6. 测试策略

- 单测 `tests/model-testing.test.ts`（新增）：
  - `buildModelTestRequestBody`：请求体形状（model/messages/stream:false），不含 max_tokens。
  - `parseModelTestResponse`：构造 `Response` 桩——openai 成功体 / 无 choices 的 2xx JSON / 非 JSON 2xx / 4xx 错误体 / 截断行为。
  - settings 默认值回退（如现有测试模式允许 mock D1；若成本高则以纯函数为主）。
- 既有 `tests/` 回归：`bun run test`。
- 手工验收：本地 `dev:worker + dev:ui`，对 openai 与 anthropic 格式渠道各测一例，验证设置页保存与弹窗覆盖。
