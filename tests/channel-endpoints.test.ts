import { afterEach, describe, expect, it, vi } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import anthropicApp from "../apps/worker/src/routes/anthropic-proxy";
import proxyApp, { buildChannelRequest } from "../apps/worker/src/routes/proxy";
import channelsApp from "../apps/worker/src/routes/channels";
import { fetchChannelModels } from "../apps/worker/src/services/channel-testing";
import {
	resolveEndpointBaseUrl,
} from "../apps/worker/src/services/channel-routing";
import {
	type ChannelRecord,
} from "../apps/worker/src/services/channels";
import {
	normalizeEndpointOverrides,
	parseEndpointOverrides,
} from "../apps/worker/src/services/channel-types";

// ---------------------------------------------------------------------------
// parseEndpointOverrides — 读侧容错解析（与 parseApiFormats 同哲学）
// ---------------------------------------------------------------------------

describe("parseEndpointOverrides", () => {
	it("parses a well-formed overrides object with all three keys", () => {
		expect(
			parseEndpointOverrides({
				endpoint_overrides: JSON.stringify({
					openai: "https://oai.example/v1",
					responses: "https://resp.example",
					anthropic: "https://antho.example/api/anthropic",
				}),
			}),
		).toEqual({
			openai: "https://oai.example/v1",
			responses: "https://resp.example",
			anthropic: "https://antho.example/api/anthropic",
		});
	});

	it("returns {} for null / missing / empty / whitespace column values", () => {
		expect(parseEndpointOverrides({ endpoint_overrides: null })).toEqual({});
		expect(parseEndpointOverrides({})).toEqual({});
		expect(parseEndpointOverrides({ endpoint_overrides: "" })).toEqual({});
		expect(parseEndpointOverrides({ endpoint_overrides: "   " })).toEqual({});
	});

	it("returns {} for malformed JSON", () => {
		expect(parseEndpointOverrides({ endpoint_overrides: '{"openai":' })).toEqual(
			{},
		);
		expect(parseEndpointOverrides({ endpoint_overrides: "not-json" })).toEqual(
			{},
		);
	});

	it("returns {} when the top-level JSON is not an object", () => {
		expect(
			parseEndpointOverrides({ endpoint_overrides: '["openai"]' }),
		).toEqual({});
		expect(parseEndpointOverrides({ endpoint_overrides: '"str"' })).toEqual({});
		expect(parseEndpointOverrides({ endpoint_overrides: "42" })).toEqual({});
		expect(parseEndpointOverrides({ endpoint_overrides: "null" })).toEqual({});
	});

	it("filters keys outside the {openai, responses, anthropic} whitelist", () => {
		expect(
			parseEndpointOverrides({
				endpoint_overrides: JSON.stringify({
					openai: "https://a.example/v1",
					grpc: "https://g.example",
					custom: "https://c.example/full-url",
				}),
			}),
		).toEqual({ openai: "https://a.example/v1" });
	});

	it("drops non-string and blank values (blank override = not overridden)", () => {
		expect(
			parseEndpointOverrides({
				endpoint_overrides: JSON.stringify({
					openai: "   ",
					responses: 42,
					anthropic: "https://a.example",
				}),
			}),
		).toEqual({ anthropic: "https://a.example" });
	});
});

// ---------------------------------------------------------------------------
// resolveEndpointBaseUrl — 覆盖优先 / 兜底 byte-identical（AC1 红线）
// ---------------------------------------------------------------------------

describe("resolveEndpointBaseUrl — no-override fallback (byte-identical guard)", () => {
	const row = (baseUrl: string, overrides: string | null) => ({
		base_url: baseUrl,
		endpoint_overrides: overrides,
	});

	it("anthropic: normalizeBaseUrl semantics (strip trailing slashes + one /v1)", () => {
		// 现行分支逻辑：normalizeBaseUrl("https://x.com/v1/") === "https://x.com"
		expect(resolveEndpointBaseUrl(row("https://x.com/v1/", null), "anthropic")).toBe(
			"https://x.com",
		);
		expect(resolveEndpointBaseUrl(row("https://x.com", null), "anthropic")).toBe(
			"https://x.com",
		);
		expect(
			resolveEndpointBaseUrl(row("https://x.com/V1//", null), "anthropic"),
		).toBe("https://x.com");
	});

	it("openai: trim trailing slashes only — version path preserved", () => {
		// 现行分支逻辑：base_url.replace(/\/+$/, "") === "https://x.com/v1"
		expect(resolveEndpointBaseUrl(row("https://x.com/v1/", null), "openai")).toBe(
			"https://x.com/v1",
		);
		expect(resolveEndpointBaseUrl(row("https://x.com/v1", null), "openai")).toBe(
			"https://x.com/v1",
		);
	});

	it("responses: same rule as openai", () => {
		expect(
			resolveEndpointBaseUrl(row("https://x.com/v1//", null), "responses"),
		).toBe("https://x.com/v1");
	});

	it("custom: base_url returned raw (full URL semantics)", () => {
		expect(
			resolveEndpointBaseUrl(
				row("https://legacy.example/custom-endpoint", null),
				"custom",
			),
		).toBe("https://legacy.example/custom-endpoint");
	});

	it("malformed overrides JSON falls back byte-identically for every format", () => {
		const dirty = row("https://x.com/v1/", '{"openai":');
		expect(resolveEndpointBaseUrl(dirty, "anthropic")).toBe("https://x.com");
		expect(resolveEndpointBaseUrl(dirty, "openai")).toBe("https://x.com/v1");
		expect(resolveEndpointBaseUrl(dirty, "responses")).toBe("https://x.com/v1");
		expect(resolveEndpointBaseUrl(dirty, "custom")).toBe(
			"https://x.com/v1/",
		);
	});
});

describe("resolveEndpointBaseUrl — override wins", () => {
	const row = (baseUrl: string, overrides: unknown) => ({
		base_url: baseUrl,
		endpoint_overrides: JSON.stringify(overrides),
	});

	it("anthropic: override normalized with normalizeBaseUrl semantics", () => {
		expect(
			resolveEndpointBaseUrl(
				row("https://main.example/v1", {
					anthropic: "https://x.example/api/anthropic",
				}),
				"anthropic",
			),
		).toBe("https://x.example/api/anthropic");
		// 覆盖值尾斜杠 / 尾部 /v1 同样被 normalizeBaseUrl 剥除
		expect(
			resolveEndpointBaseUrl(
				row("https://main.example/v1", {
					anthropic: "https://x.example/anthropic/v1/",
				}),
				"anthropic",
			),
		).toBe("https://x.example/anthropic");
	});

	it("openai: override keeps version path (only trailing slashes stripped)", () => {
		expect(
			resolveEndpointBaseUrl(
				row("https://main.example/v1", { openai: "https://oai.example/v2" }),
				"openai",
			),
		).toBe("https://oai.example/v2");
		// 与 anthropic 规范化的关键差异：/v1 不被剥除
		expect(
			resolveEndpointBaseUrl(
				row("https://main.example/v1", { openai: "https://oai.example/v1//" }),
				"openai",
			),
		).toBe("https://oai.example/v1");
	});

	it("responses: override same trim rule as openai", () => {
		expect(
			resolveEndpointBaseUrl(
				row("https://main.example", { responses: "https://resp.example/api/" }),
				"responses",
			),
		).toBe("https://resp.example/api");
	});

	it("custom: base_url wins even when other overrides exist", () => {
		expect(
			resolveEndpointBaseUrl(
				row("https://legacy.example/full-url", {
					openai: "https://oai.example/v1",
					responses: "https://resp.example",
				}),
				"custom",
			),
		).toBe("https://legacy.example/full-url");
	});

	it("only the requested format's override applies", () => {
		const source = row("https://main.example/v1", {
			anthropic: "https://x.example/api/anthropic",
		});
		expect(resolveEndpointBaseUrl(source, "openai")).toBe(
			"https://main.example/v1",
		);
		expect(resolveEndpointBaseUrl(source, "anthropic")).toBe(
			"https://x.example/api/anthropic",
		);
	});
});

// ---------------------------------------------------------------------------
// buildChannelRequest — 三分支换 resolver（AC2 / AC3 单元级）
// ---------------------------------------------------------------------------

function makeChannel(overrides: Partial<ChannelRecord> = {}): ChannelRecord {
	return {
		id: "ch1",
		name: "test-channel",
		base_url: "https://main.example/v1",
		api_key: "sk-channel",
		weight: 1,
		status: "active",
		api_format: "openai",
		api_formats: JSON.stringify(["openai", "anthropic"]),
		endpoint_overrides: null,
		models_json: JSON.stringify([{ id: "test-model" }]),
		...overrides,
	};
}

describe("buildChannelRequest with endpoint overrides", () => {
	it("anthropic target: hits {norm(override)}/v1/messages (AC2)", () => {
		const channel = makeChannel({
			api_format: "anthropic",
			endpoint_overrides: JSON.stringify({
				anthropic: "https://x.example/api/anthropic",
			}),
		});
		const result = buildChannelRequest(
			channel,
			"/v1/chat/completions",
			"",
			new Headers(),
			JSON.stringify({ model: "m", messages: [] }),
			{ model: "m", messages: [] },
			false,
			"sk-call",
		);
		expect(result.target).toBe("https://x.example/api/anthropic/v1/messages");
	});

	it("chat inbound on the same channel is unaffected by the anthropic override (AC2)", () => {
		const channel = makeChannel({
			api_format: "openai",
			endpoint_overrides: JSON.stringify({
				anthropic: "https://x.example/api/anthropic",
			}),
		});
		const result = buildChannelRequest(
			channel,
			"/v1/chat/completions",
			"",
			new Headers(),
			JSON.stringify({ model: "m", messages: [] }),
			{ model: "m", messages: [] },
			false,
			"sk-call",
		);
		// 仍走 base_url（保留版本路径）
		expect(result.target).toBe("https://main.example/v1/chat/completions");
	});

	it("responses target: /v1/responses inbound hits {override}/responses (AC3)", () => {
		const channel = makeChannel({
			api_format: "responses",
			endpoint_overrides: JSON.stringify({
				responses: "https://resp.example/api",
			}),
		});
		const result = buildChannelRequest(
			channel,
			"/v1/responses",
			"",
			new Headers(),
			"{}",
			null,
			false,
			"sk-call",
		);
		expect(result.target).toBe("https://resp.example/api/responses");
	});

	it("openai target: chat inbound hits {override}/chat/completions (AC3)", () => {
		const channel = makeChannel({
			api_format: "openai",
			endpoint_overrides: JSON.stringify({ openai: "https://oai.example/v2" }),
		});
		const result = buildChannelRequest(
			channel,
			"/v1/chat/completions",
			"",
			new Headers(),
			JSON.stringify({ model: "m", messages: [] }),
			{ model: "m", messages: [] },
			false,
			"sk-call",
		);
		expect(result.target).toBe("https://oai.example/v2/chat/completions");
	});

	it("openai target: passthrough path hits {override}{subPath} (AC3)", () => {
		const channel = makeChannel({
			api_format: "openai",
			endpoint_overrides: JSON.stringify({ openai: "https://oai.example/v2" }),
		});
		const result = buildChannelRequest(
			channel,
			"/v1/embeddings",
			"",
			new Headers(),
			JSON.stringify({ model: "m", input: [] }),
			{ model: "m", input: [] },
			false,
			"sk-call",
		);
		expect(result.target).toBe("https://oai.example/v2/embeddings");
	});

	it("custom target ignores overrides entirely (base_url is the full URL)", () => {
		const channel = makeChannel({
			api_format: "custom",
			base_url: "https://legacy.example/full-url",
			endpoint_overrides: JSON.stringify({ openai: "https://oai.example/v1" }),
		});
		const result = buildChannelRequest(
			channel,
			"/v1/chat/completions",
			"",
			new Headers(),
			"{}",
			null,
			false,
			"sk-call",
		);
		expect(result.target).toBe("https://legacy.example/full-url");
	});
});

// ---------------------------------------------------------------------------
// fetchChannelModels — 探测分端点（AC6）
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("fetchChannelModels with endpoint overrides", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("probes each declared format at its own resolved endpoint (AC6)", async () => {
		const calls: string[] = [];
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			calls.push(String(input));
			return jsonResponse({ data: [{ id: "gpt-4o" }] });
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await fetchChannelModels(
			"https://main.example/v1",
			"sk",
			["openai", "anthropic"],
			null,
			null,
			JSON.stringify({ anthropic: "https://x.example/api/anthropic" }),
		);

		expect(result.ok).toBe(true);
		expect(calls.sort()).toEqual([
			// openai 无覆盖 → base_url 推导（保留版本路径）
			"https://main.example/v1/models",
			// anthropic 覆盖 → normalizeBaseUrl(override) + /v1/models
			"https://x.example/api/anthropic/v1/models",
		]);
	});

	it("channel row without overrides probes base_url for every format (unchanged)", async () => {
		const calls: string[] = [];
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			calls.push(String(input));
			return jsonResponse({ data: [{ id: "gpt-4o" }] });
		});
		vi.stubGlobal("fetch", fetchMock);

		await fetchChannelModels("https://x.com", "sk", ["openai", "anthropic"]);

		expect(calls.sort()).toEqual([
			"https://x.com/models",
			"https://x.com/v1/models",
		]);
	});
});

// ---------------------------------------------------------------------------
// 路由级集成 — handler 接线（AC2 / AC3）
// ---------------------------------------------------------------------------

const tokenRow = {
	id: "tok1",
	name: "test-token",
	quota_total: null,
	quota_used: 0,
	status: "active",
	allowed_channels: null,
	user_id: null,
};

function makeProxyDb(channels: unknown[]) {
	return {
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
					return { results: [] };
				},
				first: async () => {
					if (sql.includes("FROM tokens")) {
						return tokenRow;
					}
					return null;
				},
				run: async () => ({}),
			};
			return stmt;
		},
	};
}

type ProxyRequestEnv = Parameters<typeof proxyApp.request>[2];

function makeProxyEnv(channels: unknown[]): { env: ProxyRequestEnv } {
	const db = makeProxyDb(channels);
	return {
		env: {
			DB: db,
			PROXY_RETRY_ROUNDS: "1",
			PROXY_RETRY_DELAY_MS: "0",
		} as unknown as ProxyRequestEnv,
	};
}

describe("proxy handler routing with endpoint overrides (integration)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("/v1/responses inbound + responses override: upstream fetch hits {override}/responses (AC3)", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				id: "resp_1",
				object: "response",
				status: "completed",
				model: "test-model",
				output: [
					{
						type: "message",
						content: [{ type: "output_text", text: "Hello!" }],
					},
				],
				usage: { input_tokens: 4, output_tokens: 6, total_tokens: 10 },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const { env } = makeProxyEnv([
			makeChannel({
				api_format: "openai",
				api_formats: JSON.stringify(["responses"]),
				endpoint_overrides: JSON.stringify({
					responses: "https://resp.example/api",
				}),
			}),
		]);
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
		expect(res.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [target] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(target).toBe("https://resp.example/api/responses");
	});
});

describe("anthropic proxy handler with endpoint overrides (integration)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("anthropic inbound + anthropic override: upstream fetch hits {norm(override)}/v1/messages (AC2)", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				id: "msg_1",
				type: "message",
				model: "claude-3",
				role: "assistant",
				content: [{ type: "text", text: "Hi" }],
				stop_reason: "end_turn",
				usage: { input_tokens: 1, output_tokens: 2 },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const { env } = makeProxyEnv([
			makeChannel({
				api_format: "openai",
				api_formats: JSON.stringify(["anthropic", "openai"]),
				endpoint_overrides: JSON.stringify({
					anthropic: "https://x.example/api/anthropic/",
				}),
			}),
		]);
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
		const [target] = fetchMock.mock.calls[0] as [string, RequestInit];
		// 覆盖值尾斜杠经 normalizeBaseUrl 剥除，再拼 /v1/messages
		expect(target).toBe("https://x.example/api/anthropic/v1/messages");
	});
});

// ---------------------------------------------------------------------------
// /api/channels/:id/test — 渠道行覆盖探测（AC6 路由级）
// ---------------------------------------------------------------------------

function makeChannelsDb(options: { channelRow?: Record<string, unknown> | null } = {}) {
	const runs: Array<{ sql: string; args: unknown[] }> = [];
	const db = {
		prepare(sql: string) {
			const stmt = {
				boundArgs: [] as unknown[],
				bind: (...args: unknown[]) => {
					stmt.boundArgs = args;
					return stmt;
				},
				all: async () => ({ results: [] }),
				first: async () => {
					if (sql.includes("SELECT * FROM channels")) {
						return options.channelRow ?? null;
					}
					if (sql.includes("SELECT id FROM channels")) {
						return options.channelRow
							? { id: (options.channelRow as { id?: string }).id }
							: null;
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
	return {
		db: db as unknown as D1Database,
		runs,
	};
}

type ChannelsRequestEnv = Parameters<typeof channelsApp.request>[2];

function makeChannelsEnv(options: { channelRow?: Record<string, unknown> } = {}): {
	env: ChannelsRequestEnv;
	runs: Array<{ sql: string; args: unknown[] }>;
} {
	const { db, runs } = makeChannelsDb({
		channelRow: options.channelRow ?? null,
	});
	return { env: { DB: db } as unknown as ChannelsRequestEnv, runs };
}

describe("POST /api/channels/:id/test — per-format endpoint resolution", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("probes the anthropic override endpoint while openai stays on base_url (AC6)", async () => {
		const calls: string[] = [];
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			calls.push(String(input));
			return jsonResponse({ data: [{ id: "gpt-4o" }] });
		});
		vi.stubGlobal("fetch", fetchMock);
		const { env, runs } = makeChannelsEnv({
			channelRow: {
				id: "ch1",
				name: "agg",
				base_url: "https://main.example/v1",
				api_key: "sk-test",
				weight: 1,
				status: "active",
				models_json: "[]",
				api_format: "openai",
				api_formats: '["openai","anthropic"]',
				endpoint_overrides: JSON.stringify({
					anthropic: "https://x.example/api/anthropic",
				}),
				custom_headers_json: null,
				disguise_headers_json: null,
			},
		});

		const res = await channelsApp.request("/ch1/test", { method: "POST" }, env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.ok).toBe(true);
		expect(calls.sort()).toEqual([
			"https://main.example/v1/models",
			"https://x.example/api/anthropic/v1/models",
		]);
		// 整体 ok → 测试状态仍落库 active
		expect(runs).toHaveLength(1);
		expect(runs[0].sql).toContain("UPDATE channels");
		expect(runs[0].args[0]).toBe("active");
	});
});

// ---------------------------------------------------------------------------
// repo 列序锁定 — endpoint_overrides 的 INSERT / UPDATE 绑定位置
// ---------------------------------------------------------------------------

describe("channel repo — endpoint_overrides bind positions", () => {
	it("INSERT binds endpoint_overrides right after api_formats (args[14])", async () => {
		const { env, runs } = makeChannelsEnv();
		const res = await channelsApp.request(
			"/",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "c",
					base_url: "https://x.com/v1",
				}),
			},
			env,
		);
		expect(res.status).toBe(200);
		expect(runs[0].sql).toContain("endpoint_overrides");
		// 列序：… metadata_json(11), api_format(12), api_formats(13),
		// endpoint_overrides(14), custom_headers_json(15) …
		expect(runs[0].args[12]).toBe("openai");
		expect(runs[0].args[13]).toBe('["openai"]');
		expect(runs[0].args[14]).toBe(null);
		expect(runs[0].args[15]).toBe(null);
	});

	it("UPDATE binds endpoint_overrides right after api_formats (args[13]) and preserves the stored value", async () => {
		const { env, runs } = makeChannelsEnv({
			channelRow: {
				id: "ch1",
				name: "c",
				base_url: "https://x.com/v1",
				api_key: "sk",
				weight: 1,
				status: "active",
				models_json: "[]",
				api_format: "openai",
				api_formats: '["openai"]',
				endpoint_overrides: '{"anthropic":"https://x.example/api/anthropic"}',
				custom_headers_json: null,
				disguise_headers_json: null,
			},
		});
		const res = await channelsApp.request(
			"/ch1",
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: "renamed" }),
			},
			env,
		);
		expect(res.status).toBe(200);
		expect(runs[0].sql).toContain("endpoint_overrides = ?");
		// UPDATE 绑定序：… metadata_json(10), api_format(11), api_formats(12),
		// endpoint_overrides(13), custom_headers_json(14) …
		expect(runs[0].args[11]).toBe("openai");
		expect(runs[0].args[12]).toBe('["openai"]');
		expect(runs[0].args[13]).toBe(
			'{"anthropic":"https://x.example/api/anthropic"}',
		);
	});
});

// ---------------------------------------------------------------------------
// normalizeEndpointOverrides — CRUD 写侧校验与规范化（AC4）
// ---------------------------------------------------------------------------

describe("normalizeEndpointOverrides — validation matrix", () => {
	it("rejects non-object input (array / string / number)", () => {
		expect(
			normalizeEndpointOverrides(["openai"], ["openai"]),
		).toEqual({ ok: false, reason: "not_object" });
		expect(
			normalizeEndpointOverrides("https://x.com", ["openai"]),
		).toEqual({ ok: false, reason: "not_object" });
		expect(normalizeEndpointOverrides(42, ["openai"])).toEqual({
			ok: false,
			reason: "not_object",
		});
	});

	it("field-level null clears everything", () => {
		expect(normalizeEndpointOverrides(null, ["openai"])).toEqual({
			ok: true,
			value: null,
		});
	});

	it("rejects keys outside the {openai, responses, anthropic} whitelist", () => {
		expect(
			normalizeEndpointOverrides({ grpc: "https://g.example" }, ["openai"]),
		).toEqual({ ok: false, reason: "unknown_key", key: "grpc" });
	});

	it("rejects the custom key explicitly (base_url is the full URL)", () => {
		expect(
			normalizeEndpointOverrides(
				{ custom: "https://c.example/full" },
				["custom"],
			),
		).toEqual({ ok: false, reason: "custom_key", key: "custom" });
	});

	it("rejects keys for formats not in the effective declared formats", () => {
		expect(
			normalizeEndpointOverrides(
				{ anthropic: "https://x.example" },
				["openai"],
			),
		).toEqual({ ok: false, reason: "undeclared_format", key: "anthropic" });
	});

	it("rejects values without an http(s) prefix (incl. non-string values)", () => {
		expect(
			normalizeEndpointOverrides({ openai: "x.example/v1" }, ["openai"]),
		).toEqual({ ok: false, reason: "invalid_url", key: "openai" });
		expect(
			normalizeEndpointOverrides(
				{ responses: "ftp://resp.example" },
				["responses"],
			),
		).toEqual({ ok: false, reason: "invalid_url", key: "responses" });
		expect(normalizeEndpointOverrides({ openai: 42 }, ["openai"])).toEqual({
			ok: false,
			reason: "invalid_url",
			key: "openai",
		});
	});
});

describe("normalizeEndpointOverrides — three states & storage normalization", () => {
	it("drops null / blank values (per-key clear)", () => {
		expect(
			normalizeEndpointOverrides(
				{ anthropic: null, openai: "", responses: "   " },
				["openai", "responses", "anthropic"],
			),
		).toEqual({ ok: true, value: null });
	});

	it("normalizes anthropic overrides with normalizeBaseUrl semantics", () => {
		expect(
			normalizeEndpointOverrides(
				{ anthropic: "https://x.example/api/anthropic/v1/" },
				["anthropic"],
			),
		).toEqual({
			ok: true,
			value: '{"anthropic":"https://x.example/api/anthropic"}',
		});
	});

	it("keeps version paths for openai / responses (trim + trailing slashes only)", () => {
		expect(
			normalizeEndpointOverrides(
				{
					openai: "  https://oai.example/v1//  ",
					responses: "https://resp.example/api/",
				},
				["openai", "responses"],
			),
		).toEqual({
			ok: true,
			value:
				'{"openai":"https://oai.example/v1","responses":"https://resp.example/api"}',
		});
	});

	it("emits canonical key order regardless of input order", () => {
		expect(
			normalizeEndpointOverrides(
				{ anthropic: "https://a.example", openai: "https://o.example/v1" },
				["openai", "anthropic"],
			),
		).toEqual({
			ok: true,
			value:
				'{"openai":"https://o.example/v1","anthropic":"https://a.example"}',
		});
	});

	it("returns null for an empty overrides object", () => {
		expect(normalizeEndpointOverrides({}, ["openai"])).toEqual({
			ok: true,
			value: null,
		});
	});
});

// ---------------------------------------------------------------------------
// CRUD 接线 — POST / PATCH / fetch_models / test-model（AC4 / R4）
// ---------------------------------------------------------------------------

const overridesRow = {
	id: "ch1",
	name: "agg",
	base_url: "https://main.example/v1",
	api_key: "sk-test",
	weight: 1,
	status: "active",
	models_json: "[]",
	api_format: "openai",
	api_formats: '["openai","anthropic"]',
	endpoint_overrides: JSON.stringify({
		openai: "https://oai.example/v1",
		anthropic: "https://x.example/api/anthropic",
	}),
	custom_headers_json: null,
	disguise_headers_json: null,
};

describe("POST /api/channels — endpoint_overrides storage", () => {
	it("stores normalized overrides JSON at args[14]", async () => {
		const { env, runs } = makeChannelsEnv();
		const res = await channelsApp.request(
			"/",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "agg",
					base_url: "https://x.com/v1/",
					api_formats: ["openai", "anthropic"],
					endpoint_overrides: {
						anthropic: "https://x.example/api/anthropic/",
						openai: "https://oai.example/v1//",
					},
				}),
			},
			env,
		);
		expect(res.status).toBe(200);
		expect(runs[0].sql).toContain("INSERT INTO channels");
		// 规范化：首尾空白/尾斜杠剥除 + 规范键序（openai → responses → anthropic）
		expect(runs[0].args[14]).toBe(
			'{"openai":"https://oai.example/v1","anthropic":"https://x.example/api/anthropic"}',
		);
	});

	it("rejects an unknown key with 400 invalid_endpoint_overrides and writes nothing", async () => {
		const { env, runs } = makeChannelsEnv();
		const res = await channelsApp.request(
			"/",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "c",
					base_url: "https://x.com/v1",
					api_formats: ["openai"],
					endpoint_overrides: { grpc: "https://g.example" },
				}),
			},
			env,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.code).toBe("invalid_endpoint_overrides");
		expect(String(body.error)).toContain("grpc");
		expect(runs).toHaveLength(0);
	});
});

describe("PATCH /api/channels/:id — endpoint_overrides three-state", () => {
	it("clears a single key via null while keeping the rest", async () => {
		const { env, runs } = makeChannelsEnv({
			channelRow: { ...overridesRow },
		});
		const res = await channelsApp.request(
			"/ch1",
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					endpoint_overrides: {
						openai: "https://oai.example/v1",
						anthropic: null,
					},
				}),
			},
			env,
		);
		expect(res.status).toBe(200);
		expect(runs[0].sql).toContain("endpoint_overrides = ?");
		expect(runs[0].args[13]).toBe('{"openai":"https://oai.example/v1"}');
	});

	it("keeps the stored value when the field is absent", async () => {
		const { env, runs } = makeChannelsEnv({
			channelRow: { ...overridesRow },
		});
		const res = await channelsApp.request(
			"/ch1",
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: "renamed" }),
			},
			env,
		);
		expect(res.status).toBe(200);
		expect(runs[0].args[13]).toBe(
			'{"openai":"https://oai.example/v1","anthropic":"https://x.example/api/anthropic"}',
		);
	});
});

describe("POST /api/channels/fetch_models — endpoint_overrides probe routing", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("probes the anthropic override endpoint while openai stays on base_url", async () => {
		const calls: string[] = [];
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			calls.push(String(input));
			return jsonResponse({ data: [{ id: "gpt-4o" }] });
		});
		vi.stubGlobal("fetch", fetchMock);
		const { env } = makeChannelsEnv();

		const res = await channelsApp.request(
			"/fetch_models",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					base_url: "https://x.com/v1",
					api_key: "sk",
					api_formats: ["openai", "anthropic"],
					endpoint_overrides: {
						anthropic: "https://x.example/api/anthropic",
					},
				}),
			},
			env,
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.ok).toBe(true);
		expect(calls.sort()).toEqual([
			"https://x.com/v1/models",
			"https://x.example/api/anthropic/v1/models",
		]);
	});
});

describe("POST /api/channels/test-model — endpoint_overrides precedence", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("body overrides win over the DB row for the upstream target", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				id: "msg_1",
				type: "message",
				role: "assistant",
				model: "test-model",
				content: [{ type: "text", text: "Hi" }],
				stop_reason: "end_turn",
				usage: { input_tokens: 1, output_tokens: 2 },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const { env } = makeChannelsEnv({
			channelRow: {
				...overridesRow,
				api_format: "anthropic",
				api_formats: '["anthropic"]',
				endpoint_overrides: JSON.stringify({
					anthropic: "https://old.example/anthropic",
				}),
			},
		});

		const res = await channelsApp.request(
			"/test-model",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					id: "ch1",
					model: "test-model",
					endpoint_overrides: {
						anthropic: "https://new.example/anthropic",
					},
				}),
			},
			env,
		);

		expect(res.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [target] = fetchMock.mock.calls[0] as [string, RequestInit];
		// anthropic 目标格式：normalizeBaseUrl(body 覆盖) + /v1/messages，
		// DB 行的旧覆盖被表单值取代（表单即真相）
		expect(target).toBe("https://new.example/anthropic/v1/messages");
	});

	it("rejects invalid body overrides with 400 without contacting upstream", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const { env } = makeChannelsEnv({
			channelRow: { ...overridesRow },
		});

		const res = await channelsApp.request(
			"/test-model",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					id: "ch1",
					model: "test-model",
					endpoint_overrides: { anthropic: "not-a-url" },
				}),
			},
			env,
		);

		expect(res.status).toBe(400);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.code).toBe("invalid_endpoint_overrides");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
