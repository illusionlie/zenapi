import { parseExtraHeaders } from "./proxy-headers";

/**
 * 渠道客户端伪装(请求头 + 系统提示词注入)— 纯函数模块。
 *
 * 伪装头解析复用全局 extra headers 的校验规则(值必须全为字符串),但完全
 * fail-open:空/缺失输入与任何结构性非法载荷(畸形 JSON / 非对象 / 值非字符串)
 * 一律按「无伪装」处理返回 {} —— 代理请求绝不因伪装配置损坏而失败(PRD AC7,
 * 与 applyHeaderPolicy 内部的伪装头解析语义一致)。
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
