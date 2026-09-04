import type { ChannelRecord } from "./channel-types";

/**
 * Resolves `channel_name/model_name` syntax in the model string.
 *
 * Channel names are matched longest-first so that a channel named "abc-pro"
 * is not shadowed by one named "abc".
 */
export function resolveChannelRoute(
	model: string | null,
	channels: ChannelRecord[],
): { targetChannel: ChannelRecord | null; actualModel: string | null } {
	if (!model) {
		return { targetChannel: null, actualModel: null };
	}

	// No slash → cannot be channel/model syntax
	if (!model.includes("/")) {
		return { targetChannel: null, actualModel: model };
	}

	// Sort channel names by length descending (longest match first)
	const sorted = channels.slice().sort((a, b) => b.name.length - a.name.length);

	for (const channel of sorted) {
		const prefix = channel.name + "/";
		if (model.startsWith(prefix)) {
			const actualModel = model.slice(prefix.length);
			return { targetChannel: channel, actualModel: actualModel || null };
		}
	}

	return { targetChannel: null, actualModel: model };
}
