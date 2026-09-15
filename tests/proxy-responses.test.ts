import { afterEach, describe, expect, it, vi } from "vitest";
import anthropicApp from "../apps/worker/src/routes/anthropic-proxy";
import proxyApp, {
	allowedFormatsForPath,
	buildChannelRequest,
	convertResponse,
} from "../apps/worker/src/routes/proxy";
import type { ChannelRecord } from "../apps/worker/src/services/channels";

function makeChannel(
	overrides: Partial<ChannelRecord> = {},
): ChannelRecord {
	return {
		id: "ch1",
		name: "test-channel",
		base_url: "https://upstream.example/v1",
		api_key: "sk-channel",
		weight: 1,
		status: "active",
		api_format: "openai",
		models_json: JSON.stringify([{ id: "test-model" }]),
		...overrides,
	};
}

const tokenRow = {
	id: "tok1",
	name: "test-token",
	quota_total: null,
	quota_used: 0,
	status: "active",
	allowed_channels: null,
	user_id: null,
};

/**
 * Minimal D1 mock covering the queries the proxy handlers hit:
 * tokens (tokenAuth), channels, channel_model_aliases, settings,
 * plus run() capture for usage INSERTs.
 */
function makeDb(
	options: {
		channels?: unknown[];
		token?: Record<string, unknown> | null;
	} = {},
) {
	const channels = options.channels ?? [];
	const token =
		options.token === undefined ? tokenRow : options.token;
	const runs: Array<{ sql: string; args: unknown[] }> = [];
	const db = {
		prepare(sql: string) {
			const stmt = {
				boundArgs: [] as unknown[],
				bind: (...args: unknown[]) => {
					stmt.boundArgs = args;
					return stmt;
				},
				all: async () => {
					if (sql.includes("FROM channels")) {
						return { results: channels };
					}
					// channel_model_aliases / settings / others: empty
					return { results: [] };
				},
				first: async () => {
					if (sql.includes("FROM tokens")) {
						return token;
					}
					return null;
				},
				run: async () => {
					runs.push({ sql, args: stmt.boundArgs });
					return {};
				},
			};
			return stmt;
		},
	};
	return { db, runs };
}

type RequestEnv = Parameters<typeof proxyApp.request>[2];
type RequestCtx = Parameters<typeof proxyApp.request>[3];

/**
 * Mock Workers ExecutionContext: captures waitUntil tasks so tests can
 * deterministically await background usage recording.
 */
function makeMockCtx(): {
	ctx: RequestCtx;
	awaitTasks: () => Promise<void>;
} {
	const tasks: Promise<unknown>[] = [];
	return {
		ctx: {
			waitUntil: (p: Promise<unknown>) => {
				tasks.push(p);
			},
			passThroughOnException: () => {},
		} as RequestCtx,
		awaitTasks: async () => {
			await Promise.allSettled(tasks);
		},
	};
}

function makeEnv(channels: unknown[]): { env: RequestEnv; runs: Array<{ sql: string; args: unknown[] }> } {
	const { db, runs } = makeDb({ channels });
	return {
		env: {
			DB: db,
			PROXY_RETRY_ROUNDS: "1",
			PROXY_RETRY_DELAY_MS: "0",
		} as unknown as RequestEnv,
		runs,
	};
}

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

const RESPONSES_UPSTREAM_BODY = {
	id: "resp_123",
	object: "response",
	created_at: 1730000000,
	status: "completed",
	model: "gpt-4o",
	output: [
		{
			type: "message",
			content: [{ type: "output_text", text: "Hello!" }],
		},
	],
	usage: { input_tokens: 4, output_tokens: 6, total_tokens: 10 },
};

describe("allowedFormatsForPath (routing matrix)", () => {
	it("allows openai/responses/custom for /v1/responses inbound and excludes anthropic", () => {
		const formats = allowedFormatsForPath("/v1/responses");
		expect(formats).not.toBeNull();
		expect(formats?.has("openai")).toBe(true);
		expect(formats?.has("responses")).toBe(true);
		expect(formats?.has("custom")).toBe(true);
		expect(formats?.has("anthropic")).toBe(false);
	});

	it("matches /v1/responses case-insensitively", () => {
		const formats = allowedFormatsForPath("/V1/Responses");
		expect(formats?.has("anthropic")).toBe(false);
		expect(formats?.has("responses")).toBe(true);
	});

	it("does not filter for /v1/chat/completions inbound (all formats eligible)", () => {
		expect(allowedFormatsForPath("/v1/chat/completions")).toBeNull();
	});

	it("excludes anthropic but allows responses for non-chat passthrough paths", () => {
		for (const path of ["/v1/embeddings", "/v1/audio/speech", "/v1/moderations"]) {
			const formats = allowedFormatsForPath(path);
			expect(formats?.has("anthropic")).toBe(false);
			expect(formats?.has("openai")).toBe(true);
			expect(formats?.has("responses")).toBe(true);
			expect(formats?.has("custom")).toBe(true);
		}
	});
});

describe("buildChannelRequest responses branch", () => {
	const channel = makeChannel({ api_format: "responses" });

	it("/v1/responses inbound: targets {base}/responses and passes the body through untouched", () => {
		const requestText = JSON.stringify({
			model: "test-model",
			input: "hi",
			store: true,
		});
		const result = buildChannelRequest(
			channel,
			"/v1/responses",
			"",
			new Headers(),
			requestText,
			null,
			false,
			"sk-call",
		);
		expect(result.target).toBe("https://upstream.example/v1/responses");
		expect(result.body).toBe(requestText);
	});

	it("/v1/responses inbound: matches path case-insensitively and keeps query suffix", () => {
		const result = buildChannelRequest(
			channel,
			"/V1/Responses",
			"?api-version=1",
			new Headers(),
			"{}",
			null,
			false,
			"sk-call",
		);
		expect(result.target).toBe(
			"https://upstream.example/v1/responses?api-version=1",
		);
	});

	it("chat inbound: converts the body via openaiToResponsesRequest", () => {
		const parsedBody = {
			model: "test-model",
			stream: false,
			max_tokens: 100,
			messages: [
				{ role: "system", content: "Be nice" },
				{ role: "user", content: "hi" },
			],
			stream_options: { include_usage: true },
		};
		const result = buildChannelRequest(
			channel,
			"/v1/chat/completions",
			"",
			new Headers(),
			JSON.stringify(parsedBody),
			parsedBody,
			false,
			"sk-call",
		);
		expect(result.target).toBe("https://upstream.example/v1/responses");
		const body = JSON.parse(result.body ?? "{}") as Record<string, unknown>;
		expect(body.model).toBe("test-model");
		expect(body.instructions).toBe("Be nice");
		expect(body.max_output_tokens).toBe(100);
		expect(body.stream).toBe(false);
		expect(body.input).toEqual([
			{ role: "user", content: [{ type: "input_text", text: "hi" }] },
		]);
		expect(body.messages).toBeUndefined();
		expect(body.stream_options).toBeUndefined();
	});

	it("chat inbound: propagates stream=true", () => {
		const parsedBody = {
			model: "test-model",
			stream: true,
			messages: [{ role: "user", content: "hi" }],
		};
		const result = buildChannelRequest(
			channel,
			"/v1/chat/completions",
			"",
			new Headers(),
			JSON.stringify(parsedBody),
			parsedBody,
			true,
			"sk-call",
		);
		const body = JSON.parse(result.body ?? "{}") as Record<string, unknown>;
		expect(body.stream).toBe(true);
	});

	it("chat inbound: falls back to an empty Responses body when parsed body is null", () => {
		const result = buildChannelRequest(
			channel,
			"/v1/chat/completions",
			"",
			new Headers(),
			"not-json",
			null,
			false,
			"sk-call",
		);
		expect(result.body).toBe("{}");
	});

	it("non-chat passthrough paths follow the openai rules (base_url + subPath + query)", () => {
		const result = buildChannelRequest(
			channel,
			"/v1/embeddings",
			"?a=b",
			new Headers(),
			'{"input":"x"}',
			null,
			false,
			"sk-call",
		);
		expect(result.target).toBe("https://upstream.example/v1/embeddings?a=b");
		expect(result.body).toBe('{"input":"x"}');
	});

	it("sets Bearer + x-api-key and strips host/content-length from client headers", () => {
		const incoming = new Headers({
			host: "gateway.example",
			"content-length": "123",
		});
		const result = buildChannelRequest(
			channel,
			"/v1/chat/completions",
			"",
			incoming,
			"{}",
			{ messages: [] },
			false,
			"sk-call",
		);
		expect(result.headers.get("authorization")).toBe("Bearer sk-call");
		expect(result.headers.get("x-api-key")).toBe("sk-call");
		expect(result.headers.get("host")).toBeNull();
		expect(result.headers.get("content-length")).toBeNull();
	});

	it("applies the header policy (remove → global inject → channel-level)", () => {
		const policyChannel = makeChannel({
			api_format: "responses",
			custom_headers_json: '{"X-Trace-Id":"channel","X-Channel":"1"}',
		});
		const incoming = new Headers({ "user-agent": "client" });
		const result = buildChannelRequest(
			policyChannel,
			"/v1/chat/completions",
			"",
			incoming,
			"{}",
			{ messages: [] },
			false,
			"sk-call",
			{
				extraHeaders: { "X-Trace-Id": "global" },
				removeHeaders: ["user-agent"],
			},
		);
		expect(result.headers.get("user-agent")).toBeNull();
		expect(result.headers.get("x-trace-id")).toBe("channel");
		expect(result.headers.get("x-channel")).toBe("1");
	});
});

describe("convertResponse responses wiring", () => {
	const channel = makeChannel({ api_format: "responses" });

	it("chat inbound non-stream: converts a Responses body into a chat completion", async () => {
		const upstream = jsonResponse(RESPONSES_UPSTREAM_BODY);
		const out = await convertResponse(
			channel,
			upstream,
			false,
			"/v1/chat/completions",
		);
		expect(out.headers.get("content-type")).toBe("application/json");
		const body = (await out.json()) as Record<string, unknown>;
		expect(body.object).toBe("chat.completion");
		const choices = body.choices as Array<Record<string, unknown>>;
		expect(choices[0].finish_reason).toBe("stop");
		const message = choices[0].message as Record<string, unknown>;
		expect(message.content).toBe("Hello!");
		expect(body.usage).toEqual({
			prompt_tokens: 4,
			completion_tokens: 6,
			total_tokens: 10,
		});
	});

	it("chat inbound stream: pipes Responses SSE into chat SSE ending with [DONE]", async () => {
		const events = [
			{ type: "response.created", response: { id: "resp_1", model: "gpt-4o" } },
			{ type: "response.output_text.delta", delta: "Hel" },
			{ type: "response.output_text.delta", delta: "lo" },
			{
				type: "response.completed",
				response: {
					id: "resp_1",
					model: "gpt-4o",
					status: "completed",
					usage: { input_tokens: 3, output_tokens: 5, total_tokens: 8 },
				},
			},
		];
		const sse = events
			.map((e) => `data: ${JSON.stringify(e)}\n\n`)
			.join("");
		const upstream = new Response(sse, {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
		const out = await convertResponse(
			channel,
			upstream,
			true,
			"/v1/chat/completions",
		);
		expect(out.headers.get("content-type")).toBe("text/event-stream");
		const text = await out.text();
		const payloads = text
			.split("\n\n")
			.filter((line) => line.startsWith("data: "))
			.map((line) => line.slice(6));
		expect(payloads).toHaveLength(5);
		const chunks = payloads.slice(0, 4).map(
			(p) => JSON.parse(p) as Record<string, unknown>,
		);
		expect(
			(chunks[0].choices as Array<Record<string, unknown>>)[0].delta,
		).toEqual({ role: "assistant" });
		const delta1 = (chunks[1].choices as Array<Record<string, unknown>>)[0]
			.delta as Record<string, unknown>;
		expect(delta1.content).toBe("Hel");
		const delta2 = (chunks[2].choices as Array<Record<string, unknown>>)[0]
			.delta as Record<string, unknown>;
		expect(delta2.content).toBe("lo");
		const terminal = chunks[3].choices as Array<Record<string, unknown>>;
		expect(terminal[0].finish_reason).toBe("stop");
		expect(terminal[0].delta).toEqual({});
		expect(chunks[3].usage).toEqual({
			prompt_tokens: 3,
			completion_tokens: 5,
			total_tokens: 8,
		});
		expect(payloads[4]).toBe("[DONE]");
	});

	it("/v1/responses inbound: returns the upstream response untouched", async () => {
		const upstream = jsonResponse(RESPONSES_UPSTREAM_BODY);
		const out = await convertResponse(
			channel,
			upstream,
			false,
			"/v1/responses",
		);
		expect(out).toBe(upstream);
	});

	it("non-chat passthrough inbound: returns the upstream response untouched", async () => {
		const upstream = jsonResponse({ embedding: [1, 2, 3] });
		const out = await convertResponse(
			channel,
			upstream,
			false,
			"/v1/embeddings",
		);
		expect(out).toBe(upstream);
	});

	it("anthropic channels still convert on chat paths (regression)", async () => {
		const anthropicChannel = makeChannel({ api_format: "anthropic" });
		const upstream = jsonResponse({
			id: "msg_1",
			model: "claude-3",
			role: "assistant",
			content: [{ type: "text", text: "Hi" }],
			stop_reason: "end_turn",
			usage: { input_tokens: 1, output_tokens: 2 },
		});
		const out = await convertResponse(
			anthropicChannel,
			upstream,
			false,
			"/v1/chat/completions",
		);
		const body = (await out.json()) as Record<string, unknown>;
		const choices = body.choices as Array<Record<string, unknown>>;
		const message = choices[0].message as Record<string, unknown>;
		expect(message.content).toBe("Hi");
		expect(choices[0].finish_reason).toBe("stop");
	});
});

describe("OpenAI proxy handler routing matrix (integration)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("responses inbound + only anthropic channel: 503 no_available_channels, zero upstream fetches", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const { env } = makeEnv([makeChannel({ api_format: "anthropic" })]);
		const res = await proxyApp.request(
			"/v1/responses",
			{
				method: "POST",
				headers: {
					authorization: "Bearer test-token",
					"content-type": "application/json",
				},
				body: JSON.stringify({ model: "test-model", input: "hi" }),
			},
			env,
		);
		expect(res.status).toBe(503);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.code).toBe("no_available_channels");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("non-chat passthrough + only anthropic channel: 503, zero fetches (regression)", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const { env } = makeEnv([makeChannel({ api_format: "anthropic" })]);
		const res = await proxyApp.request(
			"/v1/embeddings",
			{
				method: "POST",
				headers: {
					authorization: "Bearer test-token",
					"content-type": "application/json",
				},
				body: JSON.stringify({ model: "test-model", input: "hi" }),
			},
			env,
		);
		expect(res.status).toBe(503);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.code).toBe("no_available_channels");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("chat inbound + only responses channel: fetches {base}/responses with converted body and returns a chat completion", async () => {
		const fetchMock = vi.fn(async () => jsonResponse(RESPONSES_UPSTREAM_BODY));
		vi.stubGlobal("fetch", fetchMock);
		const { env, runs } = makeEnv([makeChannel({ api_format: "responses" })]);
		const res = await proxyApp.request(
			"/v1/chat/completions",
			{
				method: "POST",
				headers: {
					authorization: "Bearer test-token",
					"content-type": "application/json",
				},
				body: JSON.stringify({
					model: "test-model",
					messages: [
						{ role: "system", content: "Be nice" },
						{ role: "user", content: "hi" },
					],
				}),
			},
			env,
		);
		expect(res.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const [target, init] = fetchMock.mock.calls[0] as [
			string,
			RequestInit,
		];
		expect(target).toBe("https://upstream.example/v1/responses");
		const upstreamBody = JSON.parse(String(init.body)) as Record<
			string,
			unknown
		>;
		expect(upstreamBody.model).toBe("test-model");
		expect(upstreamBody.instructions).toBe("Be nice");
		expect(upstreamBody.messages).toBeUndefined();
		expect(upstreamBody.stream_options).toBeUndefined();
		expect(upstreamBody.input).toEqual([
			{ role: "user", content: [{ type: "input_text", text: "hi" }] },
		]);

		const body = (await res.json()) as Record<string, unknown>;
		expect(body.object).toBe("chat.completion");
		const choices = body.choices as Array<Record<string, unknown>>;
		const message = choices[0].message as Record<string, unknown>;
		expect(message.content).toBe("Hello!");
		expect(choices[0].finish_reason).toBe("stop");
		expect(body.usage).toEqual({
			prompt_tokens: 4,
			completion_tokens: 6,
			total_tokens: 10,
		});

		// Usage recorded from the converted chat JSON (prompt 4 / completion 6)
		const insert = runs.find((r) =>
			r.sql.includes("INSERT INTO usage_logs"),
		);
		expect(insert).toBeDefined();
		expect(insert?.args[5]).toBe(10);
		expect(insert?.args[6]).toBe(4);
		expect(insert?.args[7]).toBe(6);
	});

	it("streaming chat inbound + responses channel: converts SSE and records usage from the terminal chat chunk", async () => {
		const sseUpstream = [
			'{"type":"response.created","response":{"id":"resp_8","model":"test-model"}}',
			'{"type":"response.output_text.delta","delta":"Hi"}',
			'{"type":"response.completed","response":{"id":"resp_8","usage":{"input_tokens":7,"output_tokens":3,"total_tokens":10}}}',
		]
			.map((payload) => `data: ${payload}\n\n`)
			.join("") + "data: [DONE]\n\n";
		const fetchMock = vi.fn(async () =>
			new Response(sseUpstream, {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const { env, runs } = makeEnv([makeChannel({ api_format: "responses" })]);
		const mockCtx = makeMockCtx();
		const res = await proxyApp.request(
			"/v1/chat/completions",
			{
				method: "POST",
				headers: {
					authorization: "Bearer test-token",
					"content-type": "application/json",
				},
				body: JSON.stringify({
					model: "test-model",
					stream: true,
					messages: [{ role: "user", content: "hi" }],
				}),
			},
			env,
			mockCtx.ctx,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/event-stream");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(target).toBe("https://upstream.example/v1/responses");
		const upstreamBody = JSON.parse(String(init.body)) as Record<
			string,
			unknown
		>;
		expect(upstreamBody.stream).toBe(true);
		// The Responses converter drops stream_options (chat-only field)
		expect(upstreamBody.stream_options).toBeUndefined();
		expect(upstreamBody.input).toEqual([
			{ role: "user", content: [{ type: "input_text", text: "hi" }] },
		]);

		const text = await res.text();
		expect(text).toContain("finish_reason\":\"stop\"");
		expect(text.trimEnd()).toMatch(/data: \[DONE\]$/);

		// Deterministically settle the background SSE usage task
		await mockCtx.awaitTasks();
		const insert = runs.find((r) =>
			r.sql.includes("INSERT INTO usage_logs"),
		);
		expect(insert).toBeDefined();
		expect(insert?.args[5]).toBe(10);
		expect(insert?.args[6]).toBe(7);
		expect(insert?.args[7]).toBe(3);
	});

	it("streaming responses inbound + responses channel: passes the body through untouched and records usage via response.usage", async () => {
		const sseUpstream = [
			'{"type":"response.created","response":{"id":"resp_9","model":"test-model"}}',
			'{"type":"response.completed","response":{"id":"resp_9","usage":{"input_tokens":6,"output_tokens":4,"total_tokens":10}}}',
			"data: [DONE]",
		]
			.map((payload) => `data: ${payload}\n\n`)
			.join("");
		const fetchMock = vi.fn(async () =>
			new Response(sseUpstream, {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const { env, runs } = makeEnv([makeChannel({ api_format: "responses" })]);
		const mockCtx = makeMockCtx();
		const rawBody = JSON.stringify({
			model: "test-model",
			input: "hi",
			stream: true,
		});
		const res = await proxyApp.request(
			"/v1/responses",
			{
				method: "POST",
				headers: {
					authorization: "Bearer test-token",
					"content-type": "application/json",
				},
				body: rawBody,
			},
			env,
			mockCtx.ctx,
		);
		expect(res.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(target).toBe("https://upstream.example/v1/responses");
		// R4 passthrough: byte-identical body, no stream_options injection
		expect(String(init.body)).toBe(rawBody);

		await res.text();
		await mockCtx.awaitTasks();
		const insert = runs.find((r) =>
			r.sql.includes("INSERT INTO usage_logs"),
		);
		expect(insert).toBeDefined();
		expect(insert?.args[5]).toBe(10);
		expect(insert?.args[6]).toBe(6);
		expect(insert?.args[7]).toBe(4);
	});
});

describe("Anthropic proxy handler routing (integration)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("anthropic inbound + only responses channel: 503 no_available_channels, zero upstream fetches", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const { env } = makeEnv([makeChannel({ api_format: "responses" })]);
		const res = await anthropicApp.request(
			"/messages",
			{
				method: "POST",
				headers: {
					authorization: "Bearer test-token",
					"content-type": "application/json",
				},
				body: JSON.stringify({
					model: "test-model",
					max_tokens: 16,
					messages: [{ role: "user", content: "hi" }],
				}),
			},
			env,
		);
		expect(res.status).toBe(503);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.code).toBe("no_available_channels");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("anthropic inbound + openai channel: still converts via chat completions (regression)", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				id: "chatcmpl-1",
				object: "chat.completion",
				created: 1730000000,
				model: "test-model",
				choices: [
					{
						index: 0,
						message: { role: "assistant", content: "Hello!" },
						finish_reason: "stop",
					},
				],
				usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const { env } = makeEnv([makeChannel({ api_format: "openai" })]);
		const res = await anthropicApp.request(
			"/messages",
			{
				method: "POST",
				headers: {
					authorization: "Bearer test-token",
					"content-type": "application/json",
				},
				body: JSON.stringify({
					model: "test-model",
					max_tokens: 16,
					messages: [{ role: "user", content: "hi" }],
				}),
			},
			env,
		);
		expect(res.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const [target, init] = fetchMock.mock.calls[0] as [
			string,
			RequestInit,
		];
		expect(target).toBe("https://upstream.example/v1/chat/completions");
		const upstreamBody = JSON.parse(String(init.body)) as Record<
			string,
			unknown
		>;
		expect(upstreamBody.model).toBe("test-model");
		expect(Array.isArray(upstreamBody.messages)).toBe(true);

		const body = (await res.json()) as Record<string, unknown>;
		expect(body.type).toBe("message");
		expect(body.stop_reason).toBe("end_turn");
		const content = body.content as Array<Record<string, unknown>>;
		expect(content[0].type).toBe("text");
		expect(content[0].text).toBe("Hello!");
		expect(body.usage).toEqual({ input_tokens: 2, output_tokens: 3 });
	});
});
