import type { D1Database } from "@cloudflare/workers-types";
import { parseDisguiseHeaders } from "../utils/client-disguise";
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

export type ChannelTestResult = {
	ok: boolean;
	elapsed: number;
	models: string[];
	payload?: unknown[] | { data?: unknown[] };
};

/**
 * Tests channel connectivity via GET /v1/models.
 * If the server responds (any status), the channel is considered reachable.
 * Models are only populated when the endpoint returns a valid list.
 * For custom format, probes the base_url directly.
 * Disguise headers (D4/AC5) are sent for every format, but the global header
 * policy never applies here (spec: the probe must not converge onto
 * applyHeaderPolicy — that would leak global inject/remove into probes).
 */
export async function fetchChannelModels(
	baseUrl: string,
	apiKey: string,
	apiFormat?: ChannelApiFormat,
	customHeadersJson?: string | null,
	disguiseHeadersJson?: string | null,
): Promise<ChannelTestResult> {
	const format = apiFormat ?? "openai";

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
	// JSON is treated as empty config (fail-open).
	const disguiseHeaders = parseDisguiseHeaders(disguiseHeadersJson);
	for (const [key, value] of Object.entries(disguiseHeaders)) {
		headers[key] = value;
	}

	if (format === "custom" && customHeadersJson) {
		const custom = safeJsonParse<Record<string, string>>(customHeadersJson, {});
		for (const [key, value] of Object.entries(custom)) {
			headers[key] = value;
		}
	}

	const start = Date.now();
	try {
		const response = await fetch(target, { method: "GET", headers });
		const elapsed = Date.now() - start;

		if (!response.ok) {
			// Server responded — channel is reachable, just no model list
			return { ok: true, elapsed, models: [] };
		}

		const payload = (await response.json().catch(() => ({ data: [] }))) as
			| { data?: unknown[] }
			| unknown[];
		const models = normalizeModelsInput(
			Array.isArray(payload) ? payload : (payload.data ?? payload),
		);
		return { ok: true, elapsed, models, payload };
	} catch {
		// Network error — truly unreachable
		const elapsed = Date.now() - start;
		return { ok: false, elapsed, models: [] };
	}
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
