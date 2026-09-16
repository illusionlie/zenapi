import { describe, expect, it } from "vitest";
import {
	filterModelsByAllowlist,
	isModelAllowed,
	isModelAllowedByAll,
	parseAllowlist,
} from "../apps/worker/src/utils/model-allowlist";

describe("isModelAllowed", () => {
	it("returns true for null/undefined/empty allowlist (unrestricted)", () => {
		expect(isModelAllowed(null, "gpt-4o")).toBe(true);
		expect(isModelAllowed(undefined, "gpt-4o")).toBe(true);
		expect(isModelAllowed([], "gpt-4o")).toBe(true);
	});

	it("returns true when the request carries no model name", () => {
		expect(isModelAllowed(["gpt-4o"], null)).toBe(true);
		expect(isModelAllowed(["gpt-4o"], undefined)).toBe(true);
		expect(isModelAllowed(["gpt-4o"], "")).toBe(true);
	});

	it("allows exact matches", () => {
		expect(
			isModelAllowed(["gpt-4o", "claude-sonnet-4"], "claude-sonnet-4"),
		).toBe(true);
		expect(isModelAllowed(["gpt-4o"], "gpt-4o")).toBe(true);
	});

	it("rejects models outside the allowlist", () => {
		expect(isModelAllowed(["gpt-4o"], "claude-3")).toBe(false);
	});

	it("matches case-sensitively", () => {
		expect(isModelAllowed(["gpt-4o"], "GPT-4O")).toBe(false);
		expect(isModelAllowed(["GPT-4O"], "gpt-4o")).toBe(false);
	});

	it("does not match partial names", () => {
		expect(isModelAllowed(["gpt-4o"], "gpt-4o-2024")).toBe(false);
		expect(isModelAllowed(["gpt-4o-2024"], "gpt-4o")).toBe(false);
	});
});

describe("parseAllowlist", () => {
	it("parses a valid JSON array of strings", () => {
		expect(parseAllowlist('["gpt-4o","claude-sonnet-4"]')).toEqual([
			"gpt-4o",
			"claude-sonnet-4",
		]);
	});

	it("accepts an already-parsed array", () => {
		expect(parseAllowlist(["gpt-4o"])).toEqual(["gpt-4o"]);
	});

	it("returns null for null/undefined/empty input", () => {
		expect(parseAllowlist(null)).toBeNull();
		expect(parseAllowlist(undefined)).toBeNull();
		expect(parseAllowlist("")).toBeNull();
	});

	it("returns null for malformed JSON", () => {
		expect(parseAllowlist('["gpt-4o"')).toBeNull();
		expect(parseAllowlist("not-json")).toBeNull();
	});

	it("returns null for non-array JSON", () => {
		expect(parseAllowlist('"gpt-4o"')).toBeNull();
		expect(parseAllowlist('{"models":["gpt-4o"]}')).toBeNull();
		expect(parseAllowlist("42")).toBeNull();
		expect(parseAllowlist("true")).toBeNull();
	});

	it("returns null when any element is not a string", () => {
		expect(parseAllowlist('["gpt-4o",1]')).toBeNull();
		expect(parseAllowlist('["gpt-4o",null]')).toBeNull();
		expect(parseAllowlist(["gpt-4o", 1])).toBeNull();
	});

	it("returns null for an empty array (unrestricted)", () => {
		expect(parseAllowlist("[]")).toBeNull();
		expect(parseAllowlist([])).toBeNull();
	});

	it("trims elements and drops empty ones", () => {
		expect(parseAllowlist('[" gpt-4o ", ""]')).toEqual(["gpt-4o"]);
		expect(parseAllowlist('["", "  "]')).toBeNull();
	});
});

describe("filterModelsByAllowlist", () => {
	const items = [
		{ id: "gpt-4o", price: 1 },
		{ id: "claude-sonnet-4", price: 2 },
	];

	it("returns the input unchanged for a null/empty allowlist", () => {
		expect(filterModelsByAllowlist(items, null)).toBe(items);
		expect(filterModelsByAllowlist(items, undefined)).toBe(items);
		expect(filterModelsByAllowlist(items, [])).toBe(items);
	});

	it("keeps only allowed ids", () => {
		expect(filterModelsByAllowlist(items, ["claude-sonnet-4"])).toEqual([
			{ id: "claude-sonnet-4", price: 2 },
		]);
	});

	it("returns an empty array when nothing matches", () => {
		expect(filterModelsByAllowlist(items, ["gemini"])).toEqual([]);
	});
});

describe("isModelAllowedByAll", () => {
	it("allows when every list is unrestricted (null/undefined)", () => {
		expect(isModelAllowedByAll([null, null], "gpt-4o")).toBe(true);
		expect(isModelAllowedByAll([undefined, undefined], "gpt-4o")).toBe(true);
		expect(isModelAllowedByAll([null, undefined], "gpt-4o")).toBe(true);
		expect(isModelAllowedByAll([], "gpt-4o")).toBe(true);
	});

	it("blocks when a single list rejects the model", () => {
		expect(isModelAllowedByAll([["gpt-4o"], null], "claude-3")).toBe(false);
		expect(isModelAllowedByAll([null, ["gpt-4o"]], "claude-3")).toBe(false);
	});

	it("blocks when the two lists allow different models (intersection semantics)", () => {
		// Disjoint lists must NOT merge into an empty (fail-open) intersection
		expect(
			isModelAllowedByAll([["gpt-4o"], ["claude-sonnet-4"]], "gpt-4o"),
		).toBe(false);
		expect(
			isModelAllowedByAll([["gpt-4o"], ["claude-sonnet-4"]], "claude-sonnet-4"),
		).toBe(false);
		expect(
			isModelAllowedByAll([["gpt-4o"], ["claude-sonnet-4"]], "gemini"),
		).toBe(false);
	});

	it("allows when both lists allow the same model", () => {
		expect(
			isModelAllowedByAll(
				[["gpt-4o", "claude-sonnet-4"], ["gpt-4o"]],
				"gpt-4o",
			),
		).toBe(true);
	});

	it("tolerates undefined entries among the lists", () => {
		expect(
			isModelAllowedByAll([undefined, ["gpt-4o"], null], "gpt-4o"),
		).toBe(true);
		expect(
			isModelAllowedByAll([undefined, ["gpt-4o"], null], "claude-3"),
		).toBe(false);
	});

	it("allows when the request carries no model name", () => {
		expect(
			isModelAllowedByAll([["gpt-4o"], ["claude-sonnet-4"]], null),
		).toBe(true);
		expect(isModelAllowedByAll([["gpt-4o"]], undefined)).toBe(true);
		expect(isModelAllowedByAll([["gpt-4o"]], "")).toBe(true);
	});

	it("matches case-sensitively across lists", () => {
		expect(isModelAllowedByAll([["gpt-4o"], ["gpt-4o"]], "GPT-4O")).toBe(
			false,
		);
	});
});
