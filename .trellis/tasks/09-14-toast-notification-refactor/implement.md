# 执行计划：底部 Toast 通知系统

> 依据：prd.md（需求）、design.md（设计）、research/current-state.md（71 处调用点逐行分类表）。
> 行号基于当前 working tree（含 2 个未提交文件改动）；实施时以语义定位优先，行号仅作导航。
> 每阶段结束跑一次快速验证（`bun run check && bun run typecheck`），全部阶段结束跑完整验证。

## 阶段 0：前置确认

- [ ] `git status` 确认 working tree 与 research §8.1 记录一致（AdminApp.tsx、ChannelsView.tsx 两个未提交改动）；若被 reset，重新 `git diff` 校准认知后再动。
- [ ] `bun install` 确认依赖可用，`bun run typecheck` 基线为绿。

**回滚点**：此阶段无代码变更。

## 阶段 1：基础设施（store + ToastHost + 动画 + 挂载）

- [ ] 新建 `apps/ui/src/core/toast.ts`：ToastType/ToastItem 类型、模块级 store、`subscribe` / `push` / `dismiss`、`toast.success/error/info` 便捷封装、堆叠上限 5 条、两段式退场（leaving 标记 → 200ms 后移除）。见 design §2。
- [ ] `apps/ui/src/styles.css` 追加 `@theme`：`--animate-toast-in` / `--animate-toast-out` + 两个 `@keyframes`。见 design §3。
- [ ] 新建 `apps/ui/src/features/ToastHost.tsx`：`createPortal(<容器>, document.body)`、底部居中容器 `z-[100] pointer-events-none`、单条卡片（三色图标 + break-all 文本 + 关闭按钮）、`useState` 镜像 + `useEffect` 订阅。见 design §3。
- [ ] `apps/ui/src/App.tsx` 顶层渲染一次 `<ToastHost />`（三端路由分发之外）。
- [ ] 快速验证：`bun run check && bun run typecheck`。

**回滚点**：删除 3 个新文件 + App.tsx 一行 + styles.css 追加段，即回到基线。

## 阶段 2：明文弹窗（SecretValueModal + 5 处用例）

- [ ] 新建 `apps/ui/src/features/SecretValueModal.tsx`：title/value/onClose props、现有 modal 语汇（z-50、移动端底部抽屉）、等宽明文展示、复制按钮（成功 `toast.success`，失败 `toast.error`）。见 design §4。
- [ ] AdminApp.tsx：新增 `secretModal: { title, value } | null` state；迁移 3 处——
  - [ ] L492 新令牌 → `toast.success("令牌已创建")` + 打开 SecretValueModal
  - [ ] L711/713 reveal → 打开 SecretValueModal（「令牌详情」），删除原剪贴板兜底双分支
  - [ ] L784 导出兜底 → 打开 SecretValueModal（多行文本）
- [ ] UserApp.tsx：同上 state；迁移 2 处——L221 新令牌、L255/257 reveal。
- [ ] 渲染 SecretValueModal 于两容器返回树末端（与现有 modal 挂载方式一致，组件树内条件渲染）。
- [ ] 快速验证：typecheck；手动冒烟「新建令牌 → 弹窗出现明文 → 复制 → toast」。

**回滚点**：阶段 1 的 toast 已独立可用，本阶段新增文件可单独删除。

## 阶段 3：AdminApp 迁移（50 处）+ AppLayout 拆除

- [ ] 对照 research §2.1 分类表逐条迁移 AdminApp.tsx 50 处（success→toast.success / error→toast.error / info→toast.info）。
- [ ] 删除 4 处 `setNotice("")` clear（L190/301/306/373）。
- [ ] 删除 notice state（L78）与传给 AppLayout 的 notice prop（L1066 附近）。
- [ ] AppLayout.tsx：删除 notice prop（AppLayoutProps L8）与 banner 渲染（L186-190）。
- [ ] 快速验证：`bun run check && bun run typecheck`；grep AdminApp/AppLayout 无 `setNotice\|notice` 残留。

**回滚点**：阶段 1-2 基础设施不动，仅回退 AdminApp/AppLayout 改动。

## 阶段 4：UserApp 迁移（15 处）+ banner 拆除

- [ ] 对照 research §2.2 分类表迁移 UserApp.tsx 15 处（明文 2 处已在阶段 2 完成）。
- [ ] 删除 `setNotice("")` clear（L156）。
- [ ] 删除 notice state（L75）与 banner 渲染（L495-499）。
- [ ] 快速验证：同上。

**回滚点**：仅回退 UserApp 改动。

## 阶段 5：PublicApp + App.tsx + 登录视图（6 处 + 渲染点）

- [ ] PublicApp.tsx 4 处迁移（§2.3）：OAuth 回跳错误、登录失败、注册失败 → toast.error；L76 clear 删除；删除 notice state（L32）及向 UserRegisterView/UserLoginView 传递的 notice props。
- [ ] App.tsx 2 处迁移（§2.4）：管理员登录失败 → toast.error；L159 clear 删除；删除 notice state（L35）及向 LoginView 的传递。
- [ ] LoginView.tsx：删除 notice prop 与 banner（L49-53）。
- [ ] UserLoginView.tsx：同上（L160-164）。
- [ ] UserRegisterView.tsx：L167-171 删除（linuxdo_only 分支的 notice banner）；L327-331 拆分——本地 error 保留渲染、样式 amber → 红色（`border-red-200 bg-red-50 text-red-700`），notice 从条件中移除；删除 notice prop。
- [ ] 快速验证：`bun run check && bun run typecheck`。

**回滚点**：仅回退本阶段涉及文件。

## 阶段 6：全量验证 + spec 修订

- [ ] 全局 grep 验证为 0：`grep -rn "setNotice" apps/ui/src`、`grep -rn "notice" apps/ui/src`（PlaygroundView 的局部 `error` 不受影响；如剩 `notice` 命中需逐条确认为误留）。
- [ ] `bun run check && bun run typecheck && bun run test` 全绿。
- [ ] `bun run build:ui`（或等价 build 命令）确认 Tailwind v4 新 `@theme` 动画正常产出。
- [ ] 手动冒烟清单（`bun run dev:worker` + `bun run dev:ui`）：
  - [ ] 渠道弹窗内提交重名 → error toast 可见于弹窗之上，弹窗不关
  - [ ] 拉取模型失败（双层弹窗）→ error toast 可见
  - [ ] 别名/价格保存失败 → error toast 可见
  - [ ] 新建令牌 → SecretValueModal 明文 + 复制按钮 + success toast
  - [ ] 各 CRUD 成功 → success toast 约 3 秒自动消失
  - [ ] 注册表单校验错误 → 表单内红色展示
  - [ ] 移动端视口：toast 与底部抽屉弹窗同屏可用
- [ ] 修订 `.trellis/spec/api-worker-ui/frontend/state-management.md`：L10-16 架构图、L24、L44，新增明文弹窗约定（见 design §9）。

**回滚点**：spec 修订独立提交粒度，可单独回退。

## 阶段 7：收尾

- [ ] trellis-check 全量质量检查。
- [ ] Conventional Commits 提交（建议 `feat(ui): 全局通知迁移为底部 toast，明文信息升级弹窗`）。
- [ ] 归档任务（`task.py archive`）。

## 验证命令速查

```bash
bun run check          # Biome
bun run typecheck      # tsc --noEmit
bun run test           # Vitest
bun run build:ui       # 前端构建（确认 @theme 动画产物）
grep -rn "setNotice" apps/ui/src   # 期望 0 命中
```

## 子代理调度注意

- 每阶段可独立派发 trellis-implement；dispatch prompt 首行必须是 `Active task: .trellis/tasks/09-14-toast-notification-refactor`。
- 阶段 3/4/5 的迁移必须携带 research/current-state.md §2 分类表（逐行语义已定，禁止实施者自行猜测 success/error）。
- 实施顺序强约束：1 → 2 → 3 → 4 → 5（store/ToastHost 是一切迁移的前置；AdminApp 量最大先啃）。
