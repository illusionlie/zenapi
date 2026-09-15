# Design — UI 动效改造(核心套餐)

## 0. 依据与素材

- 审计报告(会话内):G1 / 14 / 15 / 16 / 1-9 项。
- transitions-dev reference(片段 **verbatim 来源**,摘录已存 `research/transitions-snippets.md`):
  - `06-modal.md`(.t-modal)
  - `05-menu-dropdown.md`(.t-dropdown)
  - `07-panel-reveal.md`(.t-panel-slide)
  - `22-toast.md`(仅取数值口径:open 350ms / close 250ms / distance 16px / blur 2px / scale 0.97 / ease smooth-out)
- 项目 spec:`.trellis/spec/api-worker-ui/frontend/*`(无自定义 hook、容器持有状态、a11y 约定、0-error 门禁)。

## 1. CSS 层(apps/ui/src/styles.css)

### 1.1 Token 安装

```css
@import "tailwindcss";

@theme {
	/* 现有 --animate-toast-* 保留(数值见 1.4) */
	--ease-smooth-out: cubic-bezier(0.22, 1, 0.36, 1);
}
```

`@theme` 中的 `--ease-smooth-out` 由 Tailwind v4 自动生成 `ease-smooth-out` utility(与项目现有 `--animate-toast-in → animate-toast-in` 同机制),供全站类名替换使用。

### 1.2 片段安装(verbatim + 显式记录的两处适配)

在 `styles.css` 追加(源顺序重要,适配类必须在原片段之后):

1. `:root` 变量块 —— `--modal-*`、`--dropdown-*`、`--panel-*` 三组,取值与 reference 一致:
   - modal:open 250ms / close 150ms / scale 0.96 / scale-close 0.96 / ease smooth-out
   - dropdown:open 250ms / close 150ms / pre-scale 0.97 / closing-scale 0.99 / ease smooth-out
   - panel:open 400ms / close 350ms / translate-y 100px / blur 2px / ease smooth-out
2. `.t-modal` + `.t-dropdown` + `.t-panel-slide` 三段 CSS **原样粘贴**,含各自的 `@media (prefers-reduced-motion: reduce)` guard。
3. **适配 A — `.t-drawer`(X 轴抽屉)**:结构复制自 `.t-panel-slide`,仅将轴从 `translateY` 改为 `translateX(-100%)`(左侧滑入),变量复用 `--panel-*` 组,自带 reduced-motion guard。原片段本体不动;这是抽屉场景的方向必需适配,非参数重调。
4. **适配 B — `.t-modal-sheet`(bottom-sheet 断点变体)**:`@media (max-width: 767px)`(Tailwind md 断点以下)内,`.t-modal-sheet` 将 transform 覆盖为 `translateY(100%) ↔ 0`(贴底面板从视口底 rise),open/close 时长与 ease 仍读 `--modal-*`。桌面端走 `.t-modal` 原样 scale。置于 `.t-modal.is-open` / `.is-closing` 规则之后以正确覆盖。
5. 抽屉根节点可见性:`.drawer-root`(fixed inset-0 容器)closed 态 `visibility: hidden` 且 `transition: visibility 0s linear var(--panel-close-dur)`(open 立即 visible),`pointer-events: none` ↔ `data-open="true"` 时 auto —— 防止隐藏抽屉内容可被 Tab 聚焦、以及整层拦截页面点击。backdrop 用 opacity 0↔1 过渡(open 400ms / close 350ms,同 `--panel-*` ease)。

### 1.3 全局 reduced-motion 守卫(G1)

```css
@media (prefers-reduced-motion: reduce) {
	*,
	*::before,
	*::after {
		animation-duration: 0.01ms !important;
		animation-iteration-count: 1 !important;
		transition-duration: 0.01ms !important;
	}
}
```

置于文件末尾,兜底覆盖 Tailwind 内置动画(animate-pulse/bounce)与所有过渡。

### 1.4 Toast 对齐(R5)

```css
@theme {
	--animate-toast-in: toast-in 0.35s cubic-bezier(0.22, 1, 0.36, 1);
	--animate-toast-out: toast-out 0.25s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

@keyframes toast-in {
	from { opacity: 0; transform: translateY(16px) scale(0.97); filter: blur(2px); }
	to   { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
}
@keyframes toast-out {
	from { opacity: 1; transform: translateY(0) scale(1); }
	to   { opacity: 0; transform: translateY(16px) scale(0.97); }
}
```

- `@theme` 内不能用 `var()`,故 easing 写字面值(与 token 表一致)。
- `ToastCard`(`ToastHost.tsx`)的 `leaving ? "animate-toast-out" : "animate-toast-in"` 切换逻辑不变,并加 `will-change-transform`。

## 2. 组件层

### 2.1 新增 `features/Modal.tsx`(统一模态壳)

```tsx
type ModalProps = {
	isOpen: boolean;
	onClose: () => void;
	sheet?: boolean;          // 移动端 bottom-sheet 形态 → 面板加 t-modal-sheet
	backdropClass?: string;   // 默认 "bg-stone-900/40";AnnouncementModal 传 bg-black/40 backdrop-blur-sm
	panelClass?: string;      // 面板外观类(圆角/边框/宽度),由调用方传现状值
	children: ...
};
```

- 状态机(组件内部 useState,非自定义 hook,容器仅持有 `isOpen` + `onClose`,符合 spec 状态管理约定):
  - `isOpen: false → true`:挂载 DOM(初始为 `.t-modal` pre-scale 态)→ **双 rAF**(等价于 reflow 保证)后加 `.is-open`。
  - `isOpen: true → false`:移除 `.is-open`、加 `.is-closing` → `setTimeout(—modal-close-dur)` 后卸载。时长运行时读取:`parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--modal-close-dur")) || 150`(skill JS 编排要求,保持与 CSS 同源)。
  - **竞态处理**:close 计时器存 useRef;isOpen 再次变 true 时 clearTimeout、移除 `.is-closing`、直接 `.is-open`(skill 常见错误第 1 条:close 态必须清理,否则下次打开从错误 scale 跳变)。
  - 组件自身 unmount 时 clearTimeout。
- 结构:根 `fixed inset-0 z-50 flex items-end md:items-center justify-center px-0 md:px-4 py-0 md:py-8`(sheet 形态沿用现有布局类);backdrop 为 `<button aria-label="关闭">` 点击 onClose;面板 `<div class="t-modal {sheet && 't-modal-sheet'}" role="dialog">`。
- 统一提供 **Esc 关闭**(keydown 监听)—— 现有 8 处模态均缺失此能力,属 wrapper 免费增强;backdrop 点击关闭与各容器现有 `onClose` 幂等兼容。

### 2.2 模态接入(8 处,容器侧改动)

统一模式:`{cond && (<div class="fixed inset-0 ...">…)</div>)}` → `<Modal isOpen={cond} onClose={…} sheet={?} panelClass={原面板类}>{原内容}</Modal>`;容器保持持有 open state,Modal 常驻渲染(不再条件挂载)。

| 位置 | sheet | 备注 |
| --- | --- | --- |
| `SecretValueModal.tsx` | ✓ | 重构为 Modal 的薄封装,对外 props 不变(title/value/onClose) |
| `ChannelsView.tsx:676` 渠道编辑 | ✓ | 表单内容原样作为 children |
| `ChannelsView.tsx:862` 确认 | ✗ | 居中小窗 |
| `TokensView.tsx:301` 令牌编辑 | ✓ | |
| `UsersView.tsx:271` | ✗ | |
| `UsersView.tsx:390` | ✗ | |
| `UsersView.tsx:555` 确认 | ✗ | |
| `App.tsx:295` AnnouncementModal | ✗ | backdropClass 传 `bg-black/40 backdrop-blur-sm` |

### 2.3 Playground 下拉(`PlaygroundView.tsx`)

- 现状 `{isModelDropdownOpen && <div>}` → 组件内 mounted/closing 局部 state(同 2.1 模式,单处使用不抽公共件):open 时挂载 + 双 rAF 加 `.is-open`(`data-origin="top-left"`);close 时 `.is-closing` → `--dropdown-close-dur` 后卸载;快速开关竞态同 2.1 处理。
- outside-click 与输入焦点行为**不变**;下拉项、样式原样搬入。

### 2.4 抽屉(`AppLayout.tsx`、`UserApp.tsx`)

- 容器 `isMobileMenuOpen` 语义不变;DOM 改常驻:根 `fixed inset-0 z-50 lg:hidden drawer-root` + `data-open={isMobileMenuOpen}`;aside 加 `t-drawer` + `data-open`;backdrop button 加 opacity 过渡类。
- 现有 Esc 键关闭(仅 AppLayout 有)保留。

## 3. 全站类名收敛(R6,机械替换表)

逐处判断,禁止全局 sed(属性集各异):

| 现状模式 | 替换为 |
| --- | --- |
| `transition-all duration-200 ease-in-out` + `hover:-translate-y-0.5` + `hover:shadow-*` | `transition-[transform,box-shadow] duration-200 ease-smooth-out`(其余类不动) |
| `transition-all duration-200 ease-in-out`(纯 hover 变色/边框/背景) | `transition-colors duration-200` |
| `transition-all duration-200 ease-in-out`(变色 + hover:shadow) | `transition-[color,background-color,border-color,box-shadow] duration-200` |
| 裸 `transition-all`(无 duration/ease) | 同上行规则,Tailwind 默认 150ms 保留;含 translate 的补 `ease-smooth-out` |
| `transition-colors` / `transition-opacity` / 裸 `transition`(Tailwind 默认枚举) | **不动**(已是正确示范) |

分布:ChannelsView(15)、TokensView(13)、UserApp(6)、AppLayout(5)、UserDashboard(4)、UsageView(4)、UsersView(3)、UserRegisterView(3)、SettingsView(3)、ModelsView(3)、UserTokensView(2)、UserLoginView(2)、SecretValueModal(2)、PlaygroundView(2)、LoginView(1)、App(1),共 69 处;接入 Modal 后 SecretValueModal/ChannelsView/TokensView 等处的个别实例随结构重写自然消化。

## 4. 兼容性与风险

- 纯展示层改动,不触碰 worker;风险集中在 8 处模态的容器结构改写(漏传 panelClass 会丢外观,需逐处比对原 class)。
- Modal 常驻渲染后,表单内部 state 随卸载清空的时机变化:closing 动画期间(150ms)表单仍挂载——可接受,不影响数据(容器 state 为主)。
- 快速连点开/关:2.1 竞态方案覆盖;`prefers-reduced-motion` 下 guard 将时长归零,setTimeout 仍按 150ms 执行卸载(动画即时完成,无可见跳变)。
- 回滚:整任务为 2 个 commit(见 implement.md),`git revert` 即可,无数据/接口影响。

## 5. 验证

- `bun run check && bun run typecheck && bun run test`(项目门禁)。
- `bun run dev:ui` + `bun run dev:worker` 冒烟:模态开/关/快速连点、Esc、backdrop 点击;下拉开合;抽屉滑入/滑出;toast 出入;系统级"减少动态"开启后全站无动画。
