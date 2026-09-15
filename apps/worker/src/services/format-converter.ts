/**
 * Bidirectional format conversion between OpenAI, Anthropic, and OpenAI
 * Responses APIs.
 */

type OpenAIMessage = {
	role: string;
	content:
		| string
		| Array<{ type: string; text?: string; [k: string]: unknown }>;
	[k: string]: unknown;
};

type OpenAIChatRequest = {
	model?: string;
	messages?: OpenAIMessage[];
	stream?: boolean;
	max_tokens?: number;
	temperature?: number;
	top_p?: number;
	stop?: string | string[];
	[k: string]: unknown;
};

type AnthropicContentBlock = {
	type: string;
	text?: string;
	[k: string]: unknown;
};

type AnthropicMessage = {
	role: string;
	content: string | AnthropicContentBlock[];
};

type AnthropicRequest = {
	model?: string;
	messages?: AnthropicMessage[];
	system?: string | Array<{ type: string; text: string }>;
	max_tokens?: number;
	stream?: boolean;
	temperature?: number;
	top_p?: number;
	stop_sequences?: string[];
	[k: string]: unknown;
};

type ResponsesRequest = {
	model?: string;
	input?: Array<Record<string, unknown>>;
	instructions?: string;
	max_output_tokens?: number;
	temperature?: number;
	top_p?: number;
	stream?: boolean;
	parallel_tool_calls?: boolean;
	user?: string;
	tools?: Array<Record<string, unknown>>;
	tool_choice?: unknown;
	text?: { format: Record<string, unknown> };
	reasoning?: { effort: string };
	[k: string]: unknown;
};

type ResponsesOutputItem = {
	type?: string;
	id?: string;
	call_id?: string;
	name?: string;
	arguments?: string;
	content?: Array<Record<string, unknown>>;
	[k: string]: unknown;
};

type ResponsesResponseBody = {
	id?: string;
	model?: string;
	created_at?: number;
	status?: string;
	output?: ResponsesOutputItem[];
	incomplete_details?: { reason?: string } | null;
	usage?: Record<string, unknown>;
	[k: string]: unknown;
};

// --- Request converters ---

/**
 * Converts an OpenAI chat completion request body to an Anthropic Messages request body.
 */
export function openaiToAnthropicRequest(
	body: OpenAIChatRequest,
): AnthropicRequest {
	const result: AnthropicRequest = {};
	if (body.model) {
		result.model = body.model;
	}
	if (body.stream !== undefined) {
		result.stream = body.stream;
	}
	result.max_tokens = body.max_tokens ?? 4096;
	if (body.temperature !== undefined) {
		result.temperature = body.temperature;
	}
	if (body.top_p !== undefined) {
		result.top_p = body.top_p;
	}
	if (body.stop) {
		result.stop_sequences = Array.isArray(body.stop) ? body.stop : [body.stop];
	}

	// Convert OpenAI tools to Anthropic tools format
	if (body.tools) {
		result.tools = (body.tools as Array<Record<string, unknown>>).map(
			(tool) => {
				const fn = ((tool as Record<string, unknown>).function ??
					tool) as Record<string, unknown>;
				return {
					name: fn.name as string,
					description: (fn.description as string) ?? "",
					input_schema: (fn.parameters as Record<string, unknown>) ?? {
						type: "object",
					},
				};
			},
		);
	}

	// Convert tool_choice
	if (body.tool_choice) {
		if (body.tool_choice === "auto") {
			result.tool_choice = { type: "auto" };
		} else if (body.tool_choice === "required") {
			result.tool_choice = { type: "any" };
		} else if (body.tool_choice === "none") {
			// Anthropic doesn't have "none" — omit tool_choice and tools
			delete result.tools;
		} else if (typeof body.tool_choice === "object") {
			const tc = body.tool_choice as Record<string, unknown>;
			const fn = tc.function as Record<string, unknown> | undefined;
			if (fn?.name) {
				result.tool_choice = { type: "tool", name: fn.name };
			}
		}
	}

	const systemParts: string[] = [];
	const rawMessages: Array<{
		role: string;
		content: string | AnthropicContentBlock[];
	}> = [];

	for (const msg of body.messages ?? []) {
		if (msg.role === "system") {
			const text =
				typeof msg.content === "string"
					? msg.content
					: (msg.content as Array<{ text?: string }>)
							.map((c) => c.text ?? "")
							.join("\n");
			systemParts.push(text);
		} else if (msg.role === "assistant") {
			const contentBlocks: AnthropicContentBlock[] = [];
			if (typeof msg.content === "string") {
				if (msg.content) {
					contentBlocks.push({ type: "text", text: msg.content });
				}
			} else if (Array.isArray(msg.content)) {
				contentBlocks.push(...(msg.content as AnthropicContentBlock[]));
			}
			// Convert tool_calls to tool_use content blocks
			const toolCalls = msg.tool_calls as
				| Array<Record<string, unknown>>
				| undefined;
			if (toolCalls) {
				for (const tc of toolCalls) {
					const fn = tc.function as Record<string, unknown> | undefined;
					let input: unknown = {};
					if (fn?.arguments) {
						try {
							input = JSON.parse(fn.arguments as string);
						} catch {
							input = {};
						}
					}
					contentBlocks.push({
						type: "tool_use",
						id: (tc.id as string) ?? `toolu_${crypto.randomUUID()}`,
						name: (fn?.name as string) ?? "",
						input,
					});
				}
			}
			rawMessages.push({
				role: "assistant",
				content:
					contentBlocks.length === 1 && contentBlocks[0].type === "text"
						? (contentBlocks[0].text ?? "")
						: contentBlocks,
			});
		} else if (msg.role === "tool") {
			// Tool result → user message with tool_result block
			const toolCallId = msg.tool_call_id as string | undefined;
			const contentText = typeof msg.content === "string" ? msg.content : "";
			rawMessages.push({
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: toolCallId ?? "",
						content: contentText,
					},
				],
			});
		} else {
			const content =
				typeof msg.content === "string"
					? msg.content
					: (msg.content as AnthropicContentBlock[]);
			rawMessages.push({ role: "user", content });
		}
	}

	if (systemParts.length > 0) {
		result.system = systemParts.join("\n\n");
	}

	// Merge consecutive same-role messages (required by Anthropic API)
	const messages: AnthropicMessage[] = [];
	for (const msg of rawMessages) {
		const last = messages[messages.length - 1];
		if (last && last.role === msg.role) {
			const lastContent =
				typeof last.content === "string"
					? [{ type: "text", text: last.content } as AnthropicContentBlock]
					: last.content;
			const curContent =
				typeof msg.content === "string"
					? [{ type: "text", text: msg.content } as AnthropicContentBlock]
					: msg.content;
			last.content = [...lastContent, ...curContent];
		} else {
			messages.push({ ...msg });
		}
	}

	result.messages = messages;
	return result;
}

/**
 * Converts an Anthropic Messages request body to an OpenAI chat completion request body.
 */
export function anthropicToOpenaiRequest(
	body: AnthropicRequest,
): OpenAIChatRequest {
	const result: OpenAIChatRequest = {};
	if (body.model) {
		result.model = body.model;
	}
	if (body.stream !== undefined) {
		result.stream = body.stream;
	}
	if (body.max_tokens !== undefined) {
		result.max_tokens = body.max_tokens;
	}
	if (body.temperature !== undefined) {
		result.temperature = body.temperature;
	}
	if (body.top_p !== undefined) {
		result.top_p = body.top_p;
	}
	if (body.stop_sequences) {
		result.stop = body.stop_sequences;
	}

	// Convert Anthropic tools to OpenAI tools format
	if (body.tools) {
		result.tools = (body.tools as Array<Record<string, unknown>>).map(
			(tool) => ({
				type: "function" as const,
				function: {
					name: tool.name as string,
					description: (tool.description as string) ?? "",
					parameters: (tool.input_schema as Record<string, unknown>) ?? {},
				},
			}),
		);
	}

	// Convert tool_choice
	if (body.tool_choice) {
		const tc = body.tool_choice as Record<string, unknown>;
		if (tc.type === "auto") {
			result.tool_choice = "auto";
		} else if (tc.type === "any") {
			result.tool_choice = "required";
		} else if (tc.type === "tool") {
			result.tool_choice = {
				type: "function",
				function: { name: tc.name as string },
			};
		}
	}

	const messages: OpenAIMessage[] = [];

	if (body.system) {
		const systemText =
			typeof body.system === "string"
				? body.system
				: body.system.map((s) => s.text).join("\n\n");
		messages.push({ role: "system", content: systemText });
	}

	for (const msg of body.messages ?? []) {
		if (msg.role === "assistant") {
			if (typeof msg.content === "string") {
				messages.push({ role: "assistant", content: msg.content });
			} else {
				const blocks = msg.content as AnthropicContentBlock[];
				const textParts: string[] = [];
				const toolCalls: Array<Record<string, unknown>> = [];
				for (const block of blocks) {
					if (block.type === "text") {
						textParts.push(block.text ?? "");
					} else if (block.type === "tool_use") {
						toolCalls.push({
							id: block.id as string,
							type: "function",
							function: {
								name: block.name as string,
								arguments:
									typeof block.input === "string"
										? block.input
										: JSON.stringify(block.input ?? {}),
							},
						});
					}
					// Skip thinking blocks and other unknown types
				}
				const assistantMsg: OpenAIMessage = {
					role: "assistant",
					content: textParts.join("") || "",
				};
				if (toolCalls.length > 0) {
					assistantMsg.tool_calls = toolCalls;
				}
				messages.push(assistantMsg);
			}
		} else if (msg.role === "user") {
			if (typeof msg.content === "string") {
				messages.push({ role: "user", content: msg.content });
			} else {
				const blocks = msg.content as AnthropicContentBlock[];
				const toolResults: AnthropicContentBlock[] = [];
				const otherBlocks: AnthropicContentBlock[] = [];
				for (const block of blocks) {
					if (block.type === "tool_result") {
						toolResults.push(block);
					} else {
						otherBlocks.push(block);
					}
				}
				// Non-tool content as user message
				if (otherBlocks.length > 0) {
					const textContent = otherBlocks
						.filter((b) => b.type === "text")
						.map((b) => b.text ?? "")
						.join("");
					if (textContent) {
						messages.push({ role: "user", content: textContent });
					}
				}
				// Each tool_result becomes a separate tool message
				for (const tr of toolResults) {
					let trContent: string;
					if (typeof tr.content === "string") {
						trContent = tr.content;
					} else if (Array.isArray(tr.content)) {
						trContent = (tr.content as Array<Record<string, unknown>>)
							.map((b) => (b.type === "text" ? ((b.text as string) ?? "") : ""))
							.join("");
					} else {
						trContent = "";
					}
					messages.push({
						role: "tool",
						tool_call_id: tr.tool_use_id as string,
						content: trContent,
					});
				}
			}
		} else {
			// Other roles pass through
			const content =
				typeof msg.content === "string"
					? msg.content
					: (msg.content as AnthropicContentBlock[])
							.map((block) => (block.type === "text" ? (block.text ?? "") : ""))
							.join("");
			messages.push({ role: msg.role, content });
		}
	}

	result.messages = messages;
	return result;
}

// --- Response converters ---

function mapStopReason(stopReason: string | null | undefined): string {
	if (!stopReason) return "stop";
	switch (stopReason) {
		case "end_turn":
		case "stop_sequence":
			return "stop";
		case "max_tokens":
			return "length";
		case "tool_use":
			return "tool_calls";
		default:
			return "stop";
	}
}

function mapFinishReason(finishReason: string | null | undefined): string {
	if (!finishReason) return "end_turn";
	switch (finishReason) {
		case "stop":
			return "end_turn";
		case "length":
			return "max_tokens";
		case "tool_calls":
			return "tool_use";
		default:
			return "end_turn";
	}
}

/**
 * Converts an Anthropic Messages API response to an OpenAI chat completion response.
 */
export function anthropicToOpenaiResponse(
	anthropicBody: Record<string, unknown>,
): Record<string, unknown> {
	const content = anthropicBody.content as AnthropicContentBlock[] | undefined;
	const textParts = (content ?? [])
		.filter((b) => b.type === "text")
		.map((b) => b.text ?? "");
	const text = textParts.join("");

	// Convert tool_use content blocks to OpenAI tool_calls
	const toolUseBlocks = (content ?? []).filter((b) => b.type === "tool_use");
	const toolCalls =
		toolUseBlocks.length > 0
			? toolUseBlocks.map((b) => ({
					id: (b.id as string) ?? `call_${crypto.randomUUID()}`,
					type: "function" as const,
					function: {
						name: (b.name as string) ?? "",
						arguments:
							typeof b.input === "string"
								? b.input
								: JSON.stringify(b.input ?? {}),
					},
				}))
			: undefined;

	const usage = anthropicBody.usage as Record<string, unknown> | undefined;

	const message: Record<string, unknown> = {
		role: "assistant",
		content: text || null,
	};
	if (toolCalls) {
		message.tool_calls = toolCalls;
	}

	return {
		id: `chatcmpl-${(anthropicBody.id as string) ?? crypto.randomUUID()}`,
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: anthropicBody.model as string,
		choices: [
			{
				index: 0,
				message,
				finish_reason: mapStopReason(
					anthropicBody.stop_reason as string | undefined,
				),
			},
		],
		usage: usage
			? {
					prompt_tokens: (usage.input_tokens as number) ?? 0,
					completion_tokens: (usage.output_tokens as number) ?? 0,
					total_tokens:
						((usage.input_tokens as number) ?? 0) +
						((usage.output_tokens as number) ?? 0),
				}
			: undefined,
	};
}

/**
 * Converts an OpenAI chat completion response to an Anthropic Messages API response.
 */
export function openaiToAnthropicResponse(
	openaiBody: Record<string, unknown>,
): Record<string, unknown> {
	const choices = openaiBody.choices as
		| Array<Record<string, unknown>>
		| undefined;
	const firstChoice = choices?.[0];
	const message = firstChoice?.message as Record<string, unknown> | undefined;
	const contentText = (message?.content as string) ?? "";
	const toolCalls = message?.tool_calls as
		| Array<Record<string, unknown>>
		| undefined;
	const usage = openaiBody.usage as Record<string, unknown> | undefined;

	const contentBlocks: AnthropicContentBlock[] = [];
	if (contentText) {
		contentBlocks.push({ type: "text", text: contentText });
	}
	if (toolCalls && toolCalls.length > 0) {
		for (const tc of toolCalls) {
			const fn = tc.function as Record<string, unknown> | undefined;
			let input: unknown = {};
			if (fn?.arguments) {
				try {
					input = JSON.parse(fn.arguments as string);
				} catch {
					input = {};
				}
			}
			contentBlocks.push({
				type: "tool_use",
				id: (tc.id as string) ?? `toolu_${crypto.randomUUID()}`,
				name: (fn?.name as string) ?? "",
				input,
			});
		}
	}
	if (contentBlocks.length === 0) {
		contentBlocks.push({ type: "text", text: "" });
	}

	let stopReason = mapFinishReason(
		firstChoice?.finish_reason as string | undefined,
	);
	if (toolCalls && toolCalls.length > 0) {
		stopReason = "tool_use";
	}

	return {
		id:
			((openaiBody.id as string) ?? "").replace("chatcmpl-", "msg_") ||
			`msg_${crypto.randomUUID()}`,
		type: "message",
		role: "assistant",
		model: openaiBody.model as string,
		content: contentBlocks,
		stop_reason: stopReason,
		usage: usage
			? {
					input_tokens: (usage.prompt_tokens as number) ?? 0,
					output_tokens: (usage.completion_tokens as number) ?? 0,
				}
			: { input_tokens: 0, output_tokens: 0 },
	};
}

// --- Stream converters ---

/**
 * Creates a TransformStream that converts Anthropic SSE events to OpenAI SSE chunks.
 */
export function createAnthropicToOpenaiStreamTransform(): TransformStream<
	Uint8Array,
	Uint8Array
> {
	let buffer = "";
	let currentEventType = "";
	let messageId = "";
	let model = "";
	let toolCallIndex = -1;
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	return new TransformStream({
		transform(chunk, controller) {
			buffer += decoder.decode(chunk, { stream: true });
			let newlineIndex = buffer.indexOf("\n");

			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);

				if (line.startsWith("event:")) {
					currentEventType = line.slice(6).trim();
				} else if (line.startsWith("data:")) {
					const payload = line.slice(5).trim();
					if (!payload) {
						newlineIndex = buffer.indexOf("\n");
						continue;
					}

					try {
						const data = JSON.parse(payload);

						if (data.type === "message_start" && data.message) {
							messageId = data.message.id ?? messageId;
							model = data.message.model ?? model;
						}

						// Track tool_use content blocks for index mapping
						if (
							(currentEventType === "content_block_start" ||
								data.type === "content_block_start") &&
							data.content_block?.type === "tool_use"
						) {
							toolCallIndex++;
						}

						const openaiChunk = convertAnthropicEventToOpenaiChunk(
							currentEventType,
							data,
							messageId,
							model,
							toolCallIndex,
						);

						if (openaiChunk) {
							controller.enqueue(
								encoder.encode(`data: ${JSON.stringify(openaiChunk)}\n\n`),
							);
						}

						if (
							currentEventType === "message_stop" ||
							data.type === "message_stop"
						) {
							controller.enqueue(encoder.encode("data: [DONE]\n\n"));
						}
					} catch {
						// Skip invalid JSON
					}
				}

				newlineIndex = buffer.indexOf("\n");
			}
		},
		flush(controller) {
			if (buffer.trim()) {
				// Process any remaining data
				const line = buffer.trim();
				if (line.startsWith("data:")) {
					const payload = line.slice(5).trim();
					if (payload && payload !== "[DONE]") {
						try {
							const data = JSON.parse(payload);
							const openaiChunk = convertAnthropicEventToOpenaiChunk(
								currentEventType,
								data,
								messageId,
								model,
								toolCallIndex,
							);
							if (openaiChunk) {
								controller.enqueue(
									encoder.encode(`data: ${JSON.stringify(openaiChunk)}\n\n`),
								);
							}
						} catch {
							// Skip
						}
					}
				}
			}
			controller.enqueue(encoder.encode("data: [DONE]\n\n"));
		},
	});
}

function convertAnthropicEventToOpenaiChunk(
	eventType: string,
	data: Record<string, unknown>,
	messageId: string,
	model: string,
	toolCallIndex: number,
): Record<string, unknown> | null {
	const id = `chatcmpl-${messageId || crypto.randomUUID()}`;
	const base = {
		id,
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model,
	};

	switch (eventType) {
		case "message_start": {
			const msg = data.message as Record<string, unknown> | undefined;
			const usage = msg?.usage as Record<string, unknown> | undefined;
			return {
				...base,
				model: (msg?.model as string) ?? model,
				choices: [
					{
						index: 0,
						delta: { role: "assistant", content: "" },
						finish_reason: null,
					},
				],
				usage: usage
					? {
							prompt_tokens: usage.input_tokens ?? 0,
							completion_tokens: 0,
							total_tokens: (usage.input_tokens as number) ?? 0,
						}
					: undefined,
			};
		}
		case "content_block_start": {
			const contentBlock = data.content_block as
				| Record<string, unknown>
				| undefined;
			if (contentBlock?.type === "tool_use") {
				return {
					...base,
					choices: [
						{
							index: 0,
							delta: {
								tool_calls: [
									{
										index: toolCallIndex,
										id: contentBlock.id as string,
										type: "function",
										function: {
											name: contentBlock.name as string,
											arguments: "",
										},
									},
								],
							},
							finish_reason: null,
						},
					],
				};
			}
			return null;
		}
		case "content_block_delta": {
			const delta = data.delta as Record<string, unknown> | undefined;
			if (delta?.type === "text_delta") {
				return {
					...base,
					choices: [
						{
							index: 0,
							delta: { content: delta.text ?? "" },
							finish_reason: null,
						},
					],
				};
			}
			if (delta?.type === "input_json_delta") {
				return {
					...base,
					choices: [
						{
							index: 0,
							delta: {
								tool_calls: [
									{
										index: toolCallIndex,
										function: {
											arguments: (delta.partial_json as string) ?? "",
										},
									},
								],
							},
							finish_reason: null,
						},
					],
				};
			}
			return null;
		}
		case "message_delta": {
			const delta = data.delta as Record<string, unknown> | undefined;
			const usage = data.usage as Record<string, unknown> | undefined;
			return {
				...base,
				choices: [
					{
						index: 0,
						delta: {},
						finish_reason: mapStopReason(
							delta?.stop_reason as string | undefined,
						),
					},
				],
				usage: usage
					? {
							prompt_tokens: 0,
							completion_tokens: usage.output_tokens ?? 0,
							total_tokens: (usage.output_tokens as number) ?? 0,
						}
					: undefined,
			};
		}
		default:
			return null;
	}
}

/**
 * Creates a TransformStream that converts OpenAI SSE chunks to Anthropic SSE events.
 */
export function createOpenaiToAnthropicStreamTransform(
	model: string,
): TransformStream<Uint8Array, Uint8Array> {
	let buffer = "";
	let sentMessageStart = false;
	let contentBlockIndex = 0;
	let hasTextBlock = false;
	const activeToolIndices = new Map<number, number>(); // openai tool index → anthropic content block index
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	return new TransformStream({
		transform(chunk, controller) {
			buffer += decoder.decode(chunk, { stream: true });
			let newlineIndex = buffer.indexOf("\n");

			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);

				if (!line.startsWith("data:")) {
					newlineIndex = buffer.indexOf("\n");
					continue;
				}

				const payload = line.slice(5).trim();
				if (!payload || payload === "[DONE]") {
					if (payload === "[DONE]") {
						controller.enqueue(
							encoder.encode(
								`event: message_stop\ndata: {"type":"message_stop"}\n\n`,
							),
						);
					}
					newlineIndex = buffer.indexOf("\n");
					continue;
				}

				try {
					const data = JSON.parse(payload);
					const choices = data.choices as
						| Array<Record<string, unknown>>
						| undefined;
					const firstChoice = choices?.[0];
					const delta = firstChoice?.delta as
						| Record<string, unknown>
						| undefined;
					const finishReason = firstChoice?.finish_reason as
						| string
						| null
						| undefined;
					const usage = data.usage as Record<string, unknown> | undefined;

					// Emit message_start if not yet sent
					if (!sentMessageStart) {
						const messageStart = {
							type: "message_start",
							message: {
								id: `msg_${crypto.randomUUID()}`,
								type: "message",
								role: "assistant",
								model: (data.model as string) ?? model,
								content: [],
								stop_reason: null,
								usage: {
									input_tokens: (usage?.prompt_tokens as number) ?? 0,
									output_tokens: 0,
								},
							},
						};
						controller.enqueue(
							encoder.encode(
								`event: message_start\ndata: ${JSON.stringify(messageStart)}\n\n`,
							),
						);
						sentMessageStart = true;
					}

					// Handle text content delta
					if (delta?.content != null) {
						if (!hasTextBlock) {
							controller.enqueue(
								encoder.encode(
									`event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: contentBlockIndex, content_block: { type: "text", text: "" } })}\n\n`,
								),
							);
							hasTextBlock = true;
							contentBlockIndex++;
						}
						const textDelta = {
							type: "content_block_delta",
							index: contentBlockIndex - 1,
							delta: { type: "text_delta", text: delta.content as string },
						};
						controller.enqueue(
							encoder.encode(
								`event: content_block_delta\ndata: ${JSON.stringify(textDelta)}\n\n`,
							),
						);
					}

					// Handle tool_calls delta
					const toolCallsArr = delta?.tool_calls as
						| Array<Record<string, unknown>>
						| undefined;
					if (toolCallsArr) {
						for (const tc of toolCallsArr) {
							const tcIndex = (tc.index as number) ?? 0;
							const fn = tc.function as Record<string, unknown> | undefined;

							if (tc.id && fn?.name != null) {
								// New tool call — close text block if open and no tool blocks yet
								if (hasTextBlock && activeToolIndices.size === 0) {
									controller.enqueue(
										encoder.encode(
											`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: contentBlockIndex - 1 })}\n\n`,
										),
									);
								}

								const blockIdx = contentBlockIndex;
								activeToolIndices.set(tcIndex, blockIdx);
								controller.enqueue(
									encoder.encode(
										`event: content_block_start\ndata: ${JSON.stringify({
											type: "content_block_start",
											index: blockIdx,
											content_block: {
												type: "tool_use",
												id: tc.id as string,
												name: fn.name as string,
												input: {},
											},
										})}\n\n`,
									),
								);
								contentBlockIndex++;

								// Send initial arguments if present
								if (fn.arguments && (fn.arguments as string).length > 0) {
									controller.enqueue(
										encoder.encode(
											`event: content_block_delta\ndata: ${JSON.stringify({
												type: "content_block_delta",
												index: blockIdx,
												delta: {
													type: "input_json_delta",
													partial_json: fn.arguments as string,
												},
											})}\n\n`,
										),
									);
								}
							} else if (fn?.arguments != null) {
								// Continuation of arguments for existing tool call
								const blockIdx = activeToolIndices.get(tcIndex);
								if (
									blockIdx !== undefined &&
									(fn.arguments as string).length > 0
								) {
									controller.enqueue(
										encoder.encode(
											`event: content_block_delta\ndata: ${JSON.stringify({
												type: "content_block_delta",
												index: blockIdx,
												delta: {
													type: "input_json_delta",
													partial_json: fn.arguments as string,
												},
											})}\n\n`,
										),
									);
								}
							}
						}
					}

					// Handle finish
					if (finishReason) {
						// Close any open tool blocks
						for (const [, blockIdx] of activeToolIndices) {
							controller.enqueue(
								encoder.encode(
									`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: blockIdx })}\n\n`,
								),
							);
						}
						// Close text block if still open and no tools were used
						if (hasTextBlock && activeToolIndices.size === 0) {
							controller.enqueue(
								encoder.encode(
									`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: contentBlockIndex - 1 })}\n\n`,
								),
							);
						}

						const messageDelta = {
							type: "message_delta",
							delta: { stop_reason: mapFinishReason(finishReason) },
							usage: {
								output_tokens: (usage?.completion_tokens as number) ?? 0,
							},
						};
						controller.enqueue(
							encoder.encode(
								`event: message_delta\ndata: ${JSON.stringify(messageDelta)}\n\n`,
							),
						);
					}
				} catch {
					// Skip invalid JSON
				}

				newlineIndex = buffer.indexOf("\n");
			}
		},
		flush(controller) {
			if (!sentMessageStart) {
				return;
			}
			controller.enqueue(
				encoder.encode(
					`event: message_stop\ndata: {"type":"message_stop"}\n\n`,
				),
			);
		},
	});
}

// --- Responses (OpenAI Responses API) converters ---

function chatContentText(
	content: OpenAIMessage["content"],
	joiner: string,
): string {
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.map((part) => (typeof part?.text === "string" ? part.text : ""))
			.join(joiner);
	}
	return "";
}

function responsesFinishReason(resp: ResponsesResponseBody): string {
	const output = resp.output ?? [];
	if (output.some((item) => item?.type === "function_call")) {
		return "tool_calls";
	}
	if (
		resp.status === "incomplete" &&
		resp.incomplete_details?.reason === "max_output_tokens"
	) {
		return "length";
	}
	return "stop";
}

function responsesUsageToChat(
	usage: Record<string, unknown> | undefined,
): Record<string, number> | undefined {
	if (!usage || typeof usage !== "object") {
		return undefined;
	}
	const promptTokens = (usage.input_tokens as number) ?? 0;
	const completionTokens = (usage.output_tokens as number) ?? 0;
	return {
		prompt_tokens: promptTokens,
		completion_tokens: completionTokens,
		total_tokens:
			(usage.total_tokens as number) ?? promptTokens + completionTokens,
	};
}

/**
 * Converts an OpenAI chat completion request body to an OpenAI Responses API
 * request body. Unknown / unsupported fields are conservatively dropped
 * (stop / n / logprobs / stream_options / non-function tools etc.).
 */
export function openaiToResponsesRequest(
	body: OpenAIChatRequest,
): ResponsesRequest {
	const result: ResponsesRequest = {};
	if (body.model) {
		result.model = body.model;
	}
	if (body.stream !== undefined) {
		result.stream = body.stream;
	}
	if (body.temperature !== undefined) {
		result.temperature = body.temperature;
	}
	if (body.top_p !== undefined) {
		result.top_p = body.top_p;
	}
	if (body.parallel_tool_calls !== undefined) {
		result.parallel_tool_calls = body.parallel_tool_calls as boolean;
	}
	if (body.user !== undefined) {
		result.user = body.user as string;
	}

	// max_output_tokens: max_completion_tokens wins when both are present
	const maxOutputTokens =
		(body.max_completion_tokens as number | undefined) ?? body.max_tokens;
	if (maxOutputTokens !== undefined) {
		result.max_output_tokens = maxOutputTokens;
	}

	// reasoning effort: direct field first, then reasoning.effort
	// (mirrors extractReasoningEffort's priority)
	const reasoning = body.reasoning as Record<string, unknown> | undefined;
	const effort =
		(body.reasoning_effort as string | number | undefined) ??
		(reasoning?.effort as string | number | undefined);
	if (typeof effort === "string") {
		result.reasoning = { effort };
	}

	// Flatten chat tools {type:"function", function:{...}} into Responses tools;
	// non-function tools are dropped
	const chatTools = body.tools as Array<Record<string, unknown>> | undefined;
	if (Array.isArray(chatTools)) {
		const tools: Array<Record<string, unknown>> = [];
		for (const tool of chatTools) {
			const fn = tool.function as Record<string, unknown> | undefined;
			if (!fn || typeof fn !== "object") {
				continue;
			}
			if (tool.type !== undefined && tool.type !== "function") {
				continue;
			}
			tools.push({
				type: "function",
				name: fn.name as string,
				description: (fn.description as string) ?? "",
				parameters: (fn.parameters as Record<string, unknown>) ?? {
					type: "object",
				},
			});
		}
		if (tools.length > 0) {
			result.tools = tools;
		}
	}

	// tool_choice: strings pass through; {type:"function",function:{name}} flattens
	if (typeof body.tool_choice === "string") {
		result.tool_choice = body.tool_choice;
	} else if (body.tool_choice && typeof body.tool_choice === "object") {
		const tc = body.tool_choice as Record<string, unknown>;
		const fn = tc.function as Record<string, unknown> | undefined;
		if (fn?.name) {
			result.tool_choice = { type: "function", name: fn.name as string };
		}
	}

	// response_format → text.format
	const responseFormat = body.response_format as
		| Record<string, unknown>
		| undefined;
	if (responseFormat && typeof responseFormat === "object") {
		if (responseFormat.type === "json_object") {
			result.text = { format: { type: "json_object" } };
		} else if (responseFormat.type === "json_schema") {
			const js = responseFormat.json_schema as
				| Record<string, unknown>
				| undefined;
			if (js && typeof js === "object") {
				const format: Record<string, unknown> = {
					type: "json_schema",
					name: (js.name as string) ?? "response",
					schema: (js.schema as Record<string, unknown>) ?? {},
				};
				if (js.strict !== undefined) {
					format.strict = js.strict;
				}
				result.text = { format };
			}
		}
	}

	const systemParts: string[] = [];
	const input: Array<Record<string, unknown>> = [];

	for (const msg of body.messages ?? []) {
		if (msg.role === "system" || msg.role === "developer") {
			const text = chatContentText(msg.content, "\n");
			if (text) {
				systemParts.push(text);
			}
			continue;
		}

		if (msg.role === "tool") {
			let output: string;
			if (typeof msg.content === "string") {
				output = msg.content;
			} else if (Array.isArray(msg.content)) {
				output = chatContentText(msg.content, "");
			} else if (msg.content && typeof msg.content === "object") {
				output = JSON.stringify(msg.content);
			} else {
				output = "";
			}
			input.push({
				type: "function_call_output",
				call_id: (msg.tool_call_id as string) ?? "",
				output,
			});
			continue;
		}

		if (msg.role === "assistant") {
			const text = chatContentText(msg.content, "");
			if (text) {
				input.push({
					role: "assistant",
					content: [{ type: "output_text", text }],
				});
			}
			const toolCalls = msg.tool_calls as
				| Array<Record<string, unknown>>
				| undefined;
			if (Array.isArray(toolCalls)) {
				for (const tc of toolCalls) {
					const fn = tc.function as Record<string, unknown> | undefined;
					input.push({
						type: "function_call",
						call_id: (tc.id as string) ?? `call_${crypto.randomUUID()}`,
						name: (fn?.name as string) ?? "",
						arguments: (fn?.arguments as string) ?? "",
					});
				}
			}
			continue;
		}

		// user (and any other role) becomes user input items
		if (typeof msg.content === "string") {
			input.push({
				role: "user",
				content: [{ type: "input_text", text: msg.content }],
			});
		} else if (Array.isArray(msg.content)) {
			const parts: Array<Record<string, unknown>> = [];
			for (const part of msg.content as Array<Record<string, unknown>>) {
				if (part?.type === "text") {
					parts.push({
						type: "input_text",
						text: (part.text as string) ?? "",
					});
				} else if (part?.type === "image_url") {
					// chat image_url is {url, detail?} (or a plain string);
					// Responses expects a string url
					const imageUrl = part.image_url;
					const url =
						typeof imageUrl === "string"
							? imageUrl
							: ((imageUrl as Record<string, unknown> | undefined)?.url as
									| string
									| undefined);
					if (url) {
						const imagePart: Record<string, unknown> = {
							type: "input_image",
							image_url: url,
						};
						const detail =
							typeof imageUrl === "object" && imageUrl !== null
								? (imageUrl as Record<string, unknown>).detail
								: undefined;
						if (detail !== undefined) {
							imagePart.detail = detail;
						}
						parts.push(imagePart);
					}
				}
				// audio and other part types are dropped
			}
			if (parts.length > 0) {
				input.push({ role: "user", content: parts });
			}
		}
	}

	if (systemParts.length > 0) {
		result.instructions = systemParts.join("\n\n");
	}
	result.input = input;
	return result;
}

/**
 * Converts an OpenAI Responses API response body to an OpenAI chat completion
 * response body.
 */
export function responsesToChatResponse(
	data: ResponsesResponseBody,
): Record<string, unknown> {
	const output = data.output ?? [];
	const textParts: string[] = [];
	let refusal: string | undefined;
	const toolCalls: Array<Record<string, unknown>> = [];

	for (const item of output) {
		if (item?.type === "message" && Array.isArray(item.content)) {
			for (const part of item.content) {
				if (part?.type === "output_text" && typeof part.text === "string") {
					textParts.push(part.text);
				} else if (
					part?.type === "refusal" &&
					typeof part.refusal === "string" &&
					part.refusal
				) {
					refusal = part.refusal;
				}
			}
		} else if (item?.type === "function_call") {
			toolCalls.push({
				id: item.call_id ?? item.id ?? `call_${crypto.randomUUID()}`,
				type: "function",
				function: {
					name: item.name ?? "",
					arguments: item.arguments ?? "",
				},
			});
		}
		// reasoning / web_search_call and other output types are ignored
	}

	const message: Record<string, unknown> = {
		role: "assistant",
		content: textParts.join("") || null,
	};
	if (refusal !== undefined) {
		message.refusal = refusal;
	}
	if (toolCalls.length > 0) {
		message.tool_calls = toolCalls;
	}

	const result: Record<string, unknown> = {
		id: data.id ?? `chatcmpl-${crypto.randomUUID()}`,
		object: "chat.completion",
		created: data.created_at ?? Math.floor(Date.now() / 1000),
		model: data.model,
		choices: [
			{
				index: 0,
				message,
				finish_reason: responsesFinishReason(data),
			},
		],
	};
	const usage = responsesUsageToChat(data.usage);
	if (usage) {
		result.usage = usage;
	}
	return result;
}

/**
 * Creates a TransformStream that converts OpenAI Responses API SSE events to
 * OpenAI chat completion SSE chunks.
 */
export function createResponsesToChatStreamTransform(): TransformStream<
	Uint8Array,
	Uint8Array
> {
	let buffer = "";
	let messageId = "";
	let model = "";
	let sentFirstChunk = false;
	let finished = false;
	let doneSent = false;
	let nextToolIndex = 0;
	const toolIndexByItem = new Map<string, number>();
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	const baseChunk = () => ({
		id: messageId,
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model,
	});

	const emitFirstChunk = (
		controller: TransformStreamDefaultController<Uint8Array>,
	): void => {
		if (sentFirstChunk) {
			return;
		}
		sentFirstChunk = true;
		if (!messageId) {
			messageId = crypto.randomUUID();
		}
		controller.enqueue(
			encoder.encode(
				`data: ${JSON.stringify({
					...baseChunk(),
					choices: [
						{ index: 0, delta: { role: "assistant" }, finish_reason: null },
					],
				})}\n\n`,
			),
		);
	};

	const emitTerminalChunk = (
		controller: TransformStreamDefaultController<Uint8Array>,
		resp: ResponsesResponseBody,
	): void => {
		if (finished) {
			return;
		}
		finished = true;
		const chunk: Record<string, unknown> = {
			...baseChunk(),
			choices: [
				{
					index: 0,
					delta: {},
					finish_reason: responsesFinishReason(resp),
				},
			],
		};
		const usage = responsesUsageToChat(resp.usage);
		if (usage) {
			chunk.usage = usage;
		}
		controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
	};

	const emitDone = (
		controller: TransformStreamDefaultController<Uint8Array>,
	): void => {
		if (doneSent) {
			return;
		}
		doneSent = true;
		controller.enqueue(encoder.encode("data: [DONE]\n\n"));
	};

	const handleEvent = (
		data: Record<string, unknown>,
		controller: TransformStreamDefaultController<Uint8Array>,
	): void => {
		const resp = (
			data.response && typeof data.response === "object" ? data.response : {}
		) as ResponsesResponseBody;

		switch (data.type) {
			case "response.created": {
				if (resp.id) {
					messageId = resp.id;
				}
				if (resp.model) {
					model = resp.model;
				}
				emitFirstChunk(controller);
				break;
			}
			case "response.output_item.added": {
				const item = data.item as ResponsesOutputItem | undefined;
				if (item?.type === "function_call") {
					emitFirstChunk(controller);
					const toolIndex = nextToolIndex++;
					if (item.id) {
						toolIndexByItem.set(item.id, toolIndex);
					}
					if (item.call_id) {
						toolIndexByItem.set(item.call_id, toolIndex);
					}
					controller.enqueue(
						encoder.encode(
							`data: ${JSON.stringify({
								...baseChunk(),
								choices: [
									{
										index: 0,
										delta: {
											tool_calls: [
												{
													index: toolIndex,
													id: item.call_id ?? item.id,
													type: "function",
													function: {
														name: item.name ?? "",
														arguments: "",
													},
												},
											],
										},
										finish_reason: null,
									},
								],
							})}\n\n`,
						),
					);
				}
				break;
			}
			case "response.output_text.delta": {
				emitFirstChunk(controller);
				controller.enqueue(
					encoder.encode(
						`data: ${JSON.stringify({
							...baseChunk(),
							choices: [
								{
									index: 0,
									delta: {
										content: typeof data.delta === "string" ? data.delta : "",
									},
									finish_reason: null,
								},
							],
						})}\n\n`,
					),
				);
				break;
			}
			case "response.function_call_arguments.delta": {
				const itemKey = typeof data.item_id === "string" ? data.item_id : "";
				const toolIndex = itemKey ? toolIndexByItem.get(itemKey) : undefined;
				if (toolIndex !== undefined) {
					controller.enqueue(
						encoder.encode(
							`data: ${JSON.stringify({
								...baseChunk(),
								choices: [
									{
										index: 0,
										delta: {
											tool_calls: [
												{
													index: toolIndex,
													function: {
														arguments:
															typeof data.delta === "string" ? data.delta : "",
													},
												},
											],
										},
										finish_reason: null,
									},
								],
							})}\n\n`,
						),
					);
				}
				break;
			}
			case "response.completed":
			case "response.incomplete":
			case "response.failed": {
				if (resp.id && !messageId) {
					messageId = resp.id;
				}
				if (resp.model && !model) {
					model = resp.model;
				}
				emitFirstChunk(controller);
				emitTerminalChunk(controller, resp);
				emitDone(controller);
				break;
			}
			default:
				// message / reasoning / content_part events and unknown types
				// are swallowed
				break;
		}
	};

	return new TransformStream({
		transform(chunk, controller) {
			buffer += decoder.decode(chunk, { stream: true });
			let newlineIndex = buffer.indexOf("\n");

			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);

				if (!line.startsWith("data:")) {
					newlineIndex = buffer.indexOf("\n");
					continue;
				}

				const payload = line.slice(5).trim();
				if (payload && payload !== "[DONE]") {
					try {
						const data = JSON.parse(payload) as Record<string, unknown>;
						if (data && typeof data === "object") {
							handleEvent(data, controller);
						}
					} catch {
						// Skip invalid JSON
					}
				}

				newlineIndex = buffer.indexOf("\n");
			}
		},
		flush(controller) {
			emitDone(controller);
		},
	});
}
