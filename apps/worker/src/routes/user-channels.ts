import { Hono } from "hono";
import type { AppEnv } from "../env";
import type { UserRecord } from "../middleware/userAuth";
import { userAuth } from "../middleware/userAuth";
import { saveChannelAliases } from "../services/model-aliases";
import { getChannelReviewEnabled, getSiteMode } from "../services/settings";
import { jsonError } from "../utils/http";
import { nowIso } from "../utils/time";
import { extractHostname, hostnameMatches } from "../utils/url";

type AliasConfig = {
	aliases: string[];
	alias_only: boolean;
};

const userChannels = new Hono<AppEnv>();

// All routes require user authentication
userChannels.use("/*", userAuth);

/**
 * Lists channels contributed by the current user.
 */
userChannels.get("/", async (c) => {
	const siteMode = await getSiteMode(c.env.DB);
	if (siteMode !== "shared") {
		return jsonError(c, 403, "shared_mode_only", "shared_mode_only");
	}

	const userId = c.get("userId") as string;
	const result = await c.env.DB.prepare(
		"SELECT id, name, base_url, api_key, models_json, api_format, status, charge_enabled, stream_only, contribution_note, created_at FROM channels WHERE contributed_by = ? ORDER BY created_at DESC",
	)
		.bind(userId)
		.all();

	const channels = result.results ?? [];

	// Collect channel IDs for per-channel alias query
	const channelIds = channels.map((ch) => ch.id as string);

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

	return c.json({ channels, channel_aliases: channelAliases });
});

/**
 * Contributes a new channel (shared mode only).
 */
userChannels.post("/", async (c) => {
	const siteMode = await getSiteMode(c.env.DB);
	if (siteMode !== "shared") {
		return jsonError(c, 403, "shared_mode_only", "shared_mode_only");
	}

	const userId = c.get("userId") as string;
	const user = c.get("userRecord") as UserRecord;
	const body = await c.req.json().catch(() => null);
	if (!body?.name || !body?.base_url) {
		return jsonError(c, 400, "missing_fields", "name, base_url required");
	}

	// LDOH protection: check blocked hostnames and pending requirement
	const baseUrl = String(body.base_url).trim();
	const hostname = extractHostname(baseUrl);
	let channelStatus = "active";

	// Check if channel review is enabled — always require pending
	const reviewEnabled = await getChannelReviewEnabled(c.env.DB);
	if (reviewEnabled) {
		channelStatus = "pending";
	}

	if (hostname) {
		// Check if hostname is blocked (domain suffix match)
		const blockedResult = await c.env.DB.prepare(
			"SELECT b.id, b.site_id, b.hostname, s.name as site_name FROM ldoh_blocked_urls b JOIN ldoh_sites s ON s.id = b.site_id",
		).all();

		const blocked = (blockedResult.results ?? []).find((row) =>
			hostnameMatches(hostname, String(row.hostname)),
		) as
			| { id: string; site_id: string; hostname: string; site_name: string }
			| undefined;

		if (blocked) {
			// Record violation
			const violationId = crypto.randomUUID();
			await c.env.DB.prepare(
				"INSERT INTO ldoh_violations (id, user_id, user_name, linuxdo_username, attempted_base_url, matched_hostname, site_id, site_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			)
				.bind(
					violationId,
					userId,
					user.name,
					user.linuxdo_username || null,
					baseUrl,
					hostname,
					blocked.site_id,
					blocked.site_name,
					nowIso(),
				)
				.run();

			return jsonError(
				c,
				403,
				"hostname_blocked",
				"该 API 地址已被站点维护者封禁",
			);
		}

		// Check if hostname matches an LDOH site → require pending approval (domain suffix match)
		const sitesResult = await c.env.DB.prepare(
			"SELECT id, api_base_hostname FROM ldoh_sites",
		).all();

		const matchedSite = (sitesResult.results ?? []).find((row) => {
			const siteHostnames = String(row.api_base_hostname)
				.split(",")
				.map((h) => h.trim());
			return siteHostnames.some((h) => hostnameMatches(hostname, h));
		});

		if (matchedSite) {
			channelStatus = "pending";
		}
	}

	const id = crypto.randomUUID();
	const now = nowIso();

	let modelsJson: string | null = null;
	if (body.models && Array.isArray(body.models)) {
		modelsJson = JSON.stringify(body.models);
	}

	await c.env.DB.prepare(
		"INSERT INTO channels (id, name, base_url, api_key, weight, status, api_format, models_json, custom_headers_json, contributed_by, charge_enabled, stream_only, contribution_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
	)
		.bind(
			id,
			String(body.name).trim(),
			String(body.base_url).trim(),
			String(body.api_key ?? "").trim(),
			body.weight ?? 1,
			channelStatus,
			body.api_format ?? "openai",
			modelsJson,
			body.custom_headers ? String(body.custom_headers) : null,
			userId,
			body.charge_enabled ? 1 : 0,
			body.stream_only ? 1 : 0,
			body.contribution_note ? String(body.contribution_note).trim() : null,
			now,
			now,
		)
		.run();

	// Save per-channel model aliases if provided
	if (body.model_aliases && typeof body.model_aliases === "object") {
		const modelIds = modelsJson
			? (JSON.parse(modelsJson) as Array<{ id?: string } | string>)
					.map((m) => (typeof m === "string" ? m : (m?.id ?? "")))
					.filter(Boolean)
			: [];
		for (const [modelId, config] of Object.entries(body.model_aliases)) {
			if (!modelIds.includes(modelId)) continue;
			const cfg = config as AliasConfig;
			if (cfg.aliases && cfg.aliases.length > 0) {
				await saveChannelAliases(
					c.env.DB,
					id,
					modelId,
					cfg.aliases.map((a) => ({ alias: a })),
					cfg.alias_only ?? false,
				);
			}
		}
	}

	return c.json({
		id,
		status: channelStatus,
		message: channelStatus === "pending" ? "渠道已创建，等待审批" : undefined,
	});
});

/**
 * Updates a channel contributed by the current user.
 */
userChannels.patch("/:id", async (c) => {
	const siteMode = await getSiteMode(c.env.DB);
	if (siteMode !== "shared") {
		return jsonError(c, 403, "shared_mode_only", "shared_mode_only");
	}

	const userId = c.get("userId") as string;
	const channelId = c.req.param("id");

	const existing = await c.env.DB.prepare(
		"SELECT id, name, base_url, api_key, api_format, models_json, charge_enabled, stream_only FROM channels WHERE id = ? AND contributed_by = ?",
	)
		.bind(channelId, userId)
		.first();

	if (!existing) {
		return jsonError(c, 404, "channel_not_found", "channel_not_found");
	}

	const body = await c.req.json().catch(() => null);
	if (!body) {
		return jsonError(c, 400, "missing_body", "missing_body");
	}

	const now = nowIso();
	let modelsJson = existing.models_json as string | null;
	if (body.models && Array.isArray(body.models)) {
		modelsJson = JSON.stringify(body.models);
	}

	await c.env.DB.prepare(
		"UPDATE channels SET name = ?, base_url = ?, api_key = ?, api_format = ?, models_json = ?, charge_enabled = ?, stream_only = ?, updated_at = ? WHERE id = ? AND contributed_by = ?",
	)
		.bind(
			body.name ? String(body.name).trim() : existing.name,
			body.base_url ? String(body.base_url).trim() : existing.base_url,
			body.api_key ? String(body.api_key).trim() : existing.api_key,
			body.api_format ?? existing.api_format ?? "openai",
			modelsJson,
			body.charge_enabled !== undefined
				? body.charge_enabled
					? 1
					: 0
				: (existing.charge_enabled ?? 0),
			body.stream_only !== undefined
				? body.stream_only
					? 1
					: 0
				: (existing.stream_only ?? 0),
			now,
			channelId,
			userId,
		)
		.run();

	// Save per-channel model aliases if provided
	if (body.model_aliases && typeof body.model_aliases === "object") {
		const modelIds = modelsJson
			? (JSON.parse(modelsJson) as Array<{ id?: string } | string>)
					.map((m) => (typeof m === "string" ? m : (m?.id ?? "")))
					.filter(Boolean)
			: [];
		for (const [modelId, config] of Object.entries(body.model_aliases)) {
			if (!modelIds.includes(modelId)) continue;
			const cfg = config as AliasConfig;
			await saveChannelAliases(
				c.env.DB,
				channelId,
				modelId,
				(cfg.aliases ?? []).map((a) => ({ alias: a })),
				cfg.alias_only ?? false,
			);
		}
	}

	return c.json({ ok: true });
});

/**
 * Deletes a channel contributed by the current user.
 */
userChannels.delete("/:id", async (c) => {
	const siteMode = await getSiteMode(c.env.DB);
	if (siteMode !== "shared") {
		return jsonError(c, 403, "shared_mode_only", "shared_mode_only");
	}

	const userId = c.get("userId") as string;
	const channelId = c.req.param("id");

	const existing = await c.env.DB.prepare(
		"SELECT id FROM channels WHERE id = ? AND contributed_by = ?",
	)
		.bind(channelId, userId)
		.first();

	if (!existing) {
		return jsonError(c, 404, "channel_not_found", "channel_not_found");
	}

	await c.env.DB.prepare(
		"DELETE FROM channels WHERE id = ? AND contributed_by = ?",
	)
		.bind(channelId, userId)
		.run();

	return c.json({ ok: true });
});

export default userChannels;
