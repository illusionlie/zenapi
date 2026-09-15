# UI 动效改造:reduced-motion 守卫、toast token 对齐、全站过渡类收敛与模态/下拉/抽屉进出场动画

## Goal

按 transitions-dev / transitions-polish skill 的审计结论,补齐前端缺失的进出场动画并统一动效 token,消除"闪现感"与无障碍硬伤。范围为审计报告的**核心套餐**:G1 + 14 + 15/16 + 模态/下拉/抽屉动画(1-9)。可选增强(streaming-text、骨架屏、tabs-sliding、success-check)不在本任务。

## Requirements

### R1 全局 reduced-motion 守卫(G1)

- `apps/ui/src/styles.css` 增加全局 `@media (prefers-reduced-motion: reduce)` 守卫:所有动画/过渡时长归零。
- 新引入的 `t-*` 片段自带 per-snippet guard,不得删除。

### R2 模态进出场动画(审计 1-7,共 7 处)

以下模态当前条件渲染直接挂载、零动画,需统一具备 open/close 动画:

1. `ChannelsView.tsx:676` 渠道编辑模态(移动端 bottom-sheet 形态)
2. `ChannelsView.tsx:862` 确认模态
3. `TokensView.tsx:301` 令牌编辑模态(移动端 bottom-sheet 形态)
4. `UsersView.tsx:271` 用户编辑模态
5. `UsersView.tsx:390` 用户模态
6. `UsersView.tsx:555` 确认模态
7. `SecretValueModal.tsx:21` 密钥展示模态(移动端 bottom-sheet 形态)
8. `App.tsx:295` 站点公告模态

动效规格(transitions-dev 06-modal):open 250ms scale 0.96→1 + fade;close 150ms 更快收场;backdrop 同步 fade;**关闭动画必须完整播放后再卸载**(closing 态 + 延迟卸载)。

### R3 Playground 模型下拉动画(审计 8)

- `PlaygroundView.tsx:239` 下拉面板:open 250ms / close 150ms,从触发器方向生长(05-menu-dropdown)。
- 保留现有 outside-click 关闭与搜索行为;关闭动画播放完成后再卸载。

### R4 移动端抽屉滑入(审计 9)

- `AppLayout.tsx:80` 与 `UserApp.tsx:377` 两处侧边抽屉:左侧滑入 + cross-blur,open 400ms / close 350ms,backdrop 同步 fade(07-panel-reveal 的 X 轴适配)。
- 关闭动画完整播放;closed 态不得残留下方可聚焦内容。

### R5 Toast token 对齐(审计 14)

- `styles.css` 的 toast 动画对齐 transitions-dev 22-toast 参考:in 350ms / out 250ms,easing 统一 `cubic-bezier(0.22, 1, 0.36, 1)`,出入场均含 translateY 位移(in 16px rise,out 回落),退场不再使用 `ease-in`。

### R6 全站过渡类收敛(审计 15/16)

- 消除 `transition-all`(全站 69 处):hover 位移+阴影场景收敛为 `transition-[transform,box-shadow]`,纯变色场景收敛为 `transition-colors` 等,按实际过渡属性枚举。
- hover lift 的 `ease-in-out` 统一替换为 `ease-smooth-out`(由 Tailwind v4 `@theme` 的 `--ease-smooth-out` 生成)。
- 时长保持现状(200ms/默认 150ms 均在 token 口径内,不改)。

## Constraints

- 纯前端(apps/ui),不触碰 worker 路由/鉴权/DB。
- 遵循项目 spec:无自定义 hook;容器持有 `isOpen` 类状态、props 单向下发;类型集中 `core/types.ts`(新组件 props 就地定义亦可,遵循现有惯例);Biome tab 缩进、双引号。
- t-* 片段 CSS 从 skill reference **原样粘贴**,仅允许 design.md 中显式记录的最小适配(X 轴抽屉变体、bottom-sheet 断点变体)。
- 不引入动画库,不新增依赖。
- a11y 不回退:现有 aria/role/键盘行为保留;新增动画不得造成 closed 态残留下方可聚焦元素。

## Acceptance Criteria

- [ ] 开启系统"减少动态"后,全站过渡与动画即时归零(全局 guard 生效)。
- [ ] 8 处模态(含 AnnouncementModal)有 open 250ms / close 150ms 动画,关闭时动画完整播放后才卸载,backdrop 同步淡出。
- [ ] 移动端 bottom-sheet 形态模态从底部 rise,桌面端居中 scale,两形态动画均正常。
- [ ] Playground 下拉、两处移动端抽屉按规格动画,关闭不闪跳。
- [ ] Toast in/out 时长与 easing 符合 R5,`styles.css` 中不再有 `ease-in`/`ease-out` 关键字的 toast 声明。
- [ ] 全站 `transition-all` 清零;`ease-in-out` 在 hover lift 场景清零。
- [ ] `bun run check`、`bun run typecheck`、`bun run test` 全绿。
- [ ] 不新增运行时依赖,git diff 仅涉及 apps/ui。
