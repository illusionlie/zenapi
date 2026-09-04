import { useCallback, useMemo, useState } from "hono/jsx/dom";
import { createApiFetch } from "../core/api";
import type {
	ContributionEntry,
	LdohViolation,
	User,
	UserDashboardData,
} from "../core/types";

type UserDashboardProps = {
	data: UserDashboardData | null;
	user: User;
	token: string;
	updateToken: (next: string | null) => void;
	linuxdoEnabled: boolean;
	onUnbind: () => void;
	onUserRefresh: () => void;
};

function formatCost(n: number): string {
	if (n === 0) return "$0.00";
	if (n < 0.01) return `$${n.toFixed(4)}`;
	return `$${n.toFixed(2)}`;
}

function formatNumber(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}

const ContributionBoard = ({
	contributions,
}: {
	contributions: ContributionEntry[];
}) => {
	const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

	return (
		<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
			<h3 class="mb-4 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
				贡献榜
			</h3>
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm" id="zenapi-contribution-board">
					<thead>
						<tr class="border-b border-stone-100 text-xs uppercase tracking-widest text-stone-400">
							<th class="pb-2 pr-4 font-medium">#</th>
							<th class="pb-2 pr-4 font-medium">贡献者</th>
							<th class="pb-2 pr-4 text-right font-medium">渠道数</th>
							<th class="pb-2 pr-4 text-right font-medium">总请求</th>
							<th class="pb-2 text-right font-medium">总 Token</th>
						</tr>
					</thead>
					<tbody>
						{contributions.map((entry, idx) => {
							const isExpanded = expandedIdx === idx;
							return (
								<>
									<tr
										key={`row-${idx}`}
										class={`border-b border-stone-50 cursor-pointer transition-colors hover:bg-stone-50 ${isExpanded ? "bg-stone-50" : ""}`}
										onClick={() => setExpandedIdx(isExpanded ? null : idx)}
										data-linuxdo-id={entry.linuxdo_id ?? undefined}
										data-linuxdo-username={entry.linuxdo_username ?? undefined}
										data-contributor-name={entry.user_name}
									>
										<td class="py-2.5 pr-4 text-stone-400">{idx + 1}</td>
										<td class="py-2.5 pr-4">
											<span class="font-medium text-stone-700">
												{entry.user_name}
											</span>
											{entry.linuxdo_id && (
												<span class="ml-1.5 text-xs text-stone-400">
													L{entry.linuxdo_id}
												</span>
											)}
											{entry.tip_url && (
												<a
													href={entry.tip_url}
													target="_blank"
													rel="noopener noreferrer"
													class="ml-1.5 inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-xs text-amber-600 hover:bg-amber-100"
													onClick={(e) => e.stopPropagation()}
												>
													打赏
												</a>
											)}
										</td>
										<td class="py-2.5 pr-4 text-right text-stone-600">
											{entry.channel_count}
										</td>
										<td class="py-2.5 pr-4 text-right font-['Space_Grotesk'] text-stone-600">
											{formatNumber(entry.total_requests)}
										</td>
										<td class="py-2.5 text-right font-['Space_Grotesk'] text-stone-600">
											{formatNumber(entry.total_tokens)}
										</td>
									</tr>
									{isExpanded && entry.channels.length > 0 && (
										<tr key={`detail-${idx}`}>
											<td colSpan={5} class="pb-2">
												<div class="ml-8 rounded-lg bg-stone-50 p-3">
													<table class="w-full text-xs">
														<thead>
															<tr class="text-stone-400">
																<th class="pb-1 text-left font-medium">
																	渠道名称
																</th>
																<th class="pb-1 text-right font-medium">
																	请求
																</th>
																<th class="pb-1 text-right font-medium">
																	Token
																</th>
															</tr>
														</thead>
														<tbody>
															{entry.channels.map((ch) => (
																<tr
																	key={ch.name}
																	class="border-t border-stone-100"
																>
																	<td class="py-1 text-stone-600">{ch.name}</td>
																	<td class="py-1 text-right font-['Space_Grotesk'] text-stone-500">
																		{formatNumber(ch.requests)}
																	</td>
																	<td class="py-1 text-right font-['Space_Grotesk'] text-stone-500">
																		{formatNumber(ch.total_tokens)}
																	</td>
																</tr>
															))}
														</tbody>
													</table>
												</div>
											</td>
										</tr>
									)}
								</>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
};

export const UserDashboard = ({
	data,
	user,
	token,
	updateToken,
	linuxdoEnabled,
	onUnbind,
	onUserRefresh,
}: UserDashboardProps) => {
	const [tipUrl, setTipUrl] = useState(user.tip_url ?? "");
	const [profileNotice, setProfileNotice] = useState("");
	const [checkinLoading, setCheckinLoading] = useState(false);
	const [checkinNotice, setCheckinNotice] = useState("");
	const [rechargeAmount, setRechargeAmount] = useState("");
	const [rechargeLoading, setRechargeLoading] = useState(false);
	const [rechargeNotice, setRechargeNotice] = useState("");
	const [withdrawAmount, setWithdrawAmount] = useState("");
	const [withdrawLoading, setWithdrawLoading] = useState(false);
	const [withdrawNotice, setWithdrawNotice] = useState("");

	const apiFetch = useMemo(
		() => createApiFetch(token, () => updateToken(null)),
		[token, updateToken],
	);

	const handleCheckin = useCallback(async () => {
		setCheckinLoading(true);
		try {
			const result = await apiFetch<{
				ok?: boolean;
				already_checked_in?: boolean;
				reward?: number;
			}>("/api/u/checkin", {
				method: "POST",
			});
			if (result.already_checked_in) {
				setCheckinNotice("今日已签到");
			} else if (result.ok) {
				setCheckinNotice(`签到成功，获得 $${result.reward?.toFixed(2) ?? "0"}`);
				onUserRefresh();
			}
		} catch (error) {
			setCheckinNotice((error as Error).message);
		} finally {
			setCheckinLoading(false);
		}
	}, [apiFetch, onUserRefresh]);

	const handleSaveTipUrl = useCallback(async () => {
		try {
			await apiFetch("/api/u/profile", {
				method: "PATCH",
				body: JSON.stringify({ tip_url: tipUrl.trim() }),
			});
			setProfileNotice("打赏链接已保存");
			onUserRefresh();
		} catch (error) {
			setProfileNotice((error as Error).message);
		}
	}, [apiFetch, tipUrl, onUserRefresh]);

	const handleRecharge = useCallback(async () => {
		const amount = Number(rechargeAmount);
		if (!amount || amount <= 0) {
			setRechargeNotice("请输入有效的充值金额");
			return;
		}
		setRechargeLoading(true);
		setRechargeNotice("");
		try {
			const result = await apiFetch<{ order_id: string; redirect_url: string }>(
				"/api/recharge/create",
				{
					method: "POST",
					body: JSON.stringify({ ldc_amount: amount }),
				},
			);
			if (result.redirect_url) {
				window.location.href = result.redirect_url;
			}
		} catch (error) {
			setRechargeNotice((error as Error).message);
		} finally {
			setRechargeLoading(false);
		}
	}, [apiFetch, rechargeAmount]);

	const handleWithdraw = useCallback(async () => {
		const amount = Number(withdrawAmount);
		if (!amount || amount <= 0) {
			setWithdrawNotice("请输入有效的提现金额");
			return;
		}
		setWithdrawLoading(true);
		setWithdrawNotice("");
		try {
			const result = await apiFetch<{
				ok?: boolean;
				ldc_amount?: number;
				fee_amount?: number;
			}>("/api/u/withdrawal/create", {
				method: "POST",
				body: JSON.stringify({ amount }),
			});
			if (result.ok) {
				setWithdrawNotice(
					`提现成功，到账 ${result.ldc_amount} LDC${result.fee_amount ? `（手续费 ${result.fee_amount} LDC）` : ""}`,
				);
				setWithdrawAmount("");
				onUserRefresh();
			}
		} catch (error) {
			setWithdrawNotice((error as Error).message);
		} finally {
			setWithdrawLoading(false);
		}
	}, [apiFetch, withdrawAmount, onUserRefresh]);

	if (!data) {
		return (
			<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
				<p class="text-sm text-stone-400">加载中...</p>
			</div>
		);
	}

	return (
		<div class="space-y-5">
			{/* Check-in card */}
			<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
				<div class="flex items-center justify-between">
					<div>
						<h3 class="font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
							每日签到
						</h3>
						<p class="text-xs text-stone-500">
							每日签到可获得 ${data.checkin_reward.toFixed(2)} 余额
						</p>
					</div>
					{data.checked_in_today ? (
						<button
							type="button"
							disabled
							class="rounded-lg bg-stone-100 px-5 py-2.5 text-sm font-semibold text-stone-400 cursor-not-allowed"
						>
							已签到
						</button>
					) : (
						<button
							type="button"
							disabled={checkinLoading}
							class="rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-60"
							onClick={handleCheckin}
						>
							{checkinLoading ? "签到中..." : "签到"}
						</button>
					)}
				</div>
				{checkinNotice && (
					<div class="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
						{checkinNotice}
					</div>
				)}
			</div>

			{/* Recharge card */}
			{data.ldc_payment_enabled && (
				<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
					<h3 class="font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
						LDC 充值
					</h3>
					<p class="mb-3 text-xs text-stone-500">
						1 LDC = ${data.ldc_exchange_rate} 余额
					</p>
					<div class="flex flex-col gap-3 sm:flex-row sm:items-end">
						<div class="flex-1">
							<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
								LDC 积分数量
							</label>
							<input
								class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
								type="number"
								min="1"
								step="1"
								placeholder="输入 LDC 积分数量"
								value={rechargeAmount}
								onInput={(e) =>
									setRechargeAmount(
										(e.currentTarget as HTMLInputElement)?.value ?? "",
									)
								}
							/>
						</div>
						<button
							type="button"
							disabled={rechargeLoading || !rechargeAmount}
							class="h-[42px] rounded-lg bg-stone-900 px-5 text-sm font-semibold text-white transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
							onClick={handleRecharge}
						>
							{rechargeLoading ? "处理中..." : "充值"}
						</button>
					</div>
					{rechargeAmount && Number(rechargeAmount) > 0 && (
						<p class="mt-2 text-sm text-stone-600">
							支付 {rechargeAmount} LDC 积分 → 获得 $
							{(Number(rechargeAmount) * data.ldc_exchange_rate).toFixed(2)}{" "}
							余额
						</p>
					)}
					{rechargeNotice && (
						<div class="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
							{rechargeNotice}
						</div>
					)}
				</div>
			)}

			{/* Withdrawal card */}
			{data.withdrawal_enabled && (
				<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
					<h3 class="font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
						余额提现
					</h3>
					<p class="mb-3 text-xs text-stone-500">
						可提现余额: ${data.withdrawable_balance.toFixed(2)}
						{data.withdrawal_fee_rate > 0
							? ` | 手续费: ${data.withdrawal_fee_rate}%`
							: ""}
					</p>
					{!user.linuxdo_id ? (
						<div class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
							请先绑定 Linux DO 账号才能提现
						</div>
					) : (
						<>
							<div class="flex flex-col gap-3 sm:flex-row sm:items-end">
								<div class="flex-1">
									<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
										提现余额数量
									</label>
									<input
										class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
										type="number"
										min="0.01"
										step="0.01"
										placeholder="输入要提现的余额数量"
										value={withdrawAmount}
										onInput={(e) =>
											setWithdrawAmount(
												(e.currentTarget as HTMLInputElement)?.value ?? "",
											)
										}
									/>
								</div>
								<button
									type="button"
									disabled={withdrawLoading || !withdrawAmount}
									class="h-[42px] rounded-lg bg-stone-900 px-5 text-sm font-semibold text-white transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
									onClick={handleWithdraw}
								>
									{withdrawLoading ? "处理中..." : "提现"}
								</button>
							</div>
							{withdrawAmount &&
								Number(withdrawAmount) > 0 &&
								data.ldc_exchange_rate > 0 && (
									<p class="mt-2 text-sm text-stone-600">
										{(() => {
											const amt = Number(withdrawAmount);
											const grossLdc =
												Math.round((amt / data.ldc_exchange_rate) * 100) / 100;
											const fee =
												Math.round(
													grossLdc * (data.withdrawal_fee_rate / 100) * 100,
												) / 100;
											const net = Math.round((grossLdc - fee) * 100) / 100;
											return `${amt} 余额 → ${grossLdc} LDC${fee > 0 ? ` - ${fee} 手续费` : ""} = ${net} LDC 到账`;
										})()}
									</p>
								)}
						</>
					)}
					{withdrawNotice && (
						<div class="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
							{withdrawNotice}
						</div>
					)}
				</div>
			)}

			{/* Stats cards */}
			<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
				<div class="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
					<p class="text-xs font-medium uppercase tracking-widest text-stone-400">
						余额
					</p>
					<p class="mt-1 font-['Space_Grotesk'] text-2xl font-semibold text-stone-900">
						${user.balance.toFixed(2)}
					</p>
					{data.withdrawal_enabled && (
						<p class="mt-0.5 text-xs text-stone-500">
							可提现: ${data.withdrawable_balance.toFixed(2)}
						</p>
					)}
				</div>
				<div class="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
					<p class="text-xs font-medium uppercase tracking-widest text-stone-400">
						总请求
					</p>
					<p class="mt-1 font-['Space_Grotesk'] text-2xl font-semibold text-stone-900">
						{formatNumber(data.total_requests)}
					</p>
				</div>
				<div class="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
					<p class="text-xs font-medium uppercase tracking-widest text-stone-400">
						总 Token
					</p>
					<p class="mt-1 font-['Space_Grotesk'] text-2xl font-semibold text-stone-900">
						{formatNumber(data.total_tokens)}
					</p>
				</div>
				<div class="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
					<p class="text-xs font-medium uppercase tracking-widest text-stone-400">
						总费用
					</p>
					<p class="mt-1 font-['Space_Grotesk'] text-2xl font-semibold text-stone-900">
						{formatCost(data.total_cost)}
					</p>
				</div>
			</div>

			{/* Profile settings */}
			<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
				<h3 class="mb-4 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
					个人设置
				</h3>
				{profileNotice && (
					<div class="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
						{profileNotice}
					</div>
				)}
				<div class="flex items-end gap-3">
					<div class="flex-1">
						<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
							打赏链接（选填，显示在贡献榜）
						</label>
						<input
							class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
							type="url"
							placeholder="https://example.com/tip"
							value={tipUrl}
							onInput={(e) =>
								setTipUrl((e.currentTarget as HTMLInputElement)?.value ?? "")
							}
						/>
					</div>
					<button
						type="button"
						class="h-[42px] rounded-lg bg-stone-900 px-4 text-sm font-semibold text-white transition-all hover:shadow-lg"
						onClick={handleSaveTipUrl}
					>
						保存
					</button>
				</div>
			</div>

			{/* Account binding */}
			{linuxdoEnabled && (
				<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
					<h3 class="mb-4 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
						账号绑定
					</h3>
					<div class="flex items-center justify-between">
						<div>
							<p class="text-sm font-medium text-stone-700">Linux DO</p>
							<p class="text-xs text-stone-500">
								{user.linuxdo_id ? `已绑定 (ID: ${user.linuxdo_id})` : "未绑定"}
							</p>
						</div>
						<div>
							{user.linuxdo_id ? (
								<button
									type="button"
									class="rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 transition-all hover:border-red-200 hover:text-red-600"
									onClick={onUnbind}
								>
									解除绑定
								</button>
							) : (
								<a
									href={`/api/u/auth/linuxdo/bind?token=${encodeURIComponent(token)}`}
									class="inline-flex rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition-all hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-md"
								>
									绑定 Linux DO
								</a>
							)}
						</div>
					</div>
				</div>
			)}

			{/* Recent usage */}
			<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
				<h3 class="mb-4 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
					最近使用
				</h3>
				{data.recent_usage.length === 0 ? (
					<p class="py-8 text-center text-sm text-stone-400">暂无使用记录</p>
				) : (
					<div class="overflow-x-auto">
						<table class="w-full text-left text-sm">
							<thead>
								<tr class="border-b border-stone-100 text-xs uppercase tracking-widest text-stone-400">
									<th class="pb-2 pr-4 font-medium">日期</th>
									<th class="pb-2 pr-4 font-medium">请求数</th>
									<th class="pb-2 font-medium">费用</th>
								</tr>
							</thead>
							<tbody>
								{data.recent_usage.map((item) => (
									<tr class="border-b border-stone-50">
										<td class="py-2 pr-4 text-stone-600">{item.day}</td>
										<td class="py-2 pr-4 text-stone-600">{item.requests}</td>
										<td class="py-2 text-stone-600">{formatCost(item.cost)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
			{/* Contribution leaderboard */}
			{data.contributions.length > 0 && (
				<ContributionBoard contributions={data.contributions} />
			)}
			{/* Violations shame wall */}
			{data.violations && data.violations.length > 0 && (
				<div class="rounded-2xl border-2 border-red-300 bg-white p-5 shadow-lg">
					<h3 class="mb-4 font-['Space_Grotesk'] text-lg tracking-tight text-red-700">
						违规记录
					</h3>
					<p class="mb-3 text-xs text-red-500">
						以下用户尝试提交公益站维护者已封禁的 API 地址
					</p>
					<div class="overflow-x-auto">
						<table class="w-full text-left text-sm">
							<thead>
								<tr class="border-b border-red-100 text-xs uppercase tracking-widest text-red-400">
									<th class="pb-2 pr-4 font-medium">用户</th>
									<th class="pb-2 pr-4 font-medium">LinuxDO</th>
									<th class="pb-2 pr-4 font-medium">尝试 URL</th>
									<th class="pb-2 pr-4 font-medium">站点</th>
									<th class="pb-2 font-medium">时间</th>
								</tr>
							</thead>
							<tbody>
								{data.violations.map((v: LdohViolation) => (
									<tr key={v.id} class="border-b border-red-50">
										<td class="py-2 pr-4 text-stone-700">{v.user_name}</td>
										<td class="py-2 pr-4 text-stone-500">
											{v.linuxdo_username ?? "-"}
										</td>
										<td class="py-2 pr-4 text-xs text-stone-500 max-w-[200px] truncate">
											{v.attempted_base_url}
										</td>
										<td class="py-2 pr-4 text-stone-600">{v.site_name}</td>
										<td class="py-2 text-xs text-stone-400">
											{v.created_at?.slice(0, 16)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}
		</div>
	);
};
