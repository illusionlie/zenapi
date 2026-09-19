/**
 * Shared time-range configuration for monitoring endpoints.
 *
 * `ms` — lookback window in milliseconds; `sqlSlice` — length passed to
 * `substr(created_at, 1, sqlSlice)` to bucket rows into time slots
 * (16 = minute, 13 = hour, 10 = day on ISO `YYYY-MM-DD HH:MM:SS` strings).
 */
export const RANGE_CONFIG: Record<string, { ms: number; sqlSlice: number }> = {
	"15m": { ms: 15 * 60_000, sqlSlice: 16 },
	"1h": { ms: 60 * 60_000, sqlSlice: 16 },
	"1d": { ms: 86_400_000, sqlSlice: 13 },
	"7d": { ms: 7 * 86_400_000, sqlSlice: 13 },
	"30d": { ms: 30 * 86_400_000, sqlSlice: 10 },
};

/**
 * Resolves a raw `range` query parameter to its config, falling back to
 * the `7d` window for missing or unknown values.
 */
export function resolveMonitoringRange(range: string | undefined | null): {
	ms: number;
	sqlSlice: number;
} {
	return RANGE_CONFIG[range ?? ""] ?? RANGE_CONFIG["7d"];
}
