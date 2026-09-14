# Backend Development Guidelines — api-worker

> `apps/worker`（Cloudflare Workers + Hono + D1）后端规范索引。内容均来自真实代码与任务教训，随任务持续增补。

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | index.ts 唯一挂载点、鉴权放行清单、routes 薄壳 + services 下沉 | ✅ Filled |
| [Database Guidelines](./database-guidelines.md) | D1 迁移与 schema.sql 同步、幂等性分层（Migrations 章节已填，Query Patterns 待补） | 🟡 Partial |
| [Error Handling](./error-handling.md) | jsonError 统一错误形态、snake_case 错误码 | 🟡 Partial |
| [Quality Guidelines](./quality-guidelines.md) | 提交门禁（check/typecheck/test）、Biome 规则、命名、禁则 | ✅ Filled |
| [Logging Guidelines](./logging-guidelines.md) | console.* 前缀标签惯例、错误靠 jsonError/落库不打日志 | ✅ Filled |
| [Proxy Headers](./proxy-headers.md) | 上游请求头策略契约（全局注入/剔除/渠道级）、settings 新增配置项标准链路 | ✅ Filled |

---

## Sources

- `AGENTS.md`（agent 规范唯一事实来源，本目录与其互补不重复）
- 真实任务教训：`4fac541` D1 迁移/错误处理、`0b09027` 质量门禁 0 error

**Language**: 与 AGENTS.md 一致，中文为主。
