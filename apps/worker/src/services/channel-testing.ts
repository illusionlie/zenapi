import type { D1Database } from "@cloudflare/workers-types";
import {
	parseDisguiseHeaders,
	resolveDisguiseTemplate,
} from "../utils/client-disguise";
import { safeJsonParse } from "../utils/json";
import { nowIso } from "../utils/time";
import { normalizeBaseUrl } from "../utils/url";
import {
	extractModelPricings,
	type ModelPricing,
	modelsToJson,
	normalizeModelsInput,
} from "./channel-models";
import type { ChannelApiFormat } from "./channel-types";

export type ChannelFormatProbe = {
	api_format: ChannelApiFormat;
	ok: boolean;
	model_count: number;
	error?: string;
};

export type ChannelTestResult = {
	ok: boolean;
	elapsed: number;
	models: string[];
	payload?: unknown[] | { data?: unknown[] };
	/** 部分格式探测失败时的警告（"{format}: {原因}"）；全部成功时缺席 */
	probe_warnings?: string[];
	/** 逐格式探测结果（多格式渠道按声明格式逐项给出） */
	results?: ChannelFormatProbe[];
};

type SingleProbeSuccess = {
	ok: true;
	models: string[];
	payload?: unknown[] | { data?: unknown[] };
};

type SingleProbeFailure = { ok: false; error: string };

/**
 * 单格式探测：URL / 头规则与既有单格式实现逐字保持。
 * 语义与现状一致——服务器有响应（任意状态码）即视为可达（该格式探测
 * 成功，模型列表可能为空）；仅网络层失败（fetch reject）才算该格式失败。
 * 伪装头对所有格式生效，但全局头策略从不在此生效（spec：探测不得收敛到
 * applyHeaderPolicy——避免全局注入/剔除泄漏进探测）。
 */
async function probeChannelFormat(
	baseUrl: string,
	apiKey: string,
	format: ChannelApiFormat,
	customHeadersJson: string | null | undefined,
	disguiseHeadersJson: string | null | undefined,
): Promise<SingleProbeSuccess | SingleProbeFailure> {
	let target: string;
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};

	if (format === "custom") {
		target = baseUrl;
	} else if (format === "openai" || format === "responses") {
		// openai / responses format: base_url already includes version path (e.g. /v1)
		target = `${baseUrl.replace(/\/+$/, "")}/models`;
	} else {
		// anthropic format: normalizeBaseUrl strips /v1, then add /v1/models
		target = `${normalizeBaseUrl(baseUrl)}/v1/models`;
	}

	if (format === "anthropic") {
		headers["x-api-key"] = apiKey;
		headers["anthropic-version"] = "2023-06-01";
	} else {
		headers.Authorization = `Bearer ${apiKey}`;
		headers["x-api-key"] = apiKey;
	}

	// Disguise headers first, channel-level custom headers after (same
	// "later applier wins" order as the proxy chain); malformed disguise
	// JSON is treated as empty config (fail-open). Disguise values go
	// through template resolution (per-probe freshness); custom headers
	// below stay literal.
	const disguiseHeaders = parseDisguiseHeaders(disguiseHeadersJson);
	for (const [key, value] of Object.entries(disguiseHeaders)) {
		headers[key] = resolveDisguiseTemplate(value);
	}

	if (format === "custom" && customHeadersJson) {
		const custom = safeJsonParse<Record<string, string>>(customHeadersJson, {});
		for (const [key, value] of Object.entries(custom)) {
			headers[key] = value;
		}
	}

	try {
		const response = await fetch(target, { method: "GET", headers });

		if (!response.ok) {
			// Server responded — channel is reachable, just no model list
			return { ok: true, models: [] };
		}

		const payload = (await response.json().catch(() => ({ data: [] }))) as
			| { data?: unknown[] }
			| unknown[];
		const models = normalizeModelsInput(
			Array.isArray(payload) ? payload : (payload.data ?? payload),
		);
		return { ok: true, models, payload };
	} catch (error) {
		// Network error — this format's probe failed
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Tests channel connectivity by probing each declared API format.
 * - custom 只能独占（写侧校验保证），单独探测 base_url 本身；
 *   其余格式经 Promise.allSettled 逐个探测。
 * - 成功结果按模型 id 去重取并集（按声明顺序先到先得）。
 * - 部分失败不整体失败：结果附 probe_warnings（含失败格式与原因）。
 * - 全部失败（所有探测均网络层失败）→ 整体 ok:false，与既有单格式
 *   「网络不可达」语义一致，路由侧继续走 502 channel_unreachable。
 */
export async function fetchChannelModels(
	baseUrl: string,
	apiKey: string,
	apiFormats: ChannelApiFormat[],
	customHeadersJson?: string | null,
	disguiseHeadersJson?: string | null,
): Promise<ChannelTestResult> {
	const nonCustom = apiFormats.filter((format) => format !== "custom");
	const probeFormats: ChannelApiFormat[] =
		nonCustom.length > 0 ? nonCustom : ["custom"];

	const start = Date.now();
	const settled = await Promise.allSettled(
		probeFormats.map((format) =>
			probeChannelFormat(
				baseUrl,
				apiKey,
				format,
				customHeadersJson,
				disguiseHeadersJson,
			),
		),
	);
	const elapsed = Date.now() - start;

	const results: ChannelFormatProbe[] = [];
	const warnings: string[] = [];
	const models: string[] = [];
	const seen = new Set<string>();
	let firstPayload: unknown[] | { data?: unknown[] } | undefined;
	let firstError: string | null = null;

	for (let i = 0; i < probeFormats.length; i++) {
		const format = probeFormats[i];
		const outcome = settled[i];
		// probeChannelFormat 自捕获网络错误，reject 分支纯防御
		const probe: SingleProbeSuccess | SingleProbeFailure =
			outcome.status === "fulfilled"
				? outcome.value
				: {
						ok: false,
						error:
							outcome.reason instanceof Error
								? outcome.reason.message
								: String(outcome.reason),
					};
		if (probe.ok) {
			results.push({
				api_format: format,
				ok: true,
				model_count: probe.models.length,
			});
			for (const model of probe.models) {
				if (!seen.has(model)) {
					seen.add(model);
					models.push(model);
				}
			}
			if (probe.payload !== undefined && firstPayload === undefined) {
				firstPayload = probe.payload;
			}
		} else {
			results.push({
				api_format: format,
				ok: false,
				model_count: 0,
				error: probe.error,
			});
			warnings.push(`${format}: ${probe.error}`);
			if (firstError === null) {
				firstError = probe.error;
			}
		}
	}

	const allFailed = results.every((entry) => !entry.ok);
	if (allFailed) {
		return {
			ok: false,
			elapsed,
			models: [],
			probe_warnings: warnings,
			results,
		};
	}

	return {
		ok: true,
		elapsed,
		models,
		payload: firstPayload,
		...(warnings.length > 0 ? { probe_warnings: warnings } : {}),
		results,
	};
}

export async function updateChannelTestResult(
	db: D1Database,
	id: string,
	result: {
		ok: boolean;
		elapsed: number;
		models?: string[];
		modelsJson?: string;
		existingModelsJson?: string | null;
	},
): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	const status = result.ok ? "active" : "error";

	let modelsJson: string | undefined;
	if (result.modelsJson) {
		// When raw JSON is provided (from test payload), merge with existing prices
		if (result.existingModelsJson) {
			const existingPricings = extractModelPricings({
				models_json: result.existingModelsJson,
			});
			const existingMap = new Map<
				string,
				{
					input_price?: number;
					output_price?: number;
					enabled?: boolean;
				}
			>();
			for (const p of existingPricings) {
				existingMap.set(p.id, {
					input_price: p.input_price,
					output_price: p.output_price,
					enabled: p.enabled,
				});
			}
			const newModels = safeJsonParse<Array<{ id?: string }>>(
				result.modelsJson,
				[],
			);
			const merged: ModelPricing[] = (
				Array.isArray(newModels) ? newModels : []
			).map((m) => {
				const mid = typeof m === "string" ? m : String(m?.id ?? "");
				const existing = existingMap.get(mid);
				const entry: ModelPricing = { id: mid };
				if (existing?.input_price != null)
					entry.input_price = existing.input_price;
				if (existing?.output_price != null)
					entry.output_price = existing.output_price;
				// Preserve existing enabled flag
				if (existing?.enabled != null) {
					entry.enabled = existing.enabled;
				}
				return entry;
			});
			modelsJson = JSON.stringify(merged);
		} else {
			modelsJson = result.modelsJson;
		}
	} else if (result.models) {
		modelsJson = modelsToJson(result.models);
	}

	const sql = modelsJson
		? "UPDATE channels SET status = ?, models_json = ?, test_time = ?, response_time_ms = ?, updated_at = ? WHERE id = ?"
		: "UPDATE channels SET status = ?, test_time = ?, response_time_ms = ?, updated_at = ? WHERE id = ?";

	const stmt = db.prepare(sql);
	if (modelsJson) {
		await stmt
			.bind(status, modelsJson, now, result.elapsed, nowIso(), id)
			.run();
	} else {
		await stmt.bind(status, now, result.elapsed, nowIso(), id).run();
	}
}
