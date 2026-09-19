import { isModelAllowed } from "./model-allowlist";

/**
 * Raw aggregate row from D1 (`.all()` / `.first()` results are loosely
 * typed); field access goes through Number/String coercion.
 */
export type ModelMonitoringRow = Record<string, unknown>;

export type ModelMonitoringModel = {
	model: string;
	total_requests: number;
	success_count: number;
	error_count: number;
	success_rate: number | null;
	avg_latency_ms: number;
	last_seen: string | null;
	recent_success_rate: number | null;
	recent_avg_latency_ms: number | null;
};

export type ModelMonitoringTrend = {
	model: string;
	day: string;
	requests: number;
	success: number;
	errors: number;
	success_rate: number;
	avg_latency_ms: number;
};

export type ModelMonitoringPayload = {
	summary: {
		total_requests: number;
		total_success: number;
		total_errors: number;
		avg_latency_ms: number;
		success_rate: number;
		active_models: number;
	};
	recentStatus: {
		total_requests: number;
		total_success: number;
		total_errors: number;
		avg_latency_ms: number;
		success_rate: number;
	};
	models: ModelMonitoringModel[];
	dailyTrends: ModelMonitoringTrend[];
	range: string;
};

export type ModelMonitoringInput = {
	/** Per-model aggregates within the selected range. */
	modelRows: ModelMonitoringRow[];
	/** Per-model × time-slot trends within the selected range. */
	trendRows: ModelMonitoringRow[];
	/** Global aggregate within the selected range. */
	globalRow: ModelMonitoringRow | null;
	/** Global aggregate for the last 15 minutes. */
	recentRow: ModelMonitoringRow | null;
	/** Per-model aggregates for the last 15 minutes. */
	recentModelRows: ModelMonitoringRow[];
	/** User-level allowed_models (null = unrestricted). */
	allowlist: string[] | null;
	range: string;
};

/** Percent with two decimals; null when there was no traffic (admin parity). */
const roundRate = (success: number, total: number): number | null =>
	total > 0 ? Math.round((success / total) * 10000) / 100 : null;

const modelName = (row: ModelMonitoringRow): string =>
	String(row.model ?? "unknown");

/**
 * Builds the user-facing model-availability monitoring payload.
 *
 * - Rows are filtered by the user allowlist BEFORE mapping so restricted
 *   model names never appear anywhere in the response (including trends).
 * - `summary` / `recentStatus` are platform-wide aggregates and are
 *   deliberately NOT allowlist-filtered: the status page reflects platform
 *   health and the aggregate numbers carry no model or channel names.
 * - The payload contains no channel fields by contract (no join to
 *   `channels`, no `error_message`).
 */
export function buildModelMonitoring(
	input: ModelMonitoringInput,
): ModelMonitoringPayload {
	const { allowlist } = input;

	const recentByModel = new Map<
		string,
		{ success_rate: number | null; avg_latency_ms: number }
	>();
	for (const row of input.recentModelRows) {
		const total = Number(row.total_requests);
		const success = Number(row.success_count);
		recentByModel.set(modelName(row), {
			success_rate: roundRate(success, total),
			avg_latency_ms: Math.round(Number(row.avg_latency_ms)),
		});
	}

	const models = input.modelRows
		.filter((row) => isModelAllowed(allowlist, modelName(row)))
		.map((row) => {
			const total = Number(row.total_requests);
			const success = Number(row.success_count);
			const recent = recentByModel.get(modelName(row));
			return {
				model: modelName(row),
				total_requests: total,
				success_count: success,
				error_count: Number(row.error_count),
				success_rate: roundRate(success, total),
				avg_latency_ms: Math.round(Number(row.avg_latency_ms)),
				last_seen: (row.last_seen as string | null | undefined) ?? null,
				recent_success_rate: recent?.success_rate ?? null,
				recent_avg_latency_ms: recent?.avg_latency_ms ?? null,
			};
		});

	const dailyTrends = input.trendRows
		.filter((row) => isModelAllowed(allowlist, modelName(row)))
		.map((row) => {
			const reqs = Number(row.requests);
			const succ = Number(row.success);
			return {
				model: modelName(row),
				day: String(row.day ?? ""),
				requests: reqs,
				success: succ,
				errors: Number(row.errors),
				success_rate: reqs > 0 ? Math.round((succ / reqs) * 10000) / 100 : 0,
				avg_latency_ms: Math.round(Number(row.avg_latency_ms)),
			};
		});

	const totalRequests = Number(input.globalRow?.total_requests ?? 0);
	const totalSuccess = Number(input.globalRow?.total_success ?? 0);
	const totalErrors = Number(input.globalRow?.total_errors ?? 0);

	const recentRequests = Number(input.recentRow?.total_requests ?? 0);
	const recentSuccess = Number(input.recentRow?.total_success ?? 0);
	const recentErrors = Number(input.recentRow?.total_errors ?? 0);

	return {
		summary: {
			total_requests: totalRequests,
			total_success: totalSuccess,
			total_errors: totalErrors,
			avg_latency_ms: Math.round(Number(input.globalRow?.avg_latency_ms ?? 0)),
			success_rate:
				totalRequests > 0
					? Math.round((totalSuccess / totalRequests) * 10000) / 100
					: 100,
			active_models: models.filter((m) => m.total_requests > 0).length,
		},
		recentStatus: {
			total_requests: recentRequests,
			total_success: recentSuccess,
			total_errors: recentErrors,
			avg_latency_ms: Math.round(Number(input.recentRow?.avg_latency_ms ?? 0)),
			success_rate:
				recentRequests > 0
					? Math.round((recentSuccess / recentRequests) * 10000) / 100
					: 100,
		},
		models,
		dailyTrends,
		range: input.range,
	};
}
