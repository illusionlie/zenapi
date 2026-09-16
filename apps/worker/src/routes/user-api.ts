import { Hono } from "hono";
import type { AppEnv } from "../env";
import type { UserRecord } from "../middleware/userAuth";
import { userAuth } from "../middleware/userAuth";
import { extractModelPricings } from "../services/channel-models";
import { listActiveChannels } from "../services/channel-repo";
import { loadAllChannelAliasesGrouped } from "../services/model-aliases";
import {
	getCheckinReward,
	getLdcExchangeRate,
	getLdcPaymentEnabled,
} from "../services/settings";
import { resolveUserTokenUpdate } from "../services/token-update";
import { generateToken, sha256Hex } from "../utils/crypto";
import { jsonError } from "../utils/http";
import {
	filterModelsByAllowlist,
	parseAllowlist,
	serializeAllowlist,
} from "../utils/model-allowlist";
import { nowIso } from "../utils/time";

const userApi = new Hono<AppEnv>();

// All routes require user authentication
userApi.use("/*", userAuth);

/**
 * Returns models visible to users using the effective mapping algorithm.
 */
userApi.get("/models", async (c) => {
	const channels = await listActiveChannels(c.env.DB);

	// Load alias data
	const aliasGroups = await loadAllChannelAliasesGrouped(c.env.DB);

	// Compute effective mapping
	type ChannelEntry = {
		id: string;
		name: string;
		input_price: number | null;
		output_price: number | null;
	};
	const effectiveMap = new Map<
		string,
		{ channels: Map<string, ChannelEntry> }
	>();

	for (const channel of channels) {
		const pricings = extractModelPricings(channel);
		const chAliases = aliasGroups.get(channel.id);

		for (const p of pricings) {
			const aliasInfo = chAliases?.get(p.id);
			const isAliasOnly = aliasInfo?.alias_only ?? false;
			const chInfo: ChannelEntry = {
				id: channel.id,
				name: channel.name,
				input_price: p.input_price ?? null,
				output_price: p.output_price ?? null,
			};

			// Original name (unless alias_only)
			if (!isAliasOnly) {
				let entry = effectiveMap.get(p.id);
				if (!entry) {
					entry = { channels: new Map() };
					effectiveMap.set(p.id, entry);
				}
				entry.channels.set(channel.id, chInfo);
			}

			// Alias names
			if (aliasInfo) {
				for (const alias of aliasInfo.aliases) {
					let entry = effectiveMap.get(alias);
					if (!entry) {
						entry = { channels: new Map() };
						effectiveMap.set(alias, entry);
					}
					entry.channels.set(channel.id, chInfo);
				}
			}
		}
	}

	const models: Array<{ id: string; channels: ChannelEntry[] }> = [];
	for (const [callableName, entry] of effectiveMap) {
		models.push({
			id: callableName,
			channels: Array.from(entry.channels.values()),
		});
	}

	// Filter by the current user's model allowlist (null = unrestricted)
	const userRecord = c.get("userRecord") as UserRecord;
	const allowlist = parseAllowlist(userRecord.allowed_models);
	const visibleModels = filterModelsByAllowlist(models, allowlist);

	return c.json({ models: visibleModels });
});

/**
 * Lists the current user's tokens.
 */
userApi.get("/tokens", async (c) => {
	const userId = c.get("userId") as string;
	const result = await c.env.DB.prepare(
		"SELECT id, name, key_prefix, quota_total, quota_used, status, allowed_channels, allowed_models, created_at, updated_at FROM tokens WHERE user_id = ? ORDER BY created_at DESC",
	)
		.bind(userId)
		.all();
	const rows = (result.results ?? []) as Array<{
		id: string;
		name: string;
		key_prefix: string;
		quota_total: number | null;
		quota_used: number;
		status: string;
		allowed_channels: string | null;
		allowed_models: string | null;
		created_at: string;
		updated_at: string;
	}>;
	return c.json({
		tokens: rows.map((row) => ({
			...row,
			// Expose the parsed array (or null) so the frontend can consume it directly
			allowed_models: parseAllowlist(row.allowed_models),
		})),
	});
});

/**
 * Creates a new token for the current user.
 */
userApi.post("/tokens", async (c) => {
	const userId = c.get("userId") as string;
	const body = await c.req.json().catch(() => null);
	if (!body?.name) {
		return jsonError(c, 400, "name_required", "name_required");
	}

	const rawToken = generateToken("sk-", 32);
	const tokenHash = await sha256Hex(rawToken);
	const id = crypto.randomUUID();
	const now = nowIso();
	const keyPrefix = rawToken.slice(0, 8);

	const allowedModels = serializeAllowlist(body.allowed_models ?? null);
	if (!allowedModels.ok) {
		return jsonError(
			c,
			400,
			"invalid_allowed_models",
			"invalid_allowed_models",
		);
	}

	await c.env.DB.prepare(
		"INSERT INTO tokens (id, name, key_hash, key_prefix, token_plain, quota_total, quota_used, status, allowed_channels, allowed_models, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
	)
		.bind(
			id,
			body.name,
			tokenHash,
			keyPrefix,
			rawToken,
			null,
			0,
			"active",
			null,
			allowedModels.value,
			userId,
			now,
			now,
		)
		.run();

	return c.json({ id, token: rawToken });
});

/**
 * Updates a user's token (name / status / model allowlist).
 */
userApi.patch("/tokens/:id", async (c) => {
	const userId = c.get("userId") as string;
	const tokenId = c.req.param("id");
	const body = await c.req.json().catch(() => null);
	if (!body) {
		return jsonError(c, 400, "missing_body", "missing_body");
	}

	// Quota / channel fields are admin-only; users may edit name, status and
	// allowed_models (design.md D4)
	const forbiddenFields = ["quota_total", "quota_used", "allowed_channels"];
	if (
		typeof body === "object" &&
		forbiddenFields.some((field) => field in body)
	) {
		return jsonError(c, 400, "field_not_editable", "field_not_editable");
	}

	const existing = await c.env.DB.prepare(
		"SELECT id, name, status, allowed_models FROM tokens WHERE id = ? AND user_id = ?",
	)
		.bind(tokenId, userId)
		.first<{
			id: string;
			name: string;
			status: string;
			allowed_models: string | null;
		}>();

	if (!existing) {
		return jsonError(c, 404, "token_not_found", "token_not_found");
	}

	// Three-state resolution (undefined = keep, null = clear where meaningful,
	// invalid values → 400 instead of silently falling back to the old value)
	const resolved = resolveUserTokenUpdate(body, existing);
	if (!resolved.ok) {
		return jsonError(c, 400, resolved.error, resolved.error);
	}
	const values = resolved.values;

	await c.env.DB.prepare(
		"UPDATE tokens SET name = ?, status = ?, allowed_models = ?, updated_at = ? WHERE id = ? AND user_id = ?",
	)
		.bind(
			values.name,
			values.status,
			values.allowed_models,
			nowIso(),
			tokenId,
			userId,
		)
		.run();

	return c.json({ ok: true });
});

/**
 * Deletes a user's token.
 */
userApi.delete("/tokens/:id", async (c) => {
	const userId = c.get("userId") as string;
	const tokenId = c.req.param("id");

	const existing = await c.env.DB.prepare(
		"SELECT id FROM tokens WHERE id = ? AND user_id = ?",
	)
		.bind(tokenId, userId)
		.first();

	if (!existing) {
		return jsonError(c, 404, "token_not_found", "token_not_found");
	}

	await c.env.DB.prepare("DELETE FROM tokens WHERE id = ? AND user_id = ?")
		.bind(tokenId, userId)
		.run();

	return c.json({ ok: true });
});

/**
 * Reveals a user's token.
 */
userApi.get("/tokens/:id/reveal", async (c) => {
	const userId = c.get("userId") as string;
	const tokenId = c.req.param("id");

	const record = await c.env.DB.prepare(
		"SELECT token_plain FROM tokens WHERE id = ? AND user_id = ?",
	)
		.bind(tokenId, userId)
		.first<{ token_plain?: string | null }>();

	if (!record) {
		return jsonError(c, 404, "token_not_found", "token_not_found");
	}

	return c.json({ token: record.token_plain ?? null });
});

/**
 * Returns usage logs for the current user's tokens.
 */
userApi.get("/usage", async (c) => {
	const userId = c.get("userId") as string;
	const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);

	const result = await c.env.DB.prepare(
		`SELECT u.id, u.model, u.channel_id, u.token_id, u.total_tokens, u.prompt_tokens, u.completion_tokens, u.cost, u.latency_ms, u.first_token_latency_ms, u.stream, u.reasoning_effort, u.status, u.created_at,
		t.name as token_name
		FROM usage_logs u
		LEFT JOIN tokens t ON u.token_id = t.id
		WHERE t.user_id = ?
		ORDER BY u.created_at DESC
		LIMIT ?`,
	)
		.bind(userId, limit)
		.all();

	return c.json({ logs: result.results ?? [] });
});

/**
 * Daily check-in to receive balance reward.
 */
userApi.post("/checkin", async (c) => {
	const userId = c.get("userId") as string;
	const today = new Date().toISOString().slice(0, 10);

	const existing = await c.env.DB.prepare(
		"SELECT id FROM user_checkins WHERE user_id = ? AND checkin_date = ?",
	)
		.bind(userId, today)
		.first();

	if (existing) {
		return c.json({ already_checked_in: true });
	}

	const reward = await getCheckinReward(c.env.DB);
	const id = crypto.randomUUID();
	const now = nowIso();

	await c.env.DB.prepare(
		"INSERT INTO user_checkins (id, user_id, checkin_date, reward, created_at) VALUES (?, ?, ?, ?, ?)",
	)
		.bind(id, userId, today, reward, now)
		.run();

	await c.env.DB.prepare(
		"UPDATE users SET balance = balance + ?, updated_at = ? WHERE id = ?",
	)
		.bind(reward, now, userId)
		.run();

	const updated = await c.env.DB.prepare(
		"SELECT balance FROM users WHERE id = ?",
	)
		.bind(userId)
		.first<{ balance: number }>();

	return c.json({ ok: true, reward, new_balance: updated?.balance ?? 0 });
});

/**
 * Returns dashboard data for the current user.
 */
userApi.get("/dashboard", async (c) => {
	const userId = c.get("userId") as string;
	const user = c.get("userRecord") as UserRecord;

	const summary = await c.env.DB.prepare(
		`SELECT
			COUNT(*) as total_requests,
			COALESCE(SUM(u.total_tokens), 0) as total_tokens,
			COALESCE(SUM(u.cost), 0) as total_cost
		FROM usage_logs u
		JOIN tokens t ON u.token_id = t.id
		WHERE t.user_id = ?`,
	)
		.bind(userId)
		.first<{
			total_requests: number;
			total_tokens: number;
			total_cost: number;
		}>();

	const recentUsage = await c.env.DB.prepare(
		`SELECT
			DATE(u.created_at) as day,
			COUNT(*) as requests,
			COALESCE(SUM(u.cost), 0) as cost
		FROM usage_logs u
		JOIN tokens t ON u.token_id = t.id
		WHERE t.user_id = ?
		GROUP BY DATE(u.created_at)
		ORDER BY day DESC
		LIMIT 30`,
	)
		.bind(userId)
		.all();

	const checkinReward = await getCheckinReward(c.env.DB);
	const ldcPaymentEnabled = await getLdcPaymentEnabled(c.env.DB);
	const ldcExchangeRate = await getLdcExchangeRate(c.env.DB);
	const todayStr = new Date().toISOString().slice(0, 10);
	const checkinRow = await c.env.DB.prepare(
		"SELECT id FROM user_checkins WHERE user_id = ? AND checkin_date = ?",
	)
		.bind(userId, todayStr)
		.first();
	const checkedInToday = Boolean(checkinRow);

	return c.json({
		balance: user.balance,
		total_requests: summary?.total_requests ?? 0,
		total_tokens: summary?.total_tokens ?? 0,
		total_cost: summary?.total_cost ?? 0,
		recent_usage: recentUsage.results ?? [],
		checked_in_today: checkedInToday,
		checkin_reward: checkinReward,
		ldc_payment_enabled: ldcPaymentEnabled,
		ldc_exchange_rate: ldcExchangeRate,
	});
});

export default userApi;
