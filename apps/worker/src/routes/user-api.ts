import { Hono } from "hono";
import type { AppEnv } from "../env";
import type { UserRecord } from "../middleware/userAuth";
import { userAuth } from "../middleware/userAuth";
import {
	extractModelIds,
	extractModelPricings,
	extractSharedModelPricings,
} from "../services/channel-models";
import { listActiveChannels } from "../services/channel-repo";
import { loadAllChannelAliasesGrouped } from "../services/model-aliases";
import {
	getChannelReviewEnabled,
	getCheckinReward,
	getLdcExchangeRate,
	getLdcPaymentEnabled,
	getSiteMode,
	getUserChannelSelectionEnabled,
	getWithdrawalEnabled,
	getWithdrawalFeeRate,
} from "../services/settings";
import { generateToken, sha256Hex } from "../utils/crypto";
import { jsonError } from "../utils/http";
import { nowIso } from "../utils/time";

const userApi = new Hono<AppEnv>();

// All routes require user authentication
userApi.use("/*", userAuth);

/**
 * Updates the current user's profile (tip_url).
 */
userApi.patch("/profile", async (c) => {
	const userId = c.get("userId") as string;
	const body = await c.req.json().catch(() => null);
	if (!body) {
		return jsonError(c, 400, "missing_body", "missing_body");
	}

	if (body.tip_url !== undefined) {
		const tipUrl = String(body.tip_url).trim() || null;
		await c.env.DB.prepare(
			"UPDATE users SET tip_url = ?, updated_at = ? WHERE id = ?",
		)
			.bind(tipUrl, nowIso(), userId)
			.run();
	}

	return c.json({ ok: true });
});

/**
 * Returns models visible to users using the effective mapping algorithm.
 */
userApi.get("/models", async (c) => {
	const siteMode = await getSiteMode(c.env.DB);
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
		const pricings =
			siteMode === "shared"
				? extractSharedModelPricings(channel)
				: extractModelPricings(channel);
		const modelIds = pricings.map((p) => p.id);
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

	return c.json({ models, site_mode: siteMode });
});

/**
 * Lists the current user's tokens.
 */
userApi.get("/tokens", async (c) => {
	const userId = c.get("userId") as string;
	const result = await c.env.DB.prepare(
		"SELECT id, name, key_prefix, quota_total, quota_used, status, allowed_channels, created_at, updated_at FROM tokens WHERE user_id = ? ORDER BY created_at DESC",
	)
		.bind(userId)
		.all();
	return c.json({ tokens: result.results ?? [] });
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

	let allowedChannels: string | null = null;
	if (
		body.allowed_channels &&
		typeof body.allowed_channels === "object" &&
		!Array.isArray(body.allowed_channels)
	) {
		const channelSelectionEnabled = await getUserChannelSelectionEnabled(
			c.env.DB,
		);
		if (!channelSelectionEnabled) {
			return jsonError(
				c,
				403,
				"channel_selection_disabled",
				"channel_selection_disabled",
			);
		}
		// Validate: Record<string, string[]>
		const map = body.allowed_channels as Record<string, unknown>;
		const cleaned: Record<string, string[]> = {};
		for (const [modelId, chIds] of Object.entries(map)) {
			if (Array.isArray(chIds) && chIds.length > 0) {
				cleaned[modelId] = chIds.filter((v: unknown) => typeof v === "string");
			}
		}
		if (Object.keys(cleaned).length > 0) {
			allowedChannels = JSON.stringify(cleaned);
		}
	}

	const rawToken = generateToken("sk-");
	const tokenHash = await sha256Hex(rawToken);
	const id = crypto.randomUUID();
	const now = nowIso();
	const keyPrefix = rawToken.slice(0, 8);

	await c.env.DB.prepare(
		"INSERT INTO tokens (id, name, key_hash, key_prefix, token_plain, quota_total, quota_used, status, allowed_channels, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
			allowedChannels,
			userId,
			now,
			now,
		)
		.run();

	return c.json({ id, token: rawToken });
});

/**
 * Updates a user's token (name, allowed_channels).
 */
userApi.patch("/tokens/:id", async (c) => {
	const userId = c.get("userId") as string;
	const tokenId = c.req.param("id");
	const body = await c.req.json().catch(() => null);
	if (!body) {
		return jsonError(c, 400, "missing_body", "missing_body");
	}

	const existing = await c.env.DB.prepare(
		"SELECT id, name, allowed_channels FROM tokens WHERE id = ? AND user_id = ?",
	)
		.bind(tokenId, userId)
		.first<{ id: string; name: string; allowed_channels: string | null }>();

	if (!existing) {
		return jsonError(c, 404, "token_not_found", "token_not_found");
	}

	const newName =
		typeof body.name === "string" && body.name.trim()
			? body.name.trim()
			: existing.name;

	let newAllowedChannels: string | null = existing.allowed_channels;
	if (body.allowed_channels !== undefined) {
		if (body.allowed_channels === null) {
			newAllowedChannels = null;
		} else if (
			typeof body.allowed_channels === "object" &&
			!Array.isArray(body.allowed_channels)
		) {
			const channelSelectionEnabled = await getUserChannelSelectionEnabled(
				c.env.DB,
			);
			if (!channelSelectionEnabled) {
				return jsonError(
					c,
					403,
					"channel_selection_disabled",
					"channel_selection_disabled",
				);
			}
			const map = body.allowed_channels as Record<string, unknown>;
			const cleaned: Record<string, string[]> = {};
			for (const [modelId, chIds] of Object.entries(map)) {
				if (Array.isArray(chIds) && chIds.length > 0) {
					cleaned[modelId] = chIds.filter(
						(v: unknown) => typeof v === "string",
					);
				}
			}
			newAllowedChannels =
				Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned) : null;
		}
	}

	await c.env.DB.prepare(
		"UPDATE tokens SET name = ?, allowed_channels = ?, updated_at = ? WHERE id = ? AND user_id = ?",
	)
		.bind(newName, newAllowedChannels, nowIso(), tokenId, userId)
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

	const siteMode = await getSiteMode(c.env.DB);
	const checkinReward = await getCheckinReward(c.env.DB);
	const ldcPaymentEnabled = await getLdcPaymentEnabled(c.env.DB);
	const ldcExchangeRate = await getLdcExchangeRate(c.env.DB);
	const withdrawalEnabled = await getWithdrawalEnabled(c.env.DB);
	const withdrawalFeeRate = await getWithdrawalFeeRate(c.env.DB);
	const userChannelSelectionEnabled = await getUserChannelSelectionEnabled(
		c.env.DB,
	);
	const channelReviewEnabled = await getChannelReviewEnabled(c.env.DB);
	const todayStr = new Date().toISOString().slice(0, 10);
	const checkinRow = await c.env.DB.prepare(
		"SELECT id FROM user_checkins WHERE user_id = ? AND checkin_date = ?",
	)
		.bind(userId, todayStr)
		.first();
	const checkedInToday = Boolean(checkinRow);

	let contributions: Array<{
		user_name: string;
		linuxdo_id: string | null;
		linuxdo_username: string | null;
		tip_url: string | null;
		channel_count: number;
		channels: Array<{ name: string; requests: number; total_tokens: number }>;
		total_requests: number;
		total_tokens: number;
	}> = [];

	if (siteMode === "shared") {
		const contribRows = await c.env.DB.prepare(
			`SELECT
				u.id AS user_id,
				u.name AS user_name,
				u.linuxdo_id,
				u.linuxdo_username,
				u.tip_url,
				COUNT(DISTINCT c.id) AS channel_count,
				COALESCE(SUM(CASE WHEN ul.id IS NOT NULL THEN 1 ELSE 0 END), 0) AS total_requests,
				COALESCE(SUM(ul.total_tokens), 0) AS total_tokens
			FROM channels c
			JOIN users u ON c.contributed_by = u.id
			LEFT JOIN usage_logs ul ON ul.channel_id = c.id
			WHERE c.contributed_by IS NOT NULL AND c.status = 'active'
			GROUP BY u.id, u.name, u.linuxdo_id, u.linuxdo_username, u.tip_url
			ORDER BY total_requests DESC`,
		).all();

		const contributorIds = (contribRows.results ?? []).map((r) =>
			String(r.user_id),
		);

		const channelDetailMap = new Map<
			string,
			Array<{ name: string; requests: number; total_tokens: number }>
		>();
		if (contributorIds.length > 0) {
			const channelRows = await c.env.DB.prepare(
				`SELECT
					c.contributed_by,
					c.name,
					COALESCE(SUM(CASE WHEN ul.id IS NOT NULL THEN 1 ELSE 0 END), 0) AS requests,
					COALESCE(SUM(ul.total_tokens), 0) AS total_tokens
				FROM channels c
				LEFT JOIN usage_logs ul ON ul.channel_id = c.id
				WHERE c.contributed_by IS NOT NULL AND c.status = 'active'
				GROUP BY c.id, c.contributed_by, c.name
				ORDER BY requests DESC`,
			).all();

			for (const row of channelRows.results ?? []) {
				const uid = String(row.contributed_by);
				const arr = channelDetailMap.get(uid) ?? [];
				arr.push({
					name: String(row.name),
					requests: Number(row.requests),
					total_tokens: Number(row.total_tokens),
				});
				channelDetailMap.set(uid, arr);
			}
		}

		contributions = (contribRows.results ?? []).map((row) => ({
			user_name: String(row.user_name),
			linuxdo_id: row.linuxdo_id ? String(row.linuxdo_id) : null,
			linuxdo_username: row.linuxdo_username
				? String(row.linuxdo_username)
				: null,
			tip_url: row.tip_url ? String(row.tip_url) : null,
			channel_count: Number(row.channel_count),
			channels: channelDetailMap.get(String(row.user_id)) ?? [],
			total_requests: Number(row.total_requests),
			total_tokens: Number(row.total_tokens),
		}));
	}

	// Fetch recent violations for shame wall
	const violationsResult = await c.env.DB.prepare(
		"SELECT * FROM ldoh_violations ORDER BY created_at DESC LIMIT 50",
	).all();
	const violationRows = violationsResult.results ?? [];

	return c.json({
		balance: user.balance,
		withdrawable_balance: Math.min(user.balance, user.withdrawable_balance),
		total_requests: summary?.total_requests ?? 0,
		total_tokens: summary?.total_tokens ?? 0,
		total_cost: summary?.total_cost ?? 0,
		recent_usage: recentUsage.results ?? [],
		contributions,
		checked_in_today: checkedInToday,
		checkin_reward: checkinReward,
		ldc_payment_enabled: ldcPaymentEnabled,
		ldc_exchange_rate: ldcExchangeRate,
		withdrawal_enabled: withdrawalEnabled,
		withdrawal_fee_rate: withdrawalFeeRate,
		user_channel_selection_enabled: userChannelSelectionEnabled,
		channel_review_enabled: channelReviewEnabled,
		violations: violationRows,
	});
});

export default userApi;
