import { Hono } from "hono";
import type { AppEnv } from "../env";
import { disableNonMaintainerChannels } from "../services/ldoh-blocking";
import { getLdohCookie } from "../services/settings";
import { jsonError } from "../utils/http";
import { nowIso } from "../utils/time";
import { extractHostname } from "../utils/url";

const ldoh = new Hono<AppEnv>();

/**
 * Extracts a LinuxDO username from a value that may be a profile URL.
 * e.g. "https://linux.do/u/wlwlwlwl" → "wlwlwlwl"
 */
function parseLinuxDoUsername(value: string): string {
	const trimmed = value.trim();
	const match = trimmed.match(/^https?:\/\/linux\.do\/u\/([^/\s]+)/);
	return match ? match[1] : trimmed;
}

type LdohApiMaintainer = {
	name?: string;
	id?: string;
	username?: string;
	profileUrl?: string;
};

type LdohApiSite = {
	id: string;
	name: string;
	description?: string;
	apiBaseUrl: string;
	tags?: string[];
	isOnlyMaintainerVisible?: boolean;
	maintainers?: LdohApiMaintainer[];
};

/**
 * Syncs sites from the LDOH API.
 */
ldoh.post("/sync", async (c) => {
	const cookie = await getLdohCookie(c.env.DB);
	if (!cookie) {
		return jsonError(
			c,
			400,
			"ldoh_cookie_not_set",
			"请先在设置中配置 LDOH Cookie",
		);
	}

	let sites: LdohApiSite[];
	try {
		const resp = await fetch("https://ldoh.105117.xyz/api/sites", {
			headers: { Cookie: cookie },
		});
		if (!resp.ok) {
			return jsonError(
				c,
				502,
				"ldoh_fetch_failed",
				`LDOH API 返回 ${resp.status}`,
			);
		}
		const data = (await resp.json()) as { sites?: LdohApiSite[] };
		sites = data.sites ?? [];
	} catch (error) {
		return jsonError(
			c,
			502,
			"ldoh_fetch_error",
			`无法连接 LDOH: ${(error as Error).message}`,
		);
	}

	const now = nowIso();
	let syncedSites = 0;
	let syncedMaintainers = 0;

	for (const site of sites) {
		const hostname = site.apiBaseUrl ? extractHostname(site.apiBaseUrl) : null;

		const siteId = site.id || crypto.randomUUID();
		const isVisible = site.isOnlyMaintainerVisible ? 0 : 1;

		// Check if site already exists before upsert
		const existingSite = await c.env.DB.prepare(
			"SELECT id FROM ldoh_sites WHERE id = ?",
		)
			.bind(siteId)
			.first();
		const isNewSite = !existingSite;

		await c.env.DB.prepare(
			`INSERT INTO ldoh_sites (id, name, description, api_base_url, api_base_hostname, tags_json, is_visible, source, synced_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, 'ldoh', ?)
			 ON CONFLICT(id) DO UPDATE SET
			   name = excluded.name,
			   description = excluded.description,
			   api_base_url = excluded.api_base_url,
			   api_base_hostname = excluded.api_base_hostname,
			   tags_json = excluded.tags_json,
			   is_visible = excluded.is_visible,
			   synced_at = excluded.synced_at`,
		)
			.bind(
				siteId,
				site.name || "Unknown",
				site.description || null,
				site.apiBaseUrl || null,
				hostname,
				site.tags ? JSON.stringify(site.tags) : null,
				isVisible,
				now,
			)
			.run();
		syncedSites++;

		// Auto-block new sites only (only if hostname is known)
		if (isNewSite && hostname) {
			await c.env.DB.prepare(
				"INSERT INTO ldoh_blocked_urls (id, site_id, hostname, blocked_by, created_at) VALUES (?, ?, ?, 'system', ?)",
			)
				.bind(crypto.randomUUID(), siteId, hostname, now)
				.run();
			await disableNonMaintainerChannels(c.env.DB, siteId, hostname);
		}

		// Process all maintainers (it's an array)
		for (const m of site.maintainers ?? []) {
			const username = parseLinuxDoUsername(m.username || m.profileUrl || "");
			if (!username) continue;
			const maintainerId = crypto.randomUUID();
			await c.env.DB.prepare(
				`INSERT INTO ldoh_site_maintainers (id, site_id, name, username, linuxdo_id, approved, source)
				 VALUES (?, ?, ?, ?, ?, 1, 'ldoh')
				 ON CONFLICT(site_id, username) DO UPDATE SET
				   name = excluded.name,
				   approved = 1,
				   source = 'ldoh'`,
			)
				.bind(maintainerId, siteId, m.name || username, username, m.id || null)
				.run();

			// Try to match user_id by linuxdo_username
			const localUser = await c.env.DB.prepare(
				"SELECT id FROM users WHERE linuxdo_username = ?",
			)
				.bind(username)
				.first<{ id: string }>();

			if (localUser) {
				await c.env.DB.prepare(
					"UPDATE ldoh_site_maintainers SET user_id = ? WHERE site_id = ? AND username = ?",
				)
					.bind(localUser.id, siteId, username)
					.run();
			}
			syncedMaintainers++;
		}
	}

	return c.json({
		ok: true,
		synced_sites: syncedSites,
		synced_maintainers: syncedMaintainers,
	});
});

/**
 * Manually adds a site with optional maintainer.
 */
ldoh.post("/sites", async (c) => {
	const body = await c.req.json().catch(() => null);
	if (!body?.apiBaseUrl) {
		return jsonError(c, 400, "missing_url", "请提供 API Base URL");
	}

	const apiBaseUrl = String(body.apiBaseUrl).trim();
	const hostname = extractHostname(apiBaseUrl);
	if (!hostname) {
		return jsonError(c, 400, "invalid_url", "无效的 URL");
	}

	const maintainerUsername = body.maintainerUsername
		? String(body.maintainerUsername).trim()
		: null;
	const siteName = body.name ? String(body.name).trim() : hostname;
	const now = nowIso();

	// Check if site already exists with this hostname
	const existing = await c.env.DB.prepare(
		"SELECT id FROM ldoh_sites WHERE api_base_hostname = ?",
	)
		.bind(hostname)
		.first<{ id: string }>();

	let siteId: string;

	if (existing) {
		siteId = existing.id;
	} else {
		siteId = crypto.randomUUID();
		await c.env.DB.prepare(
			`INSERT INTO ldoh_sites (id, name, api_base_url, api_base_hostname, source, synced_at)
			 VALUES (?, ?, ?, ?, 'manual', ?)`,
		)
			.bind(siteId, siteName, apiBaseUrl, hostname, now)
			.run();

		// Auto-block new sites only
		await c.env.DB.prepare(
			"INSERT INTO ldoh_blocked_urls (id, site_id, hostname, blocked_by, created_at) VALUES (?, ?, ?, 'system', ?)",
		)
			.bind(crypto.randomUUID(), siteId, hostname, now)
			.run();
		await disableNonMaintainerChannels(c.env.DB, siteId, hostname);
	}

	if (maintainerUsername) {
		const maintainerId = crypto.randomUUID();
		await c.env.DB.prepare(
			`INSERT INTO ldoh_site_maintainers (id, site_id, name, username, approved, source)
			 VALUES (?, ?, ?, ?, 1, 'manual')
			 ON CONFLICT(site_id, username) DO UPDATE SET
			   approved = 1,
			   source = 'manual'`,
		)
			.bind(maintainerId, siteId, maintainerUsername, maintainerUsername)
			.run();

		// Try to match user_id by linuxdo_username
		const localUser = await c.env.DB.prepare(
			"SELECT id FROM users WHERE linuxdo_username = ?",
		)
			.bind(maintainerUsername)
			.first<{ id: string }>();

		if (localUser) {
			await c.env.DB.prepare(
				"UPDATE ldoh_site_maintainers SET user_id = ? WHERE site_id = ? AND username = ?",
			)
				.bind(localUser.id, siteId, maintainerUsername)
				.run();
		}
	}

	return c.json({ ok: true, site_id: siteId });
});

/**
 * Lists all LDOH sites with maintainers, block status, pending channel count, violation count.
 */
ldoh.get("/sites", async (c) => {
	const sitesResult = await c.env.DB.prepare(
		"SELECT * FROM ldoh_sites ORDER BY name",
	).all();
	const sites = sitesResult.results ?? [];

	const maintainersResult = await c.env.DB.prepare(
		"SELECT * FROM ldoh_site_maintainers ORDER BY username",
	).all();
	const maintainers = maintainersResult.results ?? [];

	const blockedResult = await c.env.DB.prepare(
		"SELECT * FROM ldoh_blocked_urls",
	).all();
	const blocked = blockedResult.results ?? [];

	const pendingResult = await c.env.DB.prepare(
		`SELECT s.id as site_id, COUNT(c.id) as count
		 FROM ldoh_sites s
		 JOIN channels c ON c.status = 'pending'
		 WHERE LOWER(REPLACE(REPLACE(c.base_url, 'https://', ''), 'http://', '')) LIKE '%' || s.api_base_hostname || '%'
		 GROUP BY s.id`,
	).all();
	const pendingMap = new Map<string, number>();
	for (const row of pendingResult.results ?? []) {
		pendingMap.set(String(row.site_id), Number(row.count));
	}

	const violationResult = await c.env.DB.prepare(
		"SELECT site_id, COUNT(*) as count FROM ldoh_violations GROUP BY site_id",
	).all();
	const violationMap = new Map<string, number>();
	for (const row of violationResult.results ?? []) {
		violationMap.set(String(row.site_id), Number(row.count));
	}

	const enriched = sites.map((site) => ({
		...site,
		maintainers: maintainers.filter((m) => m.site_id === site.id),
		blocked: blocked.filter((b) => b.site_id === site.id),
		pending_channels: pendingMap.get(String(site.id)) ?? 0,
		violation_count: violationMap.get(String(site.id)) ?? 0,
	}));

	return c.json({ sites: enriched });
});

/**
 * Lists all violations.
 */
ldoh.get("/violations", async (c) => {
	const result = await c.env.DB.prepare(
		"SELECT * FROM ldoh_violations ORDER BY created_at DESC LIMIT 200",
	).all();
	return c.json({ violations: result.results ?? [] });
});

/**
 * Approves a manually declared maintainer.
 */
ldoh.post("/maintainers/:id/approve", async (c) => {
	const id = c.req.param("id");
	const existing = await c.env.DB.prepare(
		"SELECT id, username FROM ldoh_site_maintainers WHERE id = ?",
	)
		.bind(id)
		.first();

	if (!existing) {
		return jsonError(c, 404, "maintainer_not_found", "maintainer_not_found");
	}

	await c.env.DB.prepare(
		"UPDATE ldoh_site_maintainers SET approved = 1 WHERE id = ?",
	)
		.bind(id)
		.run();

	// Try to match user_id by linuxdo_username
	const localUser = await c.env.DB.prepare(
		"SELECT id FROM users WHERE linuxdo_username = ?",
	)
		.bind(existing.username)
		.first<{ id: string }>();

	if (localUser) {
		await c.env.DB.prepare(
			"UPDATE ldoh_site_maintainers SET user_id = ? WHERE id = ?",
		)
			.bind(localUser.id, id)
			.run();
	}

	return c.json({ ok: true });
});

/**
 * Removes a maintainer.
 */
ldoh.delete("/maintainers/:id", async (c) => {
	const id = c.req.param("id");
	await c.env.DB.prepare("DELETE FROM ldoh_site_maintainers WHERE id = ?")
		.bind(id)
		.run();
	return c.json({ ok: true });
});

/**
 * Approves a pending channel.
 */
ldoh.post("/channels/:channelId/approve", async (c) => {
	const channelId = c.req.param("channelId");
	const channel = await c.env.DB.prepare(
		"SELECT id, status FROM channels WHERE id = ?",
	)
		.bind(channelId)
		.first();

	if (!channel) {
		return jsonError(c, 404, "channel_not_found", "channel_not_found");
	}

	await c.env.DB.prepare(
		"UPDATE channels SET status = 'active', updated_at = ? WHERE id = ?",
	)
		.bind(nowIso(), channelId)
		.run();

	return c.json({ ok: true });
});

/**
 * Rejects a pending channel (deletes it).
 */
ldoh.post("/channels/:channelId/reject", async (c) => {
	const channelId = c.req.param("channelId");
	await c.env.DB.prepare("DELETE FROM channels WHERE id = ?")
		.bind(channelId)
		.run();
	return c.json({ ok: true });
});

/**
 * Updates a site's name, description, API base URLs, and/or maintainers.
 */
ldoh.patch("/sites/:id", async (c) => {
	const id = c.req.param("id");
	const body = await c.req.json().catch(() => null);
	if (!body) {
		return jsonError(c, 400, "invalid_body", "请提供更新数据");
	}

	const existing = await c.env.DB.prepare(
		"SELECT * FROM ldoh_sites WHERE id = ?",
	)
		.bind(id)
		.first();
	if (!existing) {
		return jsonError(c, 404, "site_not_found", "站点不存在");
	}

	const name = body.name != null ? String(body.name).trim() : null;
	const description =
		body.description != null ? String(body.description).trim() : null;

	// Support multi-URL: apiBaseUrls (newline-separated string or array) or legacy apiBaseUrl
	const rawUrls = body.apiBaseUrls ?? body.apiBaseUrl ?? null;
	let urls: string[] = [];
	if (rawUrls != null) {
		if (Array.isArray(rawUrls)) {
			urls = rawUrls.map((u: string) => String(u).trim()).filter(Boolean);
		} else {
			urls = String(rawUrls)
				.split("\n")
				.map((u) => u.trim())
				.filter(Boolean);
		}
	}

	const hostnames: string[] = [];
	for (const url of urls) {
		const h = extractHostname(url);
		if (!h) {
			return jsonError(c, 400, "invalid_url", `无效的 URL: ${url}`);
		}
		hostnames.push(h);
	}

	const sets: string[] = [];
	const binds: unknown[] = [];

	if (name) {
		sets.push("name = ?");
		binds.push(name);
	}
	if (description != null) {
		sets.push("description = ?");
		binds.push(description || null);
	}
	if (urls.length > 0) {
		sets.push("api_base_url = ?");
		binds.push(urls.join("\n"));
		sets.push("api_base_hostname = ?");
		binds.push(hostnames.join(","));
	}

	if (sets.length > 0) {
		binds.push(id);
		await c.env.DB.prepare(
			`UPDATE ldoh_sites SET ${sets.join(", ")} WHERE id = ?`,
		)
			.bind(...binds)
			.run();
	}

	// If hostnames changed, sync ldoh_blocked_urls
	if (hostnames.length > 0) {
		const oldHostnames = String(existing.api_base_hostname ?? "");
		const newHostnamesStr = hostnames.join(",");
		if (newHostnamesStr !== oldHostnames) {
			// Check if site is currently blocked
			const blockedCount = await c.env.DB.prepare(
				"SELECT COUNT(*) as cnt FROM ldoh_blocked_urls WHERE site_id = ?",
			)
				.bind(id)
				.first<{ cnt: number }>();

			if (blockedCount && blockedCount.cnt > 0) {
				// Delete old blocked records and insert new ones for each hostname
				await c.env.DB.prepare(
					"DELETE FROM ldoh_blocked_urls WHERE site_id = ?",
				)
					.bind(id)
					.run();
				const now = nowIso();
				for (const h of hostnames) {
					await c.env.DB.prepare(
						"INSERT INTO ldoh_blocked_urls (id, site_id, hostname, blocked_by, created_at) VALUES (?, ?, ?, 'admin', ?)",
					)
						.bind(crypto.randomUUID(), id, h, now)
						.run();
				}
			}
		}
	}

	// Handle maintainers
	const maintainers = body.maintainers as
		| { add?: string[]; remove?: string[] }
		| undefined;
	if (maintainers?.add) {
		for (const username of maintainers.add) {
			const trimmed = parseLinuxDoUsername(String(username));
			if (!trimmed) continue;
			const maintainerId = crypto.randomUUID();
			await c.env.DB.prepare(
				`INSERT INTO ldoh_site_maintainers (id, site_id, name, username, approved, source)
				 VALUES (?, ?, ?, ?, 1, 'manual')
				 ON CONFLICT(site_id, username) DO UPDATE SET
				   approved = 1,
				   source = 'manual'`,
			)
				.bind(maintainerId, id, trimmed, trimmed)
				.run();

			const localUser = await c.env.DB.prepare(
				"SELECT id FROM users WHERE linuxdo_username = ?",
			)
				.bind(trimmed)
				.first<{ id: string }>();
			if (localUser) {
				await c.env.DB.prepare(
					"UPDATE ldoh_site_maintainers SET user_id = ? WHERE site_id = ? AND username = ?",
				)
					.bind(localUser.id, id, trimmed)
					.run();
			}
		}
	}
	if (maintainers?.remove) {
		for (const mid of maintainers.remove) {
			await c.env.DB.prepare(
				"DELETE FROM ldoh_site_maintainers WHERE id = ? AND site_id = ?",
			)
				.bind(mid, id)
				.run();
		}
	}

	return c.json({ ok: true });
});

/**
 * Adds a maintainer to a site.
 */
ldoh.post("/sites/:id/maintainers", async (c) => {
	const siteId = c.req.param("id");
	const body = await c.req.json().catch(() => null);
	if (!body?.username) {
		return jsonError(c, 400, "missing_username", "请提供用户名");
	}

	const existing = await c.env.DB.prepare(
		"SELECT id FROM ldoh_sites WHERE id = ?",
	)
		.bind(siteId)
		.first();
	if (!existing) {
		return jsonError(c, 404, "site_not_found", "站点不存在");
	}

	const username = parseLinuxDoUsername(String(body.username));
	if (!username) {
		return jsonError(c, 400, "invalid_username", "无效的用户名");
	}

	const maintainerId = crypto.randomUUID();
	await c.env.DB.prepare(
		`INSERT INTO ldoh_site_maintainers (id, site_id, name, username, approved, source)
		 VALUES (?, ?, ?, ?, 1, 'manual')
		 ON CONFLICT(site_id, username) DO UPDATE SET
		   approved = 1,
		   source = 'manual'`,
	)
		.bind(maintainerId, siteId, username, username)
		.run();

	const localUser = await c.env.DB.prepare(
		"SELECT id FROM users WHERE linuxdo_username = ?",
	)
		.bind(username)
		.first<{ id: string }>();
	if (localUser) {
		await c.env.DB.prepare(
			"UPDATE ldoh_site_maintainers SET user_id = ? WHERE site_id = ? AND username = ?",
		)
			.bind(localUser.id, siteId, username)
			.run();
	}

	return c.json({ ok: true });
});

/**
 * Deletes a site and all associated data.
 */
ldoh.delete("/sites/:id", async (c) => {
	const id = c.req.param("id");

	await c.env.DB.prepare("DELETE FROM ldoh_site_maintainers WHERE site_id = ?")
		.bind(id)
		.run();
	await c.env.DB.prepare("DELETE FROM ldoh_blocked_urls WHERE site_id = ?")
		.bind(id)
		.run();
	await c.env.DB.prepare("DELETE FROM ldoh_violations WHERE site_id = ?")
		.bind(id)
		.run();
	await c.env.DB.prepare("DELETE FROM ldoh_sites WHERE id = ?").bind(id).run();

	return c.json({ ok: true });
});

/**
 * Blocks all currently unblocked sites.
 */
ldoh.post("/block-all", async (c) => {
	const now = nowIso();
	const sites = await c.env.DB.prepare(
		`SELECT s.id, s.api_base_hostname FROM ldoh_sites s
		 WHERE NOT EXISTS (SELECT 1 FROM ldoh_blocked_urls b WHERE b.site_id = s.id)`,
	).all();

	let blocked = 0;
	for (const site of sites.results ?? []) {
		const hostnames = String(site.api_base_hostname)
			.split(",")
			.map((h) => h.trim())
			.filter(Boolean);
		for (const h of hostnames) {
			await c.env.DB.prepare(
				"INSERT INTO ldoh_blocked_urls (id, site_id, hostname, blocked_by, created_at) VALUES (?, ?, ?, 'admin', ?)",
			)
				.bind(crypto.randomUUID(), site.id, h, now)
				.run();
		}
		await disableNonMaintainerChannels(c.env.DB, String(site.id), hostnames);
		blocked++;
	}

	return c.json({ ok: true, blocked });
});

export default ldoh;
