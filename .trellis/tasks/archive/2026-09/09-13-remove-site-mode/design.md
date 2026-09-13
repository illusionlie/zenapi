# 技术设计：移除站点模式与共享模式，固定服务模式 + 用户级模型限制

> 依据：`prd.md`（含决策点 A/B/C 用户确认）、`research/backend-inventory.md`、`research/frontend-docs-inventory.md`。
> 本文件负责 PRD 留给 design.md 的全部技术决策；行号锚点见两份 inventory。

## 1. 架构与边界

重构后系统形态：

- **运行形态**：无 `site_mode` 分支。行为 = 现行 service 模式：模型广场公开（含价格）、用户注册/登录受 `registration_mode` 控制、`/admin` 管理台不变。
- **删除边界**（后端）：5 个路由文件整体删除（`withdrawal.ts`、`ldoh.ts`、`ldoh-user.ts`、`user-channels.ts`、`services/ldoh-blocking.ts`）；`index.ts` 对应 4 处挂载与 5 处 import 删除；settings 服务删除 8 个键的 get/set；代理双链路删除 shared 过滤 / strict 提现扣费 / 分成入账三块分支。
- **新增边界**：`users.allowed_models` 一列 + 代理请求一处校验 + 两个模型列表端点过滤 + 管理台用户编辑入口。
- **保留边界**：`registration_mode` 全链路、LinuxDO OAuth、令牌级 `allowed_channels`（服务端校验 `filterAllowedChannels` 原样保留）、充值（recharge 保留，仅去掉 withdrawable_balance 列引用）、签到/邀请码/公告。

## 2. 关键技术决策

### D1 用户级模型白名单存储 — `users.allowed_models TEXT`

- 格式：JSON 字符串数组，如 `["gpt-4o","claude-sonnet-4"]`；`NULL` 或空数组 = 不限制。
- 先例：`tokens.allowed_channels TEXT`（同形态 JSON-in-TEXT），`safeJsonParse` 解析模式一致。
- 不建关联表：白名单是单用户低基数配置（几十条），无跨用户查询需求，JSON 列足够且与现有 schema 风格一致。

### D2 校验插入点与语义

**匹配语义**：白名单匹配**请求模型名**（客户端发来的 `body.model` 原文，别名解析之前）。理由：`/v1/models` 与 `/api/u/models` 展示的是 effective mapping 的模型名（含别名），管理台白名单候选也来自同一来源——三处口径天然一致；若匹配别名解析后的真实 ID 会出现「列表显示 A、白名单要填 B」的认知错位。

**后端校验链**（`/v1/*` 与 `/anthropic/v1/*`）：

1. `middleware/tokenAuth.ts`：user_id 令牌的 users 查询（tokenAuth.ts:65-79）增加 `allowed_models` 列，结果并入 `c.set("tokenRecord", { …, user_allowed_models: string[] | null })`。userless 令牌（管理员自用）不查 users、不限制。
2. `routes/proxy.ts` `proxy.all("/*")`：在 `parsedBody.model` 提取（proxy.ts:329-334）之后、`filterAllowedChannels` 之前校验：
   ```
   if (tokenRecord.user_allowed_models?.length && model && !includes(model))
     → jsonError(c, 403, "model_not_allowed", "model_not_allowed")
   ```
   未指定模型的请求不拦（无模型无法判定，与 `model_not_found` 的宽松语义一致）。
3. `routes/anthropic-proxy.ts`：同插入点（`parsedBody.model` 在 anthropicToOpenaiRequest 之前即可取到，字段同名）。
4. 令牌级 `allowed_channels` 与用户级模型白名单是**两个独立维度**（渠道 vs 模型），各自独立校验；PRD 所称「交集」指最终可用集 = 允许渠道 ∩ 白名单模型可路由的渠道，无需合并实现。

**模型列表过滤**：

- `/v1/models`（proxy.ts:219-…）：在现有 `filterAllowedChannels` 过滤后，按 `user_allowed_models` 过滤模型条目（`extractModelIds`/effective mapping 结果的 id 级过滤）。
- `/api/u/models`（user-api.ts:56-…）：`userAuth` 的 SELECT（userAuth.ts:48）增加 `allowed_models`（并入 `UserRecord`），列表按其过滤；同时删除响应中的 `site_mode` 字段与 shared 分支。

**管理台配置入口**：`/api/users` GET 列表返回 `allowed_models`；POST/PATCH 接受 `allowed_models`（`undefined` = 不改动；`null` / `[]` = 清空为不限制）。前端在用户编辑模态新增「可用模型」多选（复用渠道拉取模型弹窗交互骨架，候选源 `GET /api/models`，见 frontend §3.3）。

### D3 决策点 C 落地 — 用户端渠道选择 UI 移除

- `user-api.ts` 用户令牌 POST/PATCH：删除 `body.allowed_channels` 接收与 `getUserChannelSelectionEnabled` 门控逻辑（user-api.ts:154-190 区段、:243 附近）——用户令牌此后仅接受 name/quota/status 等基本字段。
- 存量 `tokens.allowed_channels` 数据不动，`filterAllowedChannels` 服务端校验照常生效；管理员仍可经 `/api/tokens`（tokens.ts POST :55 / PATCH）配置令牌级渠道限制，无需新增入口。
- 前端：删除 UserApp → UserTokensView 的 `channelSelectionEnabled` prop 与渠道选择模态（frontend §2.6 方案 a）。

### D4 决策 D（列清理）— channels 表共享生态列全部 DROP

`channels.contributed_by`、`channels.charge_enabled`、`channels.contribution_note`、`channels.tip_url` 四列在分成入账（proxy.ts:692-723 / anthropic-proxy.ts:437-461）、贡献榜（public.ts:145-163）、贡献渠道 CRUD（user-channels.ts）全部删除后**零消费者**（backend §6 已验证）。决定：随迁移一并 DROP，`services/channel-types.ts` 同步删字段。代价：数据不可逆丢弃——与 PRD「删表即删，风险已知悉」同一风险等级，且这四列正是本次删除的功能载体，保留即违背「彻底移除」目标。

### D5 models_json 内嵌 shared 清理 — SQL JSON 重写

采用 backend §4 方案 1（`json_each` + `json_remove`），配 `WHERE json_type = 'object' AND json_extract(...)` 守卫；纯字符串数组旧格式与 NULL/'[]' 天然安全（json_each 元素为字符串时 json_remove 原样返回）。同时 `services/channel-models.ts`：`ModelPricing` 删 `shared` 字段、`modelsToJson` 停写、删除 `extractSharedModelPricings` / `extractSharedModels` / `collectUniqueSharedModelIds`（实现时先确认后者调用点）。

### D6 前端管道文本格式 5 段 → 4 段

models 的 `id|input|output|shared|enabled` 竖线格式是**纯前端**概念（ChannelsView.tsx parseModelLines / rebuildModelsText；worker 只收 JSON 数组，channels.ts POST `JSON.stringify(body.models)`）。改法：`parseModelLines` 按四段解析（`id|input|output|enabled`）、`rebuildModelsText` 输出四段、`ParsedModel` 删 `shared`；兼容读取旧五段文本（多出的段忽略即可，无需迁移文本框内容——提交时即转为新格式）。

## 3. API 契约变更清单

| 端点 | 变更 |
|---|---|
| `GET /api/public/site-info` | 删 `site_mode` 字段；其余字段不变 |
| `GET /api/public/models` | 删 personal 403 / shared 分支；固定价格+渠道名展示 |
| `GET /api/public/contributions` | **整端点删除**（404） |
| `GET /api/settings` / `PUT /api/settings` | 删 `site_mode`、`withdrawal_*` ×3、`ldoh_cookie`、`channel_fee_enabled`、`channel_review_enabled`、`user_channel_selection_enabled` |
| `GET /v1/models` | 按用户白名单过滤（新增行为）；shared 过滤删除 |
| `POST /v1/chat/completions` 等、`POST /anthropic/v1/messages` | 白名单外模型 → 403 `model_not_allowed`；`model_not_shared` 403 消失 |
| `GET /api/u/models` | 删 `site_mode` 字段；按白名单过滤 |
| `GET /api/u/dashboard` | 删 `withdrawable_balance`、`withdrawal_enabled`、`withdrawal_fee_rate`、`user_channel_selection_enabled`、`channel_review_enabled`、`violations`、`contributions` 7 字段 |
| `PATCH /api/u/profile` | **整端点删除**（唯一功能是 tip_url） |
| `POST/PATCH /api/u/tokens` | 不再接受 `allowed_channels`（决策 C） |
| `GET/POST/PATCH /api/users` | 新增/支持 `allowed_models` 字段（R4） |
| `POST /api/recharge/callback` 等 | 内部 SQL 改为只加 `balance`（对外契约不变） |
| `/api/u/withdrawal/*`、`/api/ldoh/*`、`/api/u/ldoh/*`、`/api/u/channels*` | 整域 404 |
| 用户登录/注册响应 | 删 `tip_url` 字段（user-auth.ts:224） |

## 4. 数据库迁移与兼容

### 迁移文件 `0019_remove_shared_ecosystem.sql`（单文件）

```sql
-- 1. DROP 共享生态 5 表（含各自索引，表删则索引随删）
DROP TABLE IF EXISTS withdrawal_orders;
DROP TABLE IF EXISTS ldoh_violations;
DROP TABLE IF EXISTS ldoh_blocked_urls;
DROP TABLE IF EXISTS ldoh_site_maintainers;
DROP TABLE IF EXISTS ldoh_sites;

-- 2. DROP 失效列（SQLite 3.35+ / D1 支持 DROP COLUMN）
ALTER TABLE users DROP COLUMN withdrawable_balance;
ALTER TABLE users DROP COLUMN tip_url;
ALTER TABLE channels DROP COLUMN contributed_by;
ALTER TABLE channels DROP COLUMN charge_enabled;
ALTER TABLE channels DROP COLUMN contribution_note;
ALTER TABLE channels DROP COLUMN tip_url;

-- 3. 清理废弃 settings 键
DELETE FROM settings WHERE key IN (
  'site_mode','withdrawal_enabled','withdrawal_fee_rate','withdrawal_mode',
  'ldoh_cookie','channel_fee_enabled','channel_review_enabled',
  'user_channel_selection_enabled'
);

-- 4. channels.models_json 去除内嵌 shared 键（守卫纯字符串数组/NULL/'[]'）
UPDATE channels SET models_json = (
  SELECT json_group_array(json_remove(je.value, '$.shared'))
  FROM json_each(channels.models_json) AS je
) WHERE models_json IS NOT NULL
  AND EXISTS (SELECT 1 FROM json_each(channels.models_json)
              WHERE json_type(value) = 'object'
                AND json_extract(value, '$.shared') IS NOT NULL);

-- 5. R4 新列
ALTER TABLE users ADD COLUMN allowed_models TEXT;
```

⚠️ 实现时核对两点：`withdrawable_balance` 实际引入于 0016_withdrawal.sql（backend §4 疑点）；D1 迁移由 `d1_migrations` 跟踪单次执行，文件内幂等尽力（IF EXISTS）但不强求 DROP COLUMN 可重入。

### `schema.sql` 同步

删 5 表定义+3 索引（schema.sql:167-230 区段）、6 列；新增 `users.allowed_models TEXT`（users 表定义内）。迁移结果与 schema.sql 一致。

### 部署顺序契约（写入 README）

**迁移先于/伴随代码部署，同一 CI run 内完成**（现有 GH Actions backend/both 流程即为 migrate → deploy）。不一致窗口内旧代码读被删列（userAuth SELECT、recharge 回调、proxy strict 分支）会 SQL 报错，窗口为秒级；数据库先行无害的语句（settings DELETE、models_json 清理）排前，`ADD COLUMN allowed_models` 旧代码兼容（多列无影响）。

### 数据安全

无损保留：users（余额/状态/登录）、tokens、usage_logs、channels 主数据、recharge_orders、邀请码、签到。丢弃：withdrawal_orders、ldoh_* 4 表、6 个失效列值、8 个 settings 键——均为被删功能的专属数据。

## 5. 权衡记录

- **JSON 列 vs 关联表**（allowed_models）：选 JSON 列——低基数、无跨用户查询、与 allowed_channels 先例一致；代价是无法 SQL 级 JOIN 过滤（列表过滤在 JS 层完成，可接受）。
- **请求模型名 vs 解析后真实 ID**（D2）：选请求名——三处（列表展示/白名单候选/校验）口径一致；代价是管理员须按客户端调用名配置（UI 候选即来自模型广场，天然正确）。
- **单迁移文件 vs 多文件**：选单文件——一个原子变更单元，回滚语义清晰（整文件回滚）。
- **SQL JSON 重写 vs 留死数据**（shared 键）：选重写——一次性成本、D1 JSON1 内建支持、避免长期脏数据；风险由 json_type 守卫兜底。
- **userAuth 单查 vs tokenAuth 二查**：allowed_models 并入 tokenAuth 既有 users 查询与 userAuth 既有 SELECT，不新增查询次数。

## 6. 回滚

- 代码：单分支回滚 revert 即可（trunk-based）。
- 迁移：DROP/DROP COLUMN/DELETE 不可逆（无 down 迁移，与现有 0001-0018 惯例一致）；回滚代码不回滚迁移时，旧代码读缺失列会报错——**回滚需连迁移一起评估**，必要时从备份重建。README 的 init 流程建库即迁移，风险集中一次性交代。
- 缓解：部署前 CI 已跑 typecheck + 新增单测；迁移语句在本地 `wrangler d1 execute --local` 先验证。
