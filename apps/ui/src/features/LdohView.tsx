import { useCallback, useState } from "hono/jsx/dom";
import type {
	LdohSite,
	LdohSiteMaintainer,
	LdohViolation,
} from "../core/types";

type LdohViewProps = {
	sites: LdohSite[];
	violations: LdohViolation[];
	pendingMaintainers: LdohSiteMaintainer[];
	pendingChannels: Array<{
		id: string;
		name: string;
		base_url: string;
		status: string;
		user_name?: string;
		site_name?: string;
		contribution_note?: string | null;
	}>;
	onSync: () => Promise<void>;
	onBlockAll: () => Promise<void>;
	onAddSite: (
		apiBaseUrl: string,
		maintainerUsername: string,
		name: string,
	) => Promise<void>;
	onEditSite: (
		id: string,
		data: { name?: string; description?: string; apiBaseUrls?: string },
	) => Promise<void>;
	onDeleteSite: (id: string) => Promise<void>;
	onAddMaintainer: (siteId: string, username: string) => Promise<void>;
	onRemoveMaintainer: (maintainerId: string) => Promise<void>;
	onApproveMaintainer: (id: string) => Promise<void>;
	onRejectMaintainer: (id: string) => Promise<void>;
	onApproveChannel: (id: string) => Promise<void>;
	onRejectChannel: (id: string) => Promise<void>;
};

export const LdohView = ({
	sites,
	violations,
	pendingMaintainers,
	pendingChannels,
	onSync,
	onBlockAll,
	onAddSite,
	onEditSite,
	onDeleteSite,
	onAddMaintainer,
	onRemoveMaintainer,
	onApproveMaintainer,
	onRejectMaintainer,
	onApproveChannel,
	onRejectChannel,
}: LdohViewProps) => {
	const [syncing, setSyncing] = useState(false);
	const [syncNotice, setSyncNotice] = useState("");
	const [addUrl, setAddUrl] = useState("");
	const [addUsername, setAddUsername] = useState("");
	const [addName, setAddName] = useState("");
	const [addNotice, setAddNotice] = useState("");
	const [editingSite, setEditingSite] = useState<LdohSite | null>(null);
	const [editForm, setEditForm] = useState({
		name: "",
		description: "",
		apiBaseUrls: "",
	});
	const [newMaintainer, setNewMaintainer] = useState("");

	const handleSync = useCallback(async () => {
		setSyncing(true);
		setSyncNotice("");
		try {
			await onSync();
			setSyncNotice("同步完成");
		} catch (error) {
			setSyncNotice((error as Error).message);
		} finally {
			setSyncing(false);
		}
	}, [onSync]);

	const handleAddSite = useCallback(async () => {
		if (!addUrl.trim()) {
			setAddNotice("请输入 API Base URL");
			return;
		}
		setAddNotice("");
		try {
			await onAddSite(addUrl.trim(), addUsername.trim(), addName.trim());
			setAddNotice("站点已添加");
			setAddUrl("");
			setAddUsername("");
			setAddName("");
		} catch (error) {
			setAddNotice((error as Error).message);
		}
	}, [onAddSite, addUrl, addUsername, addName]);

	const openEdit = useCallback((site: LdohSite) => {
		setEditingSite(site);
		setEditForm({
			name: site.name,
			description: site.description ?? "",
			apiBaseUrls: (site.api_base_url ?? "")
				.split("\n")
				.filter(Boolean)
				.join("\n"),
		});
		setNewMaintainer("");
	}, []);

	const handleEditSubmit = useCallback(
		async (e: Event) => {
			e.preventDefault();
			if (!editingSite) return;
			await onEditSite(editingSite.id, {
				name: editForm.name.trim(),
				description: editForm.description.trim(),
				apiBaseUrls: editForm.apiBaseUrls.trim(),
			});
			setEditingSite(null);
		},
		[editingSite, editForm, onEditSite],
	);

	const handleAddMaintainerInModal = useCallback(async () => {
		if (!editingSite || !newMaintainer.trim()) return;
		await onAddMaintainer(editingSite.id, newMaintainer.trim());
		setNewMaintainer("");
	}, [editingSite, newMaintainer, onAddMaintainer]);

	const handleRemoveMaintainerInModal = useCallback(
		async (maintainerId: string) => {
			await onRemoveMaintainer(maintainerId);
		},
		[onRemoveMaintainer],
	);

	const handleDelete = useCallback(
		async (id: string) => {
			if (
				!window.confirm(
					"确定要删除该站点吗？关联的维护者、封禁和违规记录将一并删除。",
				)
			)
				return;
			await onDeleteSite(id);
		},
		[onDeleteSite],
	);

	// Refresh editingSite from sites list after maintainer changes
	const currentEditingSite = editingSite
		? (sites.find((s) => s.id === editingSite.id) ?? editingSite)
		: null;

	return (
		<div class="space-y-5">
			{/* Sync header */}
			<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
				<div class="flex items-center justify-between">
					<h3 class="font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
						公益站管理
					</h3>
					<div class="flex gap-2">
						<button
							type="button"
							class="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 transition-all hover:bg-red-100"
							onClick={onBlockAll}
						>
							批量封禁
						</button>
						<button
							type="button"
							disabled={syncing}
							class="rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition-all hover:shadow-lg disabled:opacity-60"
							onClick={handleSync}
						>
							{syncing ? "同步中..." : "同步站点"}
						</button>
					</div>
				</div>
				{syncNotice && (
					<div class="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
						{syncNotice}
					</div>
				)}
			</div>

			{/* Manual add site */}
			<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
				<h3 class="mb-4 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
					手动添加站点
				</h3>
				<div class="flex flex-wrap gap-3">
					<input
						type="text"
						placeholder="API Base URL *"
						value={addUrl}
						onInput={(e) => setAddUrl((e.target as HTMLInputElement).value)}
						class="flex-1 min-w-[200px] rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
					/>
					<input
						type="text"
						placeholder="维护者 LinuxDO 用户名"
						value={addUsername}
						onInput={(e) =>
							setAddUsername((e.target as HTMLInputElement).value)
						}
						class="w-48 rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
					/>
					<input
						type="text"
						placeholder="站点名称（可选）"
						value={addName}
						onInput={(e) => setAddName((e.target as HTMLInputElement).value)}
						class="w-40 rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
					/>
					<button
						type="button"
						class="rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition-all hover:shadow-lg"
						onClick={handleAddSite}
					>
						添加站点
					</button>
				</div>
				{addNotice && (
					<div class="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
						{addNotice}
					</div>
				)}
			</div>

			{/* Pending maintainers */}
			{pendingMaintainers.length > 0 && (
				<div class="rounded-2xl border border-amber-200 bg-white p-5 shadow-lg">
					<h3 class="mb-4 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
						待审批维护者
					</h3>
					<div class="overflow-x-auto">
						<table class="w-full text-left text-sm">
							<thead>
								<tr class="border-b border-stone-100 text-xs uppercase tracking-widest text-stone-400">
									<th class="pb-2 pr-4 font-medium">用户名</th>
									<th class="pb-2 pr-4 font-medium">名称</th>
									<th class="pb-2 pr-4 font-medium">来源</th>
									<th class="pb-2 font-medium">操作</th>
								</tr>
							</thead>
							<tbody>
								{pendingMaintainers.map((m) => (
									<tr key={m.id} class="border-b border-stone-50">
										<td class="py-2 pr-4 font-['Space_Grotesk'] text-stone-700">
											{m.username}
										</td>
										<td class="py-2 pr-4 text-stone-600">{m.name}</td>
										<td class="py-2 pr-4">
											<span
												class={`rounded-full px-2 py-0.5 text-xs ${m.source === "ldoh" ? "bg-blue-50 text-blue-600" : "bg-amber-50 text-amber-600"}`}
											>
												{m.source === "ldoh" ? "LDOH" : "手动"}
											</span>
										</td>
										<td class="py-2">
											<div class="flex gap-2">
												<button
													type="button"
													class="text-xs text-emerald-600 hover:text-emerald-700"
													onClick={() => onApproveMaintainer(m.id)}
												>
													批准
												</button>
												<button
													type="button"
													class="text-xs text-red-500 hover:text-red-600"
													onClick={() => onRejectMaintainer(m.id)}
												>
													拒绝
												</button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{/* Pending channels */}
			{pendingChannels.length > 0 && (
				<div class="rounded-2xl border border-amber-200 bg-white p-5 shadow-lg">
					<h3 class="mb-4 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
						待审批渠道
					</h3>
					<div class="overflow-x-auto">
						<table class="w-full text-left text-sm">
							<thead>
								<tr class="border-b border-stone-100 text-xs uppercase tracking-widest text-stone-400">
									<th class="pb-2 pr-4 font-medium">名称</th>
									<th class="pb-2 pr-4 font-medium">URL</th>
									<th class="pb-2 pr-4 font-medium">提交者</th>
									<th class="pb-2 pr-4 font-medium">说明</th>
									<th class="pb-2 font-medium">操作</th>
								</tr>
							</thead>
							<tbody>
								{pendingChannels.map((ch) => (
									<tr key={ch.id} class="border-b border-stone-50">
										<td class="py-2 pr-4 font-medium text-stone-700">
											{ch.name}
										</td>
										<td class="py-2 pr-4 text-xs text-stone-500 max-w-[200px] truncate">
											{ch.base_url}
										</td>
										<td class="py-2 pr-4 text-stone-600">
											{ch.user_name ?? "-"}
										</td>
										<td class="py-2 pr-4 text-xs text-stone-500 max-w-[200px]">
											{ch.contribution_note || "-"}
										</td>
										<td class="py-2">
											<div class="flex gap-2">
												<button
													type="button"
													class="text-xs text-emerald-600 hover:text-emerald-700"
													onClick={() => onApproveChannel(ch.id)}
												>
													批准
												</button>
												<button
													type="button"
													class="text-xs text-red-500 hover:text-red-600"
													onClick={() => onRejectChannel(ch.id)}
												>
													拒绝
												</button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{/* Sites list */}
			<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
				<h3 class="mb-4 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
					站点列表
				</h3>
				{sites.length === 0 ? (
					<p class="py-8 text-center text-sm text-stone-400">
						暂无站点数据，请先同步。
					</p>
				) : (
					<div class="overflow-x-auto">
						<table class="w-full text-left text-sm">
							<thead>
								<tr class="border-b border-stone-100 text-xs uppercase tracking-widest text-stone-400">
									<th class="pb-2 pr-4 font-medium">名称</th>
									<th class="pb-2 pr-4 font-medium">URL</th>
									<th class="pb-2 pr-4 font-medium">维护者</th>
									<th class="pb-2 pr-4 font-medium">封禁</th>
									<th class="pb-2 pr-4 font-medium">待审</th>
									<th class="pb-2 pr-4 font-medium">违规</th>
									<th class="pb-2 font-medium">操作</th>
								</tr>
							</thead>
							<tbody>
								{sites.map((site) => (
									<tr key={site.id} class="border-b border-stone-50">
										<td class="py-2.5 pr-4">
											<div class="font-medium text-stone-700">{site.name}</div>
											<div class="text-xs text-stone-400">
												{site.source === "ldoh" ? "LDOH" : "手动"}
											</div>
										</td>
										<td class="py-2.5 pr-4 text-xs text-stone-500 max-w-[200px]">
											{String(site.api_base_hostname ?? "")
												.split(",")
												.map((h, i) => (
													<div key={i} class="truncate">
														{h.trim()}
													</div>
												))}
										</td>
										<td class="py-2.5 pr-4">
											{(site.maintainers ?? []).map((m) => (
												<span
													key={m.id}
													class={`mr-1 inline-flex rounded-full px-2 py-0.5 text-xs ${
														m.approved
															? "bg-emerald-50 text-emerald-600"
															: "bg-amber-50 text-amber-600"
													}`}
												>
													{m.username}
													{m.approved ? "" : " (待审)"}
												</span>
											))}
										</td>
										<td class="py-2.5 pr-4">
											{(site.blocked ?? []).length > 0 ? (
												<span class="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-600">
													已封禁
												</span>
											) : (
												<span class="text-xs text-stone-400">-</span>
											)}
										</td>
										<td class="py-2.5 pr-4 font-['Space_Grotesk'] text-stone-600">
											{site.pending_channels ?? 0}
										</td>
										<td class="py-2.5 font-['Space_Grotesk'] text-stone-600">
											{site.violation_count ?? 0}
										</td>
										<td class="py-2.5">
											<div class="flex gap-2 whitespace-nowrap">
												<button
													type="button"
													class="text-xs text-amber-600 hover:text-amber-700"
													onClick={() => openEdit(site)}
												>
													编辑
												</button>
												<button
													type="button"
													class="text-xs text-red-500 hover:text-red-600"
													onClick={() => handleDelete(site.id)}
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
			</div>

			{/* Violations */}
			{violations.length > 0 && (
				<div class="rounded-2xl border border-red-200 bg-white p-5 shadow-lg">
					<h3 class="mb-4 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
						违规记录
					</h3>
					<div class="overflow-x-auto">
						<table class="w-full text-left text-sm">
							<thead>
								<tr class="border-b border-stone-100 text-xs uppercase tracking-widest text-stone-400">
									<th class="pb-2 pr-4 font-medium">用户</th>
									<th class="pb-2 pr-4 font-medium">LinuxDO</th>
									<th class="pb-2 pr-4 font-medium">尝试 URL</th>
									<th class="pb-2 pr-4 font-medium">匹配站点</th>
									<th class="pb-2 font-medium">时间</th>
								</tr>
							</thead>
							<tbody>
								{violations.map((v) => (
									<tr key={v.id} class="border-b border-stone-50">
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

			{/* Edit site modal */}
			{currentEditingSite && (
				<div class="fixed inset-0 z-50 flex items-center justify-center">
					<button
						type="button"
						class="absolute inset-0 bg-stone-900/40"
						onClick={() => setEditingSite(null)}
					/>
					<div class="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-stone-200 bg-white p-6 shadow-xl">
						<h3 class="mb-4 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
							编辑站点: {currentEditingSite.name}
						</h3>
						<form class="grid gap-4" onSubmit={handleEditSubmit}>
							<div>
								<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
									名称
								</label>
								<input
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
									type="text"
									required
									value={editForm.name}
									onInput={(e) =>
										setEditForm((p) => ({
											...p,
											name: (e.currentTarget as HTMLInputElement)?.value ?? "",
										}))
									}
								/>
							</div>
							<div>
								<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
									描述
								</label>
								<textarea
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
									rows={3}
									value={editForm.description}
									onInput={(e) =>
										setEditForm((p) => ({
											...p,
											description:
												(e.currentTarget as HTMLTextAreaElement)?.value ?? "",
										}))
									}
								/>
							</div>
							<div>
								<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
									API Base URL（一行一个）
								</label>
								<textarea
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm font-mono text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
									rows={3}
									required
									value={editForm.apiBaseUrls}
									onInput={(e) =>
										setEditForm((p) => ({
											...p,
											apiBaseUrls:
												(e.currentTarget as HTMLTextAreaElement)?.value ?? "",
										}))
									}
								/>
							</div>

							{/* Maintainer management */}
							<div>
								<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
									维护者
								</label>
								<div class="space-y-2">
									{(currentEditingSite.maintainers ?? []).map((m) => (
										<div
											key={m.id}
											class="flex items-center justify-between rounded-lg border border-stone-100 px-3 py-2"
										>
											<div class="flex items-center gap-2">
												<span class="text-sm text-stone-700">{m.username}</span>
												<span
													class={`rounded-full px-2 py-0.5 text-xs ${
														m.approved
															? "bg-emerald-50 text-emerald-600"
															: "bg-amber-50 text-amber-600"
													}`}
												>
													{m.source === "ldoh" ? "LDOH" : "手动"}
													{m.approved ? "" : " (待审)"}
												</span>
											</div>
											<button
												type="button"
												class="text-xs text-red-500 hover:text-red-600"
												onClick={() => handleRemoveMaintainerInModal(m.id)}
											>
												删除
											</button>
										</div>
									))}
									{(currentEditingSite.maintainers ?? []).length === 0 && (
										<p class="text-xs text-stone-400">暂无维护者</p>
									)}
									<div class="flex gap-2 mt-2">
										<input
											type="text"
											placeholder="LinuxDO 用户名或主页链接"
											value={newMaintainer}
											onInput={(e) =>
												setNewMaintainer((e.target as HTMLInputElement).value)
											}
											class="flex-1 rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
										/>
										<button
											type="button"
											class="rounded-lg bg-stone-800 px-3 py-2 text-xs font-semibold text-white hover:bg-stone-700"
											onClick={handleAddMaintainerInModal}
										>
											添加
										</button>
									</div>
								</div>
							</div>

							<div class="flex justify-end gap-3">
								<button
									type="button"
									class="h-10 rounded-lg border border-stone-200 px-4 text-sm text-stone-500 hover:text-stone-900"
									onClick={() => setEditingSite(null)}
								>
									取消
								</button>
								<button
									type="submit"
									class="h-10 rounded-lg bg-stone-900 px-4 text-sm font-semibold text-white transition-all hover:shadow-lg"
								>
									保存
								</button>
							</div>
						</form>
					</div>
				</div>
			)}
		</div>
	);
};
