import { afterEach, describe, expect, it, vi } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import authApp from "../apps/worker/src/routes/auth";
import publicApp from "../apps/worker/src/routes/public";
import settingsApp from "../apps/worker/src/routes/settings";
import userAuthApp from "../apps/worker/src/routes/user-auth";
import { sha256Hex } from "../apps/worker/src/utils/crypto";

type SettingRow = { key: string; value: string | null };

const ENABLED_ROWS: SettingRow[] = [
	{ key: "turnstile_enabled", value: "true" },
	{ key: "turnstile_site_key", value: "test-site-key" },
	{ key: "turnstile_secret_key", value: "test-secret-key" },
];

/**
 * Minimal D1 mock covering the queries the auth / public / settings routes
 * hit: settings (single-key first() reads + key-IN all() reads) and the
 * users table; run() captures upserts/inserts.
 */
function makeDb(options: {
	settings?: SettingRow[];
	userRow?: Record<string, unknown> | null;
} = {}) {
	const settingsRows = options.settings ?? [];
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
					if (sql.includes("FROM settings")) {
						return { results: settingsRows };
					}
					return { results: [] };
				},
				first: async () => {
					if (sql.includes("FROM users")) {
						return options.userRow ?? null;
					}
					if (sql.includes("FROM settings")) {
						const key = stmt.boundArgs[0];
						const row = settingsRows.find((r) => r.key === key);
						return row ? { value: row.value } : null;
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

type RequestEnv = Parameters<typeof authApp.request>[2];

function makeEnv(
	options: {
		settings?: SettingRow[];
		userRow?: Record<string, unknown> | null;
		turnstileDisabled?: string;
	} = {},
): RequestEnv {
	const { db } = makeDb({
		settings: options.settings,
		userRow: options.userRow,
	});
	return {
		DB: db,
		...(options.turnstileDisabled !== undefined
			? { TURNSTILE_DISABLED: options.turnstileDisabled }
			: {}),
	} as unknown as RequestEnv;
}

function postInit(body: unknown): RequestInit {
	return {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	};
}

async function jsonBody(res: Response): Promise<Record<string, unknown>> {
	return (await res.json()) as Record<string, unknown>;
}

function siteverifyResponder(result: unknown, status = 200) {
	return vi.fn(
		async () => new Response(JSON.stringify(result), { status }),
	);
}

describe("auth endpoints — turnstile not configured (AC1)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("admin login behaves as before and never calls siteverify", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const res = await authApp.request(
			"/login",
			postInit({ password: "first-run" }),
			makeEnv({}),
		);
		expect(res.status).toBe(200);
		const body = await jsonBody(res);
		expect(typeof body.token).toBe("string");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("user login behaves as before and never calls siteverify", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const res = await userAuthApp.request(
			"/login",
			postInit({ account: "a@b.c", password: "pw" }),
			makeEnv({}),
		);
		expect(res.status).toBe(401);
		const body = await jsonBody(res);
		expect(body.code).toBe("invalid_credentials");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe("admin login — turnstile enforced (AC2)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("missing token → 400 turnstile_token_missing without calling siteverify", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const res = await authApp.request(
			"/login",
			postInit({ password: "pw123456" }),
			makeEnv({ settings: ENABLED_ROWS }),
		);
		expect(res.status).toBe(400);
		const body = await jsonBody(res);
		expect(body.code).toBe("turnstile_token_missing");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("siteverify explicit failure → 403 turnstile_verify_failed", async () => {
		const fetchMock = siteverifyResponder({ success: false });
		vi.stubGlobal("fetch", fetchMock);
		const res = await authApp.request(
			"/login",
			postInit({ password: "pw123456", turnstile_token: "bad-token" }),
			makeEnv({ settings: ENABLED_ROWS }),
		);
		expect(res.status).toBe(403);
		const body = await jsonBody(res);
		expect(body.code).toBe("turnstile_verify_failed");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("siteverify success → proceeds into the original password flow", async () => {
		const passwordHash = await sha256Hex("pw123456");
		const fetchMock = siteverifyResponder({ success: true });
		vi.stubGlobal("fetch", fetchMock);
		const res = await authApp.request(
			"/login",
			postInit({ password: "pw123456", turnstile_token: "good-token" }),
			makeEnv({
				settings: [
					...ENABLED_ROWS,
					{ key: "admin_password_hash", value: passwordHash },
				],
			}),
		);
		expect(res.status).toBe(200);
		const body = await jsonBody(res);
		expect(typeof body.token).toBe("string");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe("user login — turnstile enforced (AC2)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("siteverify success → proceeds into the original credential flow", async () => {
		const passwordHash = await sha256Hex("pw123456");
		const fetchMock = siteverifyResponder({ success: true });
		vi.stubGlobal("fetch", fetchMock);
		const res = await userAuthApp.request(
			"/login",
			postInit({ account: "a@b.c", password: "pw123456", turnstile_token: "t" }),
			makeEnv({
				settings: ENABLED_ROWS,
				userRow: {
					id: "u1",
					email: "a@b.c",
					name: "tester",
					role: "user",
					balance: 0,
					status: "active",
					password_hash: passwordHash,
				},
			}),
		);
		expect(res.status).toBe(200);
		const body = await jsonBody(res);
		expect(typeof body.token).toBe("string");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("missing token → 400 turnstile_token_missing", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const res = await userAuthApp.request(
			"/login",
			postInit({ account: "a@b.c", password: "pw123456" }),
			makeEnv({ settings: ENABLED_ROWS }),
		);
		expect(res.status).toBe(400);
		const body = await jsonBody(res);
		expect(body.code).toBe("turnstile_token_missing");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe("user register — turnstile enforced (AC2)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("siteverify success → completes the original registration flow", async () => {
		const fetchMock = siteverifyResponder({ success: true });
		vi.stubGlobal("fetch", fetchMock);
		const res = await userAuthApp.request(
			"/register",
			postInit({
				email: "new@b.c",
				name: "newbie",
				password: "pw123456",
				turnstile_token: "t",
			}),
			makeEnv({ settings: ENABLED_ROWS }),
		);
		expect(res.status).toBe(200);
		const body = await jsonBody(res);
		expect(typeof body.token).toBe("string");
		const user = body.user as { email?: string };
		expect(user.email).toBe("new@b.c");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("missing token → 400 turnstile_token_missing", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const res = await userAuthApp.request(
			"/register",
			postInit({ email: "new@b.c", name: "newbie", password: "pw123456" }),
			makeEnv({ settings: ENABLED_ROWS }),
		);
		expect(res.status).toBe(400);
		const body = await jsonBody(res);
		expect(body.code).toBe("turnstile_token_missing");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe("siteverify degraded fail-open (AC3)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("network exception → request proceeds and a [turnstile] warn is logged", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const fetchMock = vi.fn(async () => {
			throw new Error("network unreachable");
		});
		vi.stubGlobal("fetch", fetchMock);
		const res = await authApp.request(
			"/login",
			postInit({ password: "pw123456", turnstile_token: "t" }),
			makeEnv({ settings: ENABLED_ROWS }),
		);
		// no stored hash → bootstrap path completes (original flow)
		expect(res.status).toBe(200);
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(String(warnSpy.mock.calls[0][0])).toContain("[turnstile]");
	});

	it("siteverify 5xx → request proceeds (fail-open)", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.stubGlobal("fetch", siteverifyResponder({ error: "boom" }, 500));
		const res = await authApp.request(
			"/login",
			postInit({ password: "pw123456", turnstile_token: "t" }),
			makeEnv({ settings: ENABLED_ROWS }),
		);
		expect(res.status).toBe(200);
		expect(warnSpy).toHaveBeenCalledTimes(1);
	});
});

describe("TURNSTILE_DISABLED env escape hatch (AC4)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("skips verification even when settings enable turnstile", async () => {
		const passwordHash = await sha256Hex("pw123456");
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const res = await authApp.request(
			"/login",
			postInit({ password: "wrong-password" }),
			makeEnv({
				settings: [
					...ENABLED_ROWS,
					{ key: "admin_password_hash", value: passwordHash },
				],
				turnstileDisabled: "1",
			}),
		);
		expect(res.status).toBe(401);
		const body = await jsonBody(res);
		expect(body.code).toBe("invalid_password");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe("site-info turnstile fields (AC5)", () => {
	it("reflects the effective enforcement decision, never the secret", async () => {
		const res = await publicApp.request(
			"/site-info",
			{},
			makeEnv({ settings: ENABLED_ROWS }),
		);
		expect(res.status).toBe(200);
		const body = await jsonBody(res);
		expect(body.turnstile_enabled).toBe(true);
		expect(body.turnstile_site_key).toBe("test-site-key");
		expect(JSON.stringify(body)).not.toContain("test-secret-key");
	});

	it("treats a half-configured enabled=true as not enabled", async () => {
		const res = await publicApp.request(
			"/site-info",
			{},
			makeEnv({
				settings: [
					{ key: "turnstile_enabled", value: "true" },
					{ key: "turnstile_site_key", value: "" },
					{ key: "turnstile_secret_key", value: "test-secret-key" },
				],
			}),
		);
		const body = await jsonBody(res);
		expect(body.turnstile_enabled).toBe(false);
		expect(body.turnstile_site_key).toBe("");
	});

	it("reports not-enabled when the env kill switch is set", async () => {
		const res = await publicApp.request(
			"/site-info",
			{},
			makeEnv({ settings: ENABLED_ROWS, turnstileDisabled: "1" }),
		);
		const body = await jsonBody(res);
		expect(body.turnstile_enabled).toBe(false);
		expect(body.turnstile_site_key).toBe("");
	});

	it("reports not-enabled with default (empty) settings", async () => {
		const res = await publicApp.request(
			"/site-info",
			{},
			makeEnv({ settings: [] }),
		);
		const body = await jsonBody(res);
		expect(body.turnstile_enabled).toBe(false);
		expect(body.turnstile_site_key).toBe("");
	});
});

describe("settings GET — secret never echoed (AC5)", () => {
	it("returns turnstile_secret_key_set boolean without the secret", async () => {
		const res = await settingsApp.request(
			"/",
			{},
			makeEnv({ settings: ENABLED_ROWS }),
		);
		expect(res.status).toBe(200);
		const body = await jsonBody(res);
		expect(body.turnstile_enabled).toBe(true);
		expect(body.turnstile_site_key).toBe("test-site-key");
		expect(body.turnstile_secret_key_set).toBe(true);
		expect(body.turnstile_secret_key).toBeUndefined();
		expect(JSON.stringify(body)).not.toContain("test-secret-key");
	});

	it("reports turnstile_secret_key_set=false when unset", async () => {
		const res = await settingsApp.request(
			"/",
			{},
			makeEnv({ settings: [] }),
		);
		const body = await jsonBody(res);
		expect(body.turnstile_secret_key_set).toBe(false);
	});
});

describe("settings PUT — turnstile validation (AC6)", () => {
	function putInit(body: unknown): RequestInit {
		return {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		};
	}

	it("rejects enabling with missing keys → 400 turnstile_incomplete, no writes", async () => {
		const { db, runs } = makeDb({ settings: [] });
		const res = await settingsApp.request(
			"/",
			putInit({ turnstile_enabled: "true" }),
			{ DB: db } as unknown as RequestEnv,
		);
		expect(res.status).toBe(400);
		const body = await jsonBody(res);
		expect(body.code).toBe("turnstile_incomplete");
		expect(
			runs.filter((r) => String(r.args[0]).startsWith("turnstile_")),
		).toHaveLength(0);
	});

	it("rejects enabling when only one key resolves non-empty", async () => {
		const { db } = makeDb({
			settings: [{ key: "turnstile_site_key", value: "sk" }],
		});
		const res = await settingsApp.request(
			"/",
			putInit({ turnstile_enabled: "true" }),
			{ DB: db } as unknown as RequestEnv,
		);
		expect(res.status).toBe(400);
		const body = await jsonBody(res);
		expect(body.code).toBe("turnstile_incomplete");
	});

	it("allows enabling when both keys resolve non-empty and writes all three", async () => {
		const { db, runs } = makeDb({ settings: [] });
		const res = await settingsApp.request(
			"/",
			putInit({
				turnstile_enabled: "true",
				turnstile_site_key: " sk ",
				turnstile_secret_key: "ss",
			}),
			{ DB: db } as unknown as RequestEnv,
		);
		expect(res.status).toBe(200);
		const written = new Map(
			runs.map((r) => [String(r.args[0]), String(r.args[1])]),
		);
		expect(written.get("turnstile_enabled")).toBe("true");
		expect(written.get("turnstile_site_key")).toBe("sk"); // trimmed
		expect(written.get("turnstile_secret_key")).toBe("ss");
	});

	it("secret three-state: key absent → no secret write (preserved)", async () => {
		const { db, runs } = makeDb({
			settings: [
				{ key: "turnstile_enabled", value: "true" },
				{ key: "turnstile_site_key", value: "sk" },
				{ key: "turnstile_secret_key", value: "old-secret" },
			],
		});
		const res = await settingsApp.request(
			"/",
			putInit({ turnstile_site_key: "sk2" }),
			{ DB: db } as unknown as RequestEnv,
		);
		expect(res.status).toBe(200);
		expect(
			runs.filter((r) => r.args[0] === "turnstile_secret_key"),
		).toHaveLength(0);
	});

	it("secret three-state: null / empty → cleared", async () => {
		const { db, runs } = makeDb({
			settings: [
				{ key: "turnstile_enabled", value: "false" },
				{ key: "turnstile_site_key", value: "sk" },
				{ key: "turnstile_secret_key", value: "old-secret" },
			],
		});
		await settingsApp.request(
			"/",
			putInit({ turnstile_secret_key: null }),
			{ DB: db } as unknown as RequestEnv,
		);
		expect(runs[0]?.args[0]).toBe("turnstile_secret_key");
		expect(runs[0]?.args[1]).toBe("");

		const cleared2 = makeDb({
			settings: [
				{ key: "turnstile_enabled", value: "false" },
				{ key: "turnstile_site_key", value: "sk" },
			],
		});
		await settingsApp.request(
			"/",
			putInit({ turnstile_secret_key: "" }),
			{ DB: cleared2.db } as unknown as RequestEnv,
		);
		expect(cleared2.runs[0]?.args[0]).toBe("turnstile_secret_key");
		expect(cleared2.runs[0]?.args[1]).toBe("");
	});

	it("secret three-state: non-empty → overwritten", async () => {
		const { db, runs } = makeDb({
			settings: [
				{ key: "turnstile_enabled", value: "false" },
				{ key: "turnstile_site_key", value: "sk" },
				{ key: "turnstile_secret_key", value: "old-secret" },
			],
		});
		await settingsApp.request(
			"/",
			putInit({ turnstile_secret_key: "new-secret" }),
			{ DB: db } as unknown as RequestEnv,
		);
		expect(runs[0]?.args[0]).toBe("turnstile_secret_key");
		expect(runs[0]?.args[1]).toBe("new-secret");
	});

	it("rejects clearing the site key while enabled=true", async () => {
		const { db } = makeDb({
			settings: [
				{ key: "turnstile_enabled", value: "true" },
				{ key: "turnstile_site_key", value: "sk" },
				{ key: "turnstile_secret_key", value: "ss" },
			],
		});
		const res = await settingsApp.request(
			"/",
			putInit({ turnstile_site_key: "" }),
			{ DB: db } as unknown as RequestEnv,
		);
		expect(res.status).toBe(400);
		const body = await jsonBody(res);
		expect(body.code).toBe("turnstile_incomplete");
	});

	it("rejects non-boolean-string enabled values", async () => {
		const { db } = makeDb({ settings: [] });
		for (const value of ["yes", true, 1, null]) {
			const res = await settingsApp.request(
				"/",
				putInit({ turnstile_enabled: value }),
				{ DB: db } as unknown as RequestEnv,
			);
			expect(res.status).toBe(400);
			const body = await jsonBody(res);
			expect(body.code).toBe("invalid_turnstile_enabled");
		}
	});

	it("rejects over-long or non-string site keys", async () => {
		const { db } = makeDb({ settings: [] });
		const longKey = "k".repeat(201);
		for (const value of [longKey, 123]) {
			const res = await settingsApp.request(
				"/",
				putInit({ turnstile_site_key: value }),
				{ DB: db } as unknown as RequestEnv,
			);
			expect(res.status).toBe(400);
			const body = await jsonBody(res);
			expect(body.code).toBe("invalid_turnstile_site_key");
		}
	});

	it("rejects non-string, non-null secret key values", async () => {
		const { db } = makeDb({
			settings: [{ key: "turnstile_secret_key", value: "old-secret" }],
		});
		for (const value of [{ nested: true }, 123, true, ["x"]]) {
			const res = await settingsApp.request(
				"/",
				putInit({ turnstile_secret_key: value }),
				{ DB: db } as unknown as RequestEnv,
			);
			expect(res.status).toBe(400);
			const body = await jsonBody(res);
			expect(body.code).toBe("invalid_turnstile_secret_key");
		}
	});
});
