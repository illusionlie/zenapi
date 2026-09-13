# 后端调查清单：移除站点模式与共享模式（仅 apps/worker + 数据库迁移）

> 任务：.trellis/tasks/09-13-remove-site-mode
> 范围：apps/worker 后端 + migrations + schema.sql。前端另见 frontend-docs-inventory.md。
> 状态标记：✅ 已完成调查 / ⚠️ 待确认

## 目录

- [1. site_mode 后端引用点](#1-site_mode-后端引用点) ✅
- [2. 共享模式生态（后端部分）](#2-共享模式生态后端部分) ✅
- [3. 用户级模型限制设计输入](#3-用户级模型限制设计输入) ✅
- [4. 数据库迁移清单](#4-数据库迁移清单) ✅
- [5. 后端测试现状](#5-后端测试现状) ✅
- [6. 决策点补充](#6-决策点补充) ✅

---

## 1. site_mode 后端引用点

grep 全量（`site_mode|SiteMode|getSiteMode|setSiteMode`，apps/worker）结果：

| 文件:行号 | 内容 | 处置 |
|---|---|---|
| `src/services/settings.ts:113` | `const SITE_MODE_KEY = "site_mode"` | 删除 |
| `src/services/settings.ts:114` | `export type SiteMode = "personal" \| "service" \| "shared"` | 删除 |
| `src/services/settings.ts:115` | `VALID_SITE_MODES` | 删除 |
| `src/services/settings.ts:128-137` | `getSiteMode()`（缺省回退 "personal"⚠️注意：回退值需随函数一起消失，调用方不再有回退） | 删除 |
| `src/services/settings.ts:139-…` | `setSiteMode()` | 删除 |
| `src/middleware/tokenAuth.ts:4,58-63` | import + `if (record.user_id)` 内 `siteMode === "personal"` → 403 `token_disabled`。**同区块内 user 状态/余额校验（status/balance）保留**，只删 personal 拦截 | 删除 personal 分支 |
| `src/routes/anthropic-proxy.ts:18,82-83` | import + `getSiteMode` + `const useSharedFilter = siteMode === "shared" && !!tokenRecord.user_id` | 删除 siteMode 与 useSharedFilter（见 §2d） |
| `src/routes/channels.ts:17,316-317,338-339` | import + `/:id/test` 端点内 `getSiteMode` + `if (siteMode === "shared") updateData.defaultShared = true` | 删除 |
| `src/routes/newapiChannels.ts:31,402-404,451-453,486,492` | import + 两个 test 端点与 fetch_models 的 `defaultShared: siteMode === "shared"` 分支 | 删除 |
| `src/routes/proxy.ts:28,243-244,372-373` | import + `/models` 与 `proxy.all("/*")` 两处 `useSharedFilter` | 删除 |
| `src/routes/public.ts:14,23,30,47,127,135` | import；`/site-info` 返回 `site_mode` 字段（:23,:30）；`/models` personal 403（:47-49）+ shared 分支（:72-73）；返回 `site_mode`（:127）；`/contributions` 端点 shared 门控（:135-139，整端点删除见 §2b） | 删除 site_mode 相关；site-info 保留其余字段 |
| `src/routes/settings.ts:19,26,43,62,86,152-156` | import；GET 返回 `site_mode`（:62,:86）；PUT 校验并写入 `body.site_mode`（:152-156） | 删除 |
| `src/routes/user-auth.ts:~21-24`（register 开头） | `getSiteMode` + `siteMode === "personal"` → 403 `registration_disabled` | 删除 personal 拦截；registration_mode 校验保留 |
| `src/routes/user-auth.ts:~527`（LinuxDO 新用户创建分支） | `getSiteMode` + personal → redirectWithError("registration_disabled") | 删除 personal 拦截 |
| `src/routes/user-api.ts:8,56-77,~125` | import；`/models` 内 `siteMode === "shared"` 分支（:77-78）；响应含 `site_mode` 字段（返回 `c.json({ models, site_mode: siteMode })`） | 删除 shared 分支与 site_mode 字段（前端类型同步，见 frontend §2.1） |
| `src/routes/user-channels.ts:24-27` | `GET /` 开头 `siteMode !== "shared"` → 403 `shared_mode_only`（整文件删除，见 §2c） | 随文件删除 |

⚠️ 注意 `getSiteMode` 的默认回退是 `"personal"`（settings.ts:128-131），即 settings 表无该键时系统现为 personal 行为。删除后行为固定为 service，与 PRD 一致。

## 2. 共享模式生态（后端部分）

### a) 提现

| 文件:行号 | 内容 | 处置 |
|---|---|---|
| `src/index.ts:30,158` | `withdrawalRoutes` import + `app.route("/api/u/withdrawal", …)` | 删除 |
| `src/routes/withdrawal.ts`（全文 225 行） | `POST /create`（:21）、`GET /orders`（:213） | **整文件删除** |
| `src/services/settings.ts:326-360` | `WITHDRAWAL_ENABLED_KEY` / `WITHDRAWAL_FEE_RATE_KEY` + get/set | 删除 |
| `src/services/settings.ts:422-440` | `WITHDRAWAL_MODE_KEY` + `getWithdrawalMode` / `setWithdrawalMode` | 删除 |
| `src/routes/proxy.ts:674-691` | `if (cost > 0 && tokenRecord.user_id)` 内 `getWithdrawalMode` + `withdrawalMode === "strict"` 分支：`UPDATE users SET balance = balance - ?, withdrawable_balance = MAX(0, withdrawable_balance - ?) …`；else 分支只扣 balance（:682-687） | 删除 strict 分支与 getWithdrawalMode，保留普通扣费 SQL（去掉 withdrawable_balance 列引用） |
| `src/routes/anthropic-proxy.ts:419-436` | 同上 strict 扣费分支 | 同上 |
| `src/routes/recharge.ts:191-196` | 充值回调 `UPDATE users SET balance = balance + ?, withdrawable_balance = withdrawable_balance + ? …` | **必改**：只加 balance，否则删列后 SQL 报错 |
| `src/middleware/userAuth.ts:13,48` | `UserRecord.withdrawable_balance` + SELECT 含 `withdrawable_balance, tip_url` | 删除两个字段引用 |
| `db/schema.sql:84,167-183` | `users.withdrawable_balance` 列；`withdrawal_orders` 表 + 2 索引 | 迁移删除 |

### b) LDOH

| 文件:行号 | 内容 | 处置 |
|---|---|---|
| `src/index.ts:12-13,146,156` | `ldohRoutes` / `ldohUserRoutes` import + 挂载 `/api/ldoh`、`/api/u/ldoh` | 删除 |
| `src/routes/ldoh.ts`（全文 647 行） | 12 端点：`/sync`(:41)、`/sites` CRUD(:173,:254,:399,:600)、`/violations`(:304)、维护者审批(:314,:353,:549)、渠道审批(:364,:388)、`/block-all`(:620) | **整文件删除** |
| `src/routes/ldoh-user.ts`（全文 476 行） | 10 端点：`/my-sites`(:17)、`/claim-site`(:56)、`/sites/:id/channels`(:140)、block(:191,:256)、violations(:284)、渠道删除/审批(:314,:369,:425) | **整文件删除** |
| `src/services/ldoh-blocking.ts`（全文 49 行） | `disableNonMaintainerChannels`（按 hostname 禁用非维护者渠道） | **整文件删除**（仅 ldoh-user.ts:5 引用） |
| `db/schema.sql:185-230` | `ldoh_sites`(:185)、`ldoh_site_maintainers`(:198)、`ldoh_blocked_urls`(:211)、`ldoh_violations`(:219) + 3 索引(:196,:209,:230) | 迁移 DROP |
| `src/routes/user-channels.ts:109,122,147` | 贡献渠道端点内引用 `ldoh_blocked_urls` / `ldoh_violations` / `ldoh_sites`（提交渠道时做 hostname 封禁检查+记违规） | 随 user-channels.ts 整文件删除 |
| `src/routes/user-api.ts:519-523,541` | dashboard「违规记录耻辱墙」查询 `ldoh_violations` 并返回 `violations` | 删除 |
| `src/routes/public.ts:133-170` | `/contributions` 端点（贡献榜，JOIN users 取 tip_url，shared 门控） | **整端点删除** |
| settings `ldoh_cookie` | `getLdohCookie` / `setLdohCookie`（settings service，供 /sync 拉取） | 删除 |
| adminAuth 放行清单（index.ts:117-127） | 放行 `/api/auth/login`、`/api/channel*`、`/api/user*`、`/api/group*`、`/api/public*`、`/api/u/*`、`/api/recharge*`、`/api/monitoring*`。**`/api/ldoh` 不在放行清单（走 adminAuth）**；`/api/u/*` 前缀覆盖 u/channels、u/ldoh、u/withdrawal | 删除路由后**放行清单无需改动**（`/api/u/*` 仍服务 user-api） |

### c) 渠道贡献

| 文件:行号 | 内容 | 处置 |
|---|---|---|
| `src/index.ts:29?,155` | `userChannelRoutes` import + `app.route("/api/u/channels", …)` | 删除 |
| `src/routes/user-channels.ts`（全文 333 行） | `GET /`(:24)、`POST /`(:82)、`PATCH /:id`(:224)、`DELETE /:id`(:305)；内含 LDOH hostname 检查与审核流 | **整文件删除** |
| `db/schema.sql:18,19,21` + 迁移 0003 | `channels.contributed_by`、`channels.charge_enabled`、`channels.contribution_note` | 列去留见 §6 决策 D（建议 DROP） |
| `src/services/channel-types.ts:20-23` | `ChannelRow.contributed_by / charge_enabled / contribution_note` | 随列决策删除 |
| `src/routes/proxy.ts:692-723`、`src/routes/anthropic-proxy.ts:437-461` | 分成入账：`channelForUsage.contributed_by && charge_enabled === 1` + `getChannelFeeEnabled` → 给贡献者加 balance/withdrawable_balance | 整块删除（feeEnabled 分支即 §2e） |
| `src/routes/public.ts:145-163`、`src/routes/user-api.ts:459-511` | 贡献榜查询（JOIN users） | 随 /contributions 与 dashboard 删除 |

### d) 渠道模型 shared 标记

| 文件:行号 | 内容 | 处置 |
|---|---|---|
| `src/services/channel-models.ts:12` | `ModelPricing.shared?: boolean` | 删除字段 |
| `src/services/channel-models.ts:~95`（modelsToJson） | 序列化时写 `shared` | 删除 |
| `src/services/channel-models.ts:142,150,176` | `extractSharedModelPricings` / `extractSharedModels` / `collectUniqueSharedModelIds` | 删除（先确认 collectUniqueSharedModelIds 的调用点，见下） |
| `src/routes/proxy.ts:62-72` | `channelSupportsSharedModel`（导出，被 anthropic-proxy 引用） | 删除 |
| `src/routes/proxy.ts:244,249-250` | `/models` 端点 `useSharedFilter` + `extractSharedModelPricings` 候选过滤 | 删除，固定用 `extractModelPricings` |
| `src/routes/proxy.ts:373,391-393,411-412,426-427` | `proxy.all` 内 `useSharedFilter`、403 `model_not_shared`、两处 `supportsFn` 三元选择 | 删除，固定 `channelSupportsModel` / 404 `model_not_found` 路径 |
| `src/routes/anthropic-proxy.ts:35,83,105-106,108,118-119,132-133` | 同上的 anthropic 侧镜像（含 403 `model_not_shared`） | 删除 |
| `src/routes/public.ts:5,72-73` | 公开模型 shared 分支（隐藏价格/渠道名，显示「共享渠道」） | 删除，固定 `extractModelPricings` |
| `src/routes/user-api.ts:8,77-78` | 用户端模型列表 shared 分支 | 删除 |
| `src/services/channel-testing.ts:97,144-156` | `updateChannelTestResult` 接受 `defaultShared`；「无已有模型时 defaultShared → 全部标记 shared」 | 删除 |
| `src/routes/channels.ts:330,338-339` | `/:id/test` 的 `defaultShared` 写入 | 删除 |
| `src/routes/newapiChannels.ts:393,402-404,442,451-453,486,492` | New API 兼容 test ×2 + fetch_models 的 `defaultShared` | 删除 |
| `collectUniqueSharedModelIds` | 定义于 channel-models.ts:176；⚠️ 调用点 grep 未命中 worker 其他文件（可能仅导出未用或前端不涉及）——实现时确认后删除 | 删除 |
| models_json 存储格式 | JSON 数组 `[{id, input_price?, output_price?, shared?, enabled?}]`（modelsToJson）；旧数据可能还有纯字符串数组格式 | 存量 `shared` 键清理见 §4 迁移草案 |

### e) 分成/审核设置

| 文件:行号 | 内容 | 处置 |
|---|---|---|
| `src/services/settings.ts` | `channel_fee_enabled` / `channel_review_enabled` / `user_channel_selection_enabled` 三键 get/set | 删除 |
| `src/routes/settings.ts:5-6,20,29-30,44,71-73,95-97,232-251` | GET 返回三字段 + PUT 校验写入 | 删除 |
| `src/routes/proxy.ts:27,699`、`src/routes/anthropic-proxy.ts:17,440` | `getChannelFeeEnabled` + 分成入账块（与 §2c 同一块） | 删除 |
| `src/routes/user-api.ts:13,18,157,243,429,432,539-540` | `getChannelReviewEnabled` / `getUserChannelSelectionEnabled`；用户令牌 POST/PATCH 的 `allowed_channels` 校验门（:157,:243，见下）；dashboard 返回 `user_channel_selection_enabled`(:539) / `channel_review_enabled`(:540) | 删除读点；用户令牌端点不再接受 `allowed_channels`（决策点 C） |

### f) tip_url（决策点 A：一并移除）

| 文件:行号 | 内容 | 处置 |
|---|---|---|
| 迁移 `0008_tip_url.sql` | `ALTER TABLE channels ADD COLUMN tip_url TEXT` | ⚠️ worker 代码零引用（死列）→ 随迁移 DROP（见 §6 决策 D） |
| 迁移 `0009_user_tip_url.sql` | `ALTER TABLE users ADD COLUMN tip_url TEXT` | DROP |
| `src/middleware/userAuth.ts:17,48` | `UserRecord.tip_url` + SELECT | 删除 |
| `src/routes/user-api.ts:32-47` | `PATCH /profile`（唯一功能就是更新 tip_url） | **整端点删除**（删后 user-api 无 PATCH /profile） |
| `src/routes/user-api.ts:445,459,467,511` | dashboard contributions 内 tip_url | 随贡献榜删除 |
| `src/routes/user-auth.ts:224` | 登录响应含 `tip_url: user.tip_url ?? null` | 删除字段（前端 User 类型同步） |
| `src/routes/public.ts:145,153,163` | /contributions 内 tip_url | 随端点删除 |

### g) 确认不受影响的文件（grep 零命中）

`routes/dashboard.ts`（管理端聚合）、`routes/monitoring.ts`、`routes/usage.ts`、`routes/playground.ts`、`routes/newapiUsers.ts`、`routes/newapiGroups.ts`、`services/pricing.ts`、`services/usage.ts`、`services/channel-repo.ts`、`middleware/adminAuth.ts`——均无 shared/site_mode/withdrawal/ldoh/contribution 引用，零改动。

## 3. 用户级模型限制设计输入

### 鉴权与上下文

- `src/middleware/tokenAuth.ts`：`SELECT … FROM tokens WHERE key_hash = ?` → `TokenRecord {id,name,quota_total,quota_used,status,allowed_channels,user_id}`（:11-20）；有 `user_id` 时查 `users` 的 `balance,status`（:65-79），c.set("tokenRecord")。**插入点**：此 user 查询处同时取 `users.allowed_models`（新列），经 `c.set` 传递（如并进 tokenRecord 或单独变量 `userAllowedModels`）。
- `src/middleware/userAuth.ts`：`c.set("userId")` / `c.set("userRecord")`（:59-60）。

### 令牌级渠道限制现状（交集语义的另一侧）

- `src/routes/proxy.ts:76-110+`：`filterAllowedChannels(channels, tokenRecord, model?)` 解析 `allowed_channels` JSON——**两种格式**：legacy 平铺数组 `["ch1","ch2"]` 或 `Record<model, channelIds[]>`（按模型过滤渠道）。在 `/models`(:241) 与 `proxy.all`(:405) 应用。anthropic-proxy 从 `./proxy` 复用（import :19-23）。
- 用户级模型限制的校验建议放在**模型名解析后、候选渠道过滤前**：`proxy.ts:329-334`（`parsedBody.model`）与 anthropic-proxy 对应处（~:135），403 错误码沿用 `jsonError(c, 403, code, code)` 风格（如 `model_not_allowed`）。错误格式先例：`utils/http.ts` `{error, code}`。
- `/v1/models`（proxy.ts:219-…）与 `/api/u/models`（user-api.ts:56-…）需按用户白名单过滤（userAuth 有 userId，查用户 allowed_models）。

### 管理端

- `src/routes/admin-users.ts`：GET `/`（SELECT 不含 allowed_models，需加）；POST `/`（INSERT 列清单需加）；PATCH `/:id`（现支持 balance/status/name/password 等，`allowed_models` 以 `body.allowed_models !== undefined` 追加；空数组/null 视为不限制）。
- `src/routes/tokens.ts`：POST 直接 `JSON.stringify(body.allowed_channels ?? null)`（:55），PATCH 合并 `existingAllowed`——**管理台已可配令牌级 allowed_channels**，决策点 C 移除用户端 UI 后管理员入口仍然存在，无需新增。

### dashboard 将删除的返回字段（user-api.ts:519-541）

`withdrawable_balance`(:527)、`contributions`(:532)、`withdrawal_enabled`(:537)、`withdrawal_fee_rate`(:538)、`user_channel_selection_enabled`(:539)、`channel_review_enabled`(:540)、`violations`(:541)。⚠️ 前端类型 `UserDashboardData` 同步删除（frontend §2.2/2.3/2.5）。

### 用户端令牌端点（决策点 C 落地）

`user-api.ts` POST `/tokens`(:144-) 与 PATCH `/tokens/:id`(:212-)：现接受 `body.allowed_channels`（对象格式）并受 `getUserChannelSelectionEnabled` 门控（:154-190 区段）。改法：**删除 allowed_channels 接收与校验逻辑**（用户令牌仅 name/quota 等基本字段），存量数据不动；管理员仍可经 `/api/tokens` 配置。

## 4. 数据库迁移清单

### 现有迁移

`0001_init` → `0018_channel_restrictions`（列表见下），**下一个编号 0019**，命名 `NNNN_name.sql`。
0001 init / 0002 api_format / 0003 users / 0004 model_aliases / 0005 linuxdo_oauth / 0006 error_details / 0007 alias_only / 0008 tip_url(channels) / 0009 user_tip_url(users) / 0010 channel_model_aliases / 0011 linuxdo_username / 0012 checkin / 0013 invite_codes / 0014 recharge_orders / 0015 channel_fee / 0016 withdrawal / 0017 ldoh_sites / 0018 channel_restrictions。

⚠️ **迁移先例**：现有迁移中无任何 `DROP TABLE` / `DROP COLUMN` / `DELETE FROM` 先例。SQLite 3.35+ 支持 `ALTER TABLE … DROP COLUMN`；D1（compatibility_date 2026-02-14）基于新版 SQLite，支持。D1 迁移由 `d1_migrations` 表跟踪、单次执行，无需文件内幂等；若要幂等可用 `DROP TABLE IF EXISTS`（DROP COLUMN 无 IF EXISTS 语法，重复执行会报 duplicate column 错——按 D1 单次执行语义处理即可，PRD 的「幂等」以 IF EXISTS 写法尽力满足）。

### 需删除的表（schema.sql:167-230）

- `withdrawal_orders`（+索引 `withdrawal_orders_user`、`withdrawal_orders_trade`，schema.sql:182-183）
- `ldoh_sites`（+索引 `ldoh_sites_hostname` :196）
- `ldoh_site_maintainers`（+索引 `ldoh_maintainers_username` :209）
- `ldoh_blocked_urls`
- `ldoh_violations`（+索引 `ldoh_violations_created` :230）

### 需删除的列

- `users.withdrawable_balance`（schema.sql:84，0003 后加入——⚠️ 实际加入于 0016_withdrawal.sql，实现时核对）
- `users.tip_url`（0009）
- `channels.tip_url`（0008，代码零引用）
- `channels.contributed_by`（0003）/ `channels.charge_enabled`（0015）/ `channels.contribution_note` —— 见 §6 决策 D
- tokens 表 `allowed_channels`、`user_id` **保留**

### 需删除的 settings 键（DELETE FROM settings WHERE key IN）

`site_mode`、`withdrawal_enabled`、`withdrawal_fee_rate`、`withdrawal_mode`、`ldoh_cookie`、`channel_fee_enabled`、`channel_review_enabled`、`user_channel_selection_enabled`

### models_json 内嵌 shared 清理（草案二选一）

1. **SQL JSON 重写**（推荐）：
   ```sql
   UPDATE channels SET models_json = (
     SELECT json_group_array(json_remove(je.value, '$.shared'))
     FROM json_each(channels.models_json) AS je
   ) WHERE models_json IS NOT NULL
     AND EXISTS (SELECT 1 FROM json_each(channels.models_json)
                 WHERE json_type(value) = 'object' AND json_extract(value, '$.shared') IS NOT NULL);
   ```
   ⚠️ 需处理纯字符串数组旧格式（json_each 元素为字符串时 json_remove 原样返回，安全）与 `models_json = '[]'`/NULL。
2. **保留死数据**：新代码不读 `shared`，存量键无害；零迁移风险但留脏数据。

### schema.sql 同步

删除上述 5 表定义+索引、4-7 列；无 settings seed 数据。

### 新增列（R4）

`ALTER TABLE users ADD COLUMN allowed_models TEXT;`（JSON 字符串数组，NULL=不限制；先例：`tokens.allowed_channels TEXT`）

## 5. 后端测试现状

- **`tests/` 目录不存在**（vitest.config.ts include `tests/**/*.test.ts` → vitest 空跑）。`bun run test` = 根 package.json `vitest`。AGENTS.md §3/§5 描述与实际不符。
- 现有零测试文件 → 本次改动无回归网；PRD「核心代理逻辑改动须保持或补充单测」需**新建**测试：
  - 建议落点：`tests/` 下为 `services/channel-models.ts`（modelsToJson / extractModelPricings 删 shared 后行为）与抽成纯函数的「用户级模型限制 + filterAllowedChannels 交集校验」补单测（proxy.ts 已有导出先例 channelSupportsModel）。
- 不会被删测试破坏的既有测试：无（零测试）。

## 6. 决策点补充

- **决策 D（列清理，建议 design.md 定）**：`channels.contributed_by` / `channels.charge_enabled` / `channels.contribution_note` / `channels.tip_url` 四列在生态删除后**全部失去消费者**（分成入账、贡献榜、贡献渠道 CRUD 均删）。建议随迁移一并 DROP，彻底做减法；代价是不可逆（数据即弃）。PRD R3 已授权「schema.sql 与迁移结果一致」的表/字段清理精神，但 PRD 仅明文列出 `users.withdrawable_balance` 等——需在 design.md 明确。
- **必改点（非决策）**：`routes/recharge.ts:191-196` 充值回调用 `withdrawable_balance` 列——删列前必须改为只加 `balance`，否则运行时 SQL 报错。
- **必改点（非决策）**：`middleware/userAuth.ts` SELECT 与 `UserRecord`、`routes/user-auth.ts:224` 登录响应中的 `withdrawable_balance` / `tip_url` 字段。
- **确认零改动**：adminAuth 放行清单无需变更（`/api/ldoh` 从未在放行清单；`/api/u/*` 前缀保留服务 user-api）。
- **确认零改动**：New API 兼容层除 `defaultShared` 分支外无 shared/site_mode 逻辑；`/api/user`（newapiUsers）与 `/api/group`（newapiGroups）完全不受影响。
- ⚠️ **待实现时确认**：`collectUniqueSharedModelIds` 的实际调用点（grep 未命中定义处之外的引用）。
