# Quality Guidelines

> Code quality gates and standards for the worker package (evidence-based).

---

## Gates (提交前必跑，顺序固定)

```bash
bun run check        # Biome：全仓 0 error（唯一豁免见下）
bun run typecheck    # tsc --noEmit，strict: true，0 error
bun run test         # Vitest，tests/*.test.ts 全绿
```

- `bun run check` 判定：error 数为 **0 或 1**。唯一的 1 是 `.pi/extensions/trellis/index.ts` 的 `noSelfAssign`（Trellis 基建文件，来自上游 `trellis update`，**不修改、不要求覆盖**）。
- `bun run check`（含 `--write`）会把 `.trellis/` 下 JSON 簿记文件（如 archive 的 task.json）重排为 tab，这类 diff 是必然产物，**随任务一并提交，不要回滚**。

---

## Formatting & Lint (Biome 2.x)

- Tab 缩进、双引号、`organizeImports: on`（imports 自动排序，手写顺序会被 fix）。
- `files.includes: ["**/*"]` 全仓覆盖——包括 `.pi/`、`.trellis/` 的 TS/JSON，写脚本时也要过 lint。
- 新代码不新增 warning；修老代码顺带清偿所在文件的存量 warning。

## TypeScript

- `strict: true`；禁用非空断言以外的取巧（存量 `!` 断言仅限 legacy，新代码用显式判空 + 提前 return）。
- Hono 请求体解析惯例：`const body = (await c.req.json().catch(() => null)) as XxxPayload | null;` + 紧跟判空。不要让 JSON.parse 异常冒泡。

---

## Error Response Convention

- 统一使用 `utils/http.ts` 的 `jsonError(c, status, message, code?)`，响应形态 `{ error: string, code?: string }`。
- `code` 为**小写 snake_case**（实际在用：`user_not_found`、`email_or_name_exists`、`missing_body`、`channel_unreachable`）。保持已有 code 字符串稳定，前端可能展示 `error` 文案。
- AGENTS.md 写的 `ERR_{模块}_{含义}` 是历史设想；**以代码现实为准**（snake_case），新 code 延续现有风格。

---

## Naming

| 对象 | 风格 | 例 |
|------|------|-----|
| 变量/函数 | camelCase | `fetchChannelModels` |
| 文件 | kebab-case | `channel-testing.ts` |
| 路由注册变量 | 按挂载域名 | `channels`、`newapi` |
| DB 列 | snake_case | `models_json`、`base_url` |

## Tests

- 核心逻辑须有 Vitest 单测，放 `tests/`，文件名 `*.test.ts`（现有：model-allowlist、channel-models、filter-allowed-channels 等）。
- 纯函数优先可测形态：输入输出明确、不依赖 `c`（Context）对象；路由壳薄、逻辑下沉 services/。

## Forbidden Patterns

- 硬编码管理员密码/密钥（业务配置走 `settings` 表，平台配置走 env bindings）。
- 跳过中间件鉴权清单直接加路由——新挂载点必须核对 `index.ts` 的 adminAuth 放行清单。
- 在路由文件里写长业务逻辑（>50 行的分支应下沉 services/）。
- `console.error/warn`（见 logging-guidelines：失败走 jsonError / 落库）。
