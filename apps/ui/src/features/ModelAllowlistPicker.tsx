import {
	createPortal,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "hono/jsx/dom";
import { Modal } from "./Modal";

type ModelAllowlistPickerProps = {
	/** 已选模型集合(受控),父组件持有 */
	selected: Set<string>;
	onChange: (next: Set<string>) => void;
	/** 拉取候选模型列表(管理台=模型广场聚合;用户端=/api/u/models) */
	fetchCandidates: () => Promise<string[]>;
	/** 编辑态:已配置值并入候选集,保证存量配置项(如渠道已下线的模型)始终可见可勾选 */
	initialModels?: string[];
	/** 区块标题,默认「可用模型」 */
	label?: string;
	/** 未选择任何模型时的提示文案 */
	emptyHint?: string;
};

/**
 * 模型白名单编辑区块(标签 + 已选徽章 + 选择器模态)。
 * 从 UsersView 的用户级白名单 UI 抽取共享;管理台/用户端令牌模态复用。
 */
export const ModelAllowlistPicker = ({
	selected,
	onChange,
	fetchCandidates,
	initialModels = [],
	label = "可用模型",
	emptyHint = "未配置 = 不限制，可调用全部启用渠道的模型",
}: ModelAllowlistPickerProps) => {
	const [pickerOpen, setPickerOpen] = useState(false);
	const [draftModels, setDraftModels] = useState<Set<string>>(
		() => new Set<string>(),
	);
	const [modelSearch, setModelSearch] = useState("");
	const [candidates, setCandidates] = useState<string[]>([]);

	// 挂载即拉取候选(与 UsersView 原行为一致:编辑模态打开即预载,选择器打开时已就绪)
	useEffect(() => {
		let cancelled = false;
		fetchCandidates()
			.then((list) => {
				if (!cancelled) setCandidates(list);
			})
			.catch(() => {
				if (!cancelled) setCandidates([]);
			});
		return () => {
			cancelled = true;
		};
	}, [fetchCandidates]);

	const removeModel = useCallback(
		(modelId: string) => {
			const next = new Set(selected);
			next.delete(modelId);
			onChange(next);
		},
		[onChange, selected],
	);

	const openModelPicker = useCallback(() => {
		setDraftModels(new Set(selected));
		setModelSearch("");
		setPickerOpen(true);
	}, [selected]);

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
		onChange(new Set(draftModels));
		setPickerOpen(false);
	}, [draftModels, onChange]);

	// Picker 列表 = 接口候选 ∪ 已配置值(initialModels) ∪ 当前已选值:
	// 已配置但不再出现在聚合列表中的模型(渠道下线/停用)仍需可见、可取消勾选。
	const pickerModels = useMemo(() => {
		const merged = [...candidates];
		const seen = new Set(candidates);
		for (const id of initialModels) {
			if (!seen.has(id)) {
				merged.push(id);
				seen.add(id);
			}
		}
		for (const id of selected) {
			if (!seen.has(id)) {
				merged.push(id);
				seen.add(id);
			}
		}
		if (!modelSearch) return merged;
		const lower = modelSearch.toLowerCase();
		return merged.filter((m) => m.toLowerCase().includes(lower));
	}, [candidates, initialModels, modelSearch, selected]);

	const allPickerVisibleSelected =
		pickerModels.length > 0 && pickerModels.every((m) => draftModels.has(m));

	return (
		<>
			<div>
				<div class="mb-1.5 flex items-center justify-between gap-2">
					<span class="block text-xs uppercase tracking-widest text-stone-500">
						{label}
					</span>
					<button
						type="button"
						class="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-100"
						onClick={openModelPicker}
					>
						选择模型
					</button>
				</div>
				{selected.size === 0 ? (
					<p class="text-xs text-stone-400">{emptyHint}</p>
				) : (
					<div class="flex flex-wrap gap-1.5">
						{[...selected].map((modelId) => (
							<span
								key={modelId}
								class="inline-flex max-w-full items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700"
							>
								<span class="max-w-[180px] truncate font-mono">{modelId}</span>
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
			{/* 选择器模态经 portal 挂到 body:.t-modal 面板的 transform 会为 fixed
			    后代创建 containing block,嵌套渲染会被面板裁剪(spec 既有 gotcha,
			    ToastHost portal 先例) */}
			{createPortal(
				<Modal
					isOpen={pickerOpen}
					onClose={() => setPickerOpen(false)}
					backdropClass="bg-black/40"
					panelClass="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl"
				>
					<div class="flex items-center justify-between border-b border-stone-100 px-4 py-3">
						<h4 class="text-sm font-semibold text-stone-800">
							选择可用模型
							<span class="ml-1 text-xs font-normal text-stone-400">
								未选择 = 不限制
							</span>
						</h4>
						<button
							type="button"
							onClick={() => setPickerOpen(false)}
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
							onClick={() => setPickerOpen(false)}
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
				</Modal>,
				document.body,
			)}
		</>
	);
};
