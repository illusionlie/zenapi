import { describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import {
	DEFAULT_PROXY_RETRY_DELAY_MS,
	DEFAULT_PROXY_RETRY_ROUNDS,
	loadProxyRetryConfig,
	PROXY_RETRY_DELAY_MS_KEY,
	PROXY_RETRY_ROUNDS_KEY,
	setProxyRetryDelayMs,
	setProxyRetryRounds,
} from "../apps/worker/src/services/settings";

type SettingRow = { key: string; value: string | null };

/**
 * Minimal D1 mock covering only the queries loadProxyRetryConfig and the
 * setProxyRetry* upserts hit (same style as proxy-responses.test.ts).
 */
function makeDb(rows: SettingRow[] = []) {
	const selects: Array<{ sql: string; args: unknown[] }> = [];
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
					selects.push({ sql, args: stmt.boundArgs });
					if (sql.includes("FROM settings")) {
						return { results: rows };
					}
					return { results: [] };
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
		// Test-boundary cast: mock only implements the two statement methods used.
		db: db as unknown as D1Database,
		selects,
		runs,
	};
}

function settingRows(entries: Record<string, string>): SettingRow[] {
	return Object.entries(entries).map(([key, value]) => ({ key, value }));
}

describe("loadProxyRetryConfig", () => {
	it("prefers settings values over env fallback and built-in defaults", async () => {
		const { db } = makeDb(
			settingRows({ proxy_retry_rounds: "5", proxy_retry_delay_ms: "1500" }),
		);
		const config = await loadProxyRetryConfig(db, {
			rounds: "7",
			delayMs: "3000",
		});
		expect(config).toEqual({ rounds: 5, delayMs: 1500 });
	});

	it("falls back to env vars when settings keys are missing", async () => {
		const { db } = makeDb([]);
		const config = await loadProxyRetryConfig(db, {
			rounds: "7",
			delayMs: "3000",
		});
		expect(config).toEqual({ rounds: 7, delayMs: 3000 });
	});

	it("falls back to built-in defaults when settings and env are both absent", async () => {
		const { db } = makeDb([]);
		const config = await loadProxyRetryConfig(db);
		expect(config).toEqual({
			rounds: DEFAULT_PROXY_RETRY_ROUNDS,
			delayMs: DEFAULT_PROXY_RETRY_DELAY_MS,
		});
		expect(config).toEqual({ rounds: 2, delayMs: 200 });
	});

	it("steps down the chain when the settings value is invalid (NaN / non-integer / blank)", async () => {
		const nanDb = makeDb(settingRows({ proxy_retry_rounds: "abc" }));
		expect(await loadProxyRetryConfig(nanDb.db, { rounds: "4" })).toEqual({
			rounds: 4,
			delayMs: DEFAULT_PROXY_RETRY_DELAY_MS,
		});
		expect(await loadProxyRetryConfig(nanDb.db)).toEqual({
			rounds: DEFAULT_PROXY_RETRY_ROUNDS,
			delayMs: DEFAULT_PROXY_RETRY_DELAY_MS,
		});

		const floatDb = makeDb(settingRows({ proxy_retry_delay_ms: "2.5" }));
		expect(await loadProxyRetryConfig(floatDb.db, { delayMs: "500" })).toEqual({
			rounds: DEFAULT_PROXY_RETRY_ROUNDS,
			delayMs: 500,
		});
		expect(await loadProxyRetryConfig(floatDb.db)).toEqual({
			rounds: DEFAULT_PROXY_RETRY_ROUNDS,
			delayMs: DEFAULT_PROXY_RETRY_DELAY_MS,
		});

		const blankDb = makeDb(settingRows({ proxy_retry_rounds: "" }));
		expect(await loadProxyRetryConfig(blankDb.db)).toEqual({
			rounds: DEFAULT_PROXY_RETRY_ROUNDS,
			delayMs: DEFAULT_PROXY_RETRY_DELAY_MS,
		});

		const nullValueDb = makeDb([{ key: "proxy_retry_rounds", value: null }]);
		expect(await loadProxyRetryConfig(nullValueDb.db, { rounds: "3" })).toEqual({
			rounds: 3,
			delayMs: DEFAULT_PROXY_RETRY_DELAY_MS,
		});
	});

	it("falls back per key when only one settings key exists", async () => {
		const { db } = makeDb(settingRows({ proxy_retry_rounds: "4" }));
		expect(await loadProxyRetryConfig(db, { delayMs: "500" })).toEqual({
			rounds: 4,
			delayMs: 500,
		});
	});

	it("clamps out-of-range settings rounds into [1, 10]", async () => {
		for (const [stored, expected] of [
			["0", 1],
			["1", 1],
			["-1", 1],
			["10", 10],
			["11", 10],
		] as const) {
			const { db } = makeDb(settingRows({ proxy_retry_rounds: stored }));
			expect(await loadProxyRetryConfig(db, { rounds: "3" })).toEqual({
				rounds: expected,
				delayMs: DEFAULT_PROXY_RETRY_DELAY_MS,
			});
		}
	});

	it("clamps out-of-range settings delay into [0, 60000]", async () => {
		for (const [stored, expected] of [
			["0", 0],
			["-1", 0],
			["60000", 60000],
			["60001", 60000],
		] as const) {
			const { db } = makeDb(settingRows({ proxy_retry_delay_ms: stored }));
			expect(await loadProxyRetryConfig(db, { delayMs: "500" })).toEqual({
				rounds: DEFAULT_PROXY_RETRY_ROUNDS,
				delayMs: expected,
			});
		}
	});

	it("clamps the env fallback too (env cannot widen the bounds)", async () => {
		const { db } = makeDb([]);
		expect(
			await loadProxyRetryConfig(db, { rounds: "50", delayMs: "120000" }),
		).toEqual({ rounds: 10, delayMs: 60000 });
		expect(
			await loadProxyRetryConfig(db, { rounds: "0", delayMs: "-5" }),
		).toEqual({ rounds: 1, delayMs: 0 });
		expect(
			await loadProxyRetryConfig(db, { rounds: "abc", delayMs: "1.5" }),
		).toEqual({ rounds: DEFAULT_PROXY_RETRY_ROUNDS, delayMs: DEFAULT_PROXY_RETRY_DELAY_MS });
	});

	it("reads both keys with a single SQL query", async () => {
		const { db, selects } = makeDb([]);
		await loadProxyRetryConfig(db);
		expect(selects).toHaveLength(1);
		expect(selects[0].sql).toContain("key IN (?, ?)");
		expect(selects[0].args).toEqual([
			PROXY_RETRY_ROUNDS_KEY,
			PROXY_RETRY_DELAY_MS_KEY,
		]);
	});
});

describe("setProxyRetryRounds / setProxyRetryDelayMs", () => {
	it("upserts the rounds key with the value stringified", async () => {
		const { db, runs } = makeDb([]);
		await setProxyRetryRounds(db, 5);
		expect(runs).toHaveLength(1);
		expect(runs[0].sql).toContain("INSERT INTO settings");
		expect(runs[0].args[0]).toBe(PROXY_RETRY_ROUNDS_KEY);
		expect(runs[0].args[1]).toBe("5");
	});

	it("upserts the delay key with the value stringified", async () => {
		const { db, runs } = makeDb([]);
		await setProxyRetryDelayMs(db, 1500);
		expect(runs).toHaveLength(1);
		expect(runs[0].sql).toContain("INSERT INTO settings");
		expect(runs[0].args[0]).toBe(PROXY_RETRY_DELAY_MS_KEY);
		expect(runs[0].args[1]).toBe("1500");
	});
});
