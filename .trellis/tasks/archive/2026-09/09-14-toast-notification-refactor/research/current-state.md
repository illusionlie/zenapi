# 现状研究：notice banner 全链路侦察（toast 改造前置）

> 任务：09-14-toast-notification-refactor
> 侦察日期：基于 working tree（含 2 个未提交改动文件，见 §8.1）。所有行号均为当前工作区行号。
> 本文只记录现状事实，不含实现方案。

---

## 0. 速览

| 维度 | 现状 |
|------|------|
| notice 载体 | 4 个顶层组件各自持有独立的 `notice: string` state，互不共享 |
| banner 渲染点 | 共 6 处（AppLayout 1 + UserApp 1 + LoginView 1 + UserLoginView 1 + UserRegisterView 2），样式全部是 amber 色系，**无 success/error/info 视觉区分** |
| setNotice 调用 | 实际调用 71 处（AdminApp 50 / UserApp 15 / PublicApp 4 / App 2）+ 4 处 useState 声明。委托方给的 51/16/5/3 是把 useState 解构行计入的 `grep -c "setNotice"` 计数 |
| 遮挡问题 | 全项目 11 个 modal/overlay 全部 `z-50`（1 个下拉 `z-30`），notice banner 是无定位的文档流元素 → **任何 modal 打开期间 notice 完全不可见** |
| portal 能力 | hono 4.13.7 的 `hono/jsx/dom` **原生导出 `createPortal`**；现有浮层均未使用，全部组件树内条件渲染 |
| 动画基础 | Tailwind v4 CSS-first：`styles.css` 仅 1 行 import，无 config / `@theme` / 自定义 keyframes；只有内置 `animate-pulse`/`animate-bounce` 被用过 |
| spec 待修订 | `.trellis/spec/api-worker-ui/frontend/state-management.md` L24、L44（含「不引入 toast 库」原文） |

---

## 1. notice 全链路

### 1.1 state 定义（4 份独立 state）

| 组件 | 位置 | 传递给谁 |
|------|------|----------|
| `App.tsx` | `apps/ui/src/App.tsx:35` `const [notice, setNotice] = useState("")` | 仅 `LoginView`（App.tsx:172-173），管理员的登录页场景 |
| `AdminApp.tsx` | `apps/ui/src/AdminApp.tsx:78` | `AppLayout`（AdminApp.tsx:1066 `notice={notice}`） |
| `UserApp.tsx` | `apps/ui/src/UserApp.tsx:75` | **不下发**，UserApp 自己渲染 banner（见 1.3） |
| `PublicApp.tsx` | `apps/ui/src/PublicApp.tsx:32` | `UserRegisterView`（PublicApp.tsx:152）、`UserLoginView`（PublicApp.tsx:197） |

四份 state 互不相通。App.tsx 的 notice 只覆盖管理员登录；AdminApp/UserApp/PublicApp 各管各的。features/ 下所有 View 组件**零 setNotice 调用**（`grep -rn setNotice apps/ui/src/features/` = 0 命中），全部通过 `onXxx` 回调冒泡到顶层容器后由容器 setNotice。

### 1.2 UserApp 的 layout：独立实现，不复用 AppLayout

`UserApp.tsx:464-504` 自行内联了与 `AppLayout.tsx` 几乎相同的布局结构（移动端顶栏 / 移动端抽屉 / 桌面侧栏 / main 区），是复制粘贴式的平行实现：

- 移动端顶栏：UserApp.tsx:328（`sticky top-0 z-40`）≈ AppLayout.tsx:35
- 移动端抽屉：UserApp.tsx:371（`fixed inset-0 z-50`）≈ AppLayout.tsx:79
- 桌面侧栏 + main：UserApp.tsx:415-504 ≈ AppLayout.tsx:107-191

差异：UserApp 的 main **没有** `overflow-hidden` 包裹的独立滚动区（AppLayout.tsx:133、190），banner 类名用 `mt-4` 而 AppLayout 用 `mb-4 shrink-0`。任何 toast 容器方案都要面对「两套 layout 各自渲染一次」的现状。

### 1.3 banner 渲染点（6 处）

所有 banner 样式同源：`rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700`（amber 单色，三种语义共用一套视觉）。

| # | 文件:行号 | 完整类名 | 位置说明 |
|---|-----------|----------|----------|
| 1 | `apps/ui/src/features/AppLayout.tsx:186-190` | `mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 shrink-0` | AdminApp 专用；`<main>`（AppLayout.tsx:133，带 `overflow-hidden`）内、页头之下、可滚动内容区（AppLayout.tsx:191）之上 |
| 2 | `apps/ui/src/UserApp.tsx:495-499` | `mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700` | UserApp 独立 layout 的 main 内、页头之下 |
| 3 | `apps/ui/src/features/LoginView.tsx:49-53` | `mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700` | 管理员登录卡片（max-w-md）内、表单之下 |
| 4 | `apps/ui/src/features/UserLoginView.tsx:160-164` | `mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700` | 用户登录卡片内 |
| 5 | `apps/ui/src/features/UserRegisterView.tsx:167-171` | 同上 | 仅 `registrationMode === "linuxdo_only"` 分支内渲染（该分支起于 UserRegisterView.tsx:105 附近） |
| 6 | `apps/ui/src/features/UserRegisterView.tsx:327-331` | 同上 | 开放注册分支表单之下；条件为 `{(error || notice) && ...}`，与**视图本地校验 error**（UserRegisterView.tsx:33 `useState("")`，39/43/47 setError）合并显示，`error` 优先 |

注意点：
- 渲染条件统一是 `{notice && ...}`（第 6 处是 `{(error || notice) && ...}`），空字符串即隐藏，无退场动画。
- notice 一条字符串一次只显示一条；新 setNotice 直接覆盖旧值。
- 三个登录/注册视图（3-6 号）不存在 modal 遮挡问题，但 6 号存在「本地 error 与全局 notice 两条并行错误通道」的事实。

---

## 2. setNotice 调用点全量分类

计数口径澄清：`grep -c "setNotice"` 的 51/16/5/3 含各文件的 `useState` 解构行；下表为**真实调用点**：AdminApp 50、UserApp 15、PublicApp 4、App 2，合计 71。

语义分类标准：
- **success** = 操作成功确认（"xx已创建/已删除/已保存"）
- **error** = catch 分支的 `(error as Error).message`，以及明确的前置校验失败文案
- **info** = 中性/兜底信息（剪贴板不可用时的令牌/邀请码原文兜底、"没有新模型可加入"）
- **clear** = `setNotice("")` 复位

### 2.1 AdminApp.tsx（50 处）

| 行号 | 消息摘要 | 语义 | 弹窗期间？ |
|------|----------|------|-----------|
| 190 | `""`（loadTab 开头复位） | clear | 否 |
| 207 | `(error as Error).message`（loadTab catch） | error | 否 |
| 301 | `""`（openChannelCreate 打开弹窗时复位） | clear | 打开 ChannelModal 时 |
| 306 | `""`（openTokenCreate） | clear | 打开 TokenModal 时 |
| 373 | `""`（startChannelEdit） | clear | 打开 ChannelModal 时 |
| **391** | 「渠道名称已存在，请使用其他名称」 | error（提交校验） | **ChannelModal 开着，不关闭 → 被遮挡** |
| 448 | 「渠道已更新」 | success | setNotice 后同步 `closeChannelModal()`（L449）→ 关闭后可见 |
| 454 | 「渠道已创建」 | success | 同上（L456 关闭） |
| **459** | `(error as Error).message`（渠道提交 catch） | error | **ChannelModal 保持打开 → 被遮挡** |
| 492 | `` `新令牌: ${result.token}` `` | success | 随后 `setTokenModalOpen(false)`（L494）→ 关闭后可见 |
| **498** | `(error as Error).message`（令牌创建 catch） | error | **TokenModal 保持打开 → 被遮挡** |
| 534 | 「设置已更新」 | success | 否 |
| 536 | `(error as Error).message`（设置 catch） | error | 否 |
| **544** | 「请先填写 Base URL」 | error（校验） | **ChannelModal 开着（「拉取模型」按钮触发）→ 被遮挡** |
| **574** | `(error as Error).message`（fetch_models catch） | error | **ChannelModal 开着 → 被遮挡**（成功路径不开 notice，而是打开 picker） |
| **616** | 「没有新模型可加入（已存在或未选择）」 | info | **ChannelModal 开着**（picker 已关，渠道弹窗未关）→ 被遮挡 |
| **628** | `` `已加入 ${additions.length} 个模型` `` | success | **ChannelModal 开着 → 被遮挡** |
| 643 | `` `连通测试完成，模型数 N` `` | success | 否 |
| 645 | `(error as Error).message`（连通测试 catch） | error | 否 |
| 657 | 「渠道已删除」 | success | 否（原生 `window.confirm`，AdminApp.tsx:653） |
| 662 | error（渠道删除 catch） | error | 否 |
| 677 | 「渠道已启用/停用」 | success | 否 |
| 679 | error（渠道状态 catch） | error | 否 |
| 691 | 「令牌已删除」 | success | 否（window.confirm L687） |
| 693 | error（令牌删除 catch） | error | 否 |
| 706 | 「未找到令牌」 | error | 否 |
| 711 | 「令牌已复制到剪贴板：{token}」 | success | 否 |
| 713 | 「令牌: {token}」 | info（剪贴板失败兜底） | 否 |
| 716 | error（reveal catch） | error | 否 |
| 731 | 「令牌已启用/停用」 | success | 否 |
| 733 | error（令牌状态 catch） | error | 否 |
| 750 | 「邀请码已生成」 | success | 否 |
| 752 | error（邀请码生成 catch） | error | 否 |
| 766 | 「邀请码已删除」 | success | 否 |
| 768 | error（邀请码删除 catch） | error | 否 |
| 782 | 「邀请码已复制到剪贴板」 | success | 否 |
| 784 | `` `邀请码:\n${text}` `` | info（兜底） | 否 |
| 787 | error（导出 catch） | error | 否 |
| 794 | 「日志已刷新」 | success | 否 |
| 796 | error（日志刷新 catch） | error | 否 |
| 808 | 「别名已保存」 | success | AliasEditModal 在 `await onSave` 成功后才 `onClose()`（ModelsView.tsx:234-235）→ 关闭后可见 |
| **810** | error（别名保存 catch） | error | **onSave 抛错 → ModelsView 的 `onClose()` 不执行 → AliasEditModal 保持打开 → 被遮挡** |
| 831 | 「价格已保存」 | success | PriceEditModal 同上（ModelsView.tsx:411-412）→ 关闭后可见 |
| **833** | error（价格保存 catch） | error | **PriceEditModal 保持打开 → 被遮挡** |
| 856 | 「用户已创建」 | success | UsersView 创建弹窗**同步先关**（UsersView.tsx:50-58，不等 onCreate 结果）→ banner 可见 |
| 858 | error（用户创建 catch） | error | 弹窗已同步关闭 → banner 可见（但表单上下文已丢失） |
| 872 | 「用户已更新」 | success | 同步先关（UsersView.tsx:94-96）→ 可见 |
| 874 | error（用户更新 catch） | error | 同上 |
| 886 | 「用户已删除」 | success | 否（window.confirm L882） |
| 888 | error（用户删除 catch） | error | 否 |

### 2.2 UserApp.tsx（15 处）

| 行号 | 消息摘要 | 语义 | 弹窗期间？ |
|------|----------|------|-----------|
| 93 | 「Linux DO 账号绑定成功」 | success | 否（URL 回跳参数触发，UserApp.tsx:82-95） |
| 105 | `errorMessages[bindError] ?? 绑定失败：...` | error | 否 |
| 108 | 「充值成功，余额已更新」 | success | 否（URL 回跳 `?recharge=ok`） |
| 156 | `""`（loadTab 复位） | clear | 否 |
| 168 | error（loadTab catch） | error | 否 |
| 207 | 「Linux DO 账号已解除绑定」 | success | 否 |
| 210 | error（解绑 catch） | error | 否 |
| 221 | `` `新令牌: ${result.token}` `` | success | UserTokensView 创建弹窗同步先关（UserTokensView.tsx:33-38 `resetModal()`）→ 可见 |
| 224 | error（令牌创建 catch） | error | 弹窗已同步关闭 → 可见 |
| 235 | 「令牌已删除」 | success | 否 |
| 237 | error（令牌删除 catch） | error | 否 |
| 250 | 「未找到令牌」 | error | 否 |
| 255 | 「令牌已复制到剪贴板：{token}」 | success | 否 |
| 257 | 「令牌: {token}」 | info（兜底） | 否 |
| 260 | error（reveal catch） | error | 否 |

### 2.3 PublicApp.tsx（4 处）

| 行号 | 消息摘要 | 语义 | 弹窗期间？ |
|------|----------|------|-----------|
| 68 | `errorMessages[linuxdoError] ?? 授权失败：...`（LinuxDO OAuth 回跳，9 种错误码映射，PublicApp.tsx:57-67） | error | 否 |
| 76 | `""`（navigate 切换登录/注册页复位） | clear | 否 |
| 89 | error（用户登录 catch） | error | 否 |
| 115 | error（用户注册 catch） | error | 否 |

### 2.4 App.tsx（2 处）

| 行号 | 消息摘要 | 语义 | 弹窗期间？ |
|------|----------|------|-----------|
| 159 | `""`（管理员登录成功复位） | clear | 否 |
| 161 | error（管理员登录 catch，App.tsx:141-163 handleAdminLogin） | error | 否 |

### 2.5 被遮挡重灾区汇总（modal 打开期间的 setNotice）

| 场景 | 调用点 | 遮挡原因 |
|------|--------|----------|
| 渠道表单提交失败 / 重名校验 | AdminApp.tsx:391、459 | ChannelModal（ChannelsView.tsx:676）catch 分支不关闭 |
| 渠道表单提交成功 | AdminApp.tsx:448、454 | 同步关弹窗，**关后可见**（唯一例外方向） |
| 拉取模型：缺 Base URL / 请求失败 | AdminApp.tsx:544、574 | ChannelModal 开着 |
| 模型 picker 确认：无新增 / 已加入 N 个 | AdminApp.tsx:616、628 | picker 关闭但外层 ChannelModal 仍开着 |
| 令牌创建失败 | AdminApp.tsx:498 | TokenModal（TokensView.tsx:301）catch 不关闭 |
| 别名保存失败 | AdminApp.tsx:810 | AliasEditModal（ModelsView.tsx:242）：onSave 抛错时 `onClose()` 不执行 |
| 价格保存失败 | AdminApp.tsx:833 | PriceEditModal（ModelsView.tsx:419）：同上 |

规律：**凡「容器先 await API、成功才关弹窗」的弹窗（Channel/Token/Alias/Price），失败分支 notice 必被遮挡；凡「View 先同步关弹窗、容器再发请求」的弹窗（UsersView、UserTokensView），notice 可见但成功失败文案都出现在已关闭的上下文之外。** 两种时序并存。

---

## 3. 弹窗结构与 z-index

### 3.1 全部 modal / overlay 清单

| 组件 | 文件:行 | 根类名 | z-index |
|------|--------|--------|---------|
| AnnouncementModal 站点公告 | App.tsx:294-302（根 div 在 302） | `fixed inset-0 z-50 flex items-center justify-center`，遮罩按钮 `bg-black/40 backdrop-blur-sm`（304-309），面板 `relative z-10`（309） | z-50 |
| AppLayout 移动端抽屉 | AppLayout.tsx:79 | `fixed inset-0 z-50 lg:hidden`，遮罩 `bg-stone-900/40` | z-50 |
| AppLayout 移动端顶栏 | AppLayout.tsx:35 | `sticky top-0 z-40` | z-40 |
| UserApp 移动端抽屉 | UserApp.tsx:371 | `fixed inset-0 z-50 lg:hidden` | z-50 |
| UserApp 移动端顶栏 | UserApp.tsx:328 | `sticky top-0 z-40` | z-40 |
| ChannelModal 渠道表单弹窗 | ChannelsView.tsx:676 | `fixed inset-0 z-50 flex items-end md:items-center justify-center bg-stone-900/40`（移动端底部抽屉式 `items-end`、`rounded-t-2xl`） | z-50 |
| 拉取模型 picker | ChannelsView.tsx:862 | `fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4`，**嵌套渲染在 ChannelModal 内部**（位于「模型列表」textarea 下方） | z-50（嵌套） |
| AliasEditModal 别名编辑 | ModelsView.tsx:242 | `fixed inset-0 z-50 flex items-end ... bg-stone-900/40` | z-50 |
| PriceEditModal 价格编辑 | ModelsView.tsx:419 | 同上 | z-50 |
| UserTokensView 创建令牌 | UserTokensView.tsx:150 | `fixed inset-0 z-50 flex items-center justify-center` | z-50 |
| UsersView 创建用户 | UsersView.tsx:270-271 | `fixed inset-0 z-50 flex items-center justify-center` | z-50 |
| UsersView 编辑用户 | UsersView.tsx:389-390 | 同上 | z-50 |
| UsersView 可用模型 picker | UsersView.tsx:554-555 | `fixed inset-0 z-50 ... bg-black/40 p-4`（嵌套于编辑弹窗场景使用） | z-50 |
| TokensView 创建令牌（TokenModal） | TokensView.tsx:301 | `fixed inset-0 z-50 flex items-end md:items-center ... bg-stone-900/40` | z-50 |
| Playground 模型下拉（非 modal） | PlaygroundView.tsx:239 | `absolute left-0 top-full z-30` | z-30 |

原生 `window.confirm`（非组件）：AdminApp.tsx:653（渠道删除）、687（令牌删除）、882（用户删除）。

### 3.2 遮挡关系分析

- notice banner（AppLayout.tsx:186-190、UserApp.tsx:495-499）是 `<main>` 内**无 position / 无 z-index 的文档流元素**。
- 所有 modal 根节点 `fixed inset-0 z-50` 建立了覆盖整个视口的层叠上下文 → modal 打开期间 banner 被半透明遮罩（`bg-stone-900/40` 或 `bg-black/40`）盖住，物理上不可读。
- 拉取模型 picker 是**双层嵌套**（ChannelsView.tsx:862 位于 676 的 ChannelModal 内部），此时有遮罩叠遮罩；两层的 setNotice 都打在 banner 上，被两层遮罩遮挡。
- 项目 z-index 语义只有三档：z-30（下拉）< z-40（sticky 顶栏）< z-50（一切 modal/抽屉）。无 z-60+ 或专用浮层层。

### 3.3 弹窗挂载方式（现状基线）

全部 modal 均为**组件树内条件渲染**（`{isOpen && <div class="fixed inset-0 z-50">...}`），无一处使用 portal 或 `document.body.appendChild`。AnnouncementModal 挂在 App.tsx:258、285（用户路由 / 公开路由两处条件渲染）；ChannelModal 挂在 ChannelsView 组件返回树末端（ChannelsView.tsx:719-725 开头）。即：所有浮层 DOM 都是 `#app` 树内后代节点，依赖 `position: fixed` 脱离布局，而非 DOM 结构脱离。

---

## 4. API 错误流（core/api.ts）

`apps/ui/src/core/api.ts`（全文 40 行）：

- `createApiFetch(token, onUnauthorized): ApiFetch<T>`（api.ts:12-40）。`ApiFetch = <T>(path, options?) => Promise<T>`（api.ts:4）。
- 请求：`fetch(\`${apiBase}${path}\`)`，强制 `Content-Type: application/json`（api.ts:19），token 存在时加 `Authorization: Bearer`（api.ts:20-22）。
- **错误抛出方式**（api.ts:24-34）：`!response.ok` 时 → ① 若 `status === 401` 先调用 `onUnauthorized()`（各容器传入 `() => updateToken(null)` 登出，AdminApp.tsx:104、UserApp.tsx:115）；② 尝试 `response.json()` 取 `payload.error` 字段，失败则 fallback `` `HTTP ${response.status}` ``；③ `throw new Error(...)`。
- 因此调用侧 catch 拿到的 message 只有两种来源：后端 JSON 错误体的 `error` 字符串，或 `HTTP 502` 之类的状态码文案。
- **401 的双重行为**：onUnauthorized 清 token 会让 App 重渲染并卸载 AdminApp/UserApp（App.tsx:170-186），其 notice state 随组件销毁——catch 里随后执行的 setNotice 实际写进了一个即将卸载的组件。
- **绕过 apiFetch 的特例**：AdminApp.handleExportCodes（AdminApp.tsx:772-788）直接用原生 `fetch("/api/invite-codes/export", { headers: { "x-admin-token": token } })` + `res.text()`，不走 createApiFetch 的错误规范化——它的 catch message 可能是任意网络错误文案。
- App.tsx 顶层自己也直接用 `createApiFetch`（App.tsx:69、97、121），传 `() => {}` 或登出回调。

toast 方案需要兼容的错误来源：① apiFetch 规范化的 `error` 字符串 / `HTTP xxx`；② handleExportCodes 的裸 fetch 错误；③ 纯前端校验文案（AdminApp.tsx:391、544；UserRegisterView 本地 error）；④ OAuth 回跳错误码映射表（PublicApp.tsx:57-67、UserApp.tsx:97-104）；⑤ 401 触发登出后组件卸载的时序。

---

## 5. hono/jsx/dom 渲染能力

- 版本：`hono ^4.11.9`（apps/ui/package.json），实际安装 **4.13.7**（apps/ui/node_modules/hono/package.json）。
- **`createPortal` 原生存在**：`apps/ui/node_modules/hono/dist/types/jsx/dom/index.d.ts:14-15` 从 `./render` 导入，`:19` 在公开导出清单中，`:84` 签名为 `createPortal: (children: Child, container: HTMLElement, key?: string) => Child`。可直接 `import { createPortal } from "hono/jsx/dom"`。运行时实现位于 `apps/ui/node_modules/hono/dist/jsx/dom/render.js`（grep "portal" 命中）。
- 其他相关导出（index.d.ts:19）：`flushSync`、`startViewTransition`、`useTransition`、`Suspense`、`ErrorBoundary` 等，能力面接近 React。
- 入口挂载：`App.tsx:14-18` 取 `document.querySelector("#app")`，`App.tsx:346` `render(<App />, root)`。
- **项目现有浮层全部没用 portal**：AnnouncementModal、ChannelModal、各 picker 均为条件渲染（见 §3.3）。没有 `document.body.appendChild` 用例。
- `createPortal` 在项目中的使用数为 0 —— 引入它属于新先例，而非沿用既有模式。

---

## 6. 动画基础

- **Tailwind v4 CSS-first 配置**：`apps/ui/src/styles.css` 全文仅 1 行 `@import "tailwindcss";`。无 `tailwind.config.*`（apps/ui 与仓库根均无），无 `@theme` 块，无自定义 `@keyframes`，无自定义 CSS 变量。构建链：`@tailwindcss/postcss ^4.1.18` + `postcss ^8.5.6`（apps/ui/package.json）。
- 项目已用到的**内置 animation 类**仅两处，都在 PlaygroundView：`animate-pulse`（PlaygroundView.tsx:309，流式光标）、`animate-bounce`（PlaygroundView.tsx:319-323，加载点动画，配 inline `animation-delay: 0.1s/0.2s` 错开）。
- **transition 微交互模式**（全站按钮的既定语汇，可作 toast 风格参照）：
  - 主流按钮：`transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-amber-400/70`（如 AppLayout.tsx:127、ChannelsView.tsx:389 等，出现频次极高）
  - 徽章/次级元素：`transition-colors`（ChannelsView.tsx:110、128 等）
  - 遮罩：`backdrop-blur-sm`（App.tsx:305 AnnouncementModal 独有；其余 modal 遮罩无模糊）
- 时长语义全站统一 `duration-200`，无其他 duration 档位。
- 结论性事实：toast 的进出场 keyframes 需要新增（`@theme` 的 `--animate-*` 或手写 `@keyframes`），项目目前没有任何自定义动画基建可复用。

---

## 7. spec 现状（待修订条目）

文件：`.trellis/spec/api-worker-ui/frontend/state-management.md`

| 位置 | 原文 | 与本次改造的冲突 |
|------|------|------------------|
| L10-16（Overview 架构图） | `App.tsx ── adminToken/userToken ... / ├─ AdminApp ── 管理端全部领域数据 (data: AdminData)、表单、分页、notice / └─ UserApp ── 用户端领域数据、表单、notice / └─ features/*View ── 零状态，纯 props` | 若引入跨组件 toast 状态，此图与「零外部状态库」总述需同步 |
| L24 | 「…用户反馈统一走 `notice: string` state。」 | notice 载体变化的直接冲突点 |
| **L44** | 「3. 错误流：apiFetch throw → handleXxx catch → `setNotice(错误信息)`；**不引入 toast 库**。」 | **明文禁令**，本次改造必须修订的核心条目 |

补充：该 spec 另有两处相关背景——L26-30「服务端数据按 Tab 域聚合在容器 state」、L40-42「token 是唯一全局持久状态」。若 toast 状态放进顶层容器或模块级 store，与 L44 同属「Data flow rules」章节，需一并改写。其余 spec 文件（component-guidelines.md 等）经查无 toast/notice 相关条目（grep "toast\|notice" 仅命中 state-management.md）。

---

## 8. 其他影响实现的事实

### 8.1 Working tree 未提交改动

`git diff` 显示 AdminApp.tsx（+11/-1）与 ChannelsView.tsx（+20/-1）有未提交改动，内容为「拉取模型默认只预勾选已存在模型 + picker 显示『已存在』徽标 + 确认按钮改算新增数」（AdminApp.tsx:561-570、ChannelsView.tsx:311-314、331-337、926-930、949）。**与 notice/toast 无功能交集**，但本文行号基于此 working tree；若后续 reset，AdminApp.tsx:574 之后的行号会偏移约 -7。

### 8.2 notice 复位时机模式

- 切 Tab 复位：AdminApp.tsx:190、UserApp.tsx:156（loadTab 开头 `setNotice("")`）。
- 打开弹窗复位：AdminApp.tsx:301、306、373（打开 ChannelModal/TokenModal 时清掉旧 banner）。
- 切页复位：PublicApp.tsx:76。
- 登录成功复位：App.tsx:159。
- 即现状存在「进入新上下文前主动清空旧通知」的手工纪律，clear 调用共 7 处：AdminApp 190/301/306/373（4 处）、UserApp 156、PublicApp 76、App 159。

### 8.3 每次只存一条字符串

`notice: string` 单值模型意味着：连续两次操作时前一条通知被无声覆盖；长文案（如 AdminApp.tsx:784 的多行邀请码导出、711/713 的完整令牌明文）直接塞进 banner，无截断/展开机制。令牌/邀请码明文展示目前**依赖 banner 常驻**（不自动消失），是「toast 自动消失」设计必须正面处理的存量用例（5 处：AdminApp 492、711、713、784；UserApp 221、255、257）。

### 8.4 移动端布局差异

ChannelModal（ChannelsView.tsx:676）与 AliasEditModal/PriceEditModal（ModelsView.tsx:242、419）、TokenModal（TokensView.tsx:301）在移动端是**底部抽屉式**（`items-end` + `rounded-t-2xl`），桌面端居中弹窗。若 toast 放底部，移动端与底部抽屉弹窗同屏时的空间关系是现状事实之一。

---

## 附：证据文件清单

| 文件 | 用途 |
|------|------|
| `apps/ui/src/App.tsx`（347 行） | App 级 notice、AnnouncementModal、render 入口 |
| `apps/ui/src/AdminApp.tsx`（1076 行） | 50 处 setNotice、AppLayout 传递 |
| `apps/ui/src/UserApp.tsx`（504 行） | 15 处 setNotice、独立 layout |
| `apps/ui/src/PublicApp.tsx`（207 行） | 4 处 setNotice、登录/注册分发 |
| `apps/ui/src/features/AppLayout.tsx`（194 行） | AdminApp banner 渲染点 |
| `apps/ui/src/features/LoginView.tsx`（55 行）/ `UserLoginView.tsx` / `UserRegisterView.tsx` | 三个登录视图 banner |
| `apps/ui/src/features/ChannelsView.tsx`（1118 行） | ChannelModal + 模型 picker 双层弹窗 |
| `apps/ui/src/features/ModelsView.tsx` / `UsersView.tsx` / `TokensView.tsx` / `UserTokensView.tsx` / `PlaygroundView.tsx` | 其余 modal 与动画用例 |
| `apps/ui/src/core/api.ts`（40 行） | createApiFetch 错误流 |
| `apps/ui/src/styles.css`（1 行）、`apps/ui/package.json` | Tailwind v4 配置形态 |
| `apps/ui/node_modules/hono/dist/types/jsx/dom/index.d.ts` | createPortal 签名 |
| `.trellis/spec/api-worker-ui/frontend/state-management.md` | 待修订 spec 条目 |
