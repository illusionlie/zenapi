/**
 * Shared helpers for monitoring views (admin MonitoringView and user-facing
 * ModelMonitoringView). Slot generation must stay in sync with the worker's
 * `substr(created_at, 1, sqlSlice)` bucketing (apps/worker/src/utils/monitoring.ts).
 */

export const barColor = (rate: number | null) => {
	if (rate === null) return "#e7e5e4"; // stone-200, no data
	if (rate >= 99) return "#22c55e"; // green-500
	if (rate >= 95) return "#eab308"; // yellow-500
	return "#ef4444"; // red-500
};

/** Generate time slot strings for a given range. */
export const generateSlots = (range: string): string[] => {
	const result: string[] = [];
	const now = new Date();
	if (range === "15m" || range === "1h") {
		const minutes = range === "15m" ? 15 : 60;
		// Round down to current minute
		now.setSeconds(0, 0);
		for (let i = minutes - 1; i >= 0; i--) {
			const d = new Date(now.getTime() - i * 60_000);
			// YYYY-MM-DDTHH:MM — matches SQL substr(created_at, 1, 16) on ISO strings
			result.push(d.toISOString().slice(0, 16));
		}
	} else if (range === "1d" || range === "7d") {
		const hours = range === "1d" ? 24 : 168;
		// Round down to current hour
		now.setMinutes(0, 0, 0);
		for (let i = hours - 1; i >= 0; i--) {
			const d = new Date(now.getTime() - i * 3_600_000);
			// YYYY-MM-DDTHH — matches SQL substr(created_at, 1, 13) on ISO strings
			result.push(d.toISOString().slice(0, 13));
		}
	} else {
		const days = 30;
		for (let i = days - 1; i >= 0; i--) {
			const d = new Date(now.getTime() - i * 86_400_000);
			result.push(d.toISOString().slice(0, 10));
		}
	}
	return result;
};

/** Format a slot key for display in labels/tooltips (converts UTC to local time). */
export const formatSlotLabel = (slot: string, range: string): string => {
	if (range === "15m" || range === "1h") {
		// slot is "YYYY-MM-DDTHH:MM" in UTC — convert to local time
		const date = new Date(`${slot}:00.000Z`);
		const hh = String(date.getHours()).padStart(2, "0");
		const mm = String(date.getMinutes()).padStart(2, "0");
		return `${hh}:${mm}`;
	}
	if (range === "1d" || range === "7d") {
		// slot is "YYYY-MM-DDTHH" in UTC — convert to local time
		const date = new Date(`${slot}:00:00.000Z`);
		const MM = String(date.getMonth() + 1).padStart(2, "0");
		const DD = String(date.getDate()).padStart(2, "0");
		const hh = String(date.getHours()).padStart(2, "0");
		return `${MM}-${DD} ${hh}:00`;
	}
	return slot;
};
