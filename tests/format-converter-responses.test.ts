import { describe, expect, it } from "vitest";
import {
	createResponsesToChatStreamTransform,
	openaiToResponsesRequest,
	responsesToChatResponse,
} from "../apps/worker/src/services/format-converter";

// --- helpers ---

function sse(events: unknown[]): string {
	return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

async function runStreamTransform(input: string): Promise<string> {
	const transform = createResponsesToChatStreamTransform();
	const writer = transform.writable.getWriter();
	const reader = transform.readable.getReader();
	const write = (async () => {
		await writer.write(new TextEncoder().encode(input));
		await writer.close();
	})();
	let output = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		output += new TextDecoder().decode(value);
	}
	await write;
	return output;
}

type SseItem = Record<string, unknown> | "[DONE]";

function parseSseData(output: string): SseItem[] {
	return output
		.split("\n\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => {
			expect(line.startsWith("data: ")).toBe(true);
			const payload = line.slice("data: ".length);
			return payload === "[DONE]"
				? "[DONE]"
				: (JSON.parse(payload) as Record<string, unknown>);
		});
}

function firstChoice(chunk: Record<string, unknown>): Record<string, unknown> {
	const choices = chunk.choices as Array<Record<string, unknown>>;
	expect(choices).toHaveLength(1);
	return choices[0];
}

// --- openaiToResponsesRequest ---

describe("openaiToResponsesRequest", () => {
	it("joins system and developer messages into instructions and keeps them out of input", () => {
		const out = openaiToResponsesRequest({
			model: "gpt-4o",
			messages: [
				{ role: "system", content: "Be terse." },
				{ role: "developer", content: "Also be safe." },
				{ role: "user", content: "Hi" },
			],
		});
		expect(out.instructions).toBe("Be terse.\n\nAlso be safe.");
		expect(out.input).toEqual([
			{ role: "user", content: [{ type: "input_text", text: "Hi" }] },
		]);
	});

	it("maps user content array: text → input_text, image_url → input_image, audio dropped", () => {
		const out = openaiToResponsesRequest({
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "What is this?" },
						{
							type: "image_url",
							image_url: { url: "https://example.com/cat.png", detail: "low" },
						},
						{ type: "input_audio", data: "abc", format: "wav" },
					],
				},
			],
		});
		expect(out.input).toEqual([
			{
				role: "user",
				content: [
					{ type: "input_text", text: "What is this?" },
					{
						type: "input_image",
						image_url: "https://example.com/cat.png",
						detail: "low",
					},
				],
			},
		]);
	});

	it("accepts image_url given as a plain string", () => {
		const out = openaiToResponsesRequest({
			messages: [
				{
					role: "user",
					content: [
						{ type: "image_url", image_url: "https://example.com/dog.png" },
					],
				},
			],
		});
		expect(out.input).toEqual([
			{
				role: "user",
				content: [
					{ type: "input_image", image_url: "https://example.com/dog.png" },
				],
			},
		]);
	});

	it("maps assistant text and tool_calls to output_text + function_call items in order", () => {
		const out = openaiToResponsesRequest({
			messages: [
				{ role: "user", content: "Weather in Paris?" },
				{
					role: "assistant",
					content: "Let me check.",
					tool_calls: [
						{
							id: "call_1",
							type: "function",
							function: { name: "get_weather", arguments: '{"city":"Paris"}' },
						},
					],
				},
			],
		});
		expect(out.input).toEqual([
			{
				role: "user",
				content: [{ type: "input_text", text: "Weather in Paris?" }],
			},
			{
				role: "assistant",
				content: [{ type: "output_text", text: "Let me check." }],
			},
			{
				type: "function_call",
				call_id: "call_1",
				name: "get_weather",
				arguments: '{"city":"Paris"}',
			},
		]);
	});

	it("maps tool messages to function_call_output; object content is JSON.stringify'ed", () => {
		const out = openaiToResponsesRequest({
			messages: [
				{ role: "user", content: "hi" },
				{
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "call_2",
							type: "function",
							function: { name: "f", arguments: "{}" },
						},
					],
				},
				{ role: "tool", tool_call_id: "call_2", content: { result: 42 } },
			],
		});
		expect(out.input).toContainEqual({
			type: "function_call_output",
			call_id: "call_2",
			output: '{"result":42}',
		});
	});

	it("flattens chat tools and drops non-function tools", () => {
		const out = openaiToResponsesRequest({
			messages: [{ role: "user", content: "hi" }],
			tools: [
				{
					type: "function",
					function: { name: "f", description: "d", parameters: { type: "object" } },
				},
				{ type: "web_search", web_search: {} },
			],
		});
		expect(out.tools).toEqual([
			{ type: "function", name: "f", description: "d", parameters: { type: "object" } },
		]);
	});

	it("passes string tool_choice through and flattens object tool_choice", () => {
		expect(
			openaiToResponsesRequest({ messages: [], tool_choice: "auto" })
				.tool_choice,
		).toBe("auto");
		expect(
			openaiToResponsesRequest({ messages: [], tool_choice: "none" })
				.tool_choice,
		).toBe("none");
		expect(
			openaiToResponsesRequest({ messages: [], tool_choice: "required" })
				.tool_choice,
		).toBe("required");
		const out = openaiToResponsesRequest({
			messages: [],
			tool_choice: { type: "function", function: { name: "f" } },
		});
		expect(out.tool_choice).toEqual({ type: "function", name: "f" });
	});

	it("maps max_tokens / max_completion_tokens onto max_output_tokens with completion priority", () => {
		expect(
			openaiToResponsesRequest({
				messages: [],
				max_tokens: 100,
				max_completion_tokens: 200,
			}).max_output_tokens,
		).toBe(200);
		expect(
			openaiToResponsesRequest({ messages: [], max_tokens: 100 })
				.max_output_tokens,
		).toBe(100);
	});

	it("maps reasoning_effort and reasoning.effort onto reasoning.effort (direct field wins)", () => {
		expect(
			openaiToResponsesRequest({ messages: [], reasoning_effort: "high" })
				.reasoning,
		).toEqual({ effort: "high" });
		expect(
			openaiToResponsesRequest({ messages: [], reasoning: { effort: "low" } })
				.reasoning,
		).toEqual({ effort: "low" });
		expect(
			openaiToResponsesRequest({
				messages: [],
				reasoning_effort: "high",
				reasoning: { effort: "low" },
			}).reasoning,
		).toEqual({ effort: "high" });
	});

	it("maps response_format json_object / json_schema onto text.format", () => {
		const jo = openaiToResponsesRequest({
			messages: [],
			response_format: { type: "json_object" },
		});
		expect(jo.text).toEqual({ format: { type: "json_object" } });

		const js = openaiToResponsesRequest({
			messages: [],
			response_format: {
				type: "json_schema",
				json_schema: { name: "out", schema: { type: "object" }, strict: true },
			},
		});
		expect(js.text).toEqual({
			format: {
				type: "json_schema",
				name: "out",
				schema: { type: "object" },
				strict: true,
			},
		});
	});

	it("drops stop / n / logprobs / stream_options while keeping stream", () => {
		const out = openaiToResponsesRequest({
			messages: [{ role: "user", content: "hi" }],
			stream: true,
			stream_options: { include_usage: true },
			stop: ["END"],
			n: 2,
			logprobs: true,
		});
		expect(out.stream).toBe(true);
		expect(out.stream_options).toBeUndefined();
		expect(out.stop).toBeUndefined();
		expect(out.n).toBeUndefined();
		expect(out.logprobs).toBeUndefined();
	});

	it("passes through model / temperature / top_p / parallel_tool_calls / user", () => {
		const out = openaiToResponsesRequest({
			model: "gpt-4o",
			stream: false,
			temperature: 0.5,
			top_p: 0.9,
			parallel_tool_calls: false,
			user: "u_1",
			messages: [{ role: "user", content: "hi" }],
		});
		expect(out.model).toBe("gpt-4o");
		expect(out.stream).toBe(false);
		expect(out.temperature).toBe(0.5);
		expect(out.top_p).toBe(0.9);
		expect(out.parallel_tool_calls).toBe(false);
		expect(out.user).toBe("u_1");
	});
});

// --- multi-turn tool round-trip ---

describe("openaiToResponsesRequest - multi-turn tool round-trip", () => {
	it("converts a full tool loop conversation into continuable Responses input", () => {
		const out = openaiToResponsesRequest({
			model: "gpt-4o",
			messages: [
				{ role: "system", content: "You are a weather assistant." },
				{ role: "user", content: "Paris weather?" },
				{
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "call_1",
							type: "function",
							function: {
								name: "get_weather",
								arguments: '{"city":"Paris"}',
							},
						},
					],
				},
				{ role: "tool", tool_call_id: "call_1", content: "Sunny 20C" },
				{ role: "assistant", content: "It is sunny and 20C." },
				{ role: "user", content: "Thanks!" },
			],
			tools: [
				{
					type: "function",
					function: {
						name: "get_weather",
						description: "Get weather",
						parameters: {
							type: "object",
							properties: { city: { type: "string" } },
						},
					},
				},
			],
		});
		expect(out.instructions).toBe("You are a weather assistant.");
		expect(out.input).toEqual([
			{
				role: "user",
				content: [{ type: "input_text", text: "Paris weather?" }],
			},
			{
				type: "function_call",
				call_id: "call_1",
				name: "get_weather",
				arguments: '{"city":"Paris"}',
			},
			{ type: "function_call_output", call_id: "call_1", output: "Sunny 20C" },
			{
				role: "assistant",
				content: [{ type: "output_text", text: "It is sunny and 20C." }],
			},
			{ role: "user", content: [{ type: "input_text", text: "Thanks!" }] },
		]);
		expect(out.tools).toEqual([
			{
				type: "function",
				name: "get_weather",
				description: "Get weather",
				parameters: {
					type: "object",
					properties: { city: { type: "string" } },
				},
			},
		]);
	});
});

// --- responsesToChatResponse ---

describe("responsesToChatResponse", () => {
	it("joins output_text across outputs and maps id/model/created_at/usage", () => {
		const out = responsesToChatResponse({
			id: "resp_1",
			object: "response",
			model: "gpt-4o",
			created_at: 1700000000,
			status: "completed",
			output: [
				{ type: "reasoning", id: "rs_1", summary: [] },
				{
					type: "message",
					id: "msg_1",
					role: "assistant",
					content: [
						{ type: "output_text", text: "Hello " },
						{ type: "output_text", text: "world" },
					],
				},
				{
					type: "message",
					id: "msg_2",
					role: "assistant",
					content: [{ type: "output_text", text: "!" }],
				},
			],
			usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
		});
		expect(out.id).toBe("resp_1");
		expect(out.object).toBe("chat.completion");
		expect(out.created).toBe(1700000000);
		expect(out.model).toBe("gpt-4o");
		const choices = out.choices as Array<Record<string, unknown>>;
		expect(choices).toHaveLength(1);
		const message = choices[0].message as Record<string, unknown>;
		expect(message.role).toBe("assistant");
		expect(message.content).toBe("Hello world!");
		expect(choices[0].finish_reason).toBe("stop");
		expect(out.usage).toEqual({
			prompt_tokens: 10,
			completion_tokens: 5,
			total_tokens: 15,
		});
	});

	it("maps function_call outputs to tool_calls and finishes with tool_calls", () => {
		const out = responsesToChatResponse({
			id: "resp_2",
			model: "gpt-4o",
			status: "completed",
			output: [
				{
					type: "function_call",
					id: "fc_1",
					call_id: "call_1",
					name: "get_weather",
					arguments: '{"city":"Paris"}',
				},
			],
			usage: { input_tokens: 1, output_tokens: 2 },
		});
		const choices = out.choices as Array<Record<string, unknown>>;
		const message = choices[0].message as Record<string, unknown>;
		expect(message.tool_calls).toEqual([
			{
				id: "call_1",
				type: "function",
				function: { name: "get_weather", arguments: '{"city":"Paris"}' },
			},
		]);
		expect(choices[0].finish_reason).toBe("tool_calls");
		// total_tokens computed when missing
		expect(out.usage).toEqual({
			prompt_tokens: 1,
			completion_tokens: 2,
			total_tokens: 3,
		});
	});

	it("maps refusal content parts onto message.refusal", () => {
		const out = responsesToChatResponse({
			id: "resp_3",
			model: "gpt-4o",
			status: "completed",
			output: [
				{
					type: "message",
					role: "assistant",
					content: [{ type: "refusal", refusal: "No can do" }],
				},
			],
		});
		const choices = out.choices as Array<Record<string, unknown>>;
		const message = choices[0].message as Record<string, unknown>;
		expect(message.refusal).toBe("No can do");
	});

	it("maps incomplete max_output_tokens to length and other reasons to stop", () => {
		const length = responsesToChatResponse({
			id: "resp_4",
			model: "gpt-4o",
			status: "incomplete",
			incomplete_details: { reason: "max_output_tokens" },
			output: [
				{
					type: "message",
					role: "assistant",
					content: [{ type: "output_text", text: "Par" }],
				},
			],
		});
		expect(
			(length.choices as Array<Record<string, unknown>>)[0].finish_reason,
		).toBe("length");

		const contentFilter = responsesToChatResponse({
			id: "resp_5",
			model: "gpt-4o",
			status: "incomplete",
			incomplete_details: { reason: "content_filter" },
			output: [],
		});
		expect(
			(contentFilter.choices as Array<Record<string, unknown>>)[0]
				.finish_reason,
		).toBe("stop");
	});

	it("ignores unknown output types and yields null content for text-less responses", () => {
		const out = responsesToChatResponse({
			id: "resp_6",
			model: "gpt-4o",
			status: "completed",
			output: [{ type: "web_search_call", id: "ws_1" }],
		});
		const choices = out.choices as Array<Record<string, unknown>>;
		const message = choices[0].message as Record<string, unknown>;
		expect(message.content).toBeNull();
		expect(message.tool_calls).toBeUndefined();
		expect(choices[0].finish_reason).toBe("stop");
	});
});

// --- createResponsesToChatStreamTransform ---

describe("createResponsesToChatStreamTransform", () => {
	it("converts created / output_text.delta / completed into chat chunks with usage and [DONE]", async () => {
		const input = sse([
			{ type: "response.created", response: { id: "resp_1", model: "gpt-4o" } },
			{ type: "response.output_text.delta", delta: "Hel" },
			{ type: "response.output_text.delta", delta: "lo" },
			{
				type: "response.completed",
				response: {
					id: "resp_1",
					model: "gpt-4o",
					status: "completed",
					output: [
						{
							type: "message",
							content: [{ type: "output_text", text: "Hello" }],
						},
					],
					usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
				},
			},
		]);
		const chunks = parseSseData(await runStreamTransform(input));
		expect(chunks).toHaveLength(5);
		expect(chunks[4]).toBe("[DONE]");

		const first = chunks[0] as Record<string, unknown>;
		expect(first.id).toBe("resp_1");
		expect(first.object).toBe("chat.completion.chunk");
		expect(first.model).toBe("gpt-4o");
		expect(firstChoice(first).delta).toEqual({ role: "assistant" });
		expect(firstChoice(first).finish_reason).toBeNull();

		expect(firstChoice(chunks[1] as Record<string, unknown>).delta).toEqual({
			content: "Hel",
		});
		expect(firstChoice(chunks[2] as Record<string, unknown>).delta).toEqual({
			content: "lo",
		});

		const terminal = chunks[3] as Record<string, unknown>;
		expect(firstChoice(terminal).delta).toEqual({});
		expect(firstChoice(terminal).finish_reason).toBe("stop");
		expect(terminal.usage).toEqual({
			prompt_tokens: 5,
			completion_tokens: 2,
			total_tokens: 7,
		});
	});

	it("maps function_call items and argument deltas onto tool_calls increments via item_id", async () => {
		const input = sse([
			{ type: "response.created", response: { id: "resp_2", model: "gpt-4o" } },
			{
				type: "response.output_item.added",
				output_index: 0,
				item: {
					type: "function_call",
					id: "fc_1",
					call_id: "call_1",
					name: "get_weather",
					arguments: "",
				},
			},
			{
				type: "response.function_call_arguments.delta",
				item_id: "fc_1",
				delta: '{"city":',
			},
			{
				type: "response.function_call_arguments.delta",
				item_id: "fc_1",
				delta: '"Paris"}',
			},
			{
				type: "response.completed",
				response: {
					id: "resp_2",
					model: "gpt-4o",
					status: "completed",
					output: [
						{
							type: "function_call",
							id: "fc_1",
							call_id: "call_1",
							name: "get_weather",
							arguments: '{"city":"Paris"}',
						},
					],
					usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12 },
				},
			},
		]);
		const chunks = parseSseData(await runStreamTransform(input));
		expect(chunks).toHaveLength(6);
		expect(chunks[5]).toBe("[DONE]");

		const startDelta = firstChoice(chunks[1] as Record<string, unknown>)
			.delta as Record<string, unknown>;
		expect(startDelta.tool_calls).toEqual([
			{
				index: 0,
				id: "call_1",
				type: "function",
				function: { name: "get_weather", arguments: "" },
			},
		]);
		const args1 = firstChoice(chunks[2] as Record<string, unknown>)
			.delta as Record<string, unknown>;
		expect(args1.tool_calls).toEqual([
			{ index: 0, function: { arguments: '{"city":' } },
		]);
		const args2 = firstChoice(chunks[3] as Record<string, unknown>)
			.delta as Record<string, unknown>;
		expect(args2.tool_calls).toEqual([
			{ index: 0, function: { arguments: '"Paris"}' } },
		]);

		const terminal = chunks[4] as Record<string, unknown>;
		expect(firstChoice(terminal).finish_reason).toBe("tool_calls");
		expect(terminal.usage).toEqual({
			prompt_tokens: 8,
			completion_tokens: 4,
			total_tokens: 12,
		});
	});

	it("assigns distinct indexes to multiple function_call items", async () => {
		const input = sse([
			{ type: "response.created", response: { id: "resp_3", model: "gpt-4o" } },
			{
				type: "response.output_item.added",
				item: {
					type: "function_call",
					id: "fc_1",
					call_id: "call_1",
					name: "a",
					arguments: "",
				},
			},
			{
				type: "response.output_item.added",
				item: {
					type: "function_call",
					id: "fc_2",
					call_id: "call_2",
					name: "b",
					arguments: "",
				},
			},
			{ type: "response.function_call_arguments.delta", item_id: "fc_2", delta: "2" },
			{ type: "response.function_call_arguments.delta", item_id: "fc_1", delta: "1" },
			{
				type: "response.completed",
				response: {
					id: "resp_3",
					model: "gpt-4o",
					status: "completed",
					usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
				},
			},
		]);
		const chunks = parseSseData(await runStreamTransform(input));
		expect(chunks).toHaveLength(7);
		expect(firstChoice(chunks[1] as Record<string, unknown>).delta).toEqual({
			tool_calls: [
				{ index: 0, id: "call_1", type: "function", function: { name: "a", arguments: "" } },
			],
		});
		expect(firstChoice(chunks[2] as Record<string, unknown>).delta).toEqual({
			tool_calls: [
				{ index: 1, id: "call_2", type: "function", function: { name: "b", arguments: "" } },
			],
		});
		expect(firstChoice(chunks[3] as Record<string, unknown>).delta).toEqual({
			tool_calls: [{ index: 1, function: { arguments: "2" } }],
		});
		expect(firstChoice(chunks[4] as Record<string, unknown>).delta).toEqual({
			tool_calls: [{ index: 0, function: { arguments: "1" } }],
		});
	});

	it("maps response.incomplete with max_output_tokens to finish_reason length", async () => {
		const input = sse([
			{ type: "response.created", response: { id: "resp_4", model: "gpt-4o" } },
			{ type: "response.output_text.delta", delta: "Par" },
			{
				type: "response.incomplete",
				response: {
					id: "resp_4",
					status: "incomplete",
					incomplete_details: { reason: "max_output_tokens" },
					usage: { input_tokens: 3, output_tokens: 9, total_tokens: 12 },
				},
			},
		]);
		const chunks = parseSseData(await runStreamTransform(input));
		const terminal = chunks[2] as Record<string, unknown>;
		expect(firstChoice(terminal).finish_reason).toBe("length");
		expect(terminal.usage).toEqual({
			prompt_tokens: 3,
			completion_tokens: 9,
			total_tokens: 12,
		});
		expect(chunks[3]).toBe("[DONE]");
	});

	it("closes the stream normally on response.failed without throwing", async () => {
		const input = sse([
			{ type: "response.created", response: { id: "resp_5", model: "gpt-4o" } },
			{ type: "response.output_text.delta", delta: "Hi" },
			{
				type: "response.failed",
				response: {
					id: "resp_5",
					status: "failed",
					error: { code: "server_error", message: "boom" },
				},
			},
		]);
		const chunks = parseSseData(await runStreamTransform(input));
		const terminal = chunks[2] as Record<string, unknown>;
		expect(firstChoice(terminal).finish_reason).toBe("stop");
		expect(terminal.usage).toBeUndefined();
		expect(chunks[3]).toBe("[DONE]");
	});

	it("swallows message / content_part / reasoning events", async () => {
		const input = sse([
			{ type: "response.created", response: { id: "resp_6", model: "gpt-4o" } },
			{
				type: "response.output_item.added",
				item: { type: "message", role: "assistant", content: [] },
			},
			{
				type: "response.content_part.added",
				part: { type: "output_text", text: "" },
			},
			{ type: "response.reasoning_summary_text.delta", delta: "thinking" },
			{ type: "response.output_text.done", text: "done" },
			{
				type: "response.completed",
				response: {
					id: "resp_6",
					model: "gpt-4o",
					status: "completed",
					usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
				},
			},
		]);
		const chunks = parseSseData(await runStreamTransform(input));
		expect(chunks).toHaveLength(3);
		expect(firstChoice(chunks[0] as Record<string, unknown>).delta).toEqual({
			role: "assistant",
		});
		expect(chunks[2]).toBe("[DONE]");
	});
});
