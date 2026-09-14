export type ToastType = "success" | "error" | "info";

export type ToastItem = {
	id: number;
	type: ToastType;
	message: string;
	leaving: boolean;
};

const MAX_TOASTS = 5;
const LEAVE_DURATION_MS = 200;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

const notify = () => {
	for (const listener of listeners) {
		listener();
	}
};

const clearTimer = (id: number) => {
	const timer = timers.get(id);
	if (timer !== undefined) {
		clearTimeout(timer);
		timers.delete(id);
	}
};

export const getSnapshot = (): ToastItem[] => items;

export const subscribe = (listener: () => void): (() => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

// 两段式退场第一步：标记 leaving 触发退场动画，动画结束后再真正移除。
const beginLeave = (id: number) => {
	const item = items.find((toast) => toast.id === id);
	if (!item || item.leaving) return;
	items = items.map((toast) =>
		toast.id === id ? { ...toast, leaving: true } : toast,
	);
	notify();
	timers.set(
		id,
		setTimeout(() => {
			timers.delete(id);
			items = items.filter((toast) => toast.id !== id);
			notify();
		}, LEAVE_DURATION_MS),
	);
};

export const push = (
	type: ToastType,
	message: string,
	duration: number,
): number => {
	const id = nextId++;
	items = [...items, { id, type, message, leaving: false }];
	if (items.length > MAX_TOASTS) {
		const oldest = items[0];
		clearTimer(oldest.id);
		items = items.slice(1);
	}
	notify();
	timers.set(
		id,
		setTimeout(() => {
			timers.delete(id);
			beginLeave(id);
		}, duration),
	);
	return id;
};

export const dismiss = (id: number) => {
	const item = items.find((toast) => toast.id === id);
	if (!item || item.leaving) return;
	clearTimer(id);
	beginLeave(id);
};

export const toast = {
	success: (message: string) => push("success", message, 3000),
	error: (message: string) => push("error", message, 5000),
	info: (message: string) => push("info", message, 3000),
};
