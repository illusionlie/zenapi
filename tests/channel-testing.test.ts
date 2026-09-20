import { afterEach, describe, expect, it, vi } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import channelsApp from "../apps/worker/src/routes/channels";
import { fetchChannelModels } from "../apps/worker/src/services/channel-testing";

/**
 * Minimal D1 mock covering the queries the channels routes hit:
 * channelExists (SELECT id FROM channels), getChannelById
 * (SELECT * FROM channels), and run() capture for INSERT / UPDATE.
 */
function makeDb(options: { channelRow?: Record<string, unknown> | null } = {}) {
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
		// Test-boundary cast: mock only implements the statement methods used.
		db: db as unknown as D1Database,
		runs,
	};
}

type RequestEnv = Parameters<typeof channelsApp.request>[2];

function makeEnv(options: { channelRow?: Record<string, unknown> } = {}): {
	env: RequestEnv;
	runs: Array<{ sql: string; args: unknown[] }>;
} {
	const { db, runs } = makeDb({ channelRow: options.channelRow ?? null });
	return { env: { DB: db } as unknown as RequestEnv, runs };
}

function makeChannelRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "ch1",
		name: "test-channel",
		base_url: "https://x.com",
		api_key: "sk-test",
		weight: 1,
		status: "active",
		models_json: "[]",
		api_format: "openai",
		api_formats: '["openai","anthropic"]',
		custom_headers_json: null,
		disguise_headers_json: null,
		...overrides,
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function postInit(body: unknown): RequestInit {
	return {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	};
}

function patchInit(body: unknown): RequestInit {
	return {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	};
}

async function jsonBody(res: Response): Promise<Record<string, unknown>> {
	return (await res.json()) as Record<string, unknown>;
}

describe("fetchChannelModels — multi-format probing", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("probes every declared format and unions models deduped by id", async () => {
		const calls: Array<{ url: string; headers: Record<string, string> }> = [];
		const fetchMock = vi.fn(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
				if (url === "https://agg.example.com/v1/models") {
					return jsonResponse({ data: [{ id: "claude-3" }, { id: "gpt-4o" }] });
				}
				return jsonResponse({ data: [{ id: "gpt-4o" }, { id: "gpt-3.5" }] });
			},
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await fetchChannelModels(
			"https://agg.example.com",
			"sk",
			["openai", "anthropic"],
		);

		expect(result.ok).toBe(true);
		// 并集按声明序先到先得去重：gpt-4o 两个格式都返回，只保留一份
		expect(result.models).toEqual(["gpt-4o", "gpt-3.5", "claude-3"]);
		expect(result.probe_warnings).toBeUndefined();
		expect(result.results).toEqual([
			{ api_format: "openai", ok: true, model_count: 2 },
			{ api_format: "anthropic", ok: true, model_count: 2 },
		]);
		expect(calls.map((call) => call.url).sort()).toEqual([
			"https://agg.example.com/models",
			"https://agg.example.com/v1/models",
		]);
		const anthropicCall = calls.find((call) =>
			call.url.endsWith("/v1/models"),
		);
		expect(anthropicCall?.headers["x-api-key"]).toBe("sk");
		expect(anthropicCall?.headers["anthropic-version"]).toBe("2023-06-01");
		const openaiCall = calls.find(
			(call) => call.url === "https://agg.example.com/models",
		);
		expect(openaiCall?.headers.Authorization).toBe("Bearer sk");
	});

	it("keeps going on partial failure and reports probe_warnings", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			if (String(input) === "https://x.com/v1/models") {
				throw new Error("connect ECONNREFUSED");
			}
			return jsonResponse({ data: [{ id: "gpt-4o" }] });
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await fetchChannelModels("https://x.com", "sk", [
			"openai",
			"anthropic",
		]);

		expect(result.ok).toBe(true);
		expect(result.models).toEqual(["gpt-4o"]);
		expect(result.probe_warnings).toHaveLength(1);
		expect(result.probe_warnings?.[0]).toContain("anthropic");
		expect(result.results?.[0]).toEqual({
			api_format: "openai",
			ok: true,
			model_count: 1,
		});
		expect(result.results?.[1]?.ok).toBe(false);
		expect(result.results?.[1]?.error).toContain("ECONNREFUSED");
	});

	it("fails overall only when every declared format fails", async () => {
		const fetchMock = vi.fn(async () => {
			throw new Error("dns failure");
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await fetchChannelModels("https://x.com", "sk", [
			"openai",
			"anthropic",
		]);

		expect(result.ok).toBe(false);
		expect(result.models).toEqual([]);
		expect(result.probe_warnings).toHaveLength(2);
	});

	it("probes custom format at base_url itself", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			expect(String(input)).toBe("https://legacy.example/custom-endpoint");
			return jsonResponse({ data: [{ id: "m1" }] });
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await fetchChannelModels(
			"https://legacy.example/custom-endpoint",
			"sk",
			["custom"],
		);

		expect(result.ok).toBe(true);
		expect(result.models).toEqual(["m1"]);
		expect(result.results).toEqual([
			{ api_format: "custom", ok: true, model_count: 1 },
		]);
	});

	it("keeps single-format reachability semantics: any HTTP response counts as ok", async () => {
		const fetchMock = vi.fn(async () => new Response("forbidden", { status: 403 }));
		vi.stubGlobal("fetch", fetchMock);

		const result = await fetchChannelModels("https://x.com/v1", "sk", [
			"openai",
		]);

		expect(result.ok).toBe(true);
		expect(result.models).toEqual([]);
		expect(result.probe_warnings).toBeUndefined();
		expect(result.results).toEqual([
			{ api_format: "openai", ok: true, model_count: 0 },
		]);
	});
});

describe("POST /api/channels — api_formats validation", () => {
	it("rejects non-array api_formats with 400 invalid_api_formats", async () => {
		const { env, runs } = makeEnv();
		const res = await channelsApp.request(
			"/",
			postInit({
				name: "c",
				base_url: "https://x.com/v1",
				api_formats: "openai",
			}),
			env,
		);
		expect(res.status).toBe(400);
		const body = await jsonBody(res);
		expect(body.code).toBe("invalid_api_formats");
		expect(runs).toHaveLength(0);
	});

	it("rejects empty array api_formats with a reason message", async () => {
		const { env } = makeEnv();
		const res = await channelsApp.request(
			"/",
			postInit({ name: "c", base_url: "https://x.com/v1", api_formats: [] }),
			env,
		);
		expect(res.status).toBe(400);
		const body = await jsonBody(res);
		expect(body.code).toBe("invalid_api_formats");
		expect(String(body.error)).toContain("cannot be empty");
	});

	it("rejects custom combined with other formats", async () => {
		const { env } = makeEnv();
		const res = await channelsApp.request(
			"/",
			postInit({
				name: "c",
				base_url: "https://x.com/v1",
				api_formats: ["custom", "openai"],
			}),
			env,
		);
		expect(res.status).toBe(400);
		const body = await jsonBody(res);
		expect(String(body.error)).toContain("custom");
	});

	it("rejects a legacy single api_format outside the whitelist", async () => {
		const { env } = makeEnv();
		const res = await channelsApp.request(
			"/",
			postInit({ name: "c", base_url: "https://x.com/v1", api_format: "grpc" }),
			env,
		);
		expect(res.status).toBe(400);
		const body = await jsonBody(res);
		expect(body.code).toBe("invalid_api_formats");
	});
});

describe("POST /api/channels — format storage", () => {
	it("stores canonical api_formats with mirror on multi-format create", async () => {
		const { env, runs } = makeEnv();
		const res = await channelsApp.request(
			"/",
			postInit({
				name: "agg",
				base_url: "https://agg.example.com/v1/",
				api_formats: ["anthropic", "openai"],
			}),
			env,
		);
		expect(res.status).toBe(200);
		expect(runs).toHaveLength(1);
		expect(runs[0].sql).toContain("INSERT INTO channels");
		// 多格式 base_url：trim + 去尾斜杠，保留 /v1（openai/responses 端点
		// 的存储约定；anthropic 端点在请求时自会 normalizeBaseUrl）
		expect(runs[0].args[2]).toBe("https://agg.example.com/v1");
		// 规范序 + 镜像首元素
		expect(runs[0].args[12]).toBe("openai");
		expect(runs[0].args[13]).toBe('["openai","anthropic"]');
	});

	it("maps legacy single api_format and keeps anthropic base_url normalization", async () => {
		const { env, runs } = makeEnv();
		const res = await channelsApp.request(
			"/",
			postInit({
				name: "a",
				base_url: "https://x.com/v1/",
				api_format: "anthropic",
			}),
			env,
		);
		expect(res.status).toBe(200);
		expect(runs[0].args[2]).toBe("https://x.com");
		expect(runs[0].args[13]).toBe('["anthropic"]');
		expect(runs[0].args[12]).toBe("anthropic");
	});

	it("prefers api_formats when both fields are provided", async () => {
		const { env, runs } = makeEnv();
		const res = await channelsApp.request(
			"/",
			postInit({
				name: "c",
				base_url: "https://x.com/v1",
				api_formats: ["responses"],
				api_format: "anthropic",
			}),
			env,
		);
		expect(res.status).toBe(200);
		expect(runs[0].args[13]).toBe('["responses"]');
	});
});

describe("PATCH /api/channels/:id — api_formats three-state", () => {
	it("keeps current formats when neither format field is provided", async () => {
		const { env, runs } = makeEnv({
			channelRow: makeChannelRow({
				api_formats: '["openai","anthropic"]',
				api_format: "openai",
			}),
		});
		const res = await channelsApp.request("/ch1", patchInit({}), env);
		expect(res.status).toBe(200);
		expect(runs[0].sql).toContain("UPDATE channels");
		// UPDATE 绑定序：… metadata_json(10), api_format(11), api_formats(12)…
		expect(runs[0].args[11]).toBe("openai");
		expect(runs[0].args[12]).toBe('["openai","anthropic"]');
	});

	it("rejects null and empty api_formats with 400 (no clear state)", async () => {
		const { env, runs } = makeEnv({ channelRow: makeChannelRow() });
		const resNull = await channelsApp.request(
			"/ch1",
			patchInit({ api_formats: null }),
			env,
		);
		expect(resNull.status).toBe(400);
		const bodyNull = await jsonBody(resNull);
		expect(bodyNull.code).toBe("invalid_api_formats");

		const resEmpty = await channelsApp.request(
			"/ch1",
			patchInit({ api_formats: [] }),
			env,
		);
		expect(resEmpty.status).toBe(400);

		// 400 路径不落库
		expect(runs).toHaveLength(0);
	});
});

describe("POST /api/channels/fetch_models — partial failure response", () => {
	it("returns union models with probe warnings and per-format results", async () => {
		const { env } = makeEnv();
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			if (String(input) === "https://x.com/v1/models") {
				throw new Error("connect ECONNREFUSED");
			}
			return jsonResponse({ data: [{ id: "gpt-4o" }] });
		});
		vi.stubGlobal("fetch", fetchMock);

		const res = await channelsApp.request(
			"/fetch_models",
			postInit({
				base_url: "https://x.com",
				api_key: "sk",
				api_formats: ["openai", "anthropic"],
			}),
			env,
		);
		expect(res.status).toBe(200);
		const body = await jsonBody(res);
		expect(body.ok).toBe(true);
		expect(body.models).toEqual(["gpt-4o"]);
		expect(body.probe_warnings).toHaveLength(1);
		expect(body.results).toHaveLength(2);
	});
});

describe("POST /api/channels/:id/test — per-format results", () => {
	it("returns per-format results for a mixed channel (one good one bad)", async () => {
		const { env, runs } = makeEnv({
			channelRow: makeChannelRow({ base_url: "https://x.com" }),
		});
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			if (String(input) === "https://x.com/v1/models") {
				throw new Error("connect ECONNREFUSED");
			}
			return jsonResponse({ data: [{ id: "gpt-4o" }] });
		});
		vi.stubGlobal("fetch", fetchMock);

		const res = await channelsApp.request("/ch1/test", { method: "POST" }, env);
		expect(res.status).toBe(200);
		const body = await jsonBody(res);
		expect(body.ok).toBe(true);
		expect(body.models).toEqual(["gpt-4o"]);
		expect(body.results).toEqual([
			{ api_format: "openai", ok: true, model_count: 1 },
			{
				api_format: "anthropic",
				ok: false,
				model_count: 0,
				error: expect.stringContaining("ECONNREFUSED"),
			},
		]);
		expect(body.probe_warnings).toHaveLength(1);
		// 整体 ok → 渠道测试状态仍落库为 active（向后兼容语义）
		expect(runs).toHaveLength(1);
		expect(runs[0].sql).toContain("UPDATE channels");
		expect(runs[0].args[0]).toBe("active");
	});
});
