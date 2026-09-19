import { afterEach, describe, expect, it, vi } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import {
	getTurnstileConfig,
	TURNSTILE_ENABLED_KEY,
	TURNSTILE_SECRET_KEY_KEY,
	TURNSTILE_SITE_KEY_KEY,
} from "../apps/worker/src/services/settings";
import {
	isTurnstileEnforced,
	isTurnstileEnvDisabled,
	verifyTurnstileToken,
} from "../apps/worker/src/services/turnstile";

type SettingRow = { key: string; value: string | null };

/**
 * Minimal D1 mock covering only the settings queries getTurnstileConfig hits
 * (same style as proxy-retry-settings.test.ts).
 */
function makeDb(rows: SettingRow[] = []) {
	const selects: Array<{ sql: string; args: unknown[] }> = [];
	const db = {
		prepare(sql: string) {
			const stmt = {
				boundArgs: [] as unknown[],
				bind: (...args: unknown[]) => {
					stmt.boundArgs = args;
					return stmt;
				},
				all: async () => {
					selects.push({ sql, args: stmt.boundArgs });
					if (sql.includes("FROM settings")) {
						return { results: rows };
					}
					return { results: [] };
				},
			};
			return stmt;
		},
	};
	return {
		// Test-boundary cast: mock only implements the statement methods used.
		db: db as unknown as D1Database,
		selects,
	};
}

function settingRows(entries: Record<string, string>): SettingRow[] {
	return Object.entries(entries).map(([key, value]) => ({ key, value }));
}

const FULL_CONFIG = {
	enabled: true,
	siteKey: "site-key",
	secretKey: "secret-key",
};

describe("isTurnstileEnvDisabled", () => {
	it("treats 1/true/yes (case-insensitive) as disabled", () => {
		for (const value of ["1", "true", "yes", "TRUE", "Yes", "TrUe"]) {
			expect(isTurnstileEnvDisabled(value)).toBe(true);
		}
	});

	it("treats everything else as not disabled", () => {
		for (const value of [undefined, "", "0", "false", "no", "on", "enabled"]) {
			expect(isTurnstileEnvDisabled(value)).toBe(false);
		}
	});
});

describe("isTurnstileEnforced", () => {
	it("enforces only with enabled=true and both keys non-empty", () => {
		expect(isTurnstileEnforced(FULL_CONFIG)).toBe(true);
	});

	it("fails open on any missing piece", () => {
		expect(isTurnstileEnforced({ ...FULL_CONFIG, enabled: false })).toBe(false);
		expect(isTurnstileEnforced({ ...FULL_CONFIG, siteKey: "" })).toBe(false);
		expect(isTurnstileEnforced({ ...FULL_CONFIG, secretKey: "" })).toBe(false);
	});

	it("fails open when the env kill switch is truthy", () => {
		expect(isTurnstileEnforced(FULL_CONFIG, "1")).toBe(false);
		expect(isTurnstileEnforced(FULL_CONFIG, "true")).toBe(false);
		expect(isTurnstileEnforced(FULL_CONFIG, "YES")).toBe(false);
	});

	it("stays enforced for non-truthy env values", () => {
		expect(isTurnstileEnforced(FULL_CONFIG, "0")).toBe(true);
		expect(isTurnstileEnforced(FULL_CONFIG, "no")).toBe(true);
		expect(isTurnstileEnforced(FULL_CONFIG, undefined)).toBe(true);
	});
});

describe("getTurnstileConfig", () => {
	it("reads all three keys with a single SQL query", async () => {
		const { db, selects } = makeDb([]);
		await getTurnstileConfig(db);
		expect(selects).toHaveLength(1);
		expect(selects[0].sql).toContain("key IN (?, ?, ?)");
		expect(selects[0].args).toEqual([
			TURNSTILE_ENABLED_KEY,
			TURNSTILE_SITE_KEY_KEY,
			TURNSTILE_SECRET_KEY_KEY,
		]);
	});

	it("parses stored rows", async () => {
		const { db } = makeDb(
			settingRows({
				turnstile_enabled: "true",
				turnstile_site_key: "0xAAAA",
				turnstile_secret_key: "0xBBBB",
			}),
		);
		expect(await getTurnstileConfig(db)).toEqual({
			enabled: true,
			siteKey: "0xAAAA",
			secretKey: "0xBBBB",
		});
	});

	it("degrades to disabled + empty keys when nothing is stored", async () => {
		const { db } = makeDb([]);
		expect(await getTurnstileConfig(db)).toEqual({
			enabled: false,
			siteKey: "",
			secretKey: "",
		});
	});

	it("treats dirty enabled values as not enabled (read-side lenient)", async () => {
		for (const dirty of ["1", "TRUE", "on", "yes", "", null]) {
			const { db } = makeDb([
				{ key: "turnstile_enabled", value: dirty },
				{ key: "turnstile_site_key", value: "k" },
				{ key: "turnstile_secret_key", value: "s" },
			]);
			const config = await getTurnstileConfig(db);
			expect(config.enabled).toBe(false);
		}
	});

	it("normalizes null key values to empty strings", async () => {
		const { db } = makeDb([
			{ key: "turnstile_enabled", value: "true" },
			{ key: "turnstile_site_key", value: null },
			{ key: "turnstile_secret_key", value: null },
		]);
		const config = await getTurnstileConfig(db);
		expect(config).toEqual({ enabled: true, siteKey: "", secretKey: "" });
	});
});

describe("verifyTurnstileToken", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	function jsonResponder(body: unknown, status = 200) {
		return vi.fn(async () => new Response(JSON.stringify(body), { status }));
	}

	it("posts secret + response as JSON to siteverify and succeeds", async () => {
		const fetchImpl = jsonResponder({ success: true });
		const result = await verifyTurnstileToken("the-secret", "the-token", fetchImpl as unknown as typeof fetch);
		expect(result).toEqual({ ok: true });

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
		expect(init.method).toBe("POST");
		expect(JSON.parse(String(init.body))).toEqual({
			secret: "the-secret",
			response: "the-token",
		});
		// remoteip is intentionally omitted
		expect(String(init.body)).not.toContain("remoteip");
		expect(init.signal).toBeInstanceOf(AbortSignal);
	});

	it("returns ok:false with codes on explicit success=false", async () => {
		const fetchImpl = jsonResponder({
			success: false,
			"error-codes": ["invalid-input-response"],
		});
		const result = await verifyTurnstileToken("s", "t", fetchImpl as unknown as typeof fetch);
		expect(result).toEqual({
			ok: false,
			codes: ["invalid-input-response"],
		});
	});

	it("fails open (degraded) and warns on network exception", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const fetchImpl = vi.fn(async () => {
			throw new Error("network down");
		});
		const result = await verifyTurnstileToken("s", "t", fetchImpl as unknown as typeof fetch);
		expect(result).toEqual({ ok: true, degraded: true });
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(String(warnSpy.mock.calls[0][0])).toContain("[turnstile]");
	});

	it("fails open (degraded) and warns on non-2xx responses", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const fetchImpl = jsonResponder({ error: "boom" }, 503);
		const result = await verifyTurnstileToken("s", "t", fetchImpl as unknown as typeof fetch);
		expect(result).toEqual({ ok: true, degraded: true });
		expect(warnSpy).toHaveBeenCalledTimes(1);
	});

	it("fails open (degraded) and warns on malformed 2xx bodies", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const fetchImpl = jsonResponder({ unexpected: true });
		const result = await verifyTurnstileToken("s", "t", fetchImpl as unknown as typeof fetch);
		expect(result).toEqual({ ok: true, degraded: true });
		expect(warnSpy).toHaveBeenCalledTimes(1);
	});

	it("aborts after the 5s timeout and fails open (degraded)", async () => {
		vi.useFakeTimers();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		// A fetch that only settles when the request signal aborts.
		const hangingFetch = ((_input: string, init?: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () =>
					reject(new Error("aborted")),
				);
			})) as unknown as typeof fetch;

		const pending = verifyTurnstileToken("s", "t", hangingFetch);
		const assertion = expect(pending).resolves.toEqual({
			ok: true,
			degraded: true,
		});
		await vi.advanceTimersByTimeAsync(5000);
		await assertion;
		expect(warnSpy).toHaveBeenCalledTimes(1);
	});
});
