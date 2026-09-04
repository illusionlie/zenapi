import { useState } from "hono/jsx/dom";
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
};

export const UsersView = ({
	users,
	onCreate,
	onUpdate,
	onDelete,
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
		setShowEditModal(true);
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
		onUpdate(editingUser.id, patch);
		setShowEditModal(false);
		setEditingUser(null);
	};

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
		</div>
	);
};
