import { Hono } from "hono";
import type { AppEnv } from "../env";
import { extractModelIds } from "../services/channel-models";
import { listActiveChannels } from "../services/channel-repo";
import {
	batchSaveAliasesForModel,
	loadAllChannelAliasesGrouped,
} from "../services/model-aliases";
import { jsonError } from "../utils/http";

const modelAliasRoutes = new Hono<AppEnv>();

/**
 * List all aliases grouped by model_id.
 * Queries channel_model_aliases and returns a union across channels.
 */
modelAliasRoutes.get("/", async (c) => {
	const aliasGroups = await loadAllChannelAliasesGrouped(c.env.DB);
	// Merge across all channels: for each model_id, collect unique aliases and alias_only
	const merged: Record<string, { aliases: string[]; alias_only: boolean }> = {};
	for (const [, channelMap] of aliasGroups) {
		for (const [modelId, info] of channelMap) {
			if (!merged[modelId]) {
				merged[modelId] = { aliases: [], alias_only: false };
			}
			for (const alias of info.aliases) {
				if (!merged[modelId].aliases.includes(alias)) {
					merged[modelId].aliases.push(alias);
				}
			}
			if (info.alias_only) {
				merged[modelId].alias_only = true;
			}
		}
	}
	return c.json({ aliases: merged });
});

/**
 * Save aliases for a specific model across all active channels that have it.
 * Body: { aliases: string[], alias_only: boolean }
 */
modelAliasRoutes.put("/:modelId", async (c) => {
	const modelId = c.req.param("modelId");
	const body = await c.req.json().catch(() => null);
	if (!body || !Array.isArray(body.aliases)) {
		return jsonError(c, 400, "invalid_body", "body must contain aliases array");
	}

	const aliases: string[] = [];
	for (const item of body.aliases) {
		if (typeof item !== "string" || !item.trim()) {
			return jsonError(
				c,
				400,
				"invalid_alias",
				"each alias must be a non-empty string",
			);
		}
		aliases.push(item.trim());
	}

	const aliasOnly = !!body.alias_only;

	// Find all active channels that have this modelId in their models_json
	const channels = await listActiveChannels(c.env.DB);
	const channelIds: string[] = [];
	for (const ch of channels) {
		const modelIds = extractModelIds(ch);
		if (modelIds.includes(modelId)) {
			channelIds.push(ch.id);
		}
	}

	try {
		await batchSaveAliasesForModel(
			c.env.DB,
			modelId,
			aliases,
			aliasOnly,
			channelIds,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : "unknown error";
		if (message.includes("UNIQUE")) {
			return jsonError(
				c,
				409,
				"alias_conflict",
				"one or more aliases are already in use by another model",
			);
		}
		throw error;
	}

	return c.json({ ok: true });
});

/**
 * Delete all aliases for a model across all channels.
 */
modelAliasRoutes.delete("/:modelId", async (c) => {
	const modelId = c.req.param("modelId");
	await c.env.DB.prepare("DELETE FROM channel_model_aliases WHERE model_id = ?")
		.bind(modelId)
		.run();
	return c.json({ ok: true });
});

export default modelAliasRoutes;
