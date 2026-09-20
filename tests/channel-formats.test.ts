import { describe, expect, it } from "vitest";
import {
	type ApiFormatsSource,
	normalizeApiFormats,
	parseApiFormats,
} from "../apps/worker/src/services/channel-types";

describe("normalizeApiFormats", () => {
	describe("non-array input", () => {
		it("rejects non-array values with not_array", () => {
			expect(normalizeApiFormats(null)).toEqual({
				ok: false,
				reason: "not_array",
			});
			expect(normalizeApiFormats(undefined)).toEqual({
				ok: false,
				reason: "not_array",
			});
			expect(normalizeApiFormats("openai")).toEqual({
				ok: false,
				reason: "not_array",
			});
			expect(normalizeApiFormats(42)).toEqual({
				ok: false,
				reason: "not_array",
			});
			expect(normalizeApiFormats({ format: "openai" })).toEqual({
				ok: false,
				reason: "not_array",
			});
		});
	});

	describe("empty / all-invalid input", () => {
		it("rejects an empty array with empty", () => {
			expect(normalizeApiFormats([])).toEqual({ ok: false, reason: "empty" });
		});

		it("rejects when every value is outside the whitelist", () => {
			expect(normalizeApiFormats(["gpt-format", "grpc"])).toEqual({
				ok: false,
				reason: "empty",
			});
			expect(normalizeApiFormats([42, null, {}])).toEqual({
				ok: false,
				reason: "empty",
			});
		});
	});

	describe("whitelist filtering", () => {
		it("keeps whitelisted values and drops invalid ones", () => {
			expect(normalizeApiFormats(["openai", "bogus"])).toEqual({
				ok: true,
				value: ["openai"],
			});
			expect(normalizeApiFormats(["responses", 1, null, "anthropic"])).toEqual({
				ok: true,
				value: ["responses", "anthropic"],
			});
		});

		it("accepts every whitelisted format", () => {
			for (const format of ["openai", "responses", "anthropic", "custom"]) {
				expect(normalizeApiFormats([format])).toEqual({
					ok: true,
					value: [format],
				});
			}
		});
	});

	describe("dedupe", () => {
		it("deduplicates repeated values", () => {
			expect(normalizeApiFormats(["openai", "openai"])).toEqual({
				ok: true,
				value: ["openai"],
			});
			expect(
				normalizeApiFormats(["anthropic", "openai", "anthropic", "openai"]),
			).toEqual({ ok: true, value: ["openai", "anthropic"] });
		});
	});

	describe("canonical order", () => {
		it("sorts output to [openai, responses, anthropic] regardless of input order", () => {
			expect(normalizeApiFormats(["anthropic", "responses", "openai"])).toEqual(
				{ ok: true, value: ["openai", "responses", "anthropic"] },
			);
			expect(normalizeApiFormats(["responses", "anthropic"])).toEqual({
				ok: true,
				value: ["responses", "anthropic"],
			});
		});
	});

	describe("custom exclusivity", () => {
		it("accepts a lone custom", () => {
			expect(normalizeApiFormats(["custom"])).toEqual({
				ok: true,
				value: ["custom"],
			});
		});

		it("rejects custom combined with any other format", () => {
			expect(normalizeApiFormats(["custom", "openai"])).toEqual({
				ok: false,
				reason: "custom_exclusive",
			});
			expect(normalizeApiFormats(["custom", "anthropic"])).toEqual({
				ok: false,
				reason: "custom_exclusive",
			});
			expect(normalizeApiFormats(["custom", "responses"])).toEqual({
				ok: false,
				reason: "custom_exclusive",
			});
			expect(
				normalizeApiFormats(["custom", "openai", "bogus"]),
			).toEqual({ ok: false, reason: "custom_exclusive" });
		});
	});
});

describe("parseApiFormats", () => {
	describe("tier 1: api_formats JSON array", () => {
		it("parses a stored JSON array", () => {
			const row: ApiFormatsSource = {
				api_formats: '["openai","anthropic"]',
				api_format: "openai",
			};
			expect(parseApiFormats(row)).toEqual(["openai", "anthropic"]);
		});

		it("filters non-whitelisted values and dedupes inside the stored array", () => {
			const row: ApiFormatsSource = {
				api_formats: '["openai","openai","bogus","anthropic"]',
				api_format: "custom",
			};
			expect(parseApiFormats(row)).toEqual(["openai", "anthropic"]);
		});

		it("falls through when the stored array contains no whitelisted value", () => {
			const row: ApiFormatsSource = {
				api_formats: '["bogus","grpc"]',
				api_format: "anthropic",
			};
			expect(parseApiFormats(row)).toEqual(["anthropic"]);
		});

		it("falls through when the stored JSON is not an array", () => {
			const row: ApiFormatsSource = {
				api_formats: '"openai"',
				api_format: "anthropic",
			};
			expect(parseApiFormats(row)).toEqual(["anthropic"]);
			const objRow: ApiFormatsSource = {
				api_formats: '{"format":"openai"}',
				api_format: "custom",
			};
			expect(parseApiFormats(objRow)).toEqual(["custom"]);
		});
	});

	describe("tier 2: [api_format] mirror fallback", () => {
		it("falls back to [api_format] on malformed JSON", () => {
			const row: ApiFormatsSource = {
				api_formats: "{not valid json",
				api_format: "responses",
			};
			expect(parseApiFormats(row)).toEqual(["responses"]);
		});

		it("falls back to [api_format] when api_formats is null", () => {
			const row: ApiFormatsSource = { api_formats: null, api_format: "custom" };
			expect(parseApiFormats(row)).toEqual(["custom"]);
		});

		it("falls back to [api_format] when api_formats is missing", () => {
			const row: ApiFormatsSource = { api_format: "anthropic" };
			expect(parseApiFormats(row)).toEqual(["anthropic"]);
		});

		it("ignores a non-whitelisted api_format mirror value", () => {
			const row: ApiFormatsSource = {
				api_formats: null,
				api_format: "grpc" as ApiFormatsSource["api_format"],
			};
			expect(parseApiFormats(row)).toEqual(["openai"]);
		});
	});

	describe("tier 3: historical default", () => {
		it("returns [\"openai\"] when neither column is usable", () => {
			expect(parseApiFormats({ api_formats: null, api_format: null })).toEqual([
				"openai",
			]);
			expect(parseApiFormats({})).toEqual(["openai"]);
		});
	});
});
