import { Hono } from "hono";
import type { AppEnv } from "../env";
import { collectUniqueModelIds } from "../services/channel-models";
import { type ChannelRecord, createWeightedOrder } from "../services/channels";
import { jsonError } from "../utils/http";
import { parseApiKeys, shuffleArray } from "../utils/keys";
import { isRetryableStatus, sleep } from "../utils/retry";
import {
	buildChannelRequest,
	channelSupportsModel,
	convertResponse,
} from "./proxy";

const playground = new Hono<AppEnv>();

/**
 * Returns all unique model IDs from active channels, sorted alphabetically.
 */
playground.get("/models", async (c) => {
	const channelResult = await c.env.DB.prepare(
		"SELECT * FROM channels WHERE status = ?",
	)
		.bind("active")
		.all();
	const channels = (channelResult.results ?? []) as ChannelRecord[];
	const modelIds = collectUniqueModelIds(channels);
	return c.json({ models: modelIds.sort() });
});

/**
 * Simplified proxy for admin chat testing.
 * No usage recording, no balance deduction.
 */
playground.post("/chat", async (c) => {
	const body = await c.req.json<{
		model: string;
		messages: Array<{ role: string; content: string }>;
		stream?: boolean;
	}>();

	const { model, messages, stream: isStream = true } = body;

	if (!model || !messages || messages.length === 0) {
		return jsonError(
			c,
			400,
			"invalid_request",
			"model and messages are required",
		);
	}

	// Build OpenAI-compatible request body
	const requestBody: Record<string, unknown> = {
		model,
		messages,
		stream: isStream,
	};
	if (isStream) {
		requestBody.stream_options = { include_usage: true };
	}
	const requestText = JSON.stringify(requestBody);

	// Find active channels supporting this model
	const channelResult = await c.env.DB.prepare(
		"SELECT * FROM channels WHERE status = ?",
	)
		.bind("active")
		.all();
	const activeChannels = (channelResult.results ?? []) as ChannelRecord[];
	const candidates = activeChannels.filter((ch) =>
		channelSupportsModel(ch, model),
	);

	if (candidates.length === 0) {
		return jsonError(c, 503, "no_available_channels", "no_available_channels");
	}

	const ordered = createWeightedOrder(candidates);
	const targetPath = "/v1/chat/completions";
	const retryRounds = Math.max(1, Number(c.env.PROXY_RETRY_ROUNDS ?? "1"));
	const retryDelayMs = Math.max(0, Number(c.env.PROXY_RETRY_DELAY_MS ?? "200"));
	let lastResponse: Response | null = null;

	let round = 0;
	while (round < retryRounds) {
		let shouldRetry = false;
		for (const channel of ordered) {
			const keys = shuffleArray(parseApiKeys(channel.api_key));
			let channelRetryable = false;

			for (const apiKey of keys) {
				const incomingHeaders = new Headers();
				incomingHeaders.set("content-type", "application/json");

				// 豁免全局请求头策略：Playground 对话测试不注入/剔除全局头，
				// 不传 policy（默认 null），渠道级 custom_headers 仍生效
				const {
					target,
					headers,
					body: channelBody,
				} = buildChannelRequest(
					channel,
					targetPath,
					"",
					incomingHeaders,
					requestText,
					requestBody,
					isStream,
					apiKey,
				);

				try {
					const response = await fetch(target, {
						method: "POST",
						headers,
						body: channelBody,
					});

					if (response.ok) {
						lastResponse = await convertResponse(
							channel,
							response,
							isStream,
							targetPath,
						);
						// Return immediately on success
						if (isStream && lastResponse.body) {
							return new Response(lastResponse.body, {
								status: 200,
								headers: {
									"content-type": "text/event-stream",
									"cache-control": "no-cache",
									connection: "keep-alive",
								},
							});
						}
						return lastResponse;
					}

					lastResponse = response;
					if (isRetryableStatus(response.status)) {
						channelRetryable = true;
					} else {
						break;
					}
				} catch {
					lastResponse = null;
					channelRetryable = true;
				}
			}

			if (channelRetryable) {
				shouldRetry = true;
			}
		}

		if (!shouldRetry) break;
		round += 1;
		if (round < retryRounds) {
			await sleep(retryDelayMs);
		}
	}

	if (!lastResponse) {
		return jsonError(c, 502, "upstream_unavailable", "upstream_unavailable");
	}
	return lastResponse;
});

export default playground;
