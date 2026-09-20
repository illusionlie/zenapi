import { normalizeBaseUrl } from "../utils/url";
import {
	type ChannelApiFormat,
	type EndpointOverridesSource,
	parseEndpointOverrides,
} from "./channel-types";

/**
 * 入站协议四分类（design.md §1）：
 *   - chat:        /v1/chat/completions（Chat Completions 协议）
 *   - responses:   /v1/responses（OpenAI Responses 协议）
 *   - anthropic:   /anthropic/v1/*（Anthropic Messages 协议）
 *   - passthrough: 其余 /v1/* 透传路径（embeddings 等）
 */
export type InboundProtocol =
	| "chat"
	| "responses"
	| "anthropic"
	| "passthrough";

/**
 * 每入站协议的格式偏好序（高 → 低）：命中多个可服务格式时选唯一目标格式。
 * custom 排末位仅为防御（校验层 normalizeApiFormats 已禁 custom 组合），
 * 保证单 custom 渠道行为与现状一致。
 *
 * 行为保持约束（PRD R2）：单格式渠道在各协议下的既有路由结果逐一保持——
 *   chat:        openai > responses > anthropic > custom（全格式可服务）
 *   responses:   responses > openai > custom（anthropic 排除，无转换）
 *   anthropic:   anthropic > openai > custom（responses 排除，无转换）
 *   passthrough: openai > responses > custom（anthropic 排除）
 * 即旧 allowedFormatsForPath / anthropic-proxy 内联过滤的资格集合。
 */
const FORMAT_PREFERENCE: Record<InboundProtocol, readonly ChannelApiFormat[]> =
	{
		chat: ["openai", "responses", "anthropic", "custom"],
		responses: ["responses", "openai", "custom"],
		anthropic: ["anthropic", "openai", "custom"],
		passthrough: ["openai", "responses", "custom"],
	};

/**
 * 由请求路径判定入站协议。匹配语义与既有路由过滤保持一致
 * （大小写不敏感 + 前缀匹配，见原 proxy.ts allowedFormatsForPath）。
 */
export function inboundProtocolForPath(path: string): InboundProtocol {
	const lower = path.toLowerCase();
	if (lower.startsWith("/v1/responses")) {
		return "responses";
	}
	if (lower.startsWith("/v1/chat/completions")) {
		return "chat";
	}
	if (lower.startsWith("/anthropic/v1")) {
		return "anthropic";
	}
	return "passthrough";
}

/**
 * 统一路由选择：按入站协议的偏好序，返回第一个 ∈ declared（渠道声明
 * 格式集）的目标格式；无交集 → null（渠道对该入站协议不合格，跳过）。
 * 纯函数：proxy / anthropic-proxy / playground 三处共用的唯一判定入口。
 */
export function selectTargetFormat(
	declared: ChannelApiFormat[],
	inbound: InboundProtocol,
): ChannelApiFormat | null {
	const declaredSet = new Set(declared);
	const preference = FORMAT_PREFERENCE[inbound];
	for (const format of preference) {
		if (declaredSet.has(format)) {
			return format;
		}
	}
	return null;
}

/** resolveEndpointBaseUrl 的输入源：目标格式 → 上游 URL 推导所需的行片段。 */
export type EndpointBaseUrlSource = EndpointOverridesSource & {
	base_url: string;
};

/**
 * 目标格式 → 上游 base URL 的唯一解析入口（覆盖优先，兜底 base_url 推导）。
 * 返回各消费分支「当前实际使用的形态」，无覆盖时与既有分支逻辑逐字节一致
 * （AC1 红线）：
 *   - anthropic:          normalizeBaseUrl(base_url)（剥尾斜杠 + 剥 /v1）
 *   - openai / responses: base_url.replace(/\/+$/, "")（保留版本路径）
 *   - custom:             base_url 原样（base_url 即完整 URL，不可覆盖）
 * 有覆盖时按同一消费语义规范化覆盖值：anthropic 覆盖走 normalizeBaseUrl，
 * openai/responses 覆盖仅去尾斜杠（保留用户声明的版本路径）。
 * 代理 / anthropic 代理 / 探测的全部 URL 解析点共用，禁止自建推导。
 */
export function resolveEndpointBaseUrl(
	row: EndpointBaseUrlSource,
	format: ChannelApiFormat,
): string {
	if (format === "custom") {
		return row.base_url;
	}
	const override = parseEndpointOverrides(row)[format];
	if (format === "anthropic") {
		return normalizeBaseUrl(override ?? row.base_url);
	}
	return (override ?? row.base_url).replace(/\/+$/, "");
}
