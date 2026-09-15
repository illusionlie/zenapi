import type { Child } from "hono/jsx/dom";
import { useCallback, useEffect, useRef, useState } from "hono/jsx/dom";

type ModalProps = {
	isOpen: boolean;
	onClose: () => void;
	/** 移动端 bottom-sheet 形态:面板加 t-modal-sheet(≤767px 从视口底部 rise,桌面走 .t-modal 原样 scale) */
	sheet?: boolean;
	/** 背景遮罩类,默认 bg-stone-900/40 */
	backdropClass?: string;
	/** 面板外观类(圆角/边框/宽度/padding),由调用方传原面板现状值 */
	panelClass?: string;
	children?: Child;
};

/**
 * 面板生命周期:closed(未挂载)→ entering(挂载,pre-scale 态)→ open(过渡进)→ closing(过渡出)→ closed。
 * phaseRef 镜像当前 phase:竞态判定读 ref 而非 render 闭包,避免 effect 依赖 phase 导致 close 计时器被误清。
 */
type Phase = "closed" | "entering" | "open" | "closing";

/** 与 styles.css 的 --modal-close-dur 同源;CSS 变量读取失败时兜底 */
const CLOSE_DURATION_FALLBACK_MS = 150;

/** 打开中的模态 id 栈:叠层场景(选择器叠在编辑模态上)Esc 只关最上层,避免连带关闭底层表单 */
const openModalIds: number[] = [];
let nextModalId = 0;

export const Modal = ({
	isOpen,
	onClose,
	sheet = false,
	backdropClass = "bg-stone-900/40",
	panelClass = "",
	children,
}: ModalProps) => {
	const [phase, setPhase] = useState<Phase>("closed");
	const phaseRef = useRef<Phase>("closed");
	const closeTimerRef = useRef<number | null>(null);
	// 实例稳定 id(仅首帧赋值一次),用于 openModalIds 栈的注册/注销
	const modalIdRef = useRef(0);
	if (modalIdRef.current === 0) {
		modalIdRef.current = ++nextModalId;
	}

	const goPhase = useCallback((next: Phase) => {
		phaseRef.current = next;
		setPhase(next);
	}, []);

	// 开/关状态机。effect 重跑前必先执行 cleanup:isOpen 翻 true 时清掉未触发的
	// close 计时器(重开竞态),同时取消未触发的入场 rAF(entering 中即关闭)
	useEffect(() => {
		let cancelOpenRafs: (() => void) | null = null;
		if (isOpen) {
			if (phaseRef.current === "closed") {
				// 首次打开:先挂载 pre-scale 态 DOM,双 rAF 保证先绘制一帧,
				// 之后再加 is-open,transform/opacity 过渡才能生效
				goPhase("entering");
				let raf2 = 0;
				const raf1 = requestAnimationFrame(() => {
					raf2 = requestAnimationFrame(() => goPhase("open"));
				});
				cancelOpenRafs = () => {
					cancelAnimationFrame(raf1);
					cancelAnimationFrame(raf2);
				};
			} else {
				// closing 中重开:计时器已被 cleanup 清除,直接回 is-open,
				// 面板从当前过渡位置原路返回,无跳变
				goPhase("open");
			}
		} else if (phaseRef.current === "open" || phaseRef.current === "entering") {
			goPhase("closing");
			// 时长运行时读取,与 CSS 保持同源
			const duration =
				parseFloat(
					getComputedStyle(document.documentElement).getPropertyValue(
						"--modal-close-dur",
					),
				) || CLOSE_DURATION_FALLBACK_MS;
			closeTimerRef.current = window.setTimeout(() => {
				closeTimerRef.current = null;
				goPhase("closed");
			}, duration);
		}
		return () => {
			cancelOpenRafs?.();
			if (closeTimerRef.current !== null) {
				clearTimeout(closeTimerRef.current);
				closeTimerRef.current = null;
			}
		};
	}, [isOpen, goPhase]);

	// Esc 关闭:仅 open 时启用;注册进 openModalIds 栈,非最上层(被选择器等覆盖时)不响应
	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const modalId = modalIdRef.current;
		openModalIds.push(modalId);
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") {
				return;
			}
			if (openModalIds[openModalIds.length - 1] !== modalId) {
				return;
			}
			onClose();
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			const index = openModalIds.indexOf(modalId);
			if (index >= 0) {
				openModalIds.splice(index, 1);
			}
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [isOpen, onClose]);

	if (phase === "closed") {
		return null;
	}

	const panelClasses = [
		"t-modal",
		// 面板需在 absolute backdrop 之上可点击(spec:内容层 relative z-10 先例)
		"relative z-10",
		phase === "open" ? "is-open" : "",
		phase === "closing" ? "is-closing" : "",
		sheet ? "t-modal-sheet" : "",
		panelClass,
	]
		.filter(Boolean)
		.join(" ");

	return (
		<div class="fixed inset-0 z-50 flex items-end md:items-center justify-center px-0 md:px-4 py-0 md:py-8">
			<button
				type="button"
				aria-label="关闭"
				class={`absolute inset-0 transition-opacity ease-smooth-out ${
					phase === "open"
						? "opacity-100 duration-[250ms]"
						: "opacity-0 duration-[150ms]"
				} ${backdropClass}`}
				onClick={onClose}
			/>
			<div class={panelClasses} role="dialog">
				{children}
			</div>
		</div>
	);
};
