# ModelsView 编辑别名/价格模态接入进出场动画

## Goal

补齐 09-15-ui-motion-polish 的遗留项:ModelsView 的 AliasEditModal(编辑别名)与 PriceEditModal(编辑价格)两处模态仍是手写 `fixed inset-0` 结构、零动画,且不符合新沉淀的 Modal 壳约定。

## Background

两处模态的特殊性:内部 state 以 `useState(() => [...initialAliases])` 方式初始化,**依赖容器的条件挂载实现"打开时重置"**。若按 spec 标准模式改为容器常驻渲染 + `isOpen`,需要引入边沿重置逻辑,风险大于收益。

**选定方案(组件内 closing 包装)**:容器与调用点零改动,组件内部包一层:

- `closing` state + `handleClose`(置 closing → 按 `--modal-close-dur` 延迟调用 props.onClose → 容器卸载组件,state 语义不变,下次打开仍是全新实例取新初值)
- `<Modal isOpen={!closing} onClose={handleClose} sheet panelClass>`,动画/Esc/backdrop 点击关闭由 Modal 壳提供

## Requirements

- AliasEditModal、PriceEditModal 两处接入 `features/Modal.tsx`,sheet 形态(现状即 bottom-sheet)。
- 所有关闭路径(顶部关闭钮、底部取消钮、保存成功后的 onClose、Esc、backdrop 点击)统一走 `handleClose`,均播放收场动画后再卸载。
- 面板外观 class 逐字迁移到 `panelClass`,backdrop 用默认 `bg-stone-900/40`(与现状一致)。
- 遵循 spec:动效 token、Modal 壳约定、Biome 格式。

## Acceptance Criteria

- [ ] 两模态 open 250ms scale+fade / close 150ms,移动端 bottom-sheet rise,backdrop 同步淡出。
- [ ] 每次打开均为新实例、表单初值正确(当前模型数据),编辑另一模型不串数据。
- [ ] Esc / backdrop 点击可关闭(现状没有,属 Modal 壳免费增强),快速连续操作无跳变。
- [ ] `bun run check && bun run typecheck && bun run test && bun run build` 全绿。
- [ ] 改动仅限 `apps/ui/src/features/ModelsView.tsx`。
