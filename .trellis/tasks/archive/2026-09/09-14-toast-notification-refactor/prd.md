# 全局通知改造：notice banner 迁移为底部 Toast

## Goal

将前端所有全局操作反馈（成功提示、失败报错、中性信息）从「页面标题下方的 amber banner」迁移为「屏幕底部的 Toast 通知」，彻底解决弹窗（Modal）打开期间提示被遮挡不可见的问题；同时引入 success / error / info 三种视觉语义，并将需要长期查看/复制的明文类信息升级为专用弹窗。

## 背景与问题

- 现状 notice banner 渲染在 `<main>` 文档流中、无定位无 z-index，而全项目 11 个 modal/overlay 全部 `fixed inset-0 z-50` → **任何弹窗打开期间 notice 完全不可见**。
- 重灾场景：渠道表单提交失败/重名校验（AdminApp.tsx:391、459）、拉取模型失败（544、574）、模型 picker 确认（616、628）、令牌创建失败（498）、别名/价格保存失败（810、833）——这些弹窗的 catch 分支不关闭弹窗，错误提示 100% 被遮罩盖死。
- 全站 amber 单色，成功/失败/中性信息无视觉区分。
- 401 登出时组件卸载，notice state 随之销毁，错误消息丢失。
- 令牌明文、邀请码等依赖 banner 常驻展示（5 处），toast 自动消失会弄丢。

## 范围

### 迁移为 Toast（约 66 处）

`AdminApp.tsx`（50 处）、`UserApp.tsx`（15 处）、`PublicApp.tsx`（4 处）、`App.tsx`（2 处）中全部 `setNotice` 调用点，按 research/current-state.md §2 的分类表迁移：

- success 语义 → success toast
- error 语义（catch 分支、前置校验失败）→ error toast
- info 语义 → info toast
- `setNotice("")` 复位（7 处 clear）→ **直接删除**（toast 自带生命周期，无需手工清空）

### 升级为明文弹窗（5 处）

需要长期查看/复制的明文信息改用专用弹窗（标题 + 等宽明文 + 一键复制按钮）：

- AdminApp.tsx:492 新建令牌返回明文
- AdminApp.tsx:711/713 令牌 reveal（剪贴板成功/失败兜底）
- AdminApp.tsx:784 邀请码导出多行兜底文本
- UserApp.tsx:221 新建令牌返回明文
- UserApp.tsx:255/257 令牌 reveal

复制动作的反馈走 success toast。

### 补充迁移：UserDashboard 卡片内操作反馈（实施中追加）

实施阶段发现规划时未清点的存量：`UserDashboard.tsx` 的 `checkinNotice` / `rechargeNotice`（签到卡/充值卡内 amber 提示）。其性质是**操作结果反馈**（签到成功/API 错误），不属于「保留局部」的表单校验/对话区错误范畴，为保持全端操作反馈一致一并迁移：

- 签到：已签到 → toast.info；签到成功 → toast.success；catch → toast.error；state 与 banner 删除。
- 充值：金额校验错误保留卡片内展示（贴近输入框）但改名 `rechargeError`、样式 amber → 红色；catch → toast.error。

### 保留局部展示（不改）

- `UserRegisterView` 本地表单校验 error（密码长度、两次不一致、邀请码必填）——保留在表单内，样式顺手从 amber 改为红色错误语义。
- `PlaygroundView` 对话区错误——保留原位。

### 拆除 notice 机制

- 删除 4 份 notice state（App.tsx:35、AdminApp.tsx:78、UserApp.tsx:75、PublicApp.tsx:32）及全部 props 传递链。
- 删除 6 处 banner 渲染（AppLayout.tsx:186-190、UserApp.tsx:495-499、LoginView.tsx:49-53、UserLoginView.tsx:160-164、UserRegisterView.tsx:167-171 与 327-331 中的 notice 部分）。
- `UserRegisterView.tsx:327-331` 的 `{(error || notice) && ...}` 拆分：本地 error 保留渲染（红色样式），notice 改走 toast。

## Toast 规格（需求约束）

1. **位置**：屏幕底部居中，浮于一切内容之上（z-index 高于全部 modal 的 z-50）。
2. **类型**：success（绿）/ error（红）/ info（中性），与全站 stone/amber 朴素风格协调。
3. **生命周期**：success/info 自动消失约 3 秒，error 约 5 秒；均可手动立即关闭；多条可堆叠。
4. **可达性**：弹窗（含双层嵌套 picker、移动端底部抽屉）打开期间 toast 必须可见。
5. **动画**：底部滑入/淡出，时长与全站 `duration-200` 语汇一致。
6. **401 场景**：登出导致的组件卸载不得吞掉错误 toast（全局 store 保证）。
7. **不引入第三方库**：hono/jsx/dom（非 React），自研轻量实现（createPortal + 模块级 store）。

## Acceptance Criteria

- [ ] 渠道创建弹窗内提交重名渠道 → 不关闭弹窗，error toast 在弹窗之上可见。
- [ ] 拉取模型（ChannelModal + picker 双层弹窗打开时）失败 → error toast 可见。
- [ ] 令牌/别名/价格弹窗保存失败 → error toast 可见，弹窗保持打开。
- [ ] 所有成功操作（渠道/令牌/用户/邀请码 CRUD、绑定、充值等）出现 success toast 并在约 3 秒后自动消失。
- [ ] 新建令牌/令牌 reveal/邀请码导出 → 弹窗展示明文，复制按钮可用且点击后出现 success toast。
- [ ] 注册表单校验错误仍在表单内红色展示；Playground 错误仍在对话区展示。
- [ ] 代码中不再存在 `setNotice` 调用、notice props、notice banner 渲染（grep 验证为 0）。
- [ ] 401 触发登出后错误 toast 仍能展示。
- [ ] `bun run check && bun run typecheck && bun run test` 全绿，且 `bunx biome check apps/ui/src` 0 诊断。
- [ ] 用户端冒烟：每日签到 → success/info toast；充值金额非法 → 卡片内红色错误；用户新建令牌 → 明文弹窗。
- [ ] spec `state-management.md` 的 notice 相关条目（L10-16、L24、L44）已改写为 toast 模式，并新增明文弹窗约定。

## Notes

- 现状事实与逐行分类表见 `research/current-state.md`（71 处调用点、6 处 banner、11 个 modal、createPortal 验证、动画基础）。
- working tree 有 2 个未提交改动文件（AdminApp.tsx、ChannelsView.tsx，模型 picker 预勾选逻辑），与本任务无功能交集；行号基于该 working tree。
- 纯前端改造，无 API / 数据库 / 后端变更。
