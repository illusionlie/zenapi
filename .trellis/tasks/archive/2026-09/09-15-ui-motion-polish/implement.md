# Implement — UI 动效改造(核心套餐)

> 执行顺序即依赖顺序:CSS token 先行 → Modal 壳 → 接入 → 下拉/抽屉 → 类名收敛 → 门禁。
> 全程仅 `apps/ui`;每步后可独立 `bun run check` 快速自检。

## Checklist

### Step 1 — styles.css:tokens + 片段 + 全局守卫 + toast 对齐

- [ ] `@theme` 增加 `--ease-smooth-out: cubic-bezier(0.22, 1, 0.36, 1);`
- [ ] `:root` 块粘贴 `--modal-*` / `--dropdown-*` / `--panel-*` 三组变量(值见 `research/transitions-snippets.md`)
- [ ] verbatim 粘贴 `.t-modal` / `.t-dropdown` / `.t-panel-slide` 三段 CSS,各自 reduced-motion guard 一并保留
- [ ] 追加适配 A `.t-drawer`(X 轴,复用 `--panel-*`,自带 guard)与适配 B `.t-modal-sheet`(max-md 断点 translateY,置于 `.t-modal` 规则之后)
- [ ] 追加 `.drawer-root`(visibility/pointer-events 切换,见 design §1.2-5)
- [ ] toast:`--animate-toast-in/out` 改 0.35s/0.25s + `cubic-bezier(0.22, 1, 0.36, 1)`;keyframes 补 translateY(16px)/scale(0.97)/blur(2px)(见 design §1.4)
- [ ] 文件末尾追加全局 `@media (prefers-reduced-motion: reduce)` 守卫
- [ ] 自检:`bun run dev:ui` 确认 Tailwind 生成 `ease-smooth-out` utility、toast 动画正常

### Step 2 — 新增 features/Modal.tsx

- [ ] 按 design §2.1 实现状态机(mounted / open / closing + 双 rAF + close 计时器 useRef + 竞态清理 + Esc + backdrop button)
- [ ] Biome 格式(tab、双引号);props 就地 type 定义,与现有组件惯例一致

### Step 3 — 接入 8 处模态

- [ ] `SecretValueModal.tsx` 重构为 Modal 薄封装(对外 props 不变,sheet=true)
- [ ] `ChannelsView.tsx` 渠道编辑(sheet=true)+ 确认模态
- [ ] `TokensView.tsx:301` 令牌编辑(sheet=true)
- [ ] `UsersView.tsx:271` / `390` / `555`
- [ ] `App.tsx` AnnouncementModal(backdropClass=`bg-black/40 backdrop-blur-sm`)
- [ ] **逐处核对**:原面板外观 class(圆角/边框/宽度/padding)完整迁移到 `panelClass`,backdrop 色值一致
- [ ] 自检:每个模态 open/close 动画、Esc、backdrop 点击、快速连点无跳变

### Step 4 — Playground 下拉

- [ ] `PlaygroundView.tsx` 按 design §2.3 改造:`.t-dropdown data-origin="top-left"` + mounted/closing 卸载模式
- [ ] outside-click / 搜索聚焦行为回归验证

### Step 5 — 移动端抽屉 ×2

- [ ] `AppLayout.tsx` 与 `UserApp.tsx`:根容器 `drawer-root` + `data-open`,aside 加 `t-drawer` + `data-open`,backdrop opacity 过渡(design §2.4)
- [ ] 自检:closed 态抽屉内容不可 Tab 聚焦、页面点击不受拦截

### Step 6 — 全站类名收敛(69 处 `transition-all` 清零)

- [ ] 按 design §3 替换表逐文件执行:ChannelsView / TokensView / UserApp / AppLayout / UserDashboard / UsageView / UsersView / UserRegisterView / SettingsView / ModelsView / UserTokensView / UserLoginView / SecretValueModal / PlaygroundView / LoginView / App
- [ ] 替换后 `grep -r "transition-all" apps/ui/src` 归零;hover lift 场景 `ease-in-out` 归零
- [ ] `ToastHost.tsx` 卡片加 `will-change-transform`

### Step 7 — 质量门禁(最后一轮全量)

- [ ] `bun run check`(Biome)
- [ ] `bun run typecheck`(tsc --noEmit)
- [ ] `bun run test`(Vitest)
- [ ] `bun run dev:ui` 冒烟:design §5 清单(模态/下拉/抽屉/toast/reduced-motion)

## 验证命令

```bash
bun run check && bun run typecheck && bun run test
grep -rn "transition-all" apps/ui/src        # 期望无输出
grep -rn "ease-in-out" apps/ui/src | grep -v "ease-smooth"   # 期望无输出(hover lift 口径)
```

## Commit 划分(Conventional Commits)

1. `feat(ui): 引入 motion tokens 与 t-modal/t-dropdown/t-panel 片段,对齐 toast 时序并加全局 reduced-motion 守卫`(Step 1-2)
2. `feat(ui): 模态/下拉/抽屉接入进出场动画,全站过渡类收敛为枚举属性`(Step 3-6)

## 回滚点

- 每个 commit 独立可 revert;Step 3 起若单模态接入异常,可仅回退该文件为条件渲染(其余不受影响)。
- 无 DB/接口变更,无环境变量变更。
