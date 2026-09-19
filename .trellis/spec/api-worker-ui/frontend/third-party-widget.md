# Third-Party Widget — 动态第三方脚本挂载模式

> 来自任务 `09-19-auth-turnstile`（Turnstile 为全仓首个第三方脚本先例）。需要在前端挂载任何 CDN 脚本型组件（验证码、支付、客服窗口等）前必读。

---

## Scenario: 挂载 CDN 脚本型第三方组件

### 1. Scope / Trigger

- 新增运行时加载外部 JS 的组件（`<script src="https://...">` 型，无 npm 包或刻意按需加载）。

### 2. Signatures

```ts
// apps/ui/src/core/turnstile.ts —— 加载器与最小类型声明分离于组件
export type TurnstileApi = { render: ...; reset: ...; remove: ... };
export function loadTurnstileScript(): Promise<TurnstileApi>; // 单例 Promise：并发去重、失败可重试
declare global { interface Window { turnstile?: TurnstileApi } } // 类型声明置于 loader 文件
```

```tsx
// apps/ui/src/features/Turnstile.tsx —— 组件壳 props 契约
type TurnstileProps = { siteKey: string; onToken: (token: string) => void; resetSignal: number };
```

### 3. Contracts

- **按需挂载**：脚本注入只发生在组件 effect 内且 `siteKey` 非空；功能未启用时零脚本请求。不在 `index.html` 全局注入。
- **explicit render 到 ref 容器**（非受控 DOM 写入，先例 `SettingsView.tsx`）；卸载必须 `turnstile.remove(widgetId)`。
- **reset 用 resetSignal 计数 prop**（effect 监听变化调 `reset()` + `onToken("")`，跳过首挂载），**不用 forwardRef**（hono/jsx/dom 兼容性不确定）。回调经 `onTokenRef` 转发，避免 effect 依赖抖动。
- **token 一次性**：父容器任何提交失败（非本地校验错误）一律 `resetSignal++`，不区分错误码——服务端验证成功即消耗 token，密码错误重试同样需要新 token。
- `theme: "light"` 固定（全仓无 dark mode）；a11y 用语义容器 + aria 标签（component-guidelines.md）。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 未启用 / siteKey 为空 | 组件不渲染，零脚本请求 |
| 脚本加载失败 | 静默（已知权衡，见任务 design.md）：表单按钮因 token 缺失保持禁用；逃生 = 刷新（loader 失败可重试）或服务端 `TURNSTILE_DISABLED` |
| token 过期（expired-callback） | `onToken("")` 清空，待用户重过验证 |

### 5. Good/Base/Bad Cases

- **Good**：新第三方组件复刻「core 单例 loader + ref 容器 + resetSignal」三件套，回调用 ref 转发。
- **Base**：Turnstile 未配置的部署，页面 Network 面板无任何 challenges.cloudflare.com 请求。
- **Bad**：`index.html` 全局注脚本（所有页面买单）；组件内直接 `document.createElement("script")` 无单例去重、无卸载清理。

### 6. Tests Required

- 项目无前端测试基建：以任务 AC 人工验收清单覆盖（含「启用态断网打开登录页」场景）；后端字段契约由 `tests/turnstile-endpoints.test.ts` 锁定。

### 7. Wrong vs Correct

#### Wrong

```tsx
useEffect(() => {
	const s = document.createElement("script");
	s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
	document.head.append(s); // 每实例重复注入、无清理、无并发去重
}, []);
```

#### Correct

```tsx
useEffect(() => {
	let widgetId: string | undefined;
	let cancelled = false;
	loadTurnstileScript().then((api) => {
		if (cancelled || !containerRef.current) return;
		widgetId = api.render(containerRef.current, { sitekey: siteKey, callback: (t) => onTokenRef.current(t), ... });
	});
	return () => { cancelled = true; if (widgetId) window.turnstile?.remove(widgetId); };
}, [siteKey]);
```
