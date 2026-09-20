# Channel Routing（services/channel-routing.ts + 渠道格式声明契约）

> 渠道多格式能力声明与入站路由判定。改动 `channel-routing.ts`、`channel-types.ts` 格式相关函数、channels 表格式列、或渠道 CRUD 的格式校验前必读。
> 沉淀自任务 09-20-channel-multi-api-format（2026-09-20）；行为摘要见 AGENTS.md §8。

## 1. Scope / Trigger

- 渠道格式能力声明（`api_formats`）是 DB schema + API 契约 + 路由判定 + UI 交互的跨层契约，命中 code-spec 强制深度。
- 触发场景：新增格式枚举值、改偏好序、动镜像列/双写、改 CRUD 格式校验、改 base_url 存储规范化。

## 2. Signatures

```ts
// services/channel-routing.ts
export type InboundProtocol = "chat" | "responses" | "anthropic" | "passthrough";
export function inboundProtocolForPath(path: string): InboundProtocol; // 大小写不敏感前缀匹配，镜像 legacy 语义
export function selectTargetFormat(
	declared: ChannelApiFormat[],
	inbound: InboundProtocol,
): ChannelApiFormat | null; // null = 渠道对该入站不合格

// services/channel-types.ts
export function parseApiFormats(row: ApiFormatsSource): ChannelApiFormat[]; // 读侧三级兜底
export function normalizeApiFormats(input: unknown):
	| { ok: true; value: ChannelApiFormat[] }
	| { ok: false; reason: "not_array" | "empty" | "custom_exclusive" };

// DB（迁移 0022）：channels.api_formats TEXT（JSON 数组）+ channels.api_format TEXT（镜像 = 规范序首元素，repo 层双写）
```

消费点（三处必须共用，不得自建过滤）：`routes/proxy.ts`、`routes/anthropic-proxy.ts`、`routes/playground.ts`——选中目标经**浅拷贝覆盖** `{...ch, api_format: target}` 贯穿请求构造/伪装/头策略/响应转换。

## 3. Contracts

### 3.1 能力声明语义

`api_formats` = 上游**原生支持**的端点集合。路由 = 入站协议命中「声明集 ∩ 可服务集合」；命中多个按偏好序取第一个 ∈ declared：

| InboundProtocol | 偏好序（高→低） | 可服务集合 |
|---|---|---|
| chat | openai > responses > anthropic > custom | 四者全部 |
| responses | responses > openai > custom | 排除 anthropic（无 responses→anthropic 转换） |
| anthropic | anthropic > openai > custom | 排除 responses（同上反向） |
| passthrough | openai > responses > custom | 排除 anthropic |

`custom` 在偏好序末位仅防御（写侧已禁组合）；**responses↔anthropic 转换不存在**，两侧互斥由 selectTargetFormat 的 null 返回表达，不得在路由层另写特判。

### 3.2 双写与读侧兜底

- 写：repo 层 `toApiFormatColumns` 同时产 `api_formats`（全量 JSON）与 `api_format`（规范序首元素）；**调用方只传 `api_formats`，禁止手工同步镜像**。
- 读：`parseApiFormats` 三级兜底 `api_formats`（JSON.parse + 白名单过滤 + 去重）→ `[api_format]`（镜像值也过白名单）→ `["openai"]`。UI 侧 `apps/ui/src/core/utils.ts parseChannelApiFormats` 严格同构（wire 形态是 TEXT 原始 JSON 字符串，非数组）。
- 回滚安全：旧代码读镜像列仍能以主格式路由（降级可用）；因此**删镜像列前必须确认所有旧读点迁移完毕**。

### 3.3 base_url 存储规范化（易踩坑）

`normalizeChannelBaseUrl`：**仅纯 anthropic 渠道**（length===1 且 ==="anthropic"）走 `normalizeBaseUrl`；其余（含含 anthropic 的多格式）trim + 去尾斜杠。

**Why**：openai/responses 端点的存储约定要求 base_url **含版本路径**（`{base_url}/models`、`{base_url}{subPath}` 原样拼接），`normalizeBaseUrl` 剥 `/v1` 是有损变换；anthropic 端点在请求时（buildChannelRequest anthropic 分支与探针）自会 `normalizeBaseUrl`，存储带 `/v1` 无害。故 trim+去尾斜杠才是两类端点均可消费的存储超集。

### 3.4 探测与拉模型

`fetchChannelModels(baseUrl, apiKey, apiFormats[], ...)`：逐非 custom 格式 `Promise.allSettled` 探测（单格式「有响应即可达」语义不变，仅 fetch reject 算该格式失败），模型按 id 先到先得去重取并集；部分失败附 `probe_warnings` 与逐格式 `results:[{api_format, ok, model_count, error?}]`，全部网络失败才 `ok:false`。test-model 目标格式 = `selectTargetFormat(declaredFormats, "chat")` 覆盖 channel-like。

## 4. Validation & Error Matrix

| 条件 | 行为 |
|---|---|
| POST/PATCH `api_formats` 非数组 / 空 / 全非法 | 400 `invalid_api_formats`（message 按 reason 三档说明；snake_case 与同文件既有错误码一致） |
| `custom` 与其他格式组合 | 400 `custom_exclusive` |
| PATCH 两者均缺席 | 保留现值（无「清除」态——格式声明不可为空） |
| legacy 单值 `api_format` 提供且非法 | 400（不静默回退；`api_formats` 与 `api_format` 同供时前者优先） |
| 规范序 | `[openai, responses, anthropic]`（custom 单独），写侧排序保证镜像首元素确定 |
| responses 入站无合格候选 | 503 `no_available_channels`，零上游请求 |

## 5. Good/Base/Bad Cases

- Good：渠道声明 `["openai","anthropic"]` → chat 入站 openai 原生直通；responses 入站降级 chat 转换；anthropic 入站 `/v1/messages` 原生。
- Base：存量单格式渠道回填后各协议路由结果与单值时代逐字节一致（16 格矩阵锁定）。
- Bad：路由层用 `allowedFormats.has(ch.api_format)` 单值过滤（旧世界写法）；为多格式渠道把 base_url 存成 normalizeBaseUrl 剥过的裸域；绕过 repo 手写 UPDATE 只改一列造成镜像与声明不一致。

## 6. Tests Required

- `tests/channel-routing.test.ts`：单格式 4×4=16 格**逐格独立断言** + 多格式偏好矩阵（含声明顺序无关性）。
- `tests/channel-formats.test.ts`：normalize/parse 全分支（非数组、白名单过滤、custom 独占、规范序、三级兜底、畸形 JSON）。
- `tests/channel-testing.test.ts`：并集去重、部分失败 `probe_warnings`、全失败、POST/PATCH 400 矩阵、镜像双写、base_url 两种规范化。
- `tests/proxy-responses.test.ts` 集成：AC3（转换 URL/体/协议/usage 落库 prompt>0）、AC4（`["openai","responses"]` 透传 `toHaveBeenCalledTimes(1)` 锁死路径回退不存在）、AC6/AC7 偏好序。

## 7. Wrong vs Correct

### Wrong

```typescript
// 旧世界：单值过滤，多格式渠道直接被漏判
const allowedFormats = allowedFormatsForPath(path);
candidates = candidates.filter((ch) => allowedFormats.has(ch.api_format ?? "openai"));
```

### Correct

```typescript
// 能力声明：逐渠道选目标格式，浅拷贝覆盖贯穿下游全部分支
const routed: ChannelRecord[] = [];
for (const ch of candidates) {
	const targetFormat = selectTargetFormat(parseApiFormats(ch), inboundProtocolForPath(path));
	if (targetFormat) routed.push({ ...ch, api_format: targetFormat });
}
```

**Why**：单值世界渠道格式即目标格式；多格式世界「声明」与「本次调用实际使用的目标」分离，目标必须显式选出并贯穿请求构造/伪装/头策略/响应转换，否则下游按错误格式分支。
