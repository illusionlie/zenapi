import { useCallback, useMemo, useState } from "hono/jsx/dom";
import { apiBase } from "../core/constants";
import type {
	ModelMonitoringData,
	ModelMonitoringModel,
	ModelMonitoringTrend,
} from "../core/types";
import { DotLoader } from "./DotLoader";
import { barColor, formatSlotLabel, generateSlots } from "./monitoring-shared";

type ModelMonitoringViewProps = {
	monitoring: ModelMonitoringData | null;
	token: string | null;
	onLoaded: (data: ModelMonitoringData) => void;
};

const RANGE_OPTIONS = ["15m", "1h", "1d", "7d", "30d"] as const;
const RANGE_LABELS: Record<string, string> = {
	"15m": "15 分钟",
	"1h": "1 小时",
	"1d": "1 天",
	"7d": "7 天",
	"30d": "30 天",
};

const rateColor = (rate: number | null) => {
	if (rate === null) return "text-stone-400";
	if (rate >= 99) return "text-green-600";
	if (rate >= 95) return "text-yellow-600";
	return "text-red-600";
};

const statusLabel = (rate: number | null) => {
	if (rate === null) return "无数据";
	if (rate >= 99) return "正常";
	if (rate >= 95) return "降级";
	return "异常";
};

const statusDot = (rate: number | null) => {
	if (rate === null) return "bg-stone-300";
	if (rate >= 99) return "bg-green-500";
	if (rate >= 95) return "bg-yellow-500";
	return "bg-red-500";
};

type ModelBarProps = {
	model: ModelMonitoringModel;
	slots: string[];
	range: string;
	trendMap: Map<string, ModelMonitoringTrend>;
};

const ModelBar = ({ model, slots, range, trendMap }: ModelBarProps) => {
	return (
		<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
			{/* Header row */}
			<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
				<div class="flex items-center gap-2.5">
					<span
						class={`inline-block h-2.5 w-2.5 rounded-full ${statusDot(model.success_rate)}`}
					/>
					<span class="font-mono font-medium text-stone-900">
						{model.model}
					</span>
				</div>
				<div class="flex items-center gap-3 text-xs text-stone-500">
					<span class={`font-medium ${rateColor(model.success_rate)}`}>
						{model.success_rate !== null ? `${model.success_rate}%` : "-"}
					</span>
					<span>
						{model.total_requests > 0 ? `${model.avg_latency_ms}ms` : "-"}
					</span>
					<span class={`font-medium ${rateColor(model.success_rate)}`}>
						{statusLabel(model.success_rate)}
					</span>
				</div>
			</div>

			{/* Uptime bars (non-interactive: no slot drill-down, no error details) */}
			<div class="flex gap-px">
				{slots.map((slot) => {
					const trend = trendMap.get(`${model.model}|${slot}`);
					const rate = trend ? trend.success_rate : null;
					return (
						<div
							key={`${model.model}|${slot}`}
							class="h-8 flex-1 rounded-sm"
							style={{ backgroundColor: barColor(rate) }}
						/>
					);
				})}
			</div>

			{/* Slot labels */}
			<div class="mt-1 flex justify-between text-xs text-stone-400">
				<span>{formatSlotLabel(slots[0], range)}</span>
				<span>{formatSlotLabel(slots[slots.length - 1], range)}</span>
			</div>
		</div>
	);
};

export const ModelMonitoringView = ({
	monitoring,
	token,
	onLoaded,
}: ModelMonitoringViewProps) => {
	const [range, setRange] = useState("15m");
	const [loading, setLoading] = useState(false);

	const fetchData = useCallback(
		async (r: string) => {
			setLoading(true);
			try {
				const headers: Record<string, string> = {
					"Content-Type": "application/json",
				};
				if (token) headers.Authorization = `Bearer ${token}`;
				const res = await fetch(`${apiBase}/api/u/monitoring?range=${r}`, {
					headers,
				});
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = (await res.json()) as ModelMonitoringData;
				onLoaded(data);
			} catch {
				/* silently ignore */
			} finally {
				setLoading(false);
			}
		},
		[token, onLoaded],
	);

	const handleRangeChange = useCallback(
		(r: string) => {
			setRange(r);
			fetchData(r);
		},
		[fetchData],
	);

	const slots = useMemo(() => generateSlots(range), [range]);

	const trendMap = useMemo(() => {
		const map = new Map<string, ModelMonitoringTrend>();
		if (!monitoring) return map;
		for (const t of monitoring.dailyTrends) {
			map.set(`${t.model}|${t.day}`, t);
		}
		return map;
	}, [monitoring]);

	if (!monitoring) {
		return (
			<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
				暂无数据
			</div>
		);
	}

	const { summary, models } = monitoring;
	const recent = monitoring.recentStatus;

	// Overall status based on last 15 minutes
	const overallStatus =
		recent.success_rate >= 99
			? "所有系统正常运行"
			: recent.success_rate >= 95
				? "部分系统降级"
				: "系统异常";

	return (
		<div class="space-y-5">
			{/* Time range selector */}
			<div class="flex items-center gap-2">
				{RANGE_OPTIONS.map((r) => (
					<button
						key={r}
						type="button"
						onClick={() => handleRangeChange(r)}
						disabled={loading}
						class={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
							range === r
								? "bg-stone-900 text-white"
								: "bg-stone-100 text-stone-600 hover:bg-stone-200"
						} ${loading ? "opacity-50" : ""}`}
					>
						{RANGE_LABELS[r]}
					</button>
				))}
				{loading && <DotLoader class="text-stone-400" />}
			</div>

			{/* Overall status banner (always based on last 15 minutes) */}
			<div
				class={`flex items-center gap-3 rounded-2xl border p-5 shadow-lg ${
					recent.success_rate >= 99
						? "border-green-200 bg-green-50"
						: recent.success_rate >= 95
							? "border-yellow-200 bg-yellow-50"
							: "border-red-200 bg-red-50"
				}`}
			>
				<span
					class={`inline-block h-3 w-3 rounded-full ${statusDot(recent.success_rate)}`}
				/>
				<span class={`text-lg font-semibold ${rateColor(recent.success_rate)}`}>
					{overallStatus}
				</span>
				<span class="ml-auto text-sm text-stone-500">
					近 15 分钟: {recent.total_requests} 请求 &middot;{" "}
					{recent.success_rate}% 成功率 &middot; {recent.avg_latency_ms}ms 延迟
				</span>
			</div>

			{/* Global overview cards */}
			<div class="grid grid-cols-1 gap-5 sm:grid-cols-3">
				<div class="flex flex-col gap-1.5 rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
					<span class="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-500">
						近 15 分钟成功率
					</span>
					<div
						class={`text-2xl font-semibold ${rateColor(recent.success_rate)}`}
					>
						{recent.success_rate}%
					</div>
					<span class="font-['Space_Grotesk'] text-xs text-stone-500">
						成功 {recent.total_success} / 错误 {recent.total_errors}
					</span>
				</div>
				<div class="flex flex-col gap-1.5 rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
					<span class="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-500">
						平均延迟
					</span>
					<div class="text-2xl font-semibold text-stone-900">
						{summary.avg_latency_ms} ms
					</div>
					<span class="font-['Space_Grotesk'] text-xs text-stone-500">
						{summary.total_requests} 次请求
					</span>
				</div>
				<div class="flex flex-col gap-1.5 rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
					<span class="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-500">
						可用模型
					</span>
					<div class="text-2xl font-semibold text-stone-900">
						{summary.active_models}
					</div>
					<span class="font-['Space_Grotesk'] text-xs text-stone-500">
						有流量模型数
					</span>
				</div>
			</div>

			{/* Per-model uptime bars */}
			{models.map((m) => (
				<ModelBar
					key={m.model}
					model={m}
					slots={slots}
					range={range}
					trendMap={trendMap}
				/>
			))}

			{/* Legend */}
			<div class="flex flex-wrap items-center gap-4 px-1 text-xs text-stone-400">
				<div class="flex items-center gap-1.5">
					<span class="inline-block h-3 w-3 rounded-sm bg-green-500" /> 正常
					(&ge;99%)
				</div>
				<div class="flex items-center gap-1.5">
					<span class="inline-block h-3 w-3 rounded-sm bg-yellow-500" /> 降级
					(&ge;95%)
				</div>
				<div class="flex items-center gap-1.5">
					<span class="inline-block h-3 w-3 rounded-sm bg-red-500" /> 异常
					(&lt;95%)
				</div>
				<div class="flex items-center gap-1.5">
					<span class="inline-block h-3 w-3 rounded-sm bg-stone-200" /> 无数据
				</div>
			</div>
		</div>
	);
};
