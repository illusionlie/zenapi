import { useState } from "hono/jsx/dom";
import type { PublicModelItem, Token } from "../core/types";
import { formatDateTime } from "../core/utils";

type UserTokensViewProps = {
	tokens: Token[];
	onCreate: (name: string, allowedChannels?: Record<string, string[]>) => void;
	onUpdate: (
		id: string,
		allowedChannels: Record<string, string[]> | null,
	) => void;
	onDelete: (id: string) => void;
	onReveal: (id: string) => void;
	models?: PublicModelItem[];
	channelSelectionEnabled?: boolean;
};

type ModalMode = { type: "create" } | { type: "edit"; token: Token };

export const UserTokensView = ({
	tokens,
	onCreate,
	onUpdate,
	onDelete,
	onReveal,
	models,
	channelSelectionEnabled,
}: UserTokensViewProps) => {
	const [modalMode, setModalMode] = useState<ModalMode | null>(null);
	const [tokenName, setTokenName] = useState("");
	const [selectedMap, setSelectedMap] = useState<Record<string, string[]>>({});
	const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());
	const [modelSearch, setModelSearch] = useState("");

	const resetModal = () => {
		setModalMode(null);
		setTokenName("");
		setSelectedMap({});
		setExpandedModels(new Set());
		setModelSearch("");
	};

	const openCreate = () => {
		setTokenName("");
		setSelectedMap({});
		setExpandedModels(new Set());
		setModelSearch("");
		setModalMode({ type: "create" });
	};

	const openEdit = (token: Token) => {
		setTokenName(token.name);
		const existing = parseAllowedChannels(token.allowed_channels);
		setSelectedMap(existing ?? {});
		setExpandedModels(new Set());
		setModelSearch("");
		setModalMode({ type: "edit", token });
	};

	const buildCleanedMap = (): Record<string, string[]> | undefined => {
		const cleaned: Record<string, string[]> = {};
		for (const [modelId, chIds] of Object.entries(selectedMap)) {
			if (chIds.length > 0) cleaned[modelId] = chIds;
		}
		return Object.keys(cleaned).length > 0 ? cleaned : undefined;
	};

	const handleCreate = (e: Event) => {
		e.preventDefault();
		if (!tokenName.trim()) return;
		onCreate(tokenName.trim(), buildCleanedMap());
		resetModal();
	};

	const handleEdit = (e: Event) => {
		e.preventDefault();
		if (!modalMode || modalMode.type !== "edit") return;
		const cleaned = buildCleanedMap();
		onUpdate(modalMode.token.id, cleaned ?? null);
		resetModal();
	};

	const toggleModelChannel = (modelId: string, channelId: string) => {
		setSelectedMap((prev) => {
			const current = prev[modelId] ?? [];
			const next = current.includes(channelId)
				? current.filter((c) => c !== channelId)
				: [...current, channelId];
			return { ...prev, [modelId]: next };
		});
	};

	const toggleModelExpand = (modelId: string) => {
		setExpandedModels((prev) => {
			const next = new Set(prev);
			if (next.has(modelId)) next.delete(modelId);
			else next.add(modelId);
			return next;
		});
	};

	const multiChannelModels = (models ?? []).filter(
		(m) => m.channels.length > 1,
	);
	const showChannelSelection =
		channelSelectionEnabled && multiChannelModels.length > 0;

	const filteredModels = modelSearch
		? multiChannelModels.filter((m) =>
				m.id.toLowerCase().includes(modelSearch.toLowerCase()),
			)
		: multiChannelModels;

	const configuredModelCount = Object.values(selectedMap).filter(
		(v) => v.length > 0,
	).length;

	return (
		<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
			<div class="mb-4 flex items-center justify-between">
				<div class="flex items-center gap-3">
					<h3 class="font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
						我的令牌
					</h3>
					<span class="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-500">
						{tokens.length} 个
					</span>
				</div>
				<button
					class="h-10 rounded-lg bg-stone-900 px-4 text-sm font-semibold text-white transition-all hover:shadow-lg"
					type="button"
					onClick={openCreate}
				>
					创建令牌
				</button>
			</div>

			{tokens.length === 0 ? (
				<p class="py-8 text-center text-sm text-stone-400">
					暂无令牌，点击上方按钮创建。
				</p>
			) : (
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead>
							<tr class="border-b border-stone-100 text-xs uppercase tracking-widest text-stone-400">
								<th class="pb-2 pr-4 font-medium">名称</th>
								<th class="pb-2 pr-4 font-medium">前缀</th>
								<th class="pb-2 pr-4 font-medium">已用配额</th>
								<th class="pb-2 pr-4 font-medium">渠道限定</th>
								<th class="pb-2 pr-4 font-medium">状态</th>
								<th class="pb-2 pr-4 font-medium">创建时间</th>
								<th class="pb-2 font-medium">操作</th>
							</tr>
						</thead>
						<tbody>
							{tokens.map((token) => {
								const channelMap = parseAllowedChannels(token.allowed_channels);
								const modelCount = channelMap
									? Object.keys(channelMap).length
									: 0;
								return (
									<tr class="border-b border-stone-50">
										<td class="py-2.5 pr-4 font-medium text-stone-700">
											{token.name}
										</td>
										<td class="py-2.5 pr-4 font-mono text-xs text-stone-500">
											{token.key_prefix}...
										</td>
										<td class="py-2.5 pr-4 text-stone-600">
											{token.quota_used}
											{token.quota_total != null
												? ` / ${token.quota_total}`
												: " / 无限"}
										</td>
										<td class="py-2.5 pr-4">
											{modelCount > 0 ? (
												<span class="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-600">
													{modelCount} 个模型
												</span>
											) : (
												<span class="text-xs text-stone-400">全部</span>
											)}
										</td>
										<td class="py-2.5 pr-4">
											<span
												class={`rounded-full px-2 py-0.5 text-xs ${
													token.status === "active"
														? "bg-emerald-50 text-emerald-600"
														: "bg-stone-100 text-stone-500"
												}`}
											>
												{token.status === "active" ? "启用" : "停用"}
											</span>
										</td>
										<td class="py-2.5 pr-4 text-xs text-stone-500">
											{formatDateTime(token.created_at)}
										</td>
										<td class="py-2.5">
											<div class="flex gap-2">
												{showChannelSelection && (
													<button
														type="button"
														class="text-xs text-stone-500 hover:text-stone-700"
														onClick={() => openEdit(token)}
													>
														编辑
													</button>
												)}
												<button
													type="button"
													class="text-xs text-amber-600 hover:text-amber-700"
													onClick={() => onReveal(token.id)}
												>
													复制
												</button>
												<button
													type="button"
													class="text-xs text-red-500 hover:text-red-600"
													onClick={() => onDelete(token.id)}
												>
													删除
												</button>
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}

			{/* Create / Edit modal */}
			{modalMode && (
				<div class="fixed inset-0 z-50 flex items-center justify-center">
					<button
						type="button"
						class="absolute inset-0 bg-stone-900/40"
						onClick={resetModal}
					/>
					<div
						class={`relative z-10 w-full ${showChannelSelection ? "max-w-2xl" : "max-w-md"} max-h-[90vh] overflow-y-auto rounded-2xl border border-stone-200 bg-white p-6 shadow-xl`}
					>
						<h3 class="mb-4 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
							{modalMode.type === "create" ? "创建令牌" : "编辑令牌"}
						</h3>
						<form
							onSubmit={modalMode.type === "create" ? handleCreate : handleEdit}
						>
							{modalMode.type === "create" && (
								<div class="mb-4">
									<label
										class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500"
										for="token-name"
									>
										令牌名称
									</label>
									<input
										class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
										id="token-name"
										type="text"
										required
										value={tokenName}
										onInput={(e) =>
											setTokenName(
												(e.currentTarget as HTMLInputElement)?.value ?? "",
											)
										}
									/>
								</div>
							)}
							{modalMode.type === "edit" && (
								<div class="mb-4">
									<p class="text-sm text-stone-600">
										令牌:{" "}
										<span class="font-medium">{modalMode.token.name}</span>
										<span class="ml-2 font-mono text-xs text-stone-400">
											{modalMode.token.key_prefix}...
										</span>
									</p>
								</div>
							)}
							{showChannelSelection && (
								<div class="mb-4">
									<div class="mb-1.5 flex items-center justify-between">
										<label class="block text-xs uppercase tracking-widest text-stone-500">
											按模型限定渠道（可选）
										</label>
										{configuredModelCount > 0 && (
											<span class="text-xs text-amber-600">
												已配置 {configuredModelCount} 个模型
											</span>
										)}
									</div>
									<p class="mb-2 text-xs text-stone-400">
										展开模型后勾选该模型允许使用的渠道，未配置的模型使用全部可用渠道
									</p>
									{multiChannelModels.length > 8 && (
										<input
											class="mb-2 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
											type="text"
											placeholder="搜索模型..."
											value={modelSearch}
											onInput={(e) =>
												setModelSearch(
													(e.currentTarget as HTMLInputElement)?.value ?? "",
												)
											}
										/>
									)}
									<div class="max-h-64 overflow-y-auto rounded-lg border border-stone-200">
										{filteredModels.map((model) => {
											const isExpanded = expandedModels.has(model.id);
											const selected = selectedMap[model.id] ?? [];
											return (
												<div
													key={model.id}
													class="border-b border-stone-100 last:border-b-0"
												>
													<button
														type="button"
														class="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-stone-50"
														onClick={() => toggleModelExpand(model.id)}
													>
														<span class="truncate font-medium text-stone-700">
															{model.id}
														</span>
														<span class="flex shrink-0 items-center gap-2 pl-2">
															{selected.length > 0 && (
																<span class="rounded-full bg-amber-50 px-1.5 py-0.5 text-xs text-amber-600">
																	{selected.length}/{model.channels.length}
																</span>
															)}
															<span class="text-xs text-stone-400">
																{isExpanded ? "▲" : "▼"}
															</span>
														</span>
													</button>
													{isExpanded && (
														<div class="bg-stone-50 px-3 pb-2 pt-1 space-y-0.5">
															{model.channels.map((ch) => (
																<label
																	key={ch.id}
																	class="flex items-center gap-2 rounded px-2 py-1 text-xs text-stone-600 hover:bg-white cursor-pointer"
																>
																	<input
																		type="checkbox"
																		class="h-3.5 w-3.5 rounded border-stone-300 text-amber-500 focus:ring-amber-400"
																		checked={selected.includes(ch.id)}
																		onChange={() =>
																			toggleModelChannel(model.id, ch.id)
																		}
																	/>
																	<span class="truncate">{ch.name}</span>
																	{(ch.input_price != null ||
																		ch.output_price != null) && (
																		<span class="ml-auto shrink-0 text-stone-400">
																			${ch.input_price ?? "-"} / $
																			{ch.output_price ?? "-"}
																		</span>
																	)}
																</label>
															))}
														</div>
													)}
												</div>
											);
										})}
										{filteredModels.length === 0 && (
											<p class="py-4 text-center text-xs text-stone-400">
												{modelSearch ? "未找到匹配的模型" : "无可配置的模型"}
											</p>
										)}
									</div>
								</div>
							)}
							<div class="flex justify-end gap-3">
								<button
									type="button"
									class="h-10 rounded-lg border border-stone-200 px-4 text-sm text-stone-500 hover:text-stone-900"
									onClick={resetModal}
								>
									取消
								</button>
								<button
									type="submit"
									class="h-10 rounded-lg bg-stone-900 px-4 text-sm font-semibold text-white transition-all hover:shadow-lg"
								>
									{modalMode.type === "create" ? "创建" : "保存"}
								</button>
							</div>
						</form>
					</div>
				</div>
			)}
		</div>
	);
};

function parseAllowedChannels(
	val: string | null | undefined,
): Record<string, string[]> | null {
	if (!val) return null;
	try {
		const parsed = JSON.parse(val);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, string[]>;
		}
		return null;
	} catch {
		return null;
	}
}
