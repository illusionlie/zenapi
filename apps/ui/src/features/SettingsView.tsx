import { useEffect, useRef, useState } from "hono/jsx/dom";
import type { InviteCode, RegistrationMode, SettingsForm } from "../core/types";

type SettingsViewProps = {
	settingsForm: SettingsForm;
	adminPasswordSet: boolean;
	onSubmit: (event: Event) => void;
	onFormChange: (patch: Partial<SettingsForm>) => void;
	inviteCodes: InviteCode[];
	onGenerateCodes: (
		count: number,
		maxUses: number,
		prefix: string,
	) => Promise<void>;
	onDeleteCode: (id: string) => Promise<void>;
	onExportCodes: () => Promise<void>;
};

const registrationModeOptions: {
	value: RegistrationMode;
	label: string;
	desc: string;
}[] = [
	{
		value: "open",
		label: "开放注册",
		desc: "允许通过邮箱密码和 Linux DO 注册",
	},
	{
		value: "linuxdo_only",
		label: "仅 Linux DO",
		desc: "仅允许通过 Linux DO 登录注册",
	},
	{
		value: "closed",
		label: "关闭注册",
		desc: "不接受新用户注册，已有用户可正常登录",
	},
];

export const SettingsView = ({
	settingsForm,
	adminPasswordSet,
	onSubmit,
	onFormChange,
	inviteCodes,
	onGenerateCodes,
	onDeleteCode,
	onExportCodes,
}: SettingsViewProps) => {
	const [genCount, setGenCount] = useState("10");
	const [genMaxUses, setGenMaxUses] = useState("1");
	const [genPrefix, setGenPrefix] = useState("ZEN-");
	const announcementRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (
			announcementRef.current &&
			announcementRef.current.value !== settingsForm.announcement
		) {
			announcementRef.current.value = settingsForm.announcement;
		}
	}, [settingsForm.announcement]);

	return (
		<div class="space-y-5">
			<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
				<div class="mb-4 flex items-center justify-between">
					<h3 class="mb-0 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
						系统设置
					</h3>
				</div>
				<form class="grid gap-3.5 lg:grid-cols-2" onSubmit={onSubmit}>
					<div>
						<label
							class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500"
							for="retention"
						>
							日志保留天数
						</label>
						<input
							class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
							id="retention"
							name="log_retention_days"
							type="number"
							min="1"
							value={settingsForm.log_retention_days}
							onInput={(event) => {
								const target = event.currentTarget as HTMLInputElement | null;
								onFormChange({
									log_retention_days: target?.value ?? "",
								});
							}}
						/>
					</div>
					<div>
						<label
							class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500"
							for="session-ttl"
						>
							会话时长（小时）
						</label>
						<input
							class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
							id="session-ttl"
							name="session_ttl_hours"
							type="number"
							min="1"
							value={settingsForm.session_ttl_hours}
							onInput={(event) => {
								const target = event.currentTarget as HTMLInputElement | null;
								onFormChange({
									session_ttl_hours: target?.value ?? "",
								});
							}}
						/>
					</div>
					<div class="lg:col-span-2">
						<label
							class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500"
							for="admin-password"
						>
							管理员密码
						</label>
						<input
							class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
							id="admin-password"
							name="admin_password"
							type="password"
							placeholder={
								adminPasswordSet
									? "已设置，留空则不修改"
									: "未设置，保存后即为登录密码"
							}
							value={settingsForm.admin_password}
							onInput={(event) => {
								const target = event.currentTarget as HTMLInputElement | null;
								onFormChange({
									admin_password: target?.value ?? "",
								});
							}}
						/>
						<p class="mt-1 text-xs text-stone-500">
							密码状态：{adminPasswordSet ? "已设置" : "未设置"}
						</p>
					</div>
					<div class="lg:col-span-2">
						<label
							class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500"
							for="registration-mode"
						>
							注册模式
						</label>
						<select
							class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
							id="registration-mode"
							name="registration_mode"
							value={settingsForm.registration_mode}
							onChange={(event) => {
								const target = event.currentTarget as HTMLSelectElement | null;
								onFormChange({
									registration_mode: (target?.value ??
										"open") as RegistrationMode,
								});
							}}
						>
							{registrationModeOptions.map((opt) => (
								<option
									key={opt.value}
									value={opt.value}
									selected={settingsForm.registration_mode === opt.value}
								>
									{opt.label} — {opt.desc}
								</option>
							))}
						</select>
					</div>
					<div>
						<label
							class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500"
							for="checkin-reward"
						>
							签到奖励额度
						</label>
						<input
							class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
							id="checkin-reward"
							name="checkin_reward"
							type="number"
							min="0.01"
							step="0.01"
							value={settingsForm.checkin_reward}
							onInput={(event) => {
								const target = event.currentTarget as HTMLInputElement | null;
								onFormChange({
									checkin_reward: target?.value ?? "",
								});
							}}
						/>
					</div>
					<div>
						<label
							class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500"
							for="default-balance"
						>
							新用户初始额度
						</label>
						<input
							class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
							id="default-balance"
							name="default_balance"
							type="number"
							min="0"
							step="0.01"
							value={settingsForm.default_balance}
							onInput={(event) => {
								const target = event.currentTarget as HTMLInputElement | null;
								onFormChange({
									default_balance: target?.value ?? "",
								});
							}}
						/>
					</div>
					<div class="flex items-end">
						<label class="flex items-center gap-2 text-sm text-stone-700">
							<input
								type="checkbox"
								class="h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-amber-400"
								checked={settingsForm.require_invite_code === "true"}
								onChange={(event) => {
									const target = event.currentTarget as HTMLInputElement | null;
									onFormChange({
										require_invite_code: target?.checked ? "true" : "false",
									});
								}}
							/>
							需要邀请码注册
						</label>
					</div>
					<div class="lg:col-span-2 border-t border-stone-100 pt-4 mt-1">
						<h4 class="mb-3 text-sm font-semibold text-stone-700">
							LDC 支付设置
						</h4>
						<label class="flex items-center gap-2 text-sm text-stone-700">
							<input
								type="checkbox"
								class="h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-amber-400"
								checked={settingsForm.ldc_payment_enabled === "true"}
								onChange={(event) => {
									const target = event.currentTarget as HTMLInputElement | null;
									onFormChange({
										ldc_payment_enabled: target?.checked ? "true" : "false",
									});
								}}
							/>
							启用 LDC 支付充值
						</label>
					</div>
					{settingsForm.ldc_payment_enabled === "true" && (
						<>
							<div>
								<label
									class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500"
									for="ldc-epay-pid"
								>
									商户 PID
								</label>
								<input
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
									id="ldc-epay-pid"
									name="ldc_epay_pid"
									type="text"
									value={settingsForm.ldc_epay_pid}
									onInput={(event) => {
										const target =
											event.currentTarget as HTMLInputElement | null;
										onFormChange({
											ldc_epay_pid: target?.value ?? "",
										});
									}}
								/>
							</div>
							<div>
								<label
									class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500"
									for="ldc-epay-key"
								>
									商户密钥
								</label>
								<input
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
									id="ldc-epay-key"
									name="ldc_epay_key"
									type="password"
									value={settingsForm.ldc_epay_key}
									onInput={(event) => {
										const target =
											event.currentTarget as HTMLInputElement | null;
										onFormChange({
											ldc_epay_key: target?.value ?? "",
										});
									}}
								/>
							</div>
							<div>
								<label
									class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500"
									for="ldc-epay-gateway"
								>
									支付网关
								</label>
								<input
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
									id="ldc-epay-gateway"
									name="ldc_epay_gateway"
									type="text"
									placeholder="https://credit.linux.do/epay"
									value={settingsForm.ldc_epay_gateway}
									onInput={(event) => {
										const target =
											event.currentTarget as HTMLInputElement | null;
										onFormChange({
											ldc_epay_gateway: target?.value ?? "",
										});
									}}
								/>
							</div>
							<div>
								<label
									class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500"
									for="ldc-exchange-rate"
								>
									汇率 (1 LDC = ? 余额)
								</label>
								<input
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
									id="ldc-exchange-rate"
									name="ldc_exchange_rate"
									type="number"
									min="0.001"
									step="any"
									value={settingsForm.ldc_exchange_rate}
									onInput={(event) => {
										const target =
											event.currentTarget as HTMLInputElement | null;
										onFormChange({
											ldc_exchange_rate: target?.value ?? "",
										});
									}}
								/>
							</div>
						</>
					)}
					<div class="lg:col-span-2 border-t border-stone-100 pt-4 mt-1">
						<label
							class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500"
							for="announcement"
						>
							站点公告
						</label>
						<textarea
							ref={announcementRef}
							class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
							id="announcement"
							name="announcement"
							rows={3}
							placeholder="输入公告内容，所有用户进入站点时会看到此公告。留空则不显示。"
							onInput={(event) => {
								const target =
									event.currentTarget as HTMLTextAreaElement | null;
								onFormChange({
									announcement: target?.value ?? "",
								});
							}}
						/>
						<p class="mt-1 text-xs text-stone-500">
							设置后，所有用户登录进入站点时会收到公告通知。清空公告内容即可关闭。
						</p>
					</div>
					<div class="lg:col-span-2">
						<label
							class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500"
							for="proxy-extra-headers"
						>
							额外注入请求头 (JSON)
						</label>
						<textarea
							class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 font-mono text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
							id="proxy-extra-headers"
							name="proxy_extra_headers"
							rows={3}
							placeholder='{"X-Trace-Id": "zen", "X-Env": "prod"}'
							value={settingsForm.proxy_extra_headers}
							onInput={(event) => {
								const target =
									event.currentTarget as HTMLTextAreaElement | null;
								onFormChange({
									proxy_extra_headers: target?.value ?? "",
								});
							}}
						/>
						<p class="mt-1 text-xs text-stone-500">
							仅对计费代理请求（/v1 与 /anthropic/v1）生效，Playground
							对话测试与渠道连通性测试不套用。同名头优先级：渠道级自定义请求头
							&gt; 全局注入 &gt; 系统内置头；覆盖 Authorization / x-api-key
							等鉴权头可能导致上游 401，请谨慎配置。
						</p>
					</div>
					<div class="lg:col-span-2">
						<label
							class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500"
							for="proxy-remove-headers"
						>
							剔除请求头 (JSON)
						</label>
						<textarea
							class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 font-mono text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
							id="proxy-remove-headers"
							name="proxy_remove_headers"
							rows={3}
							placeholder='["user-agent", "x-client-id"]'
							value={settingsForm.proxy_remove_headers}
							onInput={(event) => {
								const target =
									event.currentTarget as HTMLTextAreaElement | null;
								onFormChange({
									proxy_remove_headers: target?.value ?? "",
								});
							}}
						/>
						<p class="mt-1 text-xs text-stone-500">
							JSON
							字符串数组，列出的客户端请求头不会转发给上游。作用范围与优先级同「额外注入请求头」。注意：剔除是无差别的，同名内置鉴权头（如
							Authorization）也会被删除，请勿剔除代理鉴权依赖的头。
						</p>
					</div>
					<div class="flex items-end lg:col-span-2">
						<button
							class="h-11 rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white transition-[transform,box-shadow] duration-200 ease-smooth-out hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60"
							type="submit"
						>
							保存设置
						</button>
					</div>
				</form>
			</div>
			{settingsForm.require_invite_code === "true" && (
				<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
					<div class="mb-4 flex items-center justify-between">
						<h3 class="font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
							邀请码管理
						</h3>
						<button
							type="button"
							class="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 transition-[color,background-color,border-color,box-shadow] hover:border-stone-300 hover:shadow-sm"
							onClick={onExportCodes}
						>
							导出可用码
						</button>
					</div>
					<div class="mb-4 flex flex-wrap items-end gap-3">
						<div>
							<label
								class="mb-1 block text-xs text-stone-500"
								htmlFor="invite-gen-count"
							>
								数量
							</label>
							<input
								id="invite-gen-count"
								type="number"
								min="1"
								max="100"
								class="w-20 rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
								value={genCount}
								onInput={(e) =>
									setGenCount(
										(e.currentTarget as HTMLInputElement)?.value ?? "10",
									)
								}
							/>
						</div>
						<div>
							<label
								class="mb-1 block text-xs text-stone-500"
								htmlFor="invite-gen-max-uses"
							>
								最大使用次数
							</label>
							<input
								id="invite-gen-max-uses"
								type="number"
								min="1"
								class="w-20 rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
								value={genMaxUses}
								onInput={(e) =>
									setGenMaxUses(
										(e.currentTarget as HTMLInputElement)?.value ?? "1",
									)
								}
							/>
						</div>
						<div>
							<label
								class="mb-1 block text-xs text-stone-500"
								htmlFor="invite-gen-prefix"
							>
								前缀
							</label>
							<input
								id="invite-gen-prefix"
								type="text"
								class="w-24 rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
								value={genPrefix}
								onInput={(e) =>
									setGenPrefix(
										(e.currentTarget as HTMLInputElement)?.value ?? "ZEN-",
									)
								}
							/>
						</div>
						<button
							type="button"
							class="h-[34px] rounded-lg bg-stone-900 px-3 text-xs font-semibold text-white transition-shadow hover:shadow-lg"
							onClick={() =>
								onGenerateCodes(
									Number(genCount) || 10,
									Number(genMaxUses) || 1,
									genPrefix || "ZEN-",
								)
							}
						>
							批量生成
						</button>
					</div>
					{inviteCodes.length === 0 ? (
						<p class="py-4 text-center text-sm text-stone-400">暂无邀请码</p>
					) : (
						<div class="overflow-x-auto">
							<table class="w-full text-left text-sm">
								<thead>
									<tr class="border-b border-stone-100 text-xs uppercase tracking-widest text-stone-400">
										<th class="pb-2 pr-4 font-medium">邀请码</th>
										<th class="pb-2 pr-4 font-medium">最大次数</th>
										<th class="pb-2 pr-4 font-medium">已使用</th>
										<th class="pb-2 pr-4 font-medium">状态</th>
										<th class="pb-2 pr-4 font-medium">创建时间</th>
										<th class="pb-2 font-medium">操作</th>
									</tr>
								</thead>
								<tbody>
									{inviteCodes.map((code) => (
										<tr key={code.id} class="border-b border-stone-50">
											<td class="py-2 pr-4 font-['Space_Grotesk'] text-stone-700">
												{code.code}
											</td>
											<td class="py-2 pr-4 text-stone-600">{code.max_uses}</td>
											<td class="py-2 pr-4 text-stone-600">
												{code.used_count}
											</td>
											<td class="py-2 pr-4">
												<span
													class={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
														code.used_count >= code.max_uses
															? "bg-stone-100 text-stone-500"
															: "bg-green-50 text-green-600"
													}`}
												>
													{code.used_count >= code.max_uses ? "已用完" : "可用"}
												</span>
											</td>
											<td class="py-2 pr-4 text-xs text-stone-500">
												{code.created_at?.slice(0, 16)}
											</td>
											<td class="py-2">
												<button
													type="button"
													class="text-xs text-red-500 hover:text-red-700"
													onClick={() => onDeleteCode(code.id)}
												>
													删除
												</button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>
			)}
		</div>
	);
};
