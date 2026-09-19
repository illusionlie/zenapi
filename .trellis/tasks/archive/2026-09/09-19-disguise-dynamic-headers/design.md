# Design: 渠道伪装动态头模板与 OpenCode 客户端预设

> 需求与验收见 [prd.md](./prd.md)；证据与算法见 [research/opencode-zen-disguise.md](./research/opencode-zen-disguise.md)。
> 总原则：纯增量、纯函数、零回归——无占位符路径的行为与现状逐字节一致。

## 1. 模板解析器（`apps/worker/src/utils/client-disguise.ts` 扩展）

全部为纯函数，风格对齐本文件既有导出（容错、fail-open、mutate 语义注释齐全）。

```ts
// 注册表：值生成器按调用时刻求值，同一 value 内多次出现各自独立生成
const TEMPLATE_RESOLVERS: Record<string, () => string> = {
	uuid: () => crypto.randomUUID(), // Workers secure context 原生支持
	timestamp_ms: () => String(Date.now()),
	opencode_request_id: genOpencodeRequestId,
	opencode_session_id: genOpencodeSessionId,
};

export function resolveDisguiseTemplate(value: string): string;
```

解析语义：

- fast path：`value` 不含 `{{` 时原样返回同一引用（零回归热路径，AC4）。
- 正则 `/\{\{([a-zA-Z0-9_]+)\}\}/g`：命中注册表 → 替换为生成值；未命中（如 `{{nope}}`）→ 原样保留（AC3，fail-open：可预测、不报错）。
- 作用域由调用方保证：**仅伪装头值**经过此函数（§2）。

## 2. OpenCode ID 生成器（同文件）

```ts
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function genOpencodeId(desc: boolean, now: number = Date.now()): string {
	let v = BigInt(now) * 0x1000n + 1n; // timestamp << 12 | ctr(恒 1)
	if (desc) v = ~v;                   // ses_：按位取反
	let time = "";
	for (let i = 0; i < 6; i++)
		time += ((v >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, "0");
	const rnd = Array.from(crypto.getRandomValues(new Uint8Array(14)))
		.map((b) => B62[b % 62]).join("");
	return time + rnd;                  // 26 字符 = 12 hex + 14 base62
}

export function genOpencodeRequestId(now?: number): string; // msg_ + genOpencodeId(false, now)
export function genOpencodeSessionId(now?: number): string; // ses_ + genOpencodeId(true, now)
```

- 算法逐行复刻 research §2（抓包样本格式兼容）；`now` 参数仅为可测试性注入，默认 `Date.now()`。
- **与真实实现的偏差声明**：真实 opencode 的 `ctr` 为进程内有状态计数（同毫秒多 ID 自增）；本实现恒 1——跨请求唯一性由 `Date.now()` 毫秒位 + 14 位随机段保证，产物格式上游不可区分。
- `~v` 为负 BigInt 时，`>>` 算术移位 + `& 0xffn` 的低字节语义与抓包一致；`BigInt` / `crypto.getRandomValues` Workers 原生支持。

## 3. 接线点（两处，签名零变更）

| 位置 | 变更 | 覆盖路径 |
|------|------|----------|
| `utils/proxy-headers.ts` `applyHeaderPolicy` 伪装分支（现 `headers.set(key, value)`） | 改为 `headers.set(key, resolveDisguiseTemplate(value))` | proxy `buildChannelRequest` 全部分支（chat/anthropic/responses/custom/透传）、anthropic-proxy 三个 attempt 循环、Playground、`/test-model`——均为每请求/每 attempt 调用 → AC7 天然成立 |
| `services/channel-testing.ts` 连通性探针（:65-66 经 `parseDisguiseHeaders` 直设头处） | 同样包 `resolveDisguiseTemplate` | 连通性测试 `/v1/models` 探活（09-17 D4 语义：仅头、不收敛 applyHeaderPolicy，维持 spec 契约） |

明确**不接线**：`custom_headers_json` 与全局 extra/remove 头保持字面值（AC5 域界定）；body 侧（伪装提示词注入）不解释模板。

## 4. UI 预设（`apps/ui/src/core/client-presets.ts` 第七条）

```ts
{
	id: "opencode",
	name: "OpenCode 1.18.31",
	headers: {
		"User-Agent": "opencode/1.18.31 ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14",
		"x-opencode-client": "cli",
		"x-opencode-project": "global",
		"x-opencode-request": "{{opencode_request_id}}",
		"x-opencode-session": "{{opencode_session_id}}",
	},
	systemPrompt: OPENCODE_PROMPT, // 实施时提取，见下
	note: "官方源码锚定（sst/opencode dev，llm/request.ts prepare + linux.do 2912664 抓包 1.18.31）。" +
		"x-opencode-request/session 为动态模板占位符，网关每上游请求实时生成（内嵌当前毫秒时间戳，格式与源码算法逐字节兼容）；" +
		"UA 双版本号（ai-sdk/provider-utils、runtime/bun）随 opencode 发布漂移，需手工刷新。" +
		"⚠ 不适用于 opencode zen 免费额度——其校验已含 body 规则（stream:true + bash tool + tools≥2），超出头部伪装能力范围。",
	// 不标 testing：头集全部来自抓包 + 源码直接证据，无未验证指纹环节
}
```

- `OPENCODE_PROMPT`：实施时从 `sst/opencode` dev 分支 `packages/opencode/src/session/prompt/default.txt` 提取静态正文，拼一段**中性 environment 块**（对齐既有预设「静态段 + 中性环境值」规则；模型分档变体 PROMPT_GPT/ANTHROPIC 等不取）。提取产物归档至 `research/prompts/opencode-system-prompt.md`。
- `ChannelsView.tsx` 伪装分组说明文案追加一句：伪装头值支持动态占位符（每请求实时生成）：`{{uuid}}`、`{{timestamp_ms}}`、`{{opencode_request_id}}`、`{{opencode_session_id}}`；未知占位符按字面值发送。

## 5. 兼容性 / 部署 / 回滚

- **DB 无变更**：占位符即普通字符串入库（`disguise_headers_json`），无迁移。
- **部署窗口**：若 UI 先行（旧 worker 在读），占位符按字面值发送——值格式合法仅时效可疑，可接受；建议前后端同批部署。
- **回滚点 1**：解析器为纯增量，撤销 §3 两处接线即回现状；**回滚点 2**：预设条目独立，删除即回六预设。互不耦合。
- 风险文件：`proxy-headers.ts`（热路径，零回归敏感——fast path 保证）；`client-presets.ts`（bundle 增量，gzip 后可忽略）。

## 6. 测试设计

`tests/client-disguise.test.ts` 扩展：

1. ID 格式：`/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/` 与 ses 同构；注入固定 `now` 验证 hex 段字节（含 ses 取反分支）；解码时间戳落在 `now ± 60s`。
2. 同一 `now` 两次生成不相等（随机段）；`resolveDisguiseTemplate`：已知变量替换、同一 value 多次出现各独立、未知占位符保留、无 `{{` fast path、混合文本（前后缀保留）。

`tests/proxy-headers.test.ts` 扩展（伪装矩阵）：

3. 伪装值含占位符 → `Headers` 收到渲染值；同串在 `custom_headers_json` → 字面值（AC5）；非法 JSON/空配置语义不变（既有 AC7 不回退）。

`tests/client-disguise.test.ts`（`buildChannelRequest` 级）：

4. 同渠道连续两次构建，`x-opencode-request` 渲染值互不相同（AC7 代表路径）。

零回归基线：既有 25 头策略用例与 client-disguise 既有用例不改动即绿。
