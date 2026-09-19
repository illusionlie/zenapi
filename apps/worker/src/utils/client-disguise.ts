import { parseExtraHeaders } from "./proxy-headers";

/**
 * 渠道客户端伪装(请求头 + 系统提示词注入)— 纯函数模块。
 *
 * 伪装头解析复用全局 extra headers 的校验规则(值必须全为字符串),但完全
 * fail-open:空/缺失输入与任何结构性非法载荷(畸形 JSON / 非对象 / 值非字符串)
 * 一律按「无伪装」处理返回 {} —— 代理请求绝不因伪装配置损坏而失败(PRD AC7,
 * 与 applyHeaderPolicy 内部的伪装头解析语义一致)。
 *
 * 伪装头值另支持 `{{...}}` 动态模板占位符(resolveDisguiseTemplate),在每次
 * 上游请求构建时求值(重试轮 / 换渠道 / 换 Key 天然各自新鲜);未知占位符
 * 原样保留(fail-open:可预测、不报错)。模板解释仅作用于伪装头 ——
 * custom_headers_json 与全局 extra/remove 头保持字面值,由调用方(接线点)
 * 保证作用域,本模块不做区分。
 */
export function parseDisguiseHeaders(
	raw: string | null | undefined,
): Record<string, string> {
	return parseExtraHeaders(raw) ?? {};
}

/**
 * 向 OpenAI 风格请求体前置注入伪装系统提示词(mutate 传入 body 的顶层字段)。
 * 伪装消息始终位于 messages 首位(D2 前置注入);原 messages 数组不被原地修改
 * (整体重新赋值),同一 parsedBody 跨重试轮 / 跨渠道共享时不会重复注入或泄漏。
 * messages 非数组或缺失时创建 [system](design §3 契约)。
 */
export function injectSystemPromptOpenAI(
	body: Record<string, unknown>,
	prompt: string,
): void {
	if (!prompt) {
		return;
	}
	const existing = body.messages;
	body.messages = [
		{ role: "system", content: prompt },
		...(Array.isArray(existing) ? existing : []),
	];
}

/**
 * 向 Anthropic 风格请求体前置注入伪装系统提示词(mutate 传入 body 的顶层
 * system 字段):
 * - 未设置 / 空 → string prompt
 * - string → `prompt + "\n\n" + 原值`
 * - content-block 数组 → 新 text block 前置(重新赋值新数组,原 block 及其
 *   cache_control 不动)
 * 未知形态保持原样不注入(宁可缺伪装也不损坏请求)。
 */
export function injectSystemPromptAnthropic(
	body: Record<string, unknown>,
	prompt: string,
): void {
	if (!prompt) {
		return;
	}
	const existing = body.system;
	if (existing === undefined || existing === null || existing === "") {
		body.system = prompt;
		return;
	}
	if (typeof existing === "string") {
		body.system = `${prompt}\n\n${existing}`;
		return;
	}
	if (Array.isArray(existing)) {
		body.system = [{ type: "text", text: prompt }, ...existing];
	}
}

/**
 * 向 Responses 风格请求体前置注入伪装系统提示词(mutate 传入 body 的顶层
 * instructions 字段):未设置/空 → prompt;已有 → `prompt + "\n\n" + 原值`。
 */
export function injectSystemPromptResponses(
	body: Record<string, unknown>,
	prompt: string,
): void {
	if (!prompt) {
		return;
	}
	const existing = body.instructions;
	if (typeof existing === "string" && existing.length > 0) {
		body.instructions = `${prompt}\n\n${existing}`;
	} else {
		body.instructions = prompt;
	}
}

// —— 动态头模板(opencode ID 生成器 + 占位符解析,research §2 算法逐行复刻) ——

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * 生成 26 字符的 opencode 风格 ID 正文:前 12 hex 内嵌毫秒时间戳
 * (timestamp << 12 | counter,ses 分支按位取反后大端取 6 字节),后 14 位
 * base62 随机。与 sst/opencode 源码算法一致(research/opencode-zen-disguise.md §2)。
 *
 * 与真实实现的偏差:真实 opencode 的 counter 为进程内有状态计数(同毫秒多 ID
 * 自增),此处恒为 1 —— 跨请求唯一性由 Date.now() 毫秒位 + 14 位随机段保证,
 * 产物格式上游不可区分。`now` 参数仅为可测试性注入,默认当前毫秒。
 */
function genOpencodeId(desc: boolean, now: number = Date.now()): string {
	let v = BigInt(now) * 0x1000n + 1n; // timestamp << 12 | ctr(恒 1)
	if (desc) {
		v = ~v; // ses_:按位取反(~v 为负 BigInt,>> 算术移位 + & 0xffn 取低字节)
	}
	let time = "";
	for (let i = 0; i < 6; i++) {
		time += ((v >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, "0");
	}
	const rnd = Array.from(crypto.getRandomValues(new Uint8Array(14)))
		.map((b) => B62[b % 62])
		.join("");
	return time + rnd; // 26 字符 = 12 hex + 14 base62
}

/** `msg_` 前缀请求 ID(真实 opencode 每消息生成,此处每上游请求生成)。 */
export function genOpencodeRequestId(now?: number): string {
	return `msg_${genOpencodeId(false, now)}`;
}

/** `ses_` 前缀会话 ID(取反时间戳分支;每请求全新生成,D3 无状态策略)。 */
export function genOpencodeSessionId(now?: number): string {
	return `ses_${genOpencodeId(true, now)}`;
}

/**
 * 模板值生成器注册表:值生成器按调用时刻求值,同一 value 内同一占位符
 * 多次出现各自独立生成。
 */
const TEMPLATE_RESOLVERS: Record<string, () => string> = {
	uuid: () => crypto.randomUUID(), // Workers secure context 原生支持
	timestamp_ms: () => String(Date.now()),
	opencode_request_id: genOpencodeRequestId,
	opencode_session_id: genOpencodeSessionId,
};

const TEMPLATE_PATTERN = /\{\{([a-zA-Z0-9_]+)\}\}/g;

/**
 * 解析伪装头值中的 `{{...}}` 动态占位符(纯函数,不解释的输入原样返回)。
 * - 不含 `{{` 的值原样返回同一引用(fast path,零回归热路径);
 * - 命中注册表的占位符替换为按调用时刻生成的值;
 * - 未知占位符(如 {{nope}})原样保留 —— fail-open:可预测、不报错。
 * 作用域由调用方保证:仅伪装头值经过此函数,custom/全局头按字面值发送。
 */
export function resolveDisguiseTemplate(value: string): string {
	if (!value.includes("{{")) {
		return value;
	}
	return value.replace(TEMPLATE_PATTERN, (match, name: string) => {
		const resolver = TEMPLATE_RESOLVERS[name];
		return resolver ? resolver() : match;
	});
}
