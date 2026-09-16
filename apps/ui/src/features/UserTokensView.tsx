import { useState } from "hono/jsx/dom";
import type { Token } from "../core/types";
import { formatDateTime } from "../core/utils";
import { Modal } from "./Modal";
import { ModelAllowlistPicker } from "./ModelAllowlistPicker";

type UserTokensViewProps = {
	tokens: Token[];
	onCreate: (name: string, allowedModels: string[]) => void;
	onDelete: (id: string) => void;
	onReveal: (id: string) => void;
	editingToken: Token | null;
	onEdit: (token: Token) => void;
	onCloseEditModal: () => void;
	onEditSubmit: (data: { name: string; allowedModels: string[] }) => void;
	onFetchModelCandidates: () => Promise<string[]>;
};

/** 「模型限制」单元格:无限制显示「全部」,有限制显示「N 个模型」徽章(title 列明细) */
const renderModelLimit = (token: Token) => {
	const models = token.allowed_models ?? [];
	if (models.length === 0) {
		return <span class="text-xs text-stone-400">全部</span>;
	}
	return (
		<span
			class="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-600"
			title={models.join("\n")}
		>
			{models.length} 个模型
		</span>
	);
};

export const UserTokensView = ({
	tokens,
	onCreate,
	onDelete,
	onReveal,
	editingToken,
	onEdit,
	onCloseEditModal,
	onEditSubmit,
	onFetchModelCandidates,
}: UserTokensViewProps) => {
	const [showCreateModal, setShowCreateModal] = useState(false);
	const [tokenName, setTokenName] = useState("");
	const [createSelectedModels, setCreateSelectedModels] = useState<Set<string>>(
		() => new Set<string>(),
	);

	const resetModal = () => {
		setShowCreateModal(false);
		setTokenName("");
		setCreateSelectedModels(new Set());
	};

	const openCreate = () => {
		setTokenName("");
		setCreateSelectedModels(new Set());
		setShowCreateModal(true);
	};

	const handleCreate = (e: Event) => {
		e.preventDefault();
		if (!tokenName.trim()) return;
		onCreate(tokenName.trim(), [...createSelectedModels]);
		resetModal();
	};

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
					class="h-10 rounded-lg bg-stone-900 px-4 text-sm font-semibold text-white transition-shadow hover:shadow-lg"
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
								<th class="pb-2 pr-4 font-medium">模型限制</th>
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
												<span
													class="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-600"
													title="存量渠道限定，继续由服务端校验生效"
												>
													{modelCount} 个模型
												</span>
											) : (
												<span class="text-xs text-stone-400">全部</span>
											)}
										</td>
										<td class="py-2.5 pr-4">{renderModelLimit(token)}</td>
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
												<button
													type="button"
													class="text-xs text-amber-600 hover:text-amber-700"
													onClick={() => onReveal(token.id)}
												>
													复制
												</button>
												<button
													type="button"
													class="text-xs text-amber-600 hover:text-amber-700"
													onClick={() => onEdit(token)}
												>
													编辑
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

			{/* Create token modal */}
			<Modal
				isOpen={showCreateModal}
				onClose={resetModal}
				panelClass="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-xl"
			>
				<h3 class="mb-4 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
					创建令牌
				</h3>
				<form onSubmit={handleCreate}>
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
								setTokenName((e.currentTarget as HTMLInputElement)?.value ?? "")
							}
						/>
					</div>
					<div class="mb-4">
						<ModelAllowlistPicker
							label="模型白名单"
							emptyHint="未选择 = 不限制，可调用全部可用模型"
							selected={createSelectedModels}
							onChange={setCreateSelectedModels}
							fetchCandidates={onFetchModelCandidates}
						/>
					</div>
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
							class="h-10 rounded-lg bg-stone-900 px-4 text-sm font-semibold text-white transition-shadow hover:shadow-lg"
						>
							创建
						</button>
					</div>
				</form>
			</Modal>

			{/* Edit token modal */}
			<Modal
				isOpen={editingToken !== null}
				onClose={onCloseEditModal}
				panelClass="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-xl"
			>
				{/* onClose 同步置空 editingToken,closing 动画期间内容须 guard 空引用(先例 UsersView);
				    内层表单以条件挂载 + useState 初值实现「打开时重置」(先例 ModelsView) */}
				{editingToken && (
					<EditTokenForm
						key={editingToken.id}
						token={editingToken}
						fetchCandidates={onFetchModelCandidates}
						onCancel={onCloseEditModal}
						onSubmit={onEditSubmit}
					/>
				)}
			</Modal>
		</div>
	);
};

type EditTokenFormProps = {
	token: Token;
	fetchCandidates: () => Promise<string[]>;
	onCancel: () => void;
	onSubmit: (data: { name: string; allowedModels: string[] }) => void;
};

/** 编辑令牌表单:仅名称 + 模型白名单,无任何额度字段(额度仅管理员可改) */
const EditTokenForm = ({
	token,
	fetchCandidates,
	onCancel,
	onSubmit,
}: EditTokenFormProps) => {
	const [name, setName] = useState(token.name);
	const [selectedModels, setSelectedModels] = useState<Set<string>>(
		() => new Set(token.allowed_models ?? []),
	);

	const handleSubmit = (e: Event) => {
		e.preventDefault();
		onSubmit({ name: name.trim(), allowedModels: [...selectedModels] });
	};

	return (
		<>
			<h3 class="mb-4 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
				编辑令牌
			</h3>
			<form onSubmit={handleSubmit}>
				<div class="mb-4">
					<label
						class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500"
						for="token-edit-name"
					>
						令牌名称
					</label>
					<input
						class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
						id="token-edit-name"
						type="text"
						required
						value={name}
						onInput={(e) =>
							setName((e.currentTarget as HTMLInputElement)?.value ?? "")
						}
					/>
				</div>
				<div class="mb-4">
					<ModelAllowlistPicker
						label="模型白名单"
						emptyHint="未选择 = 不限制，可调用全部可用模型"
						selected={selectedModels}
						onChange={setSelectedModels}
						fetchCandidates={fetchCandidates}
						initialModels={token.allowed_models ?? []}
					/>
				</div>
				<div class="flex justify-end gap-3">
					<button
						type="button"
						class="h-10 rounded-lg border border-stone-200 px-4 text-sm text-stone-500 hover:text-stone-900"
						onClick={onCancel}
					>
						取消
					</button>
					<button
						type="submit"
						class="h-10 rounded-lg bg-stone-900 px-4 text-sm font-semibold text-white transition-shadow hover:shadow-lg"
					>
						保存
					</button>
				</div>
			</form>
		</>
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
