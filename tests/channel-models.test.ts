import { describe, expect, it } from "vitest";
import {
	extractModelIds,
	extractModelPricings,
	modelsToJson,
	normalizeModelsInput,
} from "../apps/worker/src/services/channel-models";

describe("modelsToJson", () => {
	it("returns '[]' for an empty array", () => {
		expect(modelsToJson([])).toBe("[]");
	});

	it("wraps plain id strings into objects", () => {
		expect(modelsToJson(["a", "b"])).toBe('[{"id":"a"},{"id":"b"}]');
	});

	it("drops whitespace-only ids from plain strings", () => {
		expect(modelsToJson(["a", "   "])).toBe('[{"id":"a"}]');
	});

	it("serializes pricing objects with prices and enabled flag", () => {
		expect(
			modelsToJson([
				{ id: "a", input_price: 1.5, output_price: 2, enabled: false },
			]),
		).toBe('[{"id":"a","input_price":1.5,"output_price":2,"enabled":false}]');
	});

	it("omits undefined price/enabled fields", () => {
		expect(modelsToJson([{ id: "a" }])).toBe('[{"id":"a"}]');
	});

	it("never emits a shared field (removed ecosystem)", () => {
		const legacyModel = { id: "a", shared: true };
		expect(modelsToJson([legacyModel])).not.toContain("shared");
	});
});

describe("extractModelPricings", () => {
	it("extracts ids and prices from object entries", () => {
		expect(
			extractModelPricings({
				models_json: '[{"id":"a","input_price":1.5,"output_price":2}]',
			}),
		).toEqual([{ id: "a", input_price: 1.5, output_price: 2 }]);
	});

	it("keeps disabled entries (filtering is the caller's concern)", () => {
		expect(
			extractModelPricings({
				models_json: '[{"id":"a","enabled":false},{"id":"b"}]',
			}),
		).toEqual([{ id: "a", enabled: false }, { id: "b" }]);
	});

	it("supports the { data: [...] } wrapper format", () => {
		expect(
			extractModelPricings({ models_json: '{"data":[{"id":"a"}]}' }),
		).toEqual([{ id: "a" }]);
	});

	it("supports legacy plain string arrays", () => {
		expect(extractModelPricings({ models_json: '["a","b"]' })).toEqual([
			{ id: "a" },
			{ id: "b" },
		]);
	});

	it("ignores legacy shared fields", () => {
		expect(
			extractModelPricings({ models_json: '[{"id":"a","shared":true}]' }),
		).toEqual([{ id: "a" }]);
	});

	it("drops non-positive prices", () => {
		expect(
			extractModelPricings({
				models_json: '[{"id":"a","input_price":0,"output_price":-1}]',
			}),
		).toEqual([{ id: "a" }]);
	});

	it("drops entries without an id", () => {
		expect(extractModelPricings({ models_json: '[{"id":""},{"id":"a"}]' })).toEqual(
			[{ id: "a" }],
		);
	});

	it("returns [] for malformed JSON", () => {
		expect(extractModelPricings({ models_json: "{broken" })).toEqual([]);
	});

	it("returns [] for null/empty models_json", () => {
		expect(extractModelPricings({ models_json: null })).toEqual([]);
		expect(extractModelPricings({ models_json: "" })).toEqual([]);
	});
});

describe("extractModelIds", () => {
	it("filters out disabled models", () => {
		expect(
			extractModelIds({
				models_json: '[{"id":"a"},{"id":"b","enabled":false}]',
			}),
		).toEqual(["a"]);
	});

	it("handles legacy plain string arrays", () => {
		expect(extractModelIds({ models_json: '["a","b"]' })).toEqual(["a", "b"]);
	});

	it("returns [] for malformed JSON", () => {
		expect(extractModelIds({ models_json: "{broken" })).toEqual([]);
	});
});

describe("normalizeModelsInput", () => {
	it("passes through string arrays", () => {
		expect(normalizeModelsInput(["a", "b"])).toEqual(["a", "b"]);
	});

	it("extracts ids from object arrays", () => {
		expect(normalizeModelsInput([{ id: "a" }, { id: "b" }])).toEqual([
			"a",
			"b",
		]);
	});

	it("splits comma-separated strings", () => {
		expect(normalizeModelsInput("a, b ,c")).toEqual(["a", "b", "c"]);
	});

	it("supports the { data: [...] } wrapper format", () => {
		expect(normalizeModelsInput({ data: [{ id: "x" }] })).toEqual(["x"]);
	});

	it("drops empty and id-less entries", () => {
		expect(normalizeModelsInput(["", { id: "" }, "a"])).toEqual(["a"]);
	});

	it("returns [] for null/undefined/unsupported input", () => {
		expect(normalizeModelsInput(null)).toEqual([]);
		expect(normalizeModelsInput(undefined)).toEqual([]);
		expect(normalizeModelsInput(42)).toEqual([]);
	});
});
