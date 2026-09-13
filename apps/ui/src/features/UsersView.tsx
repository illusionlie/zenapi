import { useCallback, useMemo, useState } from "hono/jsx/dom";
import type { User } from "../core/types";
import { formatDateTime } from "../core/utils";

type UsersViewProps = {
	users: User[];
	onCreate: (data: {
		email: string;
		name: string;
		password: string;
		balance?: number;
	}) => void;
	onUpdate: (id: string, patch: Record<string, unknown>) => void;
	onDelete: (id: string) => void;
	onFetchModelCandidates: () => Promise<string[]>;
};

export const UsersView = ({
	users,
	onCreate,
	onUpdate,
	onDelete,
	onFetchModelCandidates,
}: UsersViewProps) => {
	const [showCreateModal, setShowCreateModal] = useState(false);
	const [showEditModal, setShowEditModal] = useState(false);
	const [editingUser, setEditingUser] = useState<User | null>(null);
	const [createForm, setCreateForm] = useState({
		email: "",
		name: "",
		password: "",
		balance: "0",
	});
	const [editForm, setEditForm] = useState({
		name: "",
		balance: "",
		status: "",
		password: "",
	});
	const [selectedModels, setSelectedModels] = useState<Set<string>>(
		() => new Set<string>(),
	);
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const [draftModels, setDraftModels] = useState<Set<string>>(
		() => new Set<string>(),
	);
	const [modelSearch, setModelSearch] = useState("");
	const [candidates, setCandidates] = useState<string[]>([]);

	const handleCreate = (e: Event) => {
		e.preventDefault();
		onCreate({
			email: createForm.email.trim(),
			name: createForm.name.trim(),
			password: createForm.password,
			balance: Number(createForm.balance) || 0,
		});
		setCreateForm({ email: "", name: "", password: "", balance: "0" });
		setShowCreateModal(false);
	};

	const openEdit = (user: User) => {
		setEditingUser(user);
		setEditForm({
			name: user.name,
			balance: String(user.balance),
			status: user.status,
			password: "",
		});
		setSelectedModels(new Set(user.allowed_models ?? []));
		setCandidates([]);
		setShowEditModal(true);
		onFetchModelCandidates()
			.then((list) => setCandidates(list))
			.catch(() => setCandidates([]));
	};

	const handleEdit = (e: Event) => {
		e.preventDefault();
		if (!editingUser) return;
		const patch: Record<string, unknown> = {
			name: editForm.name.trim(),
			balance: Number(editForm.balance),
			status: editForm.status,
		};
		if (editForm.password) {
			patch.password = editForm.password;
		}
		const initial = [...(editingUser.allowed_models ?? [])].sort();
		const next = [...selectedModels].sort();
		if (JSON.stringify(initial) !== JSON.stringify(next)) {
			patch.allowed_models = [...selectedModels];
		}
		onUpdate(editingUser.id, patch);
		setShowEditModal(false);
		setEditingUser(null);
	};

	const removeModel = useCallback((modelId: string) => {
		setSelectedModels((prev) => {
			const next = new Set(prev);
			next.delete(modelId);
			return next;
		});
	}, []);

	const openModelPicker = useCallback(() => {
		setDraftModels(new Set(selectedModels));
		setModelSearch("");
		setModelPickerOpen(true);
	}, [selectedModels]);

	const toggleDraftModel = useCallback((modelId: string) => {
		setDraftModels((prev) => {
			const next = new Set(prev);
			if (next.has(modelId)) next.delete(modelId);
			else next.add(modelId);
			return next;
		});
	}, []);

	const toggleAllDraftVisible = useCallback(
		(visible: string[], select: boolean) => {
			setDraftModels((prev) => {
				const next = new Set(prev);
				for (const id of visible) {
					if (select) next.add(id);
					else next.delete(id);
				}
				return next;
			});
		},
		[],
	);

	const confirmModelPicker = useCallback(() => {
		setSelectedModels(new Set(draftModels));
		setModelPickerOpen(false);
	}, [draftModels]);

	// Picker list = fetched candidates plus any already-configured models that
	// may no longer appear in the aggregated list (removed/disabled channels),
	// so admins can still see and uncheck them.
	const pickerModels = useMemo(() => {
		const merged = [...candidates];
		const seen = new Set(candidates);
		for (const id of draftModels) {
			if (!seen.has(id)) {
				merged.push(id);
				seen.add(id);
			}
		}
		if (!modelSearch) return merged;
		const lower = modelSearch.toLowerCase();
		return merged.filter((m) => m.toLowerCase().includes(lower));
	}, [candidates, draftModels, modelSearch]);

	const allPickerVisibleSelected =
		pickerModels.length > 0 && pickerModels.every((m) => draftModels.has(m));

	return (
		<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
			<div class="mb-4 flex items-center justify-between">
				<div class="flex items-center gap-3">
					<h3 class="font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
						用户管理
					</h3>
					<span class="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-500">
						{users.length} 个用户
					</span>
				</div>
				<button
					class="h-10 rounded-lg bg-stone-900 px-4 text-sm font-semibold text-white transition-all hover:shadow-lg"
					type="button"
					onClick={() => setShowCreateModal(true)}
				>
					创建用户
				</button>
			</div>

			{users.length === 0 ? (
				<p class="py-8 text-center text-sm text-stone-400">暂无用户</p>
			) : (
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead>
							<tr class="border-b border-stone-100 text-xs uppercase tracking-widest text-stone-400">
								<th class="pb-2 pr-4 font-medium">邮箱</th>
								<th class="pb-2 pr-4 font-medium">用户名</th>
								<th class="pb-2 pr-4 font-medium">角色</th>
								<th class="pb-2 pr-4 font-medium">余额</th>
								<th class="pb-2 pr-4 font-medium">状态</th>
								<th class="pb-2 pr-4 font-medium">注册时间</th>
								<th class="pb-2 font-medium">操作</th>
							</tr>
						</thead>
						<tbody>
							{users.map((user) => (
								<tr class="border-b border-stone-50">
									<td class="py-2.5 pr-4 text-stone-700">{user.email}</td>
									<td class="py-2.5 pr-4 font-medium text-stone-700">
										{user.name}
									</td>
									<td class="py-2.5 pr-4">
										<span
											class={`rounded-full px-2 py-0.5 text-xs ${
												user.role === "admin"
													? "bg-amber-50 text-amber-600"
													: "bg-stone-100 text-stone-500"
											}`}
										>
											{user.role}
										</span>
									</td>
									<td class="py-2.5 pr-4 font-mono text-stone-600">
										${user.balance.toFixed(2)}
									</td>
									<td class="py-2.5 pr-4 whitespace-nowrap">
										<span
											class={`rounded-full px-2 py-0.5 text-xs ${
												user.status === "active"
													? "bg-emerald-50 text-emerald-600"
													: "bg-red-50 text-red-600"
											}`}
										>
											{user.status === "active" ? "启用" : "停用"}
										</span>
									</td>
									<td class="py-2.5 pr-4 text-xs text-stone-500">
										{formatDateTime(user.created_at)}
									</td>
									<td class="py-2.5">
										<div class="flex gap-2 whitespace-nowrap">
											<button
												type="button"
												class="text-xs text-amber-600 hover:text-amber-700"
												onClick={() => openEdit(user)}
											>
												编辑
											</button>
											<button
												type="button"
												class="text-xs text-stone-500 hover:text-stone-700"
												onClick={() =>
													onUpdate(user.id, {
														status:
															user.status === "active" ? "disabled" : "active",
													})
												}
											>
												{user.status === "active" ? "停用" : "启用"}
											</button>
											<button
												type="button"
												class="text-xs text-red-500 hover:text-red-600"
												onClick={() => onDelete(user.id)}
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

			{/* Create user modal */}
			{showCreateModal && (
				<div class="fixed inset-0 z-50 flex items-center justify-center">
					<button
						type="button"
						class="absolute inset-0 bg-stone-900/40"
						onClick={() => setShowCreateModal(false)}
					/>
					<div class="relative z-10 w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-xl">
						<h3 class="mb-4 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
							创建用户
						</h3>
						<form class="grid gap-4" onSubmit={handleCreate}>
							<div>
								<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
									邮箱
								</label>
								<input
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
									type="email"
									required
									value={createForm.email}
									onInput={(e) =>
										setCreateForm((p) => ({
											...p,
											email: (e.currentTarget as HTMLInputElement)?.value ?? "",
										}))
									}
								/>
							</div>
							<div>
								<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
									用户名
								</label>
								<input
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
									type="text"
									required
									value={createForm.name}
									onInput={(e) =>
										setCreateForm((p) => ({
											...p,
											name: (e.currentTarget as HTMLInputElement)?.value ?? "",
										}))
									}
								/>
							</div>
							<div>
								<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
									密码
								</label>
								<input
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
									type="password"
									required
									value={createForm.password}
									onInput={(e) =>
										setCreateForm((p) => ({
											...p,
											password:
												(e.currentTarget as HTMLInputElement)?.value ?? "",
										}))
									}
								/>
							</div>
							<div>
								<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
									初始余额
								</label>
								<input
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
									type="number"
									step="0.01"
									value={createForm.balance}
									onInput={(e) =>
										setCreateForm((p) => ({
											...p,
											balance:
												(e.currentTarget as HTMLInputElement)?.value ?? "0",
										}))
									}
								/>
							</div>
							<div class="flex justify-end gap-3">
								<button
									type="button"
									class="h-10 rounded-lg border border-stone-200 px-4 text-sm text-stone-500 hover:text-stone-900"
									onClick={() => setShowCreateModal(false)}
								>
									取消
								</button>
								<button
									type="submit"
									class="h-10 rounded-lg bg-stone-900 px-4 text-sm font-semibold text-white transition-all hover:shadow-lg"
								>
									创建
								</button>
							</div>
						</form>
					</div>
				</div>
			)}

			{/* Edit user modal */}
			{showEditModal && editingUser && (
				<div class="fixed inset-0 z-50 flex items-center justify-center">
					<button
						type="button"
						class="absolute inset-0 bg-stone-900/40"
						onClick={() => {
							setShowEditModal(false);
							setEditingUser(null);
						}}
					/>
					<div class="relative z-10 w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-xl">
						<h3 class="mb-4 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
							编辑用户: {editingUser.email}
						</h3>
						<form class="grid gap-4" onSubmit={handleEdit}>
							<div>
								<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
									用户名
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
									余额
								</label>
								<input
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
									type="number"
									step="0.01"
									value={editForm.balance}
									onInput={(e) =>
										setEditForm((p) => ({
											...p,
											balance:
												(e.currentTarget as HTMLInputElement)?.value ?? "",
										}))
									}
								/>
							</div>
							<div>
								<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
									状态
								</label>
								<select
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
									value={editForm.status}
									onChange={(e) =>
										setEditForm((p) => ({
											...p,
											status:
												(e.currentTarget as HTMLSelectElement)?.value ?? "",
										}))
									}
								>
									<option value="active">启用</option>
									<option value="disabled">停用</option>
								</select>
							</div>
							<div>
								<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
									新密码（留空不修改）
								</label>
								<input
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
									type="password"
									value={editForm.password}
									onInput={(e) =>
										setEditForm((p) => ({
											...p,
											password:
												(e.currentTarget as HTMLInputElement)?.value ?? "",
										}))
									}
								/>
							</div>
							<div>
								<div class="mb-1.5 flex items-center justify-between gap-2">
									<span class="block text-xs uppercase tracking-widest text-stone-500">
										可用模型
									</span>
									<button
										type="button"
										class="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-100"
										onClick={openModelPicker}
									>
										选择模型
									</button>
								</div>
								{selectedModels.size === 0 ? (
									<p class="text-xs text-stone-400">
										未配置 = 不限制，可调用全部启用渠道的模型
									</p>
								) : (
									<div class="flex flex-wrap gap-1.5">
										{[...selectedModels].map((modelId) => (
											<span
												key={modelId}
												class="inline-flex max-w-full items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700"
											>
												<span class="max-w-[180px] truncate font-mono">
													{modelId}
												</span>
												<button
													type="button"
													class="shrink-0 text-amber-400 hover:text-amber-700"
													onClick={() => removeModel(modelId)}
												>
													✕
												</button>
											</span>
										))}
									</div>
								)}
							</div>
							<div class="flex justify-end gap-3">
								<button
									type="button"
									class="h-10 rounded-lg border border-stone-200 px-4 text-sm text-stone-500 hover:text-stone-900"
									onClick={() => {
										setShowEditModal(false);
										setEditingUser(null);
									}}
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

			{/* Allowed models picker modal */}
			{modelPickerOpen && (
				<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
					<div class="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl">
						<div class="flex items-center justify-between border-b border-stone-100 px-4 py-3">
							<h4 class="text-sm font-semibold text-stone-800">
								选择可用模型
								<span class="ml-1 text-xs font-normal text-stone-400">
									未选择 = 不限制
								</span>
							</h4>
							<button
								type="button"
								onClick={() => setModelPickerOpen(false)}
								class="text-stone-400 hover:text-stone-600"
							>
								✕
							</button>
						</div>
						<div class="flex items-center gap-2 border-b border-stone-100 px-4 py-2.5">
							<input
								type="text"
								placeholder="搜索模型…"
								value={modelSearch}
								onInput={(e) =>
									setModelSearch(
										(e.currentTarget as HTMLInputElement)?.value ?? "",
									)
								}
								class="flex-1 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-200"
							/>
							<button
								type="button"
								onClick={() =>
									toggleAllDraftVisible(pickerModels, !allPickerVisibleSelected)
								}
								class="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50"
							>
								{allPickerVisibleSelected ? "取消全选" : "全选"}
							</button>
						</div>
						<div class="flex-1 overflow-y-auto px-4 py-2">
							{pickerModels.length === 0 ? (
								<p class="py-6 text-center text-sm text-stone-400">
									暂无可用模型
								</p>
							) : (
								<div class="space-y-0.5">
									{pickerModels.map((m) => (
										<label
											key={m}
											class="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-stone-50"
										>
											<input
												type="checkbox"
												checked={draftModels.has(m)}
												onChange={() => toggleDraftModel(m)}
												class="accent-amber-500"
											/>
											<span class="min-w-0 break-all font-mono text-xs text-stone-700">
												{m}
											</span>
										</label>
									))}
								</div>
							)}
						</div>
						<div class="flex items-center justify-end gap-2 border-t border-stone-100 px-4 py-3">
							<button
								type="button"
								onClick={() => setModelPickerOpen(false)}
								class="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50"
							>
								取消
							</button>
							<button
								type="button"
								onClick={confirmModelPicker}
								class="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
							>
								确认（已选 {draftModels.size}）
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
};
