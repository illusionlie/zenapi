import { createPortal, useEffect, useState } from "hono/jsx/dom";
import type { ToastItem, ToastType } from "../core/toast";
import { dismiss, getSnapshot, subscribe } from "../core/toast";

type ToastVisual = {
	iconClass: string;
	borderClass: string;
	iconPath: string;
};

const toastVisuals: Record<ToastType, ToastVisual> = {
	success: {
		iconClass: "text-emerald-600",
		borderClass: "border-emerald-200",
		iconPath: "M4.5 12.75l6 6 9-13.5",
	},
	error: {
		iconClass: "text-red-600",
		borderClass: "border-red-200",
		iconPath: "M6 18L18 6M6 6l12 12",
	},
	info: {
		iconClass: "text-stone-500",
		borderClass: "border-stone-200",
		iconPath:
			"M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12v-.008z",
	},
};

const ToastCard = ({ item }: { item: ToastItem }) => {
	const visual = toastVisuals[item.type];
	return (
		<div
			class={`pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-white px-4 py-3 shadow-lg max-w-md w-full sm:w-auto will-change-transform ${visual.borderClass} ${
				item.leaving ? "animate-toast-out" : "animate-toast-in"
			}`}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				fill="none"
				viewBox="0 0 24 24"
				stroke-width="2"
				stroke="currentColor"
				class={`h-5 w-5 shrink-0 ${visual.iconClass}`}
				aria-hidden="true"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d={visual.iconPath}
				/>
			</svg>
			<span class="text-sm text-stone-700 break-all">{item.message}</span>
			<button
				type="button"
				class="shrink-0 text-stone-400 hover:text-stone-600 transition-colors duration-200"
				aria-label="关闭通知"
				onClick={() => dismiss(item.id)}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
					stroke-width="2"
					stroke="currentColor"
					class="h-4 w-4"
					aria-hidden="true"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M6 18L18 6M6 6l12 12"
					/>
				</svg>
			</button>
		</div>
	);
};

export const ToastHost = () => {
	const [items, setItems] = useState<ToastItem[]>(() => [...getSnapshot()]);

	useEffect(() => subscribe(() => setItems([...getSnapshot()])), []);

	// createPortal 的返回类型是宽泛的 Child（含 undefined），用 fragment 包裹后才能作为 hono FC 的返回值。
	return (
		<>
			{createPortal(
				<div
					class="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 px-4 pb-4"
					role="status"
					aria-live="polite"
				>
					{items.map((item) => (
						<ToastCard key={item.id} item={item} />
					))}
				</div>,
				document.body,
			)}
		</>
	);
};
