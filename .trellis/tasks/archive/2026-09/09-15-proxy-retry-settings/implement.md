# 执行计划：代理重试参数迁移到 settings

## 前置

- [ ] 阅读 `.trellis/spec/api-worker/backend/index.md`、`error-handling.md`、`quality-guidelines.md`、`proxy-headers.md`
- [ ] 阅读 `.trellis/spec/api-worker-ui/frontend/index.md`、`type-safety.md`、`component-guidelines.md`

## Checklist（按序执行）

### 1. worker 服务层
- [ ] `apps/worker/src/services/settings.ts`：新增 `PROXY_RETRY_ROUNDS_KEY` / `PROXY_RETRY_DELAY_MS_KEY` 常量、`DEFAULT_PROXY_RETRY_ROUNDS=2` / `DEFAULT_PROXY_RETRY_DELAY_MS=200`、`ProxyRetryConfig` 类型、`loadProxyRetryConfig(db, envFallback?)`（单条 `key IN (?, ?)` 查询 + clamp）、`setProxyRetryRounds` / `setProxyRetryDelayMs`
- [ ] clamp 实现：rounds `[1,10]`、delayMs `[0,60000]`，非法数值走回退链

### 2. worker 路由层
- [ ] `apps/worker/src/routes/settings.ts`：GET 返回两个新字段；PUT 增加整数 + 范围校验（400 `invalid_proxy_retry_rounds` / `invalid_proxy_retry_delay_ms`）
- [ ] `apps/worker/src/routes/proxy.ts`：`loadProxyRetryConfig` 并入现有 `Promise.all` 预载；重试循环改用其返回值；删除 `c.env.PROXY_RETRY_*` 直接解析
- [ ] `apps/worker/src/routes/anthropic-proxy.ts`：同上（并入 `anthropic-proxy.ts:78` 的 `Promise.all`）
- [ ] `apps/worker/src/routes/playground.ts`：循环前读取一次配置并使用

### 3. 前端
- [ ] `apps/ui/src/core/types.ts`：`Settings` / `SettingsForm` 各加两字段
- [ ] `apps/ui/src/AdminApp.tsx`：`loadSettings` 初始化 + `handleSettingsSubmit` payload
- [ ] `apps/ui/src/features/SettingsView.tsx`：两个 number 输入框（min/max 与后端一致），样式对齐相邻字段

### 4. 测试
- [ ] `tests/proxy-retry-settings.test.ts`：覆盖回退链三分支（settings 优先 / env 回退 / 内置默认）、clamp 边界（0、1、10、11、-1、60001、NaN、非整数字符串）

### 5. 文档
- [ ] `AGENTS.md` §8 补一行"重试参数存 settings（proxy_retry_rounds / proxy_retry_delay_ms），env 为兼容回退"；§11 环境变量表标注两变量已降级为回退值

## 验证命令

```bash
bun run check        # Biome
bun run typecheck    # tsc --noEmit
bun run test         # Vitest
```

## 审查关口

- 实现完成后必须由 trellis-check 全量核查（重点：预载无新增串行往返、错误码命名、clamp 一致性、UI 字段与类型同步）。
- 全绿后才允许进入 Phase 3.3 spec 更新与 3.4 提交。

## 回滚点

- 全部改动位于 worker src + ui src + tests + AGENTS.md，无迁移文件；单 commit revert 即完全回滚。
