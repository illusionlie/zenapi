# Design — 渠道模型选择支持拉取与手动输入

## 架构与边界

复用既有 `fetchChannelModels` 服务，新增一个 **无副作用** 的 adminAuth 接口供「未保存渠道」拉取；前端在渠道编辑表单内增加「拉取 → 勾选 → 合并」交互，落点仍是现有 `models` textarea，保持下游（`ModelPricingEditor` / `handleChannelSubmit` / 后端 `models_json`）零改动。

```
[ChannelsView 表单]
   │ 用户点「拉取模型」
   ▼
AdminApp.handleFetchModels(channelForm)
   │ POST /api/channels/fetch_models  (adminAuth, session)
   │   body: { base_url, api_key, api_format, custom_headers }
   ▼
channels.ts  POST /fetch_models
   │ fetchChannelModels(baseUrl, apiKey, apiFormat, customHeadersJson)
   │   - openai:    GET {base}/models        Authorization: Bearer + x-api-key
   │   - anthropic: GET {normalizeBaseUrl(base)}/v1/models   x-api-key + anthropic-version
   │   - custom:    GET {base}               + custom headers
   ▼
{ ok, models: string[], elapsed }
   │ 前端展示选择弹层（复选框 + 搜索 + 全选）
   ▼ 用户确认
合并去重 → 追加到 channelForm.models textarea
   │ 既有 ModelPricingEditor / 保存逻辑不变
```

## 数据流与契约

### 后端接口 `POST /api/channels/fetch_models`

请求体（与创建/更新渠道同源字段）：
```jsonc
{
  "base_url": "https://api.openai.com/v1",
  "api_key": "sk-xxx",          // 可空字符串；多 key 取第一个
  "api_format": "openai",        // openai | anthropic | custom；缺省 openai
  "custom_headers": ""           // 可选 JSON 字符串，仅 custom 生效
}
```

响应：
```jsonc
{ "ok": true, "models": ["gpt-4o", "gpt-4o-mini"], "elapsed": 120 }
```
失败：`502 {"error":"channel_unreachable"}`。

实现要点（`channels.ts`）：
- 校验 `base_url` 非空；`api_key` 缺省空串。
- `api_format` 缺省 `"openai"`，强转为 `ChannelApiFormat`。
- base_url 规范化与 `POST /` / `PATCH /:id` 保持一致：`anthropic` 走 `normalizeBaseUrl`，其余 `trim().replace(/\/+$/,"")`；`custom` 直接用原值。
- `api_key` 取 `parseApiKeys(...)[0] ?? String(api_key)`（与 `:id/test` 一致，支持多 key 文本）。
- `custom_headers` 仅 `custom` 格式透传给 `fetchChannelModels`（服务内部已处理）。
- **不读写数据库**。

### 前端交互

#### 状态（AdminApp.tsx 新增）
```ts
const [fetchingModels, setFetchingModels] = useState(false);
const [fetchedModels, setFetchedModels] = useState<string[] | null>(null); // null = 弹层关闭
const [fetchedSearch, setFetchedSearch] = useState("");
const [selectedFetched, setSelectedFetched] = useState<Set<string>>(new Set());
```

#### 回调 `handleFetchModels`
- 前置校验：`channelForm.base_url.trim()` 为空 → `setNotice("请先填写 Base URL")` 并返回。
- `setFetchingModels(true)`；调 `apiFetch<{ ok, models: string[] }>("/api/channels/fetch_models", { method:"POST", body: JSON.stringify({ base_url, api_key, api_format, custom_headers }) })`。
- 成功：`setFetchedModels(result.models)`；`setSelectedFetched(new Set(result.models))`（默认全选）；`setFetchedSearch("")`。
- 失败：`setNotice(error.message)`。
- finally `setFetchingModels(false)`。

#### 回调 `confirmFetchedModels`
- 解析当前 `channelForm.models` 已有 ID 集合（`parseModelLines` 同款逻辑：取每行 `split("|")[0].trim()`）。
- 遍历 `selectedFetched`，跳过已存在 ID，其余以纯 ID 行追加到 textarea 末尾（若 textarea 非空且末尾无换行则先补 `\n`）。
- `setFetchedModels(null)` 关闭弹层；`setNotice("已加入 N 个模型")`。

#### UI（ChannelsView.tsx）
- 模型列表 label 行右侧加按钮「拉取模型」（`type="button"`，避免触发表单提交），loading 时禁用并显示「拉取中…」。
- 弹层：当 `fetchedModels !== null` 时渲染固定/绝对定位遮罩，内含：
  - 搜索框（过滤 `fetchedModels`，大小写不敏感 includes）。
  - 「全选 / 全不选」（作用于当前过滤后的可见集合）。
  - 模型列表（虚拟滚动非必须，模型数通常 < 数百；简单 map 即可），每项复选框 + 模型 ID。
  - 底部「确认加入（已选 N）」「取消」。
- 新增 props 透传：`fetchingModels`, `fetchedModels`, `fetchedSearch`, `selectedFetched`, `onFetchModels`, `onConfirmFetched`, `onCancelFetched`, `onFetchedSearchChange`, `onToggleFetched`。

## 兼容性

- 不改 `channels` 表 schema，无迁移。
- 不改 `models_json` 存储格式。
- 不改既有 `/api/channels/:id/test`（已保存渠道的连通测试 + 自动填充仍保留，作为列表页操作按钮）。
- 新接口路径 `/api/channels/fetch_models` 不会被 `/:id` 路由捕获（Hono 字面量路由优先于参数路由，且 `fetch_models` 非渠道 id 形态；实测确认 `POST /fetch_models` 与 `POST /:id/test` 不冲突——前者无 `/test` 后缀）。
- adminAuth 覆盖：`/api/channels/*` 已在 adminAuth 保护下（非放行清单），无需改 `index.ts`。

## 权衡

- **为何新建接口而非复用 newapi `POST /api/channel/fetch_models`**：后者走 newApiAuth（管理员密码 Bearer），管理端 session 调用需额外鉴权适配；且不支持 `api_format` / `custom_headers`。新建 adminAuth 接口与创建/更新同源同鉴权，最干净。
- **为何弹层而非直接 inline 覆盖**：需求明确「用户手动选择」；直接覆盖会丢失已有手动模型。弹层 + 默认全选 + 去重合并兼顾「自动获得」与「手动选择」。
- **为何只追加纯 ID 行**：上游 `/v1/models` 只返回 id，无定价信息；保留已有行的定价后缀，新行用纯 ID 由后续 ModelPricingEditor 编辑。

## 回滚

- 后端：删除 `channels.ts` 中 `POST /fetch_models` 路由块即可。
- 前端：移除 AdminApp 新增状态/回调与 ChannelsView 按钮/弹层及 props 透传。
- 无数据残留。
