import { useCallback, useEffect, useMemo, useState } from "hono/jsx/dom";
import { createApiFetch } from "../core/api";
import type { ChannelApiFormat, LdohViolation } from "../core/types";
import type { ModelAliasConfig, ModelAliasesMap } from "../UserApp";

type MaintainerSite = {
	id: string;
	name: string;
	api_base_hostname: string;
	maintainer_id: string;
	blocked?: Array<{ id: string; hostname: string }>;
};

type MaintainerChannel = {
	id: string;
	name: string;
	base_url: string;
	status: string;
	user_name?: string;
	linuxdo_username?: string;
	contribution_note?: string | null;
};

type ChannelItem = {
	id: string;
	name: string;
	base_url: string;
	api_key?: string;
	models_json?: string;
	api_format: string;
	status: string;
	charge_enabled?: number | null;
	stream_only?: number | null;
	contribution_note?: string | null;
	created_at: string;
};

type ChannelFormData = {
	name: string;
	base_url: string;
	api_key: string;
	api_format: ChannelApiFormat;
	models: string;
	charge_enabled: boolean;
	stream_only: boolean;
	contribution_note: string;
};

type ModelPricingConfig = {
	input_price: string;
	output_price: string;
};

const emptyForm: ChannelFormData = {
	name: "",
	base_url: "",
	api_key: "",
	api_format: "openai",
	models: "",
	charge_enabled: false,
	stream_only: false,
	contribution_note: "",
};

function parseModelsJsonToText(modelsJson?: string): string {
	if (!modelsJson) return "";
	try {
		const parsed = JSON.parse(modelsJson);
		const arr = Array.isArray(parsed)
			? parsed
			: Array.isArray(parsed?.data)
				? parsed.data
				: [];
		return arr
			.map((m: unknown) => {
				if (typeof m === "string") return m;
				const obj = m as { id?: string };
				return obj?.id ?? "";
			})
			.filter(Boolean)
			.join("\n");
	} catch {
		return "";
	}
}

function parseModelsPricing(
	modelsJson?: string,
): Record<string, ModelPricingConfig> {
	if (!modelsJson) return {};
	try {
		const parsed = JSON.parse(modelsJson);
		const arr = Array.isArray(parsed)
			? parsed
			: Array.isArray(parsed?.data)
				? parsed.data
				: [];
		const result: Record<string, ModelPricingConfig> = {};
		for (const m of arr) {
			if (typeof m === "object" && m !== null && m.id) {
				const ip = m.input_price;
				const op = m.output_price;
				if (ip != null || op != null) {
					result[m.id] = {
						input_price: ip != null ? String(ip) : "",
						output_price: op != null ? String(op) : "",
					};
				}
			}
		}
		return result;
	} catch {
		return {};
	}
}

type UserChannelsViewProps = {
	token: string;
	updateToken: (next: string | null) => void;
	channels: ChannelItem[];
	channelAliases: Record<string, ModelAliasesMap>;
	onRefresh: () => Promise<void>;
	channelReviewEnabled: boolean;
};

export const UserChannelsView = ({
	token,
	updateToken,
	channels,
	channelAliases,
	onRefresh,
	channelReviewEnabled,
}: UserChannelsViewProps) => {
	const [showModal, setShowModal] = useState(false);
	const [editingChannel, setEditingChannel] = useState<ChannelItem | null>(
		null,
	);
	const [notice, setNotice] = useState("");
	const [form, setForm] = useState<ChannelFormData>({ ...emptyForm });
	// Per-model alias state: Record<modelId, { aliases, alias_only }>
	const [aliasState, setAliasState] = useState<
		Record<string, ModelAliasConfig>
	>({});
	// Per-model pricing state: Record<modelId, { input_price, output_price }>
	const [pricingState, setPricingState] = useState<
		Record<string, ModelPricingConfig>
	>({});
	// Track which models have their alias editor expanded
	const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());
	// Maintainer panel state
	const [mySites, setMySites] = useState<MaintainerSite[]>([]);
	const [siteChannels, setSiteChannels] = useState<
		Record<string, MaintainerChannel[]>
	>({});
	const [siteViolations, setSiteViolations] = useState<
		Record<string, LdohViolation[]>
	>({});
	const [claimUrl, setClaimUrl] = useState("");
	const [claimNotice, setClaimNotice] = useState("");
	const [maintainerNotice, setMaintainerNotice] = useState("");

	const apiFetch = useMemo(
		() => createApiFetch(token, () => updateToken(null)),
		[token, updateToken],
	);

	const loadMySites = useCallback(async () => {
		try {
			const result = await apiFetch<{ sites: MaintainerSite[] }>(
				"/api/u/ldoh/my-sites",
			);
			// Load channels & violations for each site before updating state
			const chMap: Record<string, MaintainerChannel[]> = {};
			const vMap: Record<string, LdohViolation[]> = {};
			for (const site of result.sites) {
				try {
					const chResult = await apiFetch<{ channels: MaintainerChannel[] }>(
						`/api/u/ldoh/sites/${site.id}/channels`,
					);
					chMap[site.id] = chResult.channels;
				} catch {
					chMap[site.id] = [];
				}
				try {
					const vResult = await apiFetch<{ violations: LdohViolation[] }>(
						`/api/u/ldoh/sites/${site.id}/violations`,
					);
					vMap[site.id] = vResult.violations;
				} catch {
					vMap[site.id] = [];
				}
			}
			// Batch all state updates together to avoid intermediate re-renders
			setSiteChannels(chMap);
			setSiteViolations(vMap);
			setMySites(result.sites);
		} catch {
			/* ignore */
		}
	}, [apiFetch]);

	useEffect(() => {
		loadMySites();
	}, [loadMySites]);

	const handleBlock = useCallback(
		async (siteId: string) => {
			try {
				await apiFetch(`/api/u/ldoh/sites/${siteId}/block`, { method: "POST" });
				setMaintainerNotice("已封禁");
				await loadMySites();
			} catch (error) {
				setMaintainerNotice((error as Error).message);
			}
		},
		[apiFetch, loadMySites],
	);

	const handleUnblock = useCallback(
		async (siteId: string) => {
			try {
				await apiFetch(`/api/u/ldoh/sites/${siteId}/block`, {
					method: "DELETE",
				});
				setMaintainerNotice("已解封");
				await loadMySites();
			} catch (error) {
				setMaintainerNotice((error as Error).message);
			}
		},
		[apiFetch, loadMySites],
	);

	const handleMaintainerApproveChannel = useCallback(
		async (channelId: string) => {
			try {
				await apiFetch(`/api/u/ldoh/channels/${channelId}/approve`, {
					method: "POST",
				});
				setMaintainerNotice("渠道已批准");
				await loadMySites();
			} catch (error) {
				setMaintainerNotice((error as Error).message);
			}
		},
		[apiFetch, loadMySites],
	);

	const handleMaintainerRejectChannel = useCallback(
		async (channelId: string) => {
			try {
				await apiFetch(`/api/u/ldoh/channels/${channelId}/reject`, {
					method: "POST",
				});
				setMaintainerNotice("渠道已拒绝");
				await loadMySites();
			} catch (error) {
				setMaintainerNotice((error as Error).message);
			}
		},
		[apiFetch, loadMySites],
	);

	const handleMaintainerDeleteChannel = useCallback(
		async (channelId: string) => {
			if (!window.confirm("确定要删除该渠道吗？")) return;
			try {
				await apiFetch(`/api/u/ldoh/channels/${channelId}`, {
					method: "DELETE",
				});
				setMaintainerNotice("渠道已删除");
				await loadMySites();
			} catch (error) {
				setMaintainerNotice((error as Error).message);
			}
		},
		[apiFetch, loadMySites],
	);

	const handleClaimSite = useCallback(async () => {
		if (!claimUrl.trim()) {
			setClaimNotice("请输入 API Base URL");
			return;
		}
		try {
			const result = await apiFetch<{ ok?: boolean; message?: string }>(
				"/api/u/ldoh/claim-site",
				{
					method: "POST",
					body: JSON.stringify({ apiBaseUrl: claimUrl.trim() }),
				},
			);
			setClaimNotice(result.message || "声明已提交");
			setClaimUrl("");
			await loadMySites();
		} catch (error) {
			setClaimNotice((error as Error).message);
		}
	}, [apiFetch, claimUrl, loadMySites]);

	const openCreate = useCallback(() => {
		setEditingChannel(null);
		setForm({ ...emptyForm });
		setAliasState({});
		setPricingState({});
		setExpandedModels(new Set());
		setShowModal(true);
		setNotice("");
	}, []);

	const openEdit = useCallback(
		(ch: ChannelItem) => {
			setEditingChannel(ch);
			setForm({
				name: ch.name ?? "",
				base_url: ch.base_url ?? "",
				api_key: ch.api_key ?? "",
				api_format: (ch.api_format ?? "openai") as ChannelApiFormat,
				models: parseModelsJsonToText(ch.models_json),
				charge_enabled: ch.charge_enabled === 1,
				stream_only: ch.stream_only === 1,
				contribution_note: ch.contribution_note ?? "",
			});
			// Initialize alias state from per-channel aliases for this channel
			const perChannelMap = channelAliases[ch.id] ?? {};
			const models = parseModelsJsonToText(ch.models_json)
				.split("\n")
				.map((l) => l.trim())
				.filter(Boolean);
			const initial: Record<string, ModelAliasConfig> = {};
			for (const m of models) {
				if (perChannelMap[m]) {
					initial[m] = {
						aliases: [...perChannelMap[m].aliases],
						alias_only: perChannelMap[m].alias_only,
					};
				}
			}
			setAliasState(initial);
			// Initialize pricing state from models_json
			setPricingState(parseModelsPricing(ch.models_json));
			setExpandedModels(new Set());
			setShowModal(true);
			setNotice("");
		},
		[channelAliases],
	);

	const closeModal = useCallback(() => {
		setShowModal(false);
		setEditingChannel(null);
		setForm({ ...emptyForm });
		setAliasState({});
		setPricingState({});
		setExpandedModels(new Set());
	}, []);

	const handleSubmit = useCallback(
		async (e: Event) => {
			e.preventDefault();
			try {
				const models = form.models
					.split("\n")
					.map((l) => l.trim())
					.filter(Boolean)
					.map((id) => {
						const pricing = pricingState[id];
						const entry: {
							id: string;
							input_price?: number;
							output_price?: number;
						} = { id };
						if (pricing) {
							if (pricing.input_price !== "")
								entry.input_price = Number(pricing.input_price);
							if (pricing.output_price !== "")
								entry.output_price = Number(pricing.output_price);
						}
						return entry;
					});
				// Build model_aliases payload: only include models that have aliases configured
				const modelAliasPayload: Record<string, ModelAliasConfig> = {};
				const modelIds = models.map((m) => m.id);
				for (const mid of modelIds) {
					const cfg = aliasState[mid];
					if (cfg) {
						modelAliasPayload[mid] = cfg;
					}
				}
				const payload = {
					name: form.name.trim(),
					base_url: form.base_url.trim(),
					api_key: form.api_key.trim(),
					api_format: form.api_format,
					models: models.length > 0 ? models : undefined,
					model_aliases:
						Object.keys(modelAliasPayload).length > 0
							? modelAliasPayload
							: undefined,
					charge_enabled: form.charge_enabled,
					stream_only: form.stream_only,
					contribution_note: form.contribution_note.trim() || undefined,
				};
				if (editingChannel) {
					await apiFetch(`/api/u/channels/${editingChannel.id}`, {
						method: "PATCH",
						body: JSON.stringify(payload),
					});
					setNotice("渠道已更新");
				} else {
					await apiFetch("/api/u/channels", {
						method: "POST",
						body: JSON.stringify(payload),
					});
					setNotice("渠道已贡献");
				}
				closeModal();
				await onRefresh();
			} catch (error) {
				const msg = (error as Error).message;
				if (msg === "hostname_blocked") {
					closeModal();
					setNotice("该 API 地址已被站点维护者封禁，无法提交。");
				} else {
					setNotice(msg);
				}
			}
		},
		[
			apiFetch,
			form,
			aliasState,
			pricingState,
			editingChannel,
			closeModal,
			onRefresh,
		],
	);

	const handleDelete = useCallback(
		async (id: string) => {
			if (!window.confirm("确定要删除该渠道吗？此操作不可撤销。")) return;
			try {
				await apiFetch(`/api/u/channels/${id}`, { method: "DELETE" });
				setNotice("渠道已删除");
				await onRefresh();
			} catch (error) {
				setNotice((error as Error).message);
			}
		},
		[apiFetch, onRefresh],
	);

	const isEditing = Boolean(editingChannel);

	// Parse models from textarea in real-time for the alias editor
	const parsedModels = useMemo(
		() =>
			form.models
				.split("\n")
				.map((l) => l.trim())
				.filter(Boolean),
		[form.models],
	);

	const toggleModelExpanded = useCallback((modelId: string) => {
		setExpandedModels((prev) => {
			const next = new Set(prev);
			if (next.has(modelId)) {
				next.delete(modelId);
			} else {
				next.add(modelId);
			}
			return next;
		});
	}, []);

	const addAlias = useCallback((modelId: string, alias: string) => {
		const trimmed = alias.trim();
		if (!trimmed) return;
		setAliasState((prev) => {
			const existing = prev[modelId] ?? { aliases: [], alias_only: false };
			if (existing.aliases.includes(trimmed)) return prev;
			return {
				...prev,
				[modelId]: {
					...existing,
					aliases: [...existing.aliases, trimmed],
				},
			};
		});
	}, []);

	const removeAlias = useCallback((modelId: string, index: number) => {
		setAliasState((prev) => {
			const existing = prev[modelId];
			if (!existing) return prev;
			return {
				...prev,
				[modelId]: {
					...existing,
					aliases: existing.aliases.filter((_, i) => i !== index),
				},
			};
		});
	}, []);

	const toggleAliasOnly = useCallback((modelId: string, checked: boolean) => {
		setAliasState((prev) => {
			const existing = prev[modelId] ?? { aliases: [], alias_only: false };
			return {
				...prev,
				[modelId]: { ...existing, alias_only: checked },
			};
		});
	}, []);

	return (
		<div key={`ucv-${mySites.length}`} class="space-y-5">
			{/* Maintainer panel */}
			<div
				key="maintainer-panel"
				class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg"
			>
				<h3 class="mb-4 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
					站点维护
				</h3>
				{maintainerNotice && (
					<div class="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
						{maintainerNotice}
					</div>
				)}
				{mySites.length > 0 ? (
					<div key="sites-list" class="space-y-4">
						{mySites.map((site) => {
							const isBlocked = (site.blocked ?? []).length > 0;
							const channels = siteChannels[site.id] ?? [];
							const pendingChs = channels.filter(
								(ch) => ch.status === "pending",
							);
							const violations = siteViolations[site.id] ?? [];
							return (
								<div
									key={site.id}
									class="rounded-xl border border-stone-200 p-4"
								>
									<div class="flex items-center justify-between mb-3">
										<div>
											<span class="font-medium text-stone-700">
												{site.name}
											</span>
											<span class="ml-2 text-xs text-stone-400">
												{site.api_base_hostname}
											</span>
										</div>
										<div class="flex gap-2">
											{isBlocked ? (
												<button
													type="button"
													class="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100"
													onClick={() => handleUnblock(site.id)}
												>
													解除封禁
												</button>
											) : (
												<button
													type="button"
													class="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50"
													onClick={() => handleBlock(site.id)}
												>
													封禁
												</button>
											)}
										</div>
									</div>
									{isBlocked && (
										<div class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
											此站点 hostname 已被封禁，其他用户无法提交匹配的渠道
										</div>
									)}
									{/* Pending channels for approval */}
									{pendingChs.length > 0 && (
										<div class="mb-3">
											<p class="mb-1 text-xs font-medium text-amber-600">
												待审批渠道 ({pendingChs.length})
											</p>
											<div class="space-y-1">
												{pendingChs.map((ch) => (
													<div
														key={ch.id}
														class="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2"
													>
														<div class="flex items-center justify-between">
															<div>
																<span class="text-sm text-stone-700">
																	{ch.name}
																</span>
																<span class="ml-2 text-xs text-stone-400">
																	{ch.user_name ?? ""}
																</span>
															</div>
															<div class="flex gap-2">
																<button
																	type="button"
																	class="text-xs text-emerald-600 hover:text-emerald-700"
																	onClick={() =>
																		handleMaintainerApproveChannel(ch.id)
																	}
																>
																	批准
																</button>
																<button
																	type="button"
																	class="text-xs text-red-500 hover:text-red-600"
																	onClick={() =>
																		handleMaintainerRejectChannel(ch.id)
																	}
																>
																	拒绝
																</button>
															</div>
														</div>
														{ch.contribution_note && (
															<p class="mt-1 text-xs text-stone-500">
																说明：{ch.contribution_note}
															</p>
														)}
													</div>
												))}
											</div>
										</div>
									)}
									{/* All matching channels */}
									<div class="mb-3">
										<p class="mb-1 text-xs font-medium text-stone-500">
											匹配渠道 ({channels.length})
										</p>
										{channels.length > 0 ? (
											<div class="overflow-x-auto">
												<table class="w-full text-left text-xs">
													<thead>
														<tr class="border-b border-stone-100 text-stone-400">
															<th class="pb-1 pr-3 font-medium">名称</th>
															<th class="pb-1 pr-3 font-medium">状态</th>
															<th class="pb-1 pr-3 font-medium">提交者</th>
															<th class="pb-1 font-medium">操作</th>
														</tr>
													</thead>
													<tbody>
														{channels.map((ch) => (
															<tr key={ch.id} class="border-b border-stone-50">
																<td class="py-1.5 pr-3 text-stone-700">
																	{ch.name}
																</td>
																<td class="py-1.5 pr-3">
																	<span
																		class={`rounded-full px-2 py-0.5 text-xs ${ch.status === "active" ? "bg-emerald-50 text-emerald-600" : ch.status === "pending" ? "bg-amber-50 text-amber-600" : "bg-stone-100 text-stone-500"}`}
																	>
																		{ch.status}
																	</span>
																</td>
																<td class="py-1.5 pr-3 text-stone-500">
																	{ch.user_name ?? "-"}
																</td>
																<td class="py-1.5">
																	<button
																		type="button"
																		class="text-xs text-red-500 hover:text-red-600"
																		onClick={() =>
																			handleMaintainerDeleteChannel(ch.id)
																		}
																	>
																		删除
																	</button>
																</td>
															</tr>
														))}
													</tbody>
												</table>
											</div>
										) : (
											<p class="text-xs text-stone-400">暂无</p>
										)}
									</div>
									{/* Violations */}
									<div>
										<p class="mb-1 text-xs font-medium text-red-500">
											违规记录 ({violations.length})
										</p>
										{violations.length > 0 ? (
											<div class="space-y-1">
												{violations.map((v) => (
													<div
														key={v.id}
														class="rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-600"
													>
														{v.user_name} ({v.linuxdo_username ?? "-"}) 尝试提交{" "}
														{v.attempted_base_url} -{" "}
														{v.created_at?.slice(0, 16)}
													</div>
												))}
											</div>
										) : (
											<p class="text-xs text-stone-400">暂无</p>
										)}
									</div>
								</div>
							);
						})}
					</div>
				) : (
					<p key="sites-empty" class="text-sm text-stone-400">
						你暂未维护任何公益站
					</p>
				)}
				{/* Claim site */}
				<div key="claim" class="mt-4 border-t border-stone-100 pt-4">
					<p class="mb-2 text-xs font-medium text-stone-500">声明维护站点</p>
					{claimNotice && (
						<div class="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
							{claimNotice}
						</div>
					)}
					<div class="flex gap-2">
						<input
							class="flex-1 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
							type="url"
							placeholder="输入你的公益站 API Base URL"
							value={claimUrl}
							onInput={(e) =>
								setClaimUrl((e.currentTarget as HTMLInputElement)?.value ?? "")
							}
						/>
						<button
							type="button"
							class="rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition-all hover:shadow-lg"
							onClick={handleClaimSite}
						>
							声明
						</button>
					</div>
					<p class="mt-1 text-xs text-stone-400">
						声明后需等待管理员审批才能获得维护者权限
					</p>
				</div>
			</div>

			{/* Channels table */}
			<div
				key="channels-panel"
				class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg"
			>
				{channelReviewEnabled && (
					<div class="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
						禁止分发其他公益站的 API。提交的渠道需要管理员审核后才能启用。
					</div>
				)}
				<div class="mb-4 flex items-center justify-between">
					<div class="flex items-center gap-3">
						<h3 class="font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
							贡献渠道
						</h3>
						<span class="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-500">
							{channels.length} 个
						</span>
					</div>
					<button
						class="h-10 rounded-lg bg-stone-900 px-4 text-sm font-semibold text-white transition-all hover:shadow-lg"
						type="button"
						onClick={openCreate}
					>
						添加渠道
					</button>
				</div>

				{notice && (
					<div class="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
						{notice}
					</div>
				)}

				{channels.length === 0 ? (
					<p class="py-8 text-center text-sm text-stone-400">
						暂无贡献渠道，点击上方按钮贡献。
					</p>
				) : (
					<div class="overflow-x-auto">
						<table class="w-full text-left text-sm">
							<thead>
								<tr class="border-b border-stone-100 text-xs uppercase tracking-widest text-stone-400">
									<th class="pb-2 pr-4 font-medium">名称</th>
									<th class="pb-2 pr-4 font-medium">格式</th>
									<th class="pb-2 pr-4 font-medium">状态</th>
									<th class="pb-2 pr-4 font-medium">收费</th>
									<th class="pb-2 font-medium">操作</th>
								</tr>
							</thead>
							<tbody>
								{channels.map((ch) => (
									<tr class="border-b border-stone-50">
										<td class="py-2.5 pr-4 font-medium text-stone-700">
											{ch.name}
										</td>
										<td class="py-2.5 pr-4 text-stone-600">{ch.api_format}</td>
										<td class="py-2.5 pr-4">
											<span
												class={`rounded-full px-2 py-0.5 text-xs ${
													ch.status === "active"
														? "bg-emerald-50 text-emerald-600"
														: "bg-stone-100 text-stone-500"
												}`}
											>
												{ch.status === "active" ? "启用" : "停用"}
											</span>
										</td>
										<td class="py-2.5 pr-4">
											<span
												class={`rounded-full px-2 py-0.5 text-xs ${
													ch.charge_enabled === 1
														? "bg-amber-50 text-amber-600"
														: "bg-stone-100 text-stone-400"
												}`}
											>
												{ch.charge_enabled === 1 ? "已启用" : "未启用"}
											</span>
										</td>
										<td class="py-2.5">
											<div class="flex gap-2">
												<button
													type="button"
													class="text-xs text-amber-600 hover:text-amber-700"
													onClick={() => openEdit(ch)}
												>
													编辑
												</button>
												<button
													type="button"
													class="text-xs text-red-500 hover:text-red-600"
													onClick={() => handleDelete(ch.id)}
												>
													删除
												</button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}

				{/* Create / Edit modal */}
				{showModal && (
					<div class="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-stone-900/40 px-0 md:px-4 py-0 md:py-8">
						<div class="relative z-10 w-full max-w-lg rounded-t-2xl md:rounded-2xl border border-stone-200 bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
							<h3 class="mb-4 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
								{isEditing ? "编辑渠道" : "贡献渠道"}
							</h3>
							<form class="grid gap-4" onSubmit={handleSubmit}>
								<div>
									<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
										渠道名称
									</label>
									<input
										class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
										type="text"
										required
										value={form.name}
										onInput={(e) =>
											setForm((prev) => ({
												...prev,
												name:
													(e.currentTarget as HTMLInputElement)?.value ?? "",
											}))
										}
									/>
								</div>
								<div>
									<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
										{form.api_format === "custom"
											? "完整请求 URL"
											: "Base URL（含版本路径，如 /v1）"}
									</label>
									<input
										class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
										type="url"
										required
										placeholder={
											form.api_format === "anthropic"
												? "https://api.anthropic.com/anthropic"
												: form.api_format === "custom"
													? "https://example.com/v1/chat/completions"
													: "https://api.openai.com/v1"
										}
										value={form.base_url}
										onInput={(e) =>
											setForm((prev) => ({
												...prev,
												base_url:
													(e.currentTarget as HTMLInputElement)?.value ?? "",
											}))
										}
									/>
								</div>
								<div>
									<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
										API Key
									</label>
									<textarea
										class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200 font-mono"
										rows={3}
										placeholder={
											isEditing ? "留空不修改" : "每行一个 API Key（可留空）"
										}
										value={form.api_key}
										onInput={(e) =>
											setForm((prev) => ({
												...prev,
												api_key:
													(e.currentTarget as HTMLTextAreaElement)?.value ?? "",
											}))
										}
									/>
								</div>
								<div>
									<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
										API 格式
									</label>
									<select
										class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
										value={form.api_format}
										onChange={(e) =>
											setForm((prev) => ({
												...prev,
												api_format: (e.currentTarget as HTMLSelectElement)
													?.value as ChannelApiFormat,
											}))
										}
									>
										<option
											value="openai"
											selected={form.api_format === "openai"}
										>
											OpenAI
										</option>
										<option
											value="anthropic"
											selected={form.api_format === "anthropic"}
										>
											Anthropic
										</option>
										<option
											value="custom"
											selected={form.api_format === "custom"}
										>
											Custom
										</option>
									</select>
								</div>
								<div>
									<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
										模型列表（每行一个）
									</label>
									<textarea
										class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
										rows={4}
										value={form.models}
										onInput={(e) =>
											setForm((prev) => ({
												...prev,
												models:
													(e.currentTarget as HTMLTextAreaElement)?.value ?? "",
											}))
										}
									/>
								</div>
								{/* Per-model alias editor */}
								{parsedModels.length > 0 && (
									<div>
										<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
											模型定价及别名配置
										</label>
										<div class="space-y-1">
											{parsedModels.map((modelId) => {
												const config = aliasState[modelId];
												const aliasCount = config?.aliases?.length ?? 0;
												const isExpanded = expandedModels.has(modelId);
												return (
													<div class="rounded-lg border border-stone-200">
														<button
															type="button"
															class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-stone-50"
															onClick={() => toggleModelExpanded(modelId)}
														>
															<span class="text-xs text-stone-400">
																{isExpanded ? "▼" : "▶"}
															</span>
															<span class="flex-1 truncate font-mono text-xs text-stone-800">
																{modelId}
															</span>
															{aliasCount > 0 && (
																<span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
																	{aliasCount} 个别名
																</span>
															)}
														</button>
														{isExpanded && (
															<div class="border-t border-stone-100 px-3 py-2.5">
																{/* Existing aliases */}
																{config?.aliases &&
																	config.aliases.length > 0 && (
																		<div class="mb-2 space-y-1.5">
																			{config.aliases.map((alias, index) => (
																				<div class="flex items-center gap-2 rounded border border-stone-100 bg-stone-50 px-2 py-1.5">
																					<span class="flex-1 break-all font-mono text-xs text-stone-700">
																						{alias}
																					</span>
																					<button
																						type="button"
																						class="rounded px-1.5 py-0.5 text-xs text-red-400 hover:bg-red-50 hover:text-red-600"
																						onClick={() =>
																							removeAlias(modelId, index)
																						}
																					>
																						删除
																					</button>
																				</div>
																			))}
																		</div>
																	)}
																{/* Add new alias */}
																<div class="flex gap-1.5">
																	<input
																		type="text"
																		class="flex-1 rounded border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-200"
																		placeholder="输入别名..."
																		onKeyDown={(e) => {
																			if (e.key === "Enter") {
																				e.preventDefault();
																				const input =
																					e.currentTarget as HTMLInputElement;
																				addAlias(modelId, input.value);
																				input.value = "";
																			}
																		}}
																	/>
																	<button
																		type="button"
																		class="rounded border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50"
																		onClick={(e) => {
																			const input = (
																				e.currentTarget as HTMLElement
																			)
																				.previousElementSibling as HTMLInputElement;
																			addAlias(modelId, input.value);
																			input.value = "";
																		}}
																	>
																		添加
																	</button>
																</div>
																{/* Alias-only checkbox */}
																{(config?.aliases?.length ?? 0) > 0 && (
																	<label class="mt-2 flex cursor-pointer items-center gap-2 rounded border border-stone-100 bg-stone-50 px-2 py-1.5">
																		<input
																			type="checkbox"
																			checked={config?.alias_only ?? false}
																			onChange={(e) =>
																				toggleAliasOnly(
																					modelId,
																					(e.currentTarget as HTMLInputElement)
																						.checked,
																				)
																			}
																			class="accent-amber-500"
																		/>
																		<span class="text-xs text-stone-700">
																			仅限别名
																		</span>
																		<span class="text-xs text-stone-400">
																			— 隐藏原始模型名
																		</span>
																	</label>
																)}
																{/* Per-model pricing */}
																<div class="mt-2 flex items-center gap-2">
																	<span class="text-xs text-stone-500 whitespace-nowrap">
																		价格 ($/M):
																	</span>
																	<input
																		type="number"
																		class="w-20 rounded border border-stone-200 bg-white px-2 py-1 text-xs text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-200"
																		placeholder="输入"
																		min="0"
																		step="any"
																		value={
																			pricingState[modelId]?.input_price ?? ""
																		}
																		onInput={(e) => {
																			const val = (
																				e.currentTarget as HTMLInputElement
																			).value;
																			setPricingState((prev) => ({
																				...prev,
																				[modelId]: {
																					input_price: val,
																					output_price:
																						prev[modelId]?.output_price ?? "",
																				},
																			}));
																		}}
																	/>
																	<input
																		type="number"
																		class="w-20 rounded border border-stone-200 bg-white px-2 py-1 text-xs text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-200"
																		placeholder="输出"
																		min="0"
																		step="any"
																		value={
																			pricingState[modelId]?.output_price ?? ""
																		}
																		onInput={(e) => {
																			const val = (
																				e.currentTarget as HTMLInputElement
																			).value;
																			setPricingState((prev) => ({
																				...prev,
																				[modelId]: {
																					input_price:
																						prev[modelId]?.input_price ?? "",
																					output_price: val,
																				},
																			}));
																		}}
																	/>
																</div>
															</div>
														)}
													</div>
												);
											})}
										</div>
									</div>
								)}
								{/* Contribution note */}
								{channelReviewEnabled && (
									<div>
										<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
											贡献说明
										</label>
										<textarea
											class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
											rows={2}
											placeholder="简要说明渠道来源（审核时参考）"
											value={form.contribution_note}
											onInput={(e) =>
												setForm((prev) => ({
													...prev,
													contribution_note:
														(e.currentTarget as HTMLTextAreaElement)?.value ??
														"",
												}))
											}
										/>
									</div>
								)}
								{/* Charge toggle */}
								<div class="border-t border-stone-100 pt-3 space-y-3">
									<label class="flex items-center gap-2 text-sm text-stone-700">
										<input
											type="checkbox"
											class="h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-amber-400"
											checked={form.charge_enabled}
											onChange={(e) =>
												setForm((prev) => ({
													...prev,
													charge_enabled: (e.currentTarget as HTMLInputElement)
														.checked,
												}))
											}
										/>
										启用收费
									</label>
									<p class="ml-6 text-xs text-stone-500">
										开启后，其他用户调用此渠道的模型时产生的费用将计入你的余额（需管理员开启全局收费开关）
									</p>
									<label class="flex items-center gap-2 text-sm text-stone-700">
										<input
											type="checkbox"
											class="h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-amber-400"
											checked={form.stream_only}
											onChange={(e) =>
												setForm((prev) => ({
													...prev,
													stream_only: (e.currentTarget as HTMLInputElement)
														.checked,
												}))
											}
										/>
										仅流式调用
									</label>
									<p class="ml-6 text-xs text-stone-500">
										开启后，非流式请求不会路由到此渠道
									</p>
								</div>
								<div class="flex justify-end gap-3">
									<button
										type="button"
										class="h-10 rounded-lg border border-stone-200 px-4 text-sm text-stone-500 hover:text-stone-900"
										onClick={closeModal}
									>
										取消
									</button>
									<button
										type="submit"
										class="h-10 rounded-lg bg-stone-900 px-4 text-sm font-semibold text-white transition-all hover:shadow-lg"
									>
										{isEditing ? "保存修改" : "提交"}
									</button>
								</div>
							</form>
						</div>
					</div>
				)}
			</div>
		</div>
	);
};
