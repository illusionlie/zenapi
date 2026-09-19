import { describe, expect, it } from "vitest";
import {
	buildModelMonitoring,
	type ModelMonitoringInput,
	type ModelMonitoringRow,
} from "../apps/worker/src/utils/model-monitoring";

/** Recursively collects every object key in a JSON-like value. */
const collectKeys = (value: unknown): string[] => {
	if (Array.isArray(value)) {
		return value.flatMap((item) => collectKeys(item));
	}
	if (value && typeof value === "object") {
		return Object.entries(value as Record<string, unknown>).flatMap(
			([key, val]) => [key, ...collectKeys(val)],
		);
	}
	return [];
};

const globalRow: ModelMonitoringRow = {
	total_requests: 120,
	total_success: 117,
	total_errors: 3,
	avg_latency_ms: 234.6,
};

const recentRow: ModelMonitoringRow = {
	total_requests: 10,
	total_success: 9,
	total_errors: 1,
	avg_latency_ms: 88.5,
};

const modelRows: ModelMonitoringRow[] = [
	{
		model: "gpt-4o",
		total_requests: 100,
		success_count: 99,
		error_count: 1,
		avg_latency_ms: 123.4,
		last_seen: "2026-09-19 12:00:00",
	},
	{
		model: "claude-sonnet-4",
		total_requests: 20,
		success_count: 18,
		error_count: 2,
		avg_latency_ms: 456.7,
		last_seen: "2026-09-19 11:00:00",
	},
];

const trendRows: ModelMonitoringRow[] = [
	{
		model: "gpt-4o",
		day: "2026-09-19 12",
		requests: 60,
		success: 59,
		errors: 1,
		avg_latency_ms: 110.5,
	},
	{
		model: "claude-sonnet-4",
		day: "2026-09-19 12",
		requests: 20,
		success: 18,
		errors: 2,
		avg_latency_ms: 400,
	},
];

const recentModelRows: ModelMonitoringRow[] = [
	{
		model: "gpt-4o",
		total_requests: 10,
		success_count: 10,
		avg_latency_ms: 90.4,
	},
];

const buildInput = (
	overrides: Partial<ModelMonitoringInput> = {},
): ModelMonitoringInput => ({
	modelRows,
	trendRows,
	globalRow,
	recentRow,
	recentModelRows,
	allowlist: null,
	range: "15m",
	...overrides,
});

describe("buildModelMonitoring", () => {
	it("maps rows to response fields with admin-parity rounding", () => {
		const payload = buildModelMonitoring(buildInput());

		expect(payload.models).toHaveLength(2);
		expect(payload.models[0]).toEqual({
			model: "gpt-4o",
			total_requests: 100,
			success_count: 99,
			error_count: 1,
			success_rate: 99, // 99/100 → two-decimal percent
			avg_latency_ms: 123, // Math.round(123.4)
			last_seen: "2026-09-19 12:00:00",
			recent_success_rate: 100, // 10/10 in the last 15m
			recent_avg_latency_ms: 90, // Math.round(90.4)
		});
		// Model without recent traffic keeps null recent fields
		expect(payload.models[1].recent_success_rate).toBeNull();
		expect(payload.models[1].recent_avg_latency_ms).toBeNull();
		expect(payload.models[1].success_rate).toBe(90); // 18/20
		expect(payload.models[1].avg_latency_ms).toBe(457); // Math.round(456.7)

		expect(payload.dailyTrends[0]).toEqual({
			model: "gpt-4o",
			day: "2026-09-19 12",
			requests: 60,
			success: 59,
			errors: 1,
			success_rate: 98.33, // 59/60 → Math.round(9833.33…)/100
			avg_latency_ms: 111, // Math.round(110.5)
		});
	});

	it("returns null success_rate for zero-traffic models and defaults empty global rates to 100", () => {
		const payload = buildModelMonitoring(
			buildInput({
				modelRows: [
					{
						model: "idle-model",
						total_requests: 0,
						success_count: 0,
						error_count: 0,
						avg_latency_ms: 0,
						last_seen: null,
					},
				],
				trendRows: [],
				globalRow: {
					total_requests: 0,
					total_success: 0,
					total_errors: 0,
					avg_latency_ms: 0,
				},
				recentRow: {
					total_requests: 0,
					total_success: 0,
					total_errors: 0,
					avg_latency_ms: 0,
				},
				recentModelRows: [],
			}),
		);

		expect(payload.models[0].success_rate).toBeNull();
		expect(payload.summary.success_rate).toBe(100);
		expect(payload.recentStatus.success_rate).toBe(100);
	});

	it("rounds global summary and recent status like the admin endpoint", () => {
		const payload = buildModelMonitoring(buildInput());

		expect(payload.summary).toEqual({
			total_requests: 120,
			total_success: 117,
			total_errors: 3,
			avg_latency_ms: 235, // Math.round(234.6)
			success_rate: 97.5, // 117/120
			active_models: 2,
		});
		expect(payload.recentStatus).toEqual({
			total_requests: 10,
			total_success: 9,
			total_errors: 1,
			avg_latency_ms: 89, // Math.round(88.5)
			success_rate: 90, // 9/10
		});
		expect(payload.range).toBe("15m");
	});

	it("filters both model rows and trends when the allowlist is non-empty", () => {
		const payload = buildModelMonitoring(buildInput({ allowlist: ["gpt-4o"] }));

		expect(payload.models.map((m) => m.model)).toEqual(["gpt-4o"]);
		expect(payload.dailyTrends.map((t) => t.model)).toEqual(["gpt-4o"]);
		// Restricted model names must not leak anywhere in the response body
		expect(JSON.stringify(payload)).not.toContain("claude");
	});

	it("keeps every model when the allowlist is null or empty (unrestricted)", () => {
		const nullPayload = buildModelMonitoring(buildInput({ allowlist: null }));
		const emptyPayload = buildModelMonitoring(buildInput({ allowlist: [] }));

		expect(nullPayload.models).toHaveLength(2);
		expect(nullPayload.dailyTrends).toHaveLength(2);
		expect(emptyPayload.models).toHaveLength(2);
		expect(emptyPayload.dailyTrends).toHaveLength(2);
	});

	it("counts only models with traffic in active_models", () => {
		const payload = buildModelMonitoring(
			buildInput({
				modelRows: [
					...modelRows,
					{
						model: "idle-model",
						total_requests: 0,
						success_count: 0,
						error_count: 0,
						avg_latency_ms: 0,
						last_seen: null,
					},
				],
			}),
		);

		expect(payload.models).toHaveLength(3);
		expect(payload.summary.active_models).toBe(2);
	});

	it("never emits channel or error_message keys in the output", () => {
		const payload = buildModelMonitoring(
			buildInput({ allowlist: ["gpt-4o"], range: "7d" }),
		);

		const keys = collectKeys(payload);
		expect(keys.filter((key) => key.includes("channel"))).toEqual([]);
		expect(keys.filter((key) => key.includes("error_message"))).toEqual([]);
		// AC3 full-text guard on the exact forbidden field names
		const serialized = JSON.stringify(payload);
		for (const forbidden of [
			"channel_name",
			"channel_id",
			"api_format",
			"error_message",
		]) {
			expect(serialized).not.toContain(forbidden);
		}
		expect(payload.range).toBe("7d");
	});
});
