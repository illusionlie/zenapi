export type ChannelApiFormat = "openai" | "anthropic" | "custom" | "responses";

export type ChannelRow = {
	id: string;
	name: string;
	base_url: string;
	api_key: string;
	weight: number;
	status: string;
	rate_limit?: number | null;
	models_json?: string | null;
	type?: number | null;
	group_name?: string | null;
	priority?: number | null;
	metadata_json?: string | null;
	test_time?: number | string | null;
	response_time_ms?: number | null;
	api_format: ChannelApiFormat;
	// JSON 数组（能力声明）；api_format 为镜像列，存规范化数组首元素
	api_formats: string | null;
	// JSON 对象（每格式独立端点覆盖，键白名单 openai/responses/anthropic）；
	// NULL = 全部格式走 base_url 推导
	endpoint_overrides: string | null;
	custom_headers_json?: string | null;
	disguise_headers_json?: string | null;
	disguise_system_prompt?: string | null;
	stream_only?: number | null;
	created_at?: string | null;
	updated_at?: string | null;
};

export type ChannelRecord = ChannelRow;

/** 写侧白名单（与 ChannelApiFormat union 一一对应）。 */
const API_FORMAT_WHITELIST: readonly ChannelApiFormat[] = [
	"openai",
	"responses",
	"anthropic",
	"custom",
];

/**
 * 规范序：镜像列 api_format 取首元素，因此输出必须按此固定顺序排序
 * （custom 独占，单独成数组，顺序仅防御性兜底）。
 */
const CANONICAL_ORDER: readonly ChannelApiFormat[] = [
	"openai",
	"responses",
	"anthropic",
	"custom",
];

/**
 * 白名单过滤 + 去重，保持输入顺序（首个出现位置优先）。
 */
function filterWhitelisted(values: unknown[]): ChannelApiFormat[] {
	const seen = new Set<ChannelApiFormat>();
	for (const value of values) {
		if (typeof value !== "string") {
			continue;
		}
		if (!(API_FORMAT_WHITELIST as readonly string[]).includes(value)) {
			continue;
		}
		seen.add(value as ChannelApiFormat);
	}
	return [...seen];
}

export type ApiFormatsSource = {
	api_formats?: string | null;
	api_format?: ChannelApiFormat | null;
};

/**
 * 读侧三级兜底：
 *   1. api_formats JSON 数组（JSON.parse + 白名单过滤 + 去重，畸形 JSON 容错跳过）
 *   2. [api_format]（白名单外视为缺失）
 *   3. ["openai"]（列历史默认值）
 * 任何脏数据都不抛错，保证代理路径 fail-open 可路由。
 */
export function parseApiFormats(row: ApiFormatsSource): ChannelApiFormat[] {
	if (typeof row.api_formats === "string" && row.api_formats.trim() !== "") {
		try {
			const parsed: unknown = JSON.parse(row.api_formats);
			if (Array.isArray(parsed)) {
				const formats = filterWhitelisted(parsed);
				if (formats.length > 0) {
					return formats;
				}
			}
		} catch {
			// 畸形 JSON → 落到下一级兜底
		}
	}
	if (
		typeof row.api_format === "string" &&
		(API_FORMAT_WHITELIST as readonly string[]).includes(row.api_format)
	) {
		return [row.api_format];
	}
	return ["openai"];
}

export type NormalizeApiFormatsResult =
	| { ok: true; value: ChannelApiFormat[] }
	| { ok: false; reason: "not_array" | "empty" | "custom_exclusive" };

/**
 * 写侧校验与规范化：
 *   - 白名单过滤（白名单外/非字符串元素剔除）+ 去重
 *   - 空 / 全非法 → !ok（格式声明不可为空）
 *   - custom 与其他格式组合 → !ok（custom 独占）
 *   - 通过则按规范序 [openai, responses, anthropic]（custom 单独）排序，
 *     保证镜像首元素确定
 */
export function normalizeApiFormats(input: unknown): NormalizeApiFormatsResult {
	if (!Array.isArray(input)) {
		return { ok: false, reason: "not_array" };
	}
	const formats = filterWhitelisted(input);
	if (formats.length === 0) {
		return { ok: false, reason: "empty" };
	}
	if (formats.includes("custom") && formats.length > 1) {
		return { ok: false, reason: "custom_exclusive" };
	}
	const ordered = CANONICAL_ORDER.filter((format) => formats.includes(format));
	return { ok: true, value: ordered };
}

/** 可被端点覆盖的格式键：custom 的 base_url 即完整 URL，语义上不可覆盖。 */
export type EndpointOverrideKey = Exclude<ChannelApiFormat, "custom">;

export type EndpointOverrides = Partial<Record<EndpointOverrideKey, string>>;

/** 端点覆盖键白名单（与 EndpointOverrideKey union 一一对应）。 */
const ENDPOINT_OVERRIDE_KEYS: readonly EndpointOverrideKey[] = [
	"openai",
	"responses",
	"anthropic",
];

/** parseEndpointOverrides 的输入源：wire 形态是 TEXT 原始 JSON 字符串。 */
export type EndpointOverridesSource = {
	endpoint_overrides?: string | null;
};

/**
 * 读侧容错解析（与 parseApiFormats 同哲学，任何脏数据不抛错）：
 *   - 列 NULL / 空串 / 非字符串 → {}
 *   - JSON.parse 失败 / 顶层非对象（数组、标量、null）→ {}
 *   - 键白名单过滤（未知键与 custom 键剔除）
 *   - 值非字符串或空白串剔除（空白覆盖 = 未覆盖）
 */
export function parseEndpointOverrides(
	row: EndpointOverridesSource,
): EndpointOverrides {
	if (
		typeof row.endpoint_overrides !== "string" ||
		row.endpoint_overrides.trim() === ""
	) {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(row.endpoint_overrides);
		if (
			parsed === null ||
			typeof parsed !== "object" ||
			Array.isArray(parsed)
		) {
			return {};
		}
		const source = parsed as Record<string, unknown>;
		const result: EndpointOverrides = {};
		for (const key of ENDPOINT_OVERRIDE_KEYS) {
			const value = source[key];
			if (typeof value === "string" && value.trim() !== "") {
				result[key] = value;
			}
		}
		return result;
	} catch {
		// 畸形 JSON → 视为无覆盖
		return {};
	}
}
