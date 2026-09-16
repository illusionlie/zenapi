# 技术设计：UI 选项卡切换过渡动画与骨架屏加载态

## 0. 方案总览

四个触点、两类新原语，全部构建在既有动效语言之上：

| 触点 | 方案 | 原语 |
|------|------|------|
| 主内容区 tab 切换 | 包裹层 key 重挂载 + CSS 入场动画 | `.t-view-enter`（新） |
| 主加载态 | `ViewSkeleton` 骨架屏（4 变体） | `.skeleton` + shimmer（新） |
| 页面标题 | h1 key 重挂载 + 同款入场动画 | `.t-view-enter`（复用） |
| 零散小加载 | `DotLoader` 组件 + 迷你骨架行 | `DotLoader`（新）、`SkeletonBlock`（新） |
| 登录态切换 | 顶层分支容器 key + 整页入场动画 | `.t-page-enter`（新） |

新增文件仅 2 个（`ViewSkeleton.tsx`、`DotLoader.tsx`），其余为既有文件的局部修改。

## 1. 核心决策：CSS animation 而非 transition

**决策**：tab 切换与登录态切换用 **CSS `@keyframes` animation**，不用 Modal 的 transition + phase 状态机。

**论证**：
- 现有切换语义是 `<div key={activeTab}>` **重挂载**（即时替换、无退场）。CSS animation 在元素插入 DOM 时自动播放，无需 JS 参与；
- Modal 之所以需要 `closed → entering → open` 状态机 + 双 rAF，是因为 transition 需要「先以起始态绘制一帧、再加类触发过渡」——**退场动画才真正需要状态机**，本任务 enter-only，绕开了全部复杂度；
- key 重挂载时 animation 自动重放，快速连点 tab 无残影（旧节点直接销毁）；
- `fill-mode: both` 保证动画首帧即起始态，消除闪烁。

**与 spec 的一致性**：`component-guidelines.md` 允许关键帧动画（toast 即先例），要求「入场可带 cross-blur，退场从简」——本方案完全对齐。

## 2. styles.css 新增（token + 关键帧 + 动效类）

```css
@theme {
	/* 追加 */
	--animate-skeleton-shimmer: skeleton-shimmer 1.4s ease-in-out infinite;
}

:root {
	/* 追加：数值出处——250ms 对齐 --modal-open-dur；400ms 对齐 --panel-open-dur */
	--view-enter-dur: 250ms;
	--page-enter-dur: 400ms;
	/* 缓动直接复用 @theme 输出的 --ease-smooth-out，不新造 */
}

@keyframes view-enter {
	from {
		opacity: 0;
		transform: translateY(4px);
		filter: blur(2px);
	}
	to {
		opacity: 1;
		transform: translateY(0);
		filter: blur(0);
	}
}

@keyframes page-enter {
	from {
		opacity: 0;
		transform: translateY(16px);
		filter: blur(2px);
	}
	to {
		opacity: 1;
		transform: translateY(0);
		filter: blur(0);
	}
}

.t-view-enter {
	animation: view-enter var(--view-enter-dur) var(--ease-smooth-out) both;
}
.t-page-enter {
	animation: page-enter var(--page-enter-dur) var(--ease-smooth-out) both;
}

@media (prefers-reduced-motion: reduce) {
	.t-view-enter,
	.t-page-enter {
		animation: none !important;
	}
}
```

**数值出处**：
- 内容区 `4px` 上移：克制、不抢焦点（对比 toast 16px 是「弹出物」语义，内容区是「承载面」）；
- 整页 `16px`：对齐 toast-in 的 rise 节奏，整页级切换需要更大位移才可感知；
- blur `2px`：对齐 `--panel-blur`；
- 缓动：全局统一 `cubic-bezier(0.22, 1, 0.36, 1)`。

**不做 `will-change`**：一次性 animation 播完即释放，常驻 will-change 反而长期占用合成层。

## 3. 骨架屏设计

### 3.1 `.skeleton` 基础类 + shimmer（styles.css）

```css
.skeleton {
	position: relative;
	overflow: hidden;
	background-color: var(--color-stone-200);
	border-radius: 0.5rem;
}
.skeleton::after {
	content: "";
	position: absolute;
	inset: 0;
	transform: translateX(-100%);
	background: linear-gradient(
		90deg,
		transparent,
		rgb(255 255 255 / 0.55),
		transparent
	);
	animation: var(--animate-skeleton-shimmer);
}

@keyframes skeleton-shimmer {
	to {
		transform: translateX(100%);
	}
}
```

- shimmer 用 `transform`（合成器动画），不用 width/background-position（重排/重绘）；
- `@theme` 的 `--animate-*` 命名使 Tailwind 生成 `animate-skeleton-shimmer` 工具类，keyframes 声明跟随 token（Tailwind v4 约定）；
- 全局 reduced-motion 守卫已覆盖循环动画（`animation-iteration-count: 1` + duration 0.01ms），shimmer 自动降级为静止灰块。

### 3.2 `features/ViewSkeleton.tsx`（新组件）

```tsx
/** 骨架积木:小场景(详情面板等)内联组装用 */
export const SkeletonBlock = ({
	class: cls,
}: { class?: string }) => (
	<div class={`skeleton ${cls ?? ""}`} aria-hidden="true" />
);

type SkeletonVariant = "stats" | "table" | "form" | "generic";

/** 整页加载骨架:role=status 向读屏器播报加载态,内部装饰块全部 aria-hidden */
export const ViewSkeleton = ({ variant }: { variant: SkeletonVariant }) => (
	<div
		role="status"
		aria-label="加载中"
		class="t-view-enter rounded-2xl border border-stone-200 bg-white p-5 shadow-lg"
	>
		<SkeletonBlock class="mb-5 h-7 w-40 rounded-lg" />
		{variant === "stats" && (/* 3 列卡片 grid + 2 行宽条 */)}
		{variant === "table" && (/* 表头条 + 6 行条(末行 40% 宽) */)}
		{variant === "form" && (/* label 条 + 输入框条 ×4 + 按钮条 */)}
		{variant === "generic" && (/* 大块分区 */)}
	</div>
);
```

**设计要点**：
- 外壳复用现有加载卡片的容器样式（`rounded-2xl border border-stone-200 bg-white p-5 shadow-lg`，即被替换的「加载中...」卡片），保证高度占位近似，减少加载完成后的布局跳动；
- 容器自带 `.t-view-enter`：首次进入 tab 时骨架随包裹层一起入场（包裹层同动画不会叠加——animation 在父元素上，子元素仅继承视觉结果，无重复播放）；
- 高度语义化：标题条 `h-7`、表行 `h-10`、卡片 `h-24` 等，宽度用分数（`w-1/3`、`w-2/3`）制造不规则感，避免整齐划一的假感。

### 3.3 变体映射

| AdminApp tab | variant | UserApp tab | variant |
|---|---|---|---|
| dashboard | stats | dashboard | stats |
| monitoring | generic | monitoring | generic |
| channels | table | models | table |
| models | table | tokens | table |
| tokens | table | usage | table |
| usage | table | | |
| settings | form | | |
| users | table | | |
| playground | generic | | |

AdminApp 需要一个 `tabToSkeletonVariant: Record<TabId, SkeletonVariant>` 映射（UserApp 同理），放在各自组件文件内（与 `adminTabToPath` 同层，不做全局常量——两端 tab 集合不同）。

## 4. 各触点改动

### 4.1 AdminApp.tsx / UserApp.tsx（对称改动）

```tsx
// renderContent() 中
if (loading) {
	return <ViewSkeleton variant={tabToSkeletonVariant[activeTab] ?? "generic"} />;
}

// 返回 JSX 中:包裹层追加动效类
<div key={activeTab} class="t-view-enter">{renderContent()}</div>
```

- 「未知模块」兜底分支同样享受包裹层动画，无需单独处理。

### 4.2 AppLayout.tsx（标题过渡）

```tsx
<h1 key={activeLabel} class="font-['Space_Grotesk'] ... t-view-enter">
	{activeLabel}
</h1>
```

- key 用 `activeLabel`（显示文本变化即重挂载）；label 与 tab 一一对应，无歧义；
- 副标题 `<p>` 为静态文案，不动。

### 4.3 MonitoringView.tsx（两处零散加载态）

- 时间范围切换：`{loading && <span class="text-xs text-stone-400">加载中...</span>}` → `{loading && <DotLoader />}`（保留原位置与配色语义，DotLoader 自带 `text-stone-400`）；
- slot 详情面板：`loadingDetails ? <div class="text-xs ...">加载中...</div>` → 迷你骨架行：

```tsx
<div class="space-y-1.5" aria-hidden="true">
	<SkeletonBlock class="h-3 w-full" />
	<SkeletonBlock class="h-3 w-5/6" />
	<SkeletonBlock class="h-3 w-2/3" />
</div>
```

（面板内已有文字标题提供上下文，装饰块 aria-hidden 即可，不再套 role=status 避免播报嵌套。）

### 4.4 features/DotLoader.tsx（新组件）

```tsx
/** 三点 bounce 加载指示器,对齐 PlaygroundView 既有节奏(0.1s 逐点延迟) */
export const DotLoader = ({ class: cls }: { class?: string }) => (
	<span class={`inline-flex gap-1 ${cls ?? ""}`} role="status" aria-label="加载中">
		<span class="animate-bounce">·</span>
		<span class="animate-bounce" style="animation-delay: 0.1s">·</span>
		<span class="animate-bounce" style="animation-delay: 0.2s">·</span>
	</span>
);
```

- PlaygroundView 的内联三点实现替换为 `DotLoader`（气泡壳留在调用方）——消除既有重复，收拢为单一实现。

### 4.5 App.tsx（登录态切换过渡）

各顶层分支容器追加 `key` + `.t-page-enter`（仅列 key 语义，容器类名保持现状 + 追加 `t-page-enter`）：

| 分支 | key |
|---|---|
| `/admin` + 无 adminToken（LoginView） | `"admin-login"` |
| `/admin` + 有 adminToken（AdminApp） | `"admin-app"` |
| `/user` + 未登录/校验失败（PublicApp） | `"public"` |
| `/user` + 已登录（UserApp + 公告 Modal） | `"user-app"` |
| 兜底 PublicApp（/login、/register） | `"public"` |

- 管理台登录成功瞬间：`admin-login` → `admin-app`，key 变化触发整页入场动画（正是想要的仪式感）；
- 登出（AdminApp → LoginView）同理；
- `return null` 等待分支（siteInfoLoaded / userChecked）**完全不动**；
- `path === "/"` 与 `/login` ↔ `/user` 的 `replaceState` 中转（return null）不动；
- 注意：同分支内 `setPath` 引发的重渲染 key 不变，动画不重播——只有登录态/分支跨越才播放，符合预期。

## 5. a11y 与降级

| 项 | 处理 |
|---|---|
| 骨架屏读屏 | `ViewSkeleton` 外层 `role="status" aria-label="加载中"`，装饰块 `aria-hidden` |
| DotLoader 读屏 | `role="status" aria-label="加载中"`，三个点对读屏器为静音装饰（纯文本 · · ·，label 覆盖播报） |
| slot 面板迷你骨架 | 仅 `aria-hidden`（父级已有文字标题，避免嵌套 live region） |
| reduced-motion | 新动效类显式 `animation: none`；shimmer/dot 由既有全局守卫（duration 0.01ms + iteration 1）兜底 |

## 6. 性能

- 全部动画走 `opacity / transform / filter`（合成器友好），shimmer 用 `transform: translateX`；
- 无常驻 `will-change`；animation 播放完自动释放；
- 骨架节点数克制（表格变体 ≤ 8 个块），shimmer 层数 = 骨架块数，均为单层合成；
- key 重挂载是既有行为，本任务不改变挂载策略，无新增重挂载成本。

## 7. 兼容与回滚

- 纯前端展示层改动，不触 API / schema / 路由；
- 无新依赖（Tailwind v4 内置 `animate-bounce`，其余为手写 CSS）；
- 回滚：整体 revert 单次提交即可，无迁移、无状态残留。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| hono/jsx/dom 对 `class` 传 props 的 `class` 属性名（非 className）| 组件 props 解构用 `{ class: cls }`，与仓库既有写法一致（Modal.tsx 的 panelClass 先例） |
| 骨架与真实内容高度差导致加载完成跳动 | 外壳复用被替换的加载卡片容器 + 语义化高度近似；playground/monitoring 用 generic 大块 |
| 快速连点 tab 动画叠加 | key 重挂载下旧节点直接销毁，新节点 animation 从头播，天然无叠加 |
| Playwright/视觉回归（如有） | 无既有视觉快照测试，不涉及 |
