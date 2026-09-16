# 执行计划：UI 选项卡切换过渡动画与骨架屏加载态

> 前置：阅读 `.trellis/spec/api-worker-ui/frontend/component-guidelines.md`（动效 token 约定、a11y 约定、禁 transition-all）。
> 所有改动限定 `apps/ui/`，不碰 worker / 测试逻辑。

## 前置清单

- [ ] `bun install`（确保依赖就绪）
- [ ] 基线验证：`bun run check && bun run typecheck && bun run test` 全绿后再动手

## Step 1：styles.css —— token + 关键帧 + 动效类（基建层）

- [ ] `@theme` 追加 `--animate-skeleton-shimmer: skeleton-shimmer 1.4s ease-in-out infinite;`
- [ ] `:root` 追加 `--view-enter-dur: 250ms;` 与 `--page-enter-dur: 400ms;`（附数值出处注释）
- [ ] 新增 `@keyframes view-enter`（fade + translateY(4px) + blur(2px)）
- [ ] 新增 `@keyframes page-enter`（fade + translateY(16px) + blur(2px)）
- [ ] 新增 `.t-view-enter` / `.t-page-enter`（`animation: ... var(--ease-smooth-out) both;`）
- [ ] 新增 `.skeleton` + `::after` shimmer（linear-gradient 白光扫过，transform 驱动）
- [ ] 新增 `@keyframes skeleton-shimmer`
- [ ] 新增 reduced-motion 显式块：`.t-view-enter, .t-page-enter { animation: none !important; }`
- [ ] 遵循文件既有分区注释风格（`/* ===== xxx ===== */`）

**验证**：`bun run dev:ui` 启动无报错（CSS 语法由 Vite 编译校验）。

## Step 2：新增组件（features/）

- [ ] 新建 `apps/ui/src/features/ViewSkeleton.tsx`：
  - 导出 `SkeletonBlock`（`{ class?: string }`，`aria-hidden`，渲染 `.skeleton`）
  - 导出 `ViewSkeleton`（`variant: "stats" | "table" | "form" | "generic"`）
  - 外层容器：复用被替换加载卡片的样式（`rounded-2xl border border-stone-200 bg-white p-5 shadow-lg`）+ `role="status" aria-label="加载中"` + `t-view-enter`
  - 标题条骨架 + 4 变体布局（design.md §3.2；宽度用分数制造不规则感）
- [ ] 新建 `apps/ui/src/features/DotLoader.tsx`：
  - 三点 bounce（对齐 PlaygroundView 既有节奏：0.1s 逐点延迟）
  - `role="status" aria-label="加载中"`，支持 `class` 透传
- [ ] 运行 `bun run typecheck` 确认组件类型无误

## Step 3：AdminApp.tsx

- [ ] 组件文件内新增 `tabToSkeletonVariant: Record<TabId, SkeletonVariant>`（design.md §3.3 映射表）
- [ ] `renderContent()` 的 loading 分支：静态文字卡 → `<ViewSkeleton variant={tabToSkeletonVariant[activeTab] ?? "generic"} />`
- [ ] 返回 JSX 包裹层：`<div key={activeTab}>` → `<div key={activeTab} class="t-view-enter">`

## Step 4：UserApp.tsx（与 Step 3 对称）

- [ ] 新增 `userTabToSkeletonVariant`（5 tab 映射）
- [ ] loading 分支 → `ViewSkeleton`
- [ ] 包裹层追加 `class="t-view-enter"`

## Step 5：AppLayout.tsx（标题过渡）

- [ ] h1 追加 `key={activeLabel}` 与 `t-view-enter` 类（保留原有字体/字距类）
- [ ] 副标题 `<p>` 不动

## Step 6：MonitoringView.tsx（零散加载态）

- [ ] 时间范围切换提示：`<span ...>加载中...</span>` → `<DotLoader class="text-stone-400" />`（若 DotLoader 自带配色则按实际微调）
- [ ] slot 详情面板 loadingDetails 分支：文字 → 3 行 `SkeletonBlock` 迷你骨架（`aria-hidden`，`h-3` + 分数宽度）
- [ ] 确认两处删除了所有「加载中...」静态文案

## Step 7：PlaygroundView.tsx（消重，顺带）

- [ ] 内联三点 bounce 替换为 `<DotLoader />`（气泡壳 `<div class="rounded-2xl border ...">` 保留在调用方）

## Step 8：App.tsx（登录态切换过渡）

- [ ] `/admin` 无 token 分支容器：追加 `key="admin-login"` + `t-page-enter`
- [ ] `/admin` 有 token 分支容器：追加 `key="admin-app"` + `t-page-enter`
- [ ] `/user` 已登录分支容器：追加 `key="user-app"` + `t-page-enter`
- [ ] `/user` 未登录/校验失败分支容器：追加 `key="public"` + `t-page-enter`
- [ ] 兜底 PublicApp 分支容器：追加 `key="public"` + `t-page-enter`
- [ ] **不动**：`return null` 等待分支、`/` 路径中转逻辑、ToastHost 挂载、AnnouncementModal

## Step 9：全量验证（quality gate）

- [ ] `bun run check`（Biome：tab 缩进、双引号、import 排序）
- [ ] `bun run typecheck`
- [ ] `bun run test`
- [ ] 手动走查（`bun run dev:worker` + `bun run dev:ui`）：
  - [ ] 管理台逐个 tab 点击：新内容浮入（fade+上移+blur ~250ms）、标题同步淡入
  - [ ] 首次进入 dashboard/channels/settings：骨架屏 + shimmer，加载完成替换无大跳
  - [ ] 已加载 tab 回切：直接显示内容（不闪骨架，loadedTabs 语义保持）
  - [ ] 监测页切时间范围：按钮旁三点动画；点开 slot：迷你骨架行
  - [ ] 对话测试页：三点动画正常（DotLoader 替换后）
  - [ ] 登录 → 管理台：整页浮入；登出 → 登录页：整页浮入
  - [ ] 用户端全 tab 走查同上
  - [ ] 快速连点 tab：无残影、无布局异常
  - [ ] 浏览器开启 `prefers-reduced-motion: reduce`：所有新动画禁用、骨架静止
  - [ ] 读屏/无障碍抽查：骨架容器 role=status 可感知，装饰块不播报
- [ ] a11y 门禁无新增违规（对照 spec quality-guidelines 的全绿要求）

## 回滚点

- Step 1–2（基建）独立可用：后续任意 Step 失败可停在已完成步骤，动画组件不影响现有功能
- 整体回滚：`git revert` 单次提交，无迁移无状态残留

## 提交

- Conventional Commits：`feat(ui): 选项卡切换入场动画与骨架屏加载态`
- 单提交包含全部改动（基建 + 触点为一体功能）；若 review 要求可拆 `styles+components` / `app wiring` 两笔
