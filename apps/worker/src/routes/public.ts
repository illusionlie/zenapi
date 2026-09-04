import { Hono } from "hono";
import type { AppEnv } from "../env";
import {
	extractModelPricings,
	extractSharedModelPricings,
} from "../services/channel-models";
import { listActiveChannels } from "../services/channel-repo";
import { loadAllChannelAliasesGrouped } from "../services/model-aliases";
import {
	getAnnouncement,
	getLdcPaymentEnabled,
	getRegistrationMode,
	getRequireInviteCode,
	getSiteMode,
} from "../services/settings";

const publicRoutes = new Hono<AppEnv>();

/**
 * Lightweight site info endpoint — always accessible.
 */
publicRoutes.get("/site-info", async (c) => {
	const siteMode = await getSiteMode(c.env.DB);
	const registrationMode = await getRegistrationMode(c.env.DB);
	const linuxdoEnabled = Boolean(c.env.LINUXDO_CLIENT_ID);
	const requireInviteCode = await getRequireInviteCode(c.env.DB);
	const ldcPaymentEnabled = await getLdcPaymentEnabled(c.env.DB);
	const announcement = await getAnnouncement(c.env.DB);
	return c.json({
		site_mode: siteMode,
		registration_mode: registrationMode,
		linuxdo_enabled: linuxdoEnabled,
		require_invite_code: requireInviteCode,
		ldc_payment_enabled: ldcPaymentEnabled,
		announcement,
	});
});

/**
 * Public models endpoint — controlled by site mode.
 *
 * personal → 403, not public
 * service  → show models with prices (users pay per usage)
 * shared   → show shared-flagged models only, hide prices and channel names
 */
publicRoutes.get("/models", async (c) => {
	const siteMode = await getSiteMode(c.env.DB);

	if (siteMode === "personal") {
		return c.json({ error: "模型信息不公开" }, 403);
	}

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
		const chAliases = aliasGroups.get(channel.id);

		for (const p of pricings) {
			const aliasInfo = chAliases?.get(p.id);
			const isAliasOnly = aliasInfo?.alias_only ?? false;
			const chInfo: ChannelEntry =
				siteMode === "shared"
					? {
							id: channel.id,
							name: "共享渠道",
							input_price: null,
							output_price: null,
						}
					: {
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
 * Public contributions endpoint — only available in shared mode.
 * Returns contributor leaderboard with linuxdo_id/username for LDC tipping.
 */
publicRoutes.get("/contributions", async (c) => {
	const siteMode = await getSiteMode(c.env.DB);
	if (siteMode !== "shared") {
		return c.json({ error: "贡献榜不公开" }, 403);
	}

	const contribRows = await c.env.DB.prepare(
		`SELECT
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

	const contributions = (contribRows.results ?? []).map((row) => ({
		user_name: String(row.user_name),
		linuxdo_id: row.linuxdo_id ? String(row.linuxdo_id) : null,
		linuxdo_username: row.linuxdo_username
			? String(row.linuxdo_username)
			: null,
		tip_url: row.tip_url ? String(row.tip_url) : null,
		channel_count: Number(row.channel_count),
		total_requests: Number(row.total_requests),
		total_tokens: Number(row.total_tokens),
	}));

	return c.json({ contributions });
});

export default publicRoutes;
