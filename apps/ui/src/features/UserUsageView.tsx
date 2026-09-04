import type { UsageLog } from "../core/types";
import { formatDateTime } from "../core/utils";

type UserUsageViewProps = {
	usage: UsageLog[];
};

function formatCost(n: number | null | undefined): string {
	if (n == null || n === 0) return "$0";
	if (n < 0.01) return `$${n.toFixed(4)}`;
	return `$${n.toFixed(2)}`;
}

export const UserUsageView = ({ usage }: UserUsageViewProps) => (
	<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
		<div class="mb-4 flex items-center gap-3">
			<h3 class="font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
				使用日志
			</h3>
			<span class="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-500">
				{usage.length} 条记录
			</span>
		</div>

		{usage.length === 0 ? (
			<p class="py-8 text-center text-sm text-stone-400">暂无使用记录</p>
		) : (
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b border-stone-100 text-xs uppercase tracking-widest text-stone-400">
							<th class="pb-2 pr-4 font-medium">模型</th>
							<th class="pb-2 pr-4 font-medium">Token</th>
							<th class="pb-2 pr-4 font-medium">费用</th>
							<th class="pb-2 pr-4 font-medium">延迟</th>
							<th class="pb-2 pr-4 font-medium">状态</th>
							<th class="pb-2 font-medium">时间</th>
						</tr>
					</thead>
					<tbody>
						{usage.map((log) => (
							<tr class="border-b border-stone-50">
								<td class="py-2 pr-4 font-medium text-stone-700">
									{log.model ?? "-"}
								</td>
								<td class="py-2 pr-4 text-stone-600">
									{log.total_tokens ?? 0}
									{log.prompt_tokens != null && (
										<span class="ml-1 text-xs text-stone-400">
											({log.prompt_tokens}+{log.completion_tokens ?? 0})
										</span>
									)}
								</td>
								<td class="py-2 pr-4 text-stone-600">{formatCost(log.cost)}</td>
								<td class="py-2 pr-4 text-stone-600">
									{log.latency_ms != null ? `${log.latency_ms}ms` : "-"}
								</td>
								<td class="py-2 pr-4">
									<span
										class={`rounded-full px-2 py-0.5 text-xs ${
											log.status === "ok"
												? "bg-emerald-50 text-emerald-600"
												: "bg-red-50 text-red-600"
										}`}
									>
										{log.status}
									</span>
								</td>
								<td class="py-2 text-xs text-stone-500">
									{formatDateTime(log.created_at)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		)}
	</div>
);
