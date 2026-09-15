# 技术设计：代理重试参数迁移到 settings

## 数据流与边界

```
管理台 SettingsView ──PUT /api/settings──▶ routes/settings.ts ──▶ services/settings.ts ──▶ settings 表
                                                                        │
代理请求 ──▶ routes/proxy.ts / anthropic-proxy.ts / playground.ts ◀──────┘
             （Promise.all 并行预载：渠道列表 + loadProxyHeaderPolicy + loadProxyRetryConfig）
```

## 新增契约

### services/settings.ts

```ts
export type ProxyRetryConfig = { rounds: number; delayMs: number };

// 单条 SQL 读两个键（key IN (?, ?)），仿照 utils/proxy-headers.ts 的 loadProxyHeaderPolicy 模式
export async function loadProxyRetryConfig(
	db: D1Database,
	envFallback?: { rounds?: string; delayMs?: string },
): Promise<ProxyRetryConfig>;
```

- **回退链**：settings 值 → `envFallback`（调用方传 `c.env.PROXY_RETRY_ROUNDS` / `c.env.PROXY_RETRY_DELAY_MS`）→ 内置默认 `{ rounds: 2, delayMs: 200 }`。
- **clamp 规则**（读取侧统一执行，容错脏数据）：
  - rounds：`Math.min(10, Math.max(1, n))`；非数值/缺失走回退链。
  - delayMs：`Math.min(60000, Math.max(0, n))`；非数值/缺失走回退链。
- 键名常量：`PROXY_RETRY_ROUNDS_KEY = "proxy_retry_rounds"`、`PROXY_RETRY_DELAY_MS_KEY = "proxy_retry_delay_ms"`。
- 同时导出 `DEFAULT_PROXY_RETRY_ROUNDS = 2`、`DEFAULT_PROXY_RETRY_DELAY_MS = 200` 供路由层 GET 兜底与测试复用。

### routes/settings.ts（PUT 校验，沿用现有惯例）

```ts
if (body.proxy_retry_rounds !== undefined) {
	const n = Number(body.proxy_retry_rounds);
	if (!Number.isInteger(n) || n < 1 || n > 10) → 400 "invalid_proxy_retry_rounds"
	await setProxyRetryRounds(c.env.DB, n);
}
if (body.proxy_retry_delay_ms !== undefined) {
	const n = Number(body.proxy_retry_delay_ms);
	if (!Number.isInteger(n) || n < 0 || n > 60000) → 400 "invalid_proxy_retry_delay_ms"
	await setProxyRetryDelayMs(c.env.DB, n);
}
```

配套 `setProxyRetryRounds` / `setProxyRetryDelayMs`（`upsertSetting` + `toString()`）。
GET 返回当前存储值，键缺失时返回内置默认（rounds=2 / delayMs=200）。

### 三个代理调用点改造

| 文件 | 现状 | 改造 |
|------|------|------|
| `routes/proxy.ts:572` | `Math.max(1, Number(c.env.PROXY_RETRY_ROUNDS ?? "1"))` | 配置改由预载阶段取得；`loadProxyRetryConfig` 加入 `proxy.ts:470` 附近的 `Promise.all`（渠道查询 + 头策略） |
| `routes/anthropic-proxy.ts:164` | 同上 | 加入 `anthropic-proxy.ts:78` 的 `Promise.all`（渠道查询 + 头策略） |
| `routes/playground.ts:80` | 同上 | 循环前单独 `await loadProxyRetryConfig(...)`（该路径原本无预载块，一次小查询可接受） |

改后三处删除对 `c.env.PROXY_RETRY_*` 的直接 `Number()` 解析，统一走 `loadProxyRetryConfig`，消灭三份重复的 clamp 逻辑。

## UI 改造（三件套，沿用既有模式）

- `core/types.ts`：`Settings` 与 `SettingsForm` 各加 `proxy_retry_rounds`、`proxy_retry_delay_ms`（number / string）。
- `AdminApp.tsx`：
  - `loadSettings` 表单初始化：`String(settings.proxy_retry_rounds ?? 2)`、`String(settings.proxy_retry_delay_ms ?? 200)`。
  - `handleSettingsSubmit` payload：`proxy_retry_rounds: Number(...)`、`proxy_retry_delay_ms: Number(...)`。
- `SettingsView.tsx`：仿「日志保留天数」字段，两个 `type="number"` 输入框（`min`/`max` 与后端一致：1–10、0–60000），放置在系统设置网格中；label 建议带说明文案（"上游失败后的渠道重试轮数"、"重试间隔毫秒"）。

## 权衡与决策记录

1. **settings → env → 内置默认 三级回退**：纯 settings 方案会让"仅用 env 自定义过"的部署在升级后静默丢失配置；三级链保证存量行为零变化。env 变量保留在 wrangler.toml 作为新装实例的默认来源。
2. **内置默认取 2/200 而非代码里的 1/200**：wrangler.toml 一直是 2 轮，实际生效默认就是 2；统一为 2 消除"wrangler 有值、代码兜底是另一个值"的歧义（现 `?? "1"` 属于意外不一致）。
3. **读取侧 clamp 而非读取侧报错**：settings 表可能被手工改库，读取侧容错保证代理路径永不因配置脏值 500。
4. **不做缓存**：与 `loadProxyHeaderPolicy` 同语义——每请求读、改了立即生效；D1 单行读成本已在头策略上被接受，保持一致性优先。
5. **PUT 校验用 `Number.isInteger`**：防止 `"2.5"`、`"2e3"` 之类的值入库；与现有 `Number.isNaN` 风格略有收紧，但范围校验（1–10）本身要求整数语义。

## 兼容性 / 回滚

- 无 DB 迁移（settings 为现成 KV 表，键动态存在）。
- 回滚 = revert 提交即可；settings 表中残留的两个键不会被旧代码读取，无害。
- 部署顺序无敏感点：worker 先行时 UI 尚无入口（配置仍走 env 回退）；UI 先行时 PUT 会报错 404（路由不存在），前端 toast 提示失败，无数据损坏。标准流程是 both 一起发（仓库现有 GitHub Actions 已支持）。
