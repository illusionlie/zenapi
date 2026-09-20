import { Hono } from "hono";
import type { AppEnv } from "../env";
import { buildChannelRequest, convertResponse } from "../routes/proxy";
import {
	channelExists,
	deleteChannel,
	getChannelById,
	insertChannel,
	listChannels,
	updateChannel,
} from "../services/channel-repo";
import {
	fetchChannelModels,
	updateChannelTestResult,
} from "../services/channel-testing";
import type {
	ChannelApiFormat,
	ChannelRecord,
} from "../services/channel-types";
import { saveChannelAliases } from "../services/model-aliases";
import {
	buildModelTestRequestBody,
	MODEL_TEST_TIMEOUT_MS,
	type ModelTestOutcome,
	parseModelTestResponse,
} from "../services/model-testing";
import { getModelTestPrompt } from "../services/settings";
import { generateToken } from "../utils/crypto";
import { jsonError } from "../utils/http";
import { safeJsonParse } from "../utils/json";
import { parseApiKeys } from "../utils/keys";
import { nowIso } from "../utils/time";
import { normalizeBaseUrl } from "../utils/url";

const channels = new Hono<AppEnv>();

type AliasConfig = {
	aliases: string[];
	alias_only: boolean;
};

type ChannelPayload = {
	id?: string | number;
	channel_id?: string | number;
	channelId?: string | number;
	name?: string;
	base_url?: string;
	api_key?: string;
	weight?: number;
	status?: string;
	rate_limit?: number;
	models?: unknown[];
	api_format?: string;
	custom_headers?: string;
	disguise_headers?: string;
	disguise_system_prompt?: string;
	model_aliases?: Record<string, AliasConfig>;
};

/**
 * Resolves a channel id from request payload.
 *
 * Args:
 *   body: Request payload.
 *
 * Returns:
 *   Channel id if provided.
 */
function resolveChannelId(body: ChannelPayload | null): string | null {
	const candidate = body?.id ?? body?.channel_id ?? body?.channelId;
	if (!candidate) {
		return null;
	}
	const normalized = String(candidate).trim();
	return normalized.length > 0 ? normalized : null;
}

/**
 * Lists all channels.
 */
channels.get("/", async (c) => {
	const rows = await listChannels(c.env.DB, {
		orderBy: "created_at",
		order: "DESC",
	});

	// Collect channel IDs for per-channel alias query
	const channelIds = rows.map((ch) => ch.id as string);

	// Batch-query per-channel aliases (D1 limits bind params to 100)
	const channelAliases: Record<string, Record<string, AliasConfig>> = {};
	if (channelIds.length > 0) {
		const BATCH_SIZE = 80;
		for (let i = 0; i < channelIds.length; i += BATCH_SIZE) {
			const batch = channelIds.slice(i, i + BATCH_SIZE);
			const placeholders = batch.map(() => "?").join(",");
			const aliasRows = await c.env.DB.prepare(
				`SELECT channel_id, model_id, alias, alias_only FROM channel_model_aliases WHERE channel_id IN (${placeholders}) ORDER BY channel_id, model_id, alias`,
			)
				.bind(...batch)
				.all<{
					channel_id: string;
					model_id: string;
					alias: string;
					alias_only: number;
				}>();

			for (const row of aliasRows.results ?? []) {
				if (!channelAliases[row.channel_id]) {
					channelAliases[row.channel_id] = {};
				}
				const chMap = channelAliases[row.channel_id];
				if (!chMap[row.model_id]) {
					chMap[row.model_id] = { aliases: [], alias_only: false };
				}
				chMap[row.model_id].aliases.push(row.alias);
				if (row.alias_only === 1) {
					chMap[row.model_id].alias_only = true;
				}
			}
		}
	}

	return c.json({ channels: rows, channel_aliases: channelAliases });
});

/**
 * Creates a new channel.
 */
channels.post("/", async (c) => {
	const body = (await c.req.json().catch(() => null)) as ChannelPayload | null;
	if (!body?.name || !body?.base_url) {
		return jsonError(c, 400, "missing_fields", "missing_fields");
	}

	const requestedId = resolveChannelId(body);
	if (requestedId) {
		const exists = await channelExists(c.env.DB, requestedId);
		if (exists) {
			return jsonError(c, 409, "channel_id_exists", "channel_id_exists");
		}
	}

	const id = requestedId ?? generateToken("ch_");
	const now = nowIso();
	const apiFormat = (body.api_format ?? "openai") as ChannelApiFormat;
	const customHeadersJson = body.custom_headers?.trim() || null;
	const disguiseHeadersJson = body.disguise_headers?.trim() || null;
	const disguiseSystemPrompt = body.disguise_system_prompt?.trim() || null;

	await insertChannel(c.env.DB, {
		id,
		name: body.name,
		base_url:
			apiFormat === "anthropic"
				? normalizeBaseUrl(String(body.base_url))
				: String(body.base_url).trim().replace(/\/+$/, ""),
		api_key: body.api_key ?? "",
		weight: Number(body.weight ?? 1),
		status: body.status ?? "active",
		rate_limit: body.rate_limit ?? 0,
		models_json: JSON.stringify(body.models ?? []),
		type: 1,
		group_name: null,
		priority: 0,
		metadata_json: null,
		api_formats: [apiFormat],
		custom_headers_json: customHeadersJson,
		disguise_headers_json: disguiseHeadersJson,
		disguise_system_prompt: disguiseSystemPrompt,
		created_at: now,
		updated_at: now,
	});

	// Save per-channel model aliases if provided
	if (body.model_aliases && typeof body.model_aliases === "object") {
		const modelIds = (body.models ?? [])
			.map((m: unknown) =>
				typeof m === "string" ? m : ((m as { id?: string })?.id ?? ""),
			)
			.filter(Boolean);
		for (const [modelId, config] of Object.entries(body.model_aliases)) {
			if (!modelIds.includes(modelId)) continue;
			await saveChannelAliases(
				c.env.DB,
				id,
				modelId,
				(config.aliases ?? []).map((a: string) => ({ alias: a })),
				config.alias_only ?? false,
			);
		}
	}

	return c.json({ id });
});

/**
 * Updates a channel.
 */
channels.patch("/:id", async (c) => {
	const body = (await c.req.json().catch(() => null)) as ChannelPayload | null;
	const id = c.req.param("id");
	if (!body) {
		return jsonError(c, 400, "missing_body", "missing_body");
	}

	const current = await getChannelById(c.env.DB, id);
	if (!current) {
		return jsonError(c, 404, "channel_not_found", "channel_not_found");
	}

	const models = body.models ?? safeJsonParse(current.models_json, []);
	const apiFormat = (body.api_format ??
		current.api_format ??
		"openai") as ChannelApiFormat;
	const customHeadersJson =
		body.custom_headers !== undefined
			? body.custom_headers?.trim() || null
			: (current.custom_headers_json ?? null);
	// 三态语义照抄 custom_headers：undefined 保留现值，具体值（含空串）trim 后覆盖
	const disguiseHeadersJson =
		body.disguise_headers !== undefined
			? body.disguise_headers?.trim() || null
			: (current.disguise_headers_json ?? null);
	const disguiseSystemPrompt =
		body.disguise_system_prompt !== undefined
			? body.disguise_system_prompt?.trim() || null
			: (current.disguise_system_prompt ?? null);
	const baseUrl =
		apiFormat === "anthropic"
			? normalizeBaseUrl(String(body.base_url ?? current.base_url))
			: String(body.base_url ?? current.base_url)
					.trim()
					.replace(/\/+$/, "");

	await updateChannel(c.env.DB, id, {
		name: body.name ?? current.name,
		base_url: baseUrl,
		api_key: body.api_key ?? current.api_key,
		weight: Number(body.weight ?? current.weight ?? 1),
		status: body.status ?? current.status,
		rate_limit: body.rate_limit ?? current.rate_limit ?? 0,
		models_json: JSON.stringify(models),
		type: current.type ?? 1,
		group_name: current.group_name ?? null,
		priority: current.priority ?? 0,
		metadata_json: current.metadata_json ?? null,
		api_formats: [apiFormat],
		custom_headers_json: customHeadersJson,
		disguise_headers_json: disguiseHeadersJson,
		disguise_system_prompt: disguiseSystemPrompt,
		updated_at: nowIso(),
	});

	// Save per-channel model aliases if provided
	if (body.model_aliases && typeof body.model_aliases === "object") {
		const modelIds = (Array.isArray(models) ? models : [])
			.map((m: unknown) =>
				typeof m === "string" ? m : ((m as { id?: string })?.id ?? ""),
			)
			.filter(Boolean);
		for (const [modelId, config] of Object.entries(body.model_aliases)) {
			if (!modelIds.includes(modelId)) continue;
			await saveChannelAliases(
				c.env.DB,
				id,
				modelId,
				(config.aliases ?? []).map((a: string) => ({ alias: a })),
				config.alias_only ?? false,
			);
		}
	}

	return c.json({ ok: true });
});

/**
 * Deletes a channel.
 */
channels.delete("/:id", async (c) => {
	const id = c.req.param("id");
	await deleteChannel(c.env.DB, id);
	return c.json({ ok: true });
});

/**
 * Fetches models from an upstream channel without persisting anything.
 * Used by the channel form "拉取模型" button before the channel is saved.
 */
channels.post("/fetch_models", async (c) => {
	const body = (await c.req.json().catch(() => null)) as ChannelPayload | null;
	if (!body?.base_url) {
		return jsonError(c, 400, "missing_fields", "missing_fields");
	}

	const apiFormat = (body.api_format ?? "openai") as ChannelApiFormat;
	const baseUrl =
		apiFormat === "anthropic"
			? normalizeBaseUrl(String(body.base_url))
			: String(body.base_url).trim().replace(/\/+$/, "");
	const apiKey =
		parseApiKeys(body.api_key ?? "")[0] ?? String(body.api_key ?? "");

	const result = await fetchChannelModels(
		baseUrl,
		apiKey,
		apiFormat,
		body.custom_headers?.trim() || null,
		body.disguise_headers?.trim() || null,
	);

	if (!result.ok) {
		return jsonError(c, 502, "channel_unreachable", "channel_unreachable");
	}

	return c.json({ ok: true, models: result.models, elapsed: result.elapsed });
});

type ModelTestPayload = {
	id?: string | number;
	base_url?: string;
	api_key?: string;
	api_format?: string;
	custom_headers?: string;
	disguise_headers?: string;
	disguise_system_prompt?: string;
	model?: string;
	text?: string;
};

/**
 * Runs a one-shot real chat request against a single channel/model.
 * Admin-only tool: no usage recording, no balance deduction, and channel
 * connectivity test results are left untouched.
 */
channels.post("/test-model", async (c) => {
	const body = (await c.req
		.json()
		.catch(() => null)) as ModelTestPayload | null;
	const model = typeof body?.model === "string" ? body.model.trim() : "";
	if (!model) {
		return jsonError(
			c,
			400,
			"model_test_invalid_request",
			"model_test_invalid_request",
		);
	}

	const requestedId =
		body?.id !== undefined && body?.id !== null ? String(body.id).trim() : "";
	const hasBodyBaseUrl =
		typeof body?.base_url === "string" && body.base_url.trim().length > 0;
	if (!requestedId && !hasBodyBaseUrl) {
		return jsonError(
			c,
			400,
			"model_test_invalid_request",
			"model_test_invalid_request",
		);
	}

	// Resolve channel config: DB row when id is given, then body fields
	// override (the form is the source of truth — supports unsaved and
	// dirty forms; same override semantics as PATCH /:id).
	let dbChannel: ChannelRecord | null = null;
	if (requestedId) {
		dbChannel = await getChannelById(c.env.DB, requestedId);
		if (!dbChannel) {
			return jsonError(c, 404, "channel_not_found", "channel_not_found");
		}
	}

	const apiFormat = (body?.api_format ??
		dbChannel?.api_format ??
		"openai") as ChannelApiFormat;
	const baseUrl = hasBodyBaseUrl
		? apiFormat === "anthropic"
			? normalizeBaseUrl(String(body?.base_url))
			: String(body?.base_url).trim().replace(/\/+$/, "")
		: String(dbChannel?.base_url ?? "");
	const apiKey =
		body?.api_key !== undefined
			? String(body.api_key)
			: String(dbChannel?.api_key ?? "");
	const customHeadersJson =
		body?.custom_headers !== undefined
			? body.custom_headers?.trim() || null
			: (dbChannel?.custom_headers_json ?? null);
	const disguiseHeadersJson =
		body?.disguise_headers !== undefined
			? body.disguise_headers?.trim() || null
			: (dbChannel?.disguise_headers_json ?? null);
	const disguiseSystemPrompt =
		body?.disguise_system_prompt !== undefined
			? body.disguise_system_prompt?.trim() || null
			: (dbChannel?.disguise_system_prompt ?? null);
	const text =
		typeof body?.text === "string" && body.text.trim().length > 0
			? body.text
			: await getModelTestPrompt(c.env.DB);

	// Minimal ChannelRecord: buildChannelRequest only reads base_url /
	// api_key / api_format / custom_headers_json / disguise_*（plus typing-required
	// identity fields）.
	const channelLike: ChannelRecord = {
		id: dbChannel?.id ?? "model-test",
		name: dbChannel?.name ?? "model-test",
		base_url: baseUrl,
		api_key: apiKey,
		weight: Number(dbChannel?.weight ?? 1),
		status: dbChannel?.status ?? "active",
		api_format: apiFormat,
		api_formats: null,
		custom_headers_json: customHeadersJson,
		disguise_headers_json: disguiseHeadersJson,
		disguise_system_prompt: disguiseSystemPrompt,
	};

	const { bodyText, parsedBody } = buildModelTestRequestBody(model, text);
	const upstreamKey = parseApiKeys(apiKey)[0] ?? apiKey;
	const incomingHeaders = new Headers({ "content-type": "application/json" });

	// 豁免全局请求头策略：模型测试不注入/剔除全局头（policy=null，同
	// Playground），渠道级 custom_headers 仍生效
	const {
		target,
		headers,
		body: channelBody,
	} = buildChannelRequest(
		channelLike,
		"/v1/chat/completions",
		"",
		incomingHeaders,
		bodyText,
		parsedBody,
		false,
		upstreamKey,
		null,
		disguiseSystemPrompt,
	);

	const start = Date.now();
	let outcome: ModelTestOutcome;
	try {
		const response = await fetch(target, {
			method: "POST",
			headers,
			body: channelBody,
			signal: AbortSignal.timeout(MODEL_TEST_TIMEOUT_MS),
		});
		// 先归一为 OpenAI 风格再解析：anthropic / responses 渠道复用现有
		// 转换器（非流式），openai / custom 原样透传，保证三种格式得到
		// 统一回显；仅对 2xx 转换，非 2xx 直接走错误分支
		const normalized = response.ok
			? await convertResponse(
					channelLike,
					response,
					false,
					"/v1/chat/completions",
				)
			: response;
		outcome = await parseModelTestResponse(normalized);
	} catch (error) {
		outcome = {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
	return c.json({ ...outcome, elapsed: Date.now() - start });
});

/**
 * Tests channel connectivity and updates model list.
 */
channels.post("/:id/test", async (c) => {
	const id = c.req.param("id");
	const channel = await getChannelById(c.env.DB, id);
	if (!channel) {
		return jsonError(c, 404, "channel_not_found", "channel_not_found");
	}

	const result = await fetchChannelModels(
		String(channel.base_url),
		parseApiKeys(String(channel.api_key))[0] ?? String(channel.api_key),
		channel.api_format,
		channel.custom_headers_json,
		channel.disguise_headers_json ?? null,
	);

	if (!result.ok) {
		await updateChannelTestResult(c.env.DB, id, {
			ok: false,
			elapsed: result.elapsed,
		});
		return jsonError(c, 502, "channel_unreachable", "channel_unreachable");
	}

	// Check if channel already has models filled in
	const existingModels = safeJsonParse<unknown[]>(channel.models_json, []);
	const channelHasModels =
		Array.isArray(existingModels) && existingModels.length > 0;

	// Only overwrite models_json when the test returned models AND channel has no existing models
	const hasModels = result.models.length > 0;
	const updateData: {
		ok: boolean;
		elapsed: number;
		modelsJson?: string;
		existingModelsJson?: string | null;
	} = { ok: true, elapsed: result.elapsed };
	if (hasModels && result.payload && !channelHasModels) {
		const payloadData = Array.isArray(result.payload)
			? result.payload
			: ((result.payload as { data?: unknown[] })?.data ?? []);
		updateData.modelsJson = JSON.stringify(payloadData);
		updateData.existingModelsJson = channel.models_json ?? null;
	}
	await updateChannelTestResult(c.env.DB, id, updateData);

	const models = hasModels
		? result.models
		: safeJsonParse(channel.models_json, []);
	return c.json({ ok: true, models });
});

export default channels;
