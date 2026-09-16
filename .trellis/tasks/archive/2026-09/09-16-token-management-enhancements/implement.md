# 实施计划：令牌管理增强

> 执行顺序即依赖顺序；每步末尾标注验证点。设计依据 `design.md`（引用记作 D§）。
> 提交前总闸门：`bun run check && bun run typecheck && bun run test`（AC9）。

## S1 Worker 基础层（D1/D2/D5.1）

- [ ] `apps/worker/src/utils/crypto.ts`：`generateToken(prefix = "", byteLength = 24)`，body 用 `byteLength` 替换硬编码 24（D1）。
- [ ] `apps/worker/src/utils/model-allowlist.ts`：新增 `isModelAllowedByAll`（D3）；移入 `serializeAllowlist`（原 admin-users 私有函数，逻辑逐分支不变，D5.1）。
- [ ] `apps/worker/src/routes/admin-users.ts`：删除私有 `serializeAllowedModels`，改 import `serializeAllowlist`（调用点 L98/L173 附近仅改名）。
- [ ] `apps/worker/migrations/0020_token_allowed_models.sql`：`ALTER TABLE tokens ADD COLUMN allowed_models TEXT;`（D2）。
- [ ] `apps/worker/src/db/schema.sql`：tokens 表 `allowed_channels` 后追加 `allowed_models TEXT,`（D2）。
- [ ] 验证：`bun run typecheck`（admin-users 改名不破）。

## S2 Worker 白名单链路（D4）

- [ ] `apps/worker/src/middleware/tokenAuth.ts`：SELECT 加 `allowed_models`；`TokenRecord` 加 `allowed_models: string | null` 与 `token_allowed_models?`；`c.set` 注入 `parseAllowlist(record.allowed_models)`（D4）。
- [ ] `apps/worker/src/routes/proxy.ts`：chat 校验改 `isModelAllowedByAll([token_allowed_models, user_allowed_models], model)`（L419-423）；`/v1/models` 链式双过滤（L391-395）（D4）。
- [ ] `apps/worker/src/routes/anthropic-proxy.ts`：L58-62 同上（D4）。
- [ ] 验证：`bun run typecheck`。

## S3 Worker 令牌路由（D5.2/D5.3）

- [ ] 新建 `apps/worker/src/services/token-update.ts`：`resolveTokenUpdate` 纯函数，三态矩阵按 design 表格实现（D5.2）。
- [ ] `apps/worker/src/routes/tokens.ts`：
  - GET 列加 `allowed_models`，响应经 `parseAllowlist` 还原数组；
  - POST 支持 `allowed_models`（serializer 校验）+ `allowed_channels` 缺省改存 NULL；
  - PATCH 改走 `resolveTokenUpdate`，失败 400 透出错误码；
  - 两处 `generateToken("sk-")` → `generateToken("sk-", 32)`（其中一处在本文件，另一处在 user-api）。
- [ ] `apps/worker/src/routes/user-api.ts`：
  - `generateToken("sk-")` → `generateToken("sk-", 32)`；
  - GET /tokens 列加 `allowed_models`（响应数组）；
  - POST /tokens 接受可选 `allowed_models`，INSERT 加列；
  - PATCH /tokens/:id 支持 `allowed_models`；body 出现 `quota_total`/`quota_used`/`status`/`allowed_channels` → 400 `field_not_editable`（D5.3）。
- [ ] 验证：`bun run typecheck && bun run test`（现有测试不回归）。

## S4 测试（D9）

- [ ] `tests/model-allowlist.test.ts`：追加 `isModelAllowedByAll` describe（D9 表格全用例）。
- [ ] `tests/crypto-token.test.ts` 新建：长度/charset/默认回归。
- [ ] `tests/token-update.test.ts` 新建：三态矩阵 + 非法值错误码。
- [ ] 验证：`bun run test` 全绿。
- [ ] **Rollback point A**：S1–S4 为纯 worker 改动，可独立回滚（git revert 到 S5 前）。

## S5 UI 基础层（D6.1/D6.4）

- [ ] 新建 `apps/ui/src/features/ModelAllowlistPicker.tsx`：从 UsersView 抽取，契约见 D6.1。
- [ ] `apps/ui/src/features/UsersView.tsx`：重构为消费 picker，行为保持（候选 ∪ 已配置、搜索、排序逻辑原样搬移）。
- [ ] `apps/ui/src/core/types.ts`：`Token` 加 `allowed_models?: string[] | null`。
- [ ] 验证：`bun run typecheck`；手工过一遍用户管理编辑模态（回归 picker 搬移）。

## S6 管理台令牌 UI（D6.2/D6.3）

- [ ] `apps/ui/src/AdminApp.tsx`：`editingToken`/`tokenForm` state；`openTokenEdit`/`closeTokenEdit`/`handleTokenEditSubmit`；`handleTokenSubmit` body 加 `allowed_models`；props 全量下传（含 `onFetchModelCandidates=loadModelCandidates`）。
- [ ] `apps/ui/src/features/TokensView.tsx`：行操作加「编辑」；「模型限制」列（桌面+移动）；创建模态加 picker；新增编辑模态（名称/额度总额(空=无限)/已用额度/picker）。
- [ ] 验证：`bun run typecheck && bun run check`。

## S7 用户端令牌 UI（D7）

- [ ] `apps/ui/src/UserApp.tsx`：`handleTokenCreate` 加 `allowed_models`；新增 `handleTokenEdit`；候选加载（`/api/u/models`）。
- [ ] `apps/ui/src/features/UserTokensView.tsx`：「模型限制」列；创建模态加 picker；新增编辑模态（名称 + picker，无额度）。
- [ ] 验证：`bun run typecheck && bun run check`。

## S8 收尾

- [ ] AGENTS.md 同步：§6 `/api/tokens` 行职责补充「令牌级模型白名单」；§8 代理关键行为补一条「令牌级与用户级模型白名单取交集生效（`/v1/models` 同步过滤）」。
- [ ] 总闸门：`bun run check && bun run typecheck && bun run test`。
- [ ] **Rollback point B**：S5–S7 为纯 UI 改动，可与 worker 部分解耦回滚。

## V 手工验证清单（对照 AC，本地 `bun run dev:worker` + `bun run dev:ui`）

- [ ] V1（AC1/AC2）：新建令牌明文长度 46；旧令牌（或手动造 35 长度记录）仍可调用。
- [ ] V2（AC3/AC4）：管理员给令牌配白名单 → 白名单外模型 403 `model_not_allowed`、`/v1/models` 不返回；叠加用户级白名单验证交集。
- [ ] V3（AC5）：用户端建/编令牌配白名单生效；直接 PATCH `/api/u/tokens/:id` 带 quota 字段 → 400。
- [ ] V4（AC6）：管理台编辑额度：改小/改大/清空（NULL）/已用清零，列表即时反映。
- [ ] V5（AC7）：`bun run --filter api-worker db:migrate` 对已有本地库重放 0020 无错；全新 `db:migrate`（init 路径）建表含新列。

## 审查门

- S4 后：跑一次 `trellis-check`（worker 侧中间检查，可尽早暴露三态语义/白名单链路问题）。
- S8 后：`trellis-check` 全量检查（spec 对齐 + 跨层数据流：DB 列 → tokenAuth 注入 → proxy 消费 → API 响应 → UI 类型 → 模态回填）。
