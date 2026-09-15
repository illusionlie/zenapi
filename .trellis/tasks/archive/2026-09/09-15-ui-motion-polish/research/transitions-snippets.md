# transitions.dev 片段 verbatim 摘录

> 来源:`transitions-dev` skill reference 文件(06-modal.md / 05-menu-dropdown.md / 07-panel-reveal.md / 22-toast.md)。
> 用途:粘贴进 `apps/ui/src/styles.css`。**不要改写选择器、不要收拢 shorthand、不要删 will-change、不要删 reduced-motion guard。**

## :root 变量块(三组)

```css
:root {
	--modal-open-dur: 250ms;
	--modal-close-dur: 150ms;
	--modal-scale: 0.96;
	--modal-scale-close: 0.96;
	--modal-ease: cubic-bezier(0.22, 1, 0.36, 1);

	--dropdown-open-dur: 250ms;
	--dropdown-close-dur: 150ms;
	--dropdown-pre-scale: 0.97;
	--dropdown-closing-scale: 0.99;
	--dropdown-ease: cubic-bezier(0.22, 1, 0.36, 1);

	--panel-open-dur: 400ms;
	--panel-close-dur: 350ms;
	--panel-translate-y: 100px;
	--panel-blur: 2px;
	--panel-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
```

## .t-modal(06-modal.md 原文)

```css
.t-modal {
	transform-origin: center;
	transform: scale(var(--modal-scale));
	opacity: 0;
	pointer-events: none;
	transition:
		transform var(--modal-open-dur) var(--modal-ease),
		opacity   var(--modal-open-dur) var(--modal-ease);
	will-change: transform, opacity;
}
.t-modal.is-open {
	transform: scale(1);
	opacity: 1;
	pointer-events: auto;
}
.t-modal.is-closing {
	transform: scale(var(--modal-scale-close));
	opacity: 0;
	pointer-events: none;
	transition:
		transform var(--modal-close-dur) var(--modal-ease),
		opacity   var(--modal-close-dur) var(--modal-ease);
}

@media (prefers-reduced-motion: reduce) {
	.t-modal { transition: none !important; }
}
```

## .t-dropdown(05-menu-dropdown.md 原文)

```css
.t-dropdown {
	transform-origin: top left;
	transform: scale(var(--dropdown-pre-scale));
	opacity: 0;
	pointer-events: none;
	transition:
		transform var(--dropdown-open-dur) var(--dropdown-ease),
		opacity   var(--dropdown-open-dur) var(--dropdown-ease);
	will-change: transform, opacity;
}
.t-dropdown[data-origin="top-right"]     { transform-origin: top right; }
.t-dropdown[data-origin="top-center"]    { transform-origin: top center; }
.t-dropdown[data-origin="bottom-left"]   { transform-origin: bottom left; }
.t-dropdown[data-origin="bottom-center"] { transform-origin: bottom center; }
.t-dropdown[data-origin="bottom-right"]  { transform-origin: bottom right; }

.t-dropdown.is-open {
	transform: scale(1);
	opacity: 1;
	pointer-events: auto;
}
.t-dropdown.is-closing {
	transform: scale(var(--dropdown-closing-scale));
	opacity: 0;
	pointer-events: none;
	transition:
		transform var(--dropdown-close-dur) var(--dropdown-ease),
		opacity   var(--dropdown-close-dur) var(--dropdown-ease);
}

@media (prefers-reduced-motion: reduce) {
	.t-dropdown { transition: none !important; }
}
```

## .t-panel-slide(07-panel-reveal.md 原文)

```css
.t-panel-slide {
	transform: translateY(var(--panel-translate-y));
	opacity: 0;
	filter: blur(var(--panel-blur));
	pointer-events: none;
	transition:
		transform var(--panel-close-dur) var(--panel-ease),
		opacity   var(--panel-close-dur) var(--panel-ease),
		filter    var(--panel-close-dur) var(--panel-ease);
	will-change: transform, opacity, filter;
}
.t-panel-slide[data-open="true"] {
	transform: translateY(0);
	opacity: 1;
	filter: blur(0);
	pointer-events: auto;
	transition:
		transform var(--panel-open-dur) var(--panel-ease),
		opacity   var(--panel-open-dur) var(--panel-ease),
		filter    var(--panel-open-dur) var(--panel-ease);
}

@media (prefers-reduced-motion: reduce) {
	.t-panel-slide { transition: none !important; }
}
```

## 22-toast 数值口径(不粘贴其 CSS,本项目沿用 @theme + keyframes 机制)

- `--toast-open: 350ms`、`--toast-close: 250ms`、`--toast-distance: 16px`、`--toast-blur: 2px`、`--toast-scale: 0.97`、`--toast-ease: cubic-bezier(0.22, 1, 0.36, 1)`
- 语义:open 用慢钟、close 用快钟("arriving feels deliberate, leaving feels snappy");位移 + fade + 微 scale + cross-blur。

## 项目适配层(design.md §1.2 显式授权的两处变体 + 根容器规则)

```css
/* 适配 A:X 轴抽屉(左侧滑入),结构复制自 .t-panel-slide,复用 --panel-* 变量 */
.t-drawer {
	transform: translateX(-100%);
	opacity: 0;
	filter: blur(var(--panel-blur));
	pointer-events: none;
	transition:
		transform var(--panel-close-dur) var(--panel-ease),
		opacity   var(--panel-close-dur) var(--panel-ease),
		filter    var(--panel-close-dur) var(--panel-ease);
	will-change: transform, opacity, filter;
}
.t-drawer[data-open="true"] {
	transform: translateX(0);
	opacity: 1;
	filter: blur(0);
	pointer-events: auto;
	transition:
		transform var(--panel-open-dur) var(--panel-ease),
		opacity   var(--panel-open-dur) var(--panel-ease),
		filter    var(--panel-open-dur) var(--panel-ease);
}

@media (prefers-reduced-motion: reduce) {
	.t-drawer { transition: none !important; }
}

/* 适配 B:bottom-sheet 断点变体(<=767px 从底部 rise;桌面走 .t-modal 原样 scale) */
@media (max-width: 767px) {
	.t-modal-sheet {
		transform: translateY(100%);
	}
	.t-modal-sheet.is-open {
		transform: translateY(0);
	}
	.t-modal-sheet.is-closing {
		transform: translateY(100%);
	}
}

/* 抽屉根容器:closed 态不可交互、不可聚焦,visibility 延迟到 close 动画结束 */
.drawer-root {
	visibility: hidden;
	pointer-events: none;
	transition: visibility 0s linear var(--panel-close-dur);
}
.drawer-root[data-open="true"] {
	visibility: visible;
	pointer-events: auto;
	transition: none;
}
```
