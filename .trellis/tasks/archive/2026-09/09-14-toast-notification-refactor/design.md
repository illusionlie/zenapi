# 技术设计：底部 Toast 通知系统

## 1. 总体架构

```
App.tsx（顶层，一次）
 └─ <ToastHost />                    ← createPortal 到 document.body，全端覆盖
      └─ 订阅 core/toast.ts 模块级 store

core/toast.ts                        ← 无 JSX：store + 命令式 API（toast.success/error/info）
features/ToastHost.tsx               ← 渲染层：容器 + 单条 Toast 组件 + 进出场动画
features/SecretValueModal.tsx        ← 明文展示弹窗（新建令牌/reveal/导出兜底共用）
```

设计原则：**命令式触发、声明式渲染**。业务代码在 catch / 成功分支直接调 `toast.error(...)` / `toast.success(...)`，不再依赖组件树 props 传递；ToastHost 是唯一订阅者。

## 2. core/toast.ts —— store 设计

```ts
export type ToastType = "success" | "error" | "info";

export type ToastItem = {
	id: number;          // 自增
	type: ToastType;
	message: string;
	leaving: boolean;    // 退场动画标记
};
```

- 模块级单例：`let items: ToastItem[]`、`const listeners = new Set<() => void>()`、自增 id。
- `subscribe(fn: () => void): () => void` —— ToastHost 的 useEffect 用。
- `getSnapshot(): ToastItem[]` —— 返回当前数组（ToastHost 每次收到通知后克隆进本地 state）。
- `push(type, message, duration?)`：
  - 加入队列（**保留**旧消息，堆叠展示；与现状「单字符串覆盖」不同）。
  - 启动 setTimeout：到时先标 `leaving = true` 通知渲染退场动画，动画时长（约 200ms）后再真正移除。
  - 同堆栈上限 5 条：超出时移除最旧的。
- `dismiss(id)`：手动关闭，同样走 leaving → 移除两段式。
- 便捷封装：`toast.success(msg)` = `push("success", msg, 3000)`；`toast.error(msg)` = `push("error", msg, 5000)`；`toast.info(msg)` = `push("info", msg, 3000)`。
- 不使用 `useSyncExternalStore`（hono/jsx hooks 未验证支持该 API），采用保守的「ToastHost 内 `useState` 镜像 + `useEffect` 订阅」模式，与项目现有 hooks 用法同构。

**关键收益**：store 独立于组件树生命周期，401 登出触发组件卸载后，`toast.error(...)` 依然写进全局 store 并正常展示（现状 notice state 会随组件销毁丢失）。

## 3. features/ToastHost.tsx —— 渲染层

```tsx
import { createPortal } from "hono/jsx/dom";
```

- `createPortal(<容器/>, document.body)`，在 App.tsx 顶层渲染一次。
- 容器：`pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 px-4 pb-4`（z-[100] 高于全部 modal 的 z-50；`pointer-events-none` 让容器不挡点击，单条 toast 自身 `pointer-events-auto`）。
- 单条 Toast 卡片（呼应全站 stone 风格 + `rounded-xl`/`shadow-lg` 语汇）：
  - 结构：`flex items-start gap-2.5 rounded-xl border bg-white px-4 py-3 shadow-lg max-w-md w-full sm:w-auto` + 类型色。
  - 类型语义色（左侧图标着色，边框淡色）：
    - success：图标 emerald-600、边框 emerald-200
    - error：图标 red-600、边框 red-200
    - info：图标 stone-500、边框 stone-200
  - 图标用内联 SVG（对勾/叉/信息圈），不引外部图标库。
  - 文本 `text-sm text-stone-700 break-all`（长错误信息可换行）。
  - 关闭按钮：`text-stone-400 hover:text-stone-600 transition-colors duration-200`。
- 动画（Tailwind v4 `styles.css` 新增 `@theme` + `@keyframes`）：
  ```css
  @theme {
    --animate-toast-in: toast-in 0.2s ease-out;
    --animate-toast-out: toast-out 0.2s ease-in forwards;
    @keyframes toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes toast-out { from { opacity: 1; } to { opacity: 0; transform: translateY(8px); } }
  }
  ```
  进入用 `animate-toast-in`；`leaving === true` 时切换为 `animate-toast-out`。时长与全站 `duration-200` 语汇一致。

## 4. features/SecretValueModal.tsx —— 明文弹窗

通用「敏感明文展示」弹窗，三处用例共用：

```ts
type SecretValueModalProps = {
	title: string;        // 如「新令牌已创建」「令牌详情」「邀请码导出」
	value: string;        // 明文（支持多行）
	onClose: () => void;
};
```

- 视觉：沿用现有 modal 结构（`fixed inset-0 z-50 flex items-end md:items-center justify-center bg-stone-900/40`，移动端底部抽屉式，与 ChannelModal/TokenModal 同语汇）。
- 内容：标题 + `<pre class="break-all rounded-lg bg-stone-50 p-3 font-mono text-xs">` 展示明文 + 「复制」按钮（`navigator.clipboard.writeText`，失败回落 `document.execCommand`？——不，项目现状 ClipboardView 逻辑已有兜底分支，复制失败时提示手动选择即可）+ 关闭按钮。
- 复制成功 → `toast.success("已复制到剪贴板")`；失败 → `toast.error("复制失败，请手动选择复制")`。
- 覆盖的 5 处旧用例：
  - AdminApp.tsx:492 新令牌 → `toast.success("令牌已创建")` + 打开 SecretValueModal（标题「新令牌已创建」）。
  - AdminApp.tsx:711/713 reveal → 直接打开 SecretValueModal（标题「令牌详情」），原「剪贴板成功/失败兜底」双分支收敛为弹窗内复制按钮。
  - AdminApp.tsx:784 导出兜底 → SecretValueModal（标题「邀请码导出」，多行）。
  - UserApp.tsx:221 / 255/257 同理。
- State 承载：AdminApp/UserApp 增加 `secretModal: { title, value } | null` state（仅在容器层，View 通过回调触发）。

## 5. 迁移模式（71 处调用点的机械映射）

| 现状 | 改为 | 备注 |
|------|------|------|
| `setNotice("渠道已创建")`（success 类） | `toast.success("渠道已创建")` | 按 research §2 分类表逐条 |
| `setNotice((error as Error).message)`（catch） | `toast.error((error as Error).message)` | 全部 catch 分支 |
| `setNotice("请先填写 Base URL")`（前置校验） | `toast.error("请先填写 Base URL")` | 弹窗内校验，toast 浮于弹窗之上 |
| `setNotice("没有新模型可加入…")`（info 兜底） | `toast.info(...)` | |
| `setNotice("")`（7 处 clear 纪律） | **删除该行** | toast 自带生命周期；切 Tab/开弹窗不再需要清空 |
| 明文类 5 处 | SecretValueModal + toast | 见 §4 |

- **不改变任何时序逻辑**：本任务只替换通知载体，不动「成功才关弹窗 / 先关弹窗再请求」的既有流程（弹窗时序重构超出本任务范围，toast 已解决其可见性问题）。
- View 组件（features/*View）零 setNotice 的现状不变：仍通过 `onXxx` 回调冒泡，容器层调用 toast。

## 6. 拆除清单（notice 机制下线）

| 项 | 位置 |
|----|------|
| notice state | App.tsx:35、AdminApp.tsx:78、UserApp.tsx:75、PublicApp.tsx:32 |
| props 链 | AdminApp→AppLayout（notice={notice}）、PublicApp→UserRegisterView/UserLoginView、App→LoginView |
| banner 渲染 | AppLayout.tsx:186-190、UserApp.tsx:495-499、LoginView.tsx:49-53、UserLoginView.tsx:160-164、UserRegisterView.tsx:167-171、327-331（notice 部分） |
| AppLayout props | `notice: string` 从 AppLayoutProps 删除（AppLayout.tsx:8） |

- `UserRegisterView.tsx:327-331` 拆分后保留本地 error 渲染，样式 amber → 红色（`border-red-200 bg-red-50 text-red-700`），与「错误=红」的全局语义对齐。
- LoginView/UserLoginView 不再接收 notice props（登录失败改 toast.error）。

## 7. ToastHost 挂载点

App.tsx 顶层组件返回树中渲染一次 `<ToastHost />`，位于三端路由分发（AdminApp/UserApp/PublicApp）之外——portal 到 `document.body`，与路由树无 DOM 依赖，登录态切换/组件卸载均不影响。

## 8. 兼容性与风险

| 风险 | 评估 | 对策 |
|------|------|------|
| createPortal 是项目新先例 | hono 4.13.7 类型与运行时均已验证存在（research §5） | 仅 ToastHost 一处使用，影响面收敛 |
| 移动端 toast 与底部抽屉 modal 同屏重叠 | toast z-[100] 浮于抽屉之上，短暂遮住抽屉底部 | 可接受：toast ≤5s 自动消失；不引入 modal 联动复杂度 |
| 堆叠多条遮挡内容 | 上限 5 条 + 自动消失 | 单条宽度 max-w-md，底部浮层不阻断交互（pointer-events） |
| 长错误信息溢出 | 上游可能返回长 HTML 错误 | `break-all` + max-h 限制不必要（内容为纯文本） |
| working tree 行号偏移 | 2 个未提交文件与任务无交集 | 实施时以语义定位，不盲信行号 |

## 9. spec 修订（state-management.md）

- L10-16 架构图：容器 state 描述中 notice → toast（全局 store，模块级单例，非组件树状态）。
- L24「用户反馈统一走 notice state」→「用户反馈统一走 core/toast.ts 的 `toast.success/error/info`；ToastHost 在 App.tsx 挂载一次」。
- L44「错误流 …setNotice(错误信息)；不引入 toast 库」→「错误流：apiFetch throw → handleXxx catch → `toast.error(错误信息)`。toast 是自研轻量模块（core/toast.ts + features/ToastHost.tsx，createPortal 挂 body），不引入第三方 toast 库」。
- 新增一条明文约定：「需要长期查看/复制的明文（令牌、邀请码）用 SecretValueModal，不走 toast」。

## 10. 不做的事（Out of Scope）

- 不重构弹窗关闭时序（UsersView 先关后请求等）。
- 不迁移 UserRegisterView 本地校验 error、Playground 对话区错误。
- 不引入第三方动画/图标/通知库。
- 不动后端、API、数据库。
