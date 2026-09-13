# 重构：移除站点模式与共享模式，默认服务模式并新增用户级模型限制

## Goal

将 ZenAPI 从「三站点模式」（personal / service / shared）简化为**固定服务模式**运行：管理员可创建用户、为用户分配余额（额度）与可用模型；用户注册登录体系（注册模式 registration_mode）完整保留。同时彻底移除「共享模式」生态的全部功能、代码与数据库遗留。

## Background

当前系统通过 `settings` 表的 `site_mode` 键在三种子模式间切换：

- **personal（自用）**：禁用用户注册/登录、模型广场不公开、前端强制跳转管理台；
- **service（服务）**：面向用户提供 API 服务，用户有余额，公开模型及价格；
- **shared（共享）**：多人共享渠道资源，围绕它长出了渠道贡献、提现、LDOH 站点管理、渠道分成/审核、模型 shared 标记等一整套生态。

三模式并存导致代理链路（`proxy.ts` / `anthropic-proxy.ts`）、鉴权（`tokenAuth`）、用户体系（`user-auth`）中遍布模式分支，复杂度已超过收益。本次重构做减法：固定 service 行为，删除另外两模式及共享生态。

## Requirements

### R1 移除站点模式（site_mode）机制

- 删除 `site_mode` 设置键、`SiteMode` 类型、`getSiteMode` / `setSiteMode` 及全部引用分支。
- 系统行为固定等价于现在的 `service` 模式：
  - 模型广场公开访问，展示模型与价格；
  - 用户注册/登录正常（受注册模式控制）；
  - 管理台「系统设置」中的站点模式选择器移除。
- personal 模式的独占行为一并删除（强制跳 `/admin`、`/api/public/models` 403、tokenAuth/user-auth 的 personal 拦截）。
- settings 表中历史遗留的 `site_mode` 行通过迁移清理。

### R2 移除共享模式生态

移除范围（用户已确认全选）：

1. **提现功能**：`/api/u/withdrawal` 路由、`withdrawal_orders` 表、`withdrawal_enabled` / `withdrawal_fee_rate` / `withdrawal_mode` 设置、代理链路中 `withdrawal_mode === "strict"` 的扣费分支、`users.withdrawable_balance` 字段、前端提现视图。
2. **LDOH 站点管理**：`/api/ldoh` 与 `/api/u/ldoh` 路由、`ldoh_sites` / `ldoh_site_maintainers` / `ldoh_blocked_urls` / `ldoh_violations` 4 张表、`ldoh_cookie` 设置、前端 LDOH 相关视图、`/api/public/contributions` 公开贡献端点。
3. **渠道贡献**：`/api/u/channels` 路由（用户贡献渠道）、渠道创建/更新中 `defaultShared` 分支、前端贡献渠道视图与导航入口。
4. **渠道模型 shared 标记**：`extractSharedModels` / `extractSharedModelPricings` / `collectUniqueSharedModelIds` / `channelSupportsSharedModel`、代理链路 `useSharedFilter` 分支、channel models JSON 内嵌的 `shared` 标记（含迁移清理）、`channel-testing.ts` 的 shared 保留逻辑、前端渠道编辑中的 shared 开关。
5. **分成/审核设置**：`channel_fee_enabled` / `channel_review_enabled` / `user_channel_selection_enabled` 三项设置的后端读写与前端 UI。
6. **贡献榜外围（决策点 A/B，已确认）**：`users.tip_url` 字段及其后端读写（`PATCH /api/u/profile`）与用户端「个人设置-打赏链接」表单一并移除（贡献榜删除后该字段无任何展示位）；根目录油猴脚本 `ldc-reward.user.js` 随本次删除（其唯一依赖 `#zenapi-contribution-board` 贡献榜 DOM 消失后永久失效）。
7. **用户端令牌渠道选择 UI（决策点 C，已确认）**：`user_channel_selection_enabled` 删除后，用户端令牌的「选择渠道」编辑 UI 一并移除；存量令牌的 `allowed_channels` 数据保留并在代理侧继续生效（与用户级模型限制取交集），用户端不再提供编辑入口；管理台经现有 `/api/tokens` 已可配置令牌级 `allowed_channels`，无需新增入口（design.md 决策 D3）。

### R3 数据库迁移（写迁移删表）

- 新增编号迁移文件（0019）：DROP 共享模式相关表（withdrawal_orders、ldoh_sites、ldoh_site_maintainers、ldoh_blocked_urls、ldoh_violations）、ALTER TABLE 删除 `users.withdrawable_balance`、`users.tip_url` 及 channels 表共享生态四列（`contributed_by` / `charge_enabled` / `contribution_note` / `tip_url`，design.md 决策 D：生态删除后零消费者）、DELETE `settings` 表中 8 个废弃键、清理 channels.models_json 内嵌 `shared` 标记、新增 `users.allowed_models` 列（R4）。
- `schema.sql` 同步删除对应表和字段定义，保持 schema.sql 与迁移结果一致。
- 迁移需幂等（IF EXISTS 类写法），与现有迁移文件编号规律衔接。

### R4 新增用户级可用模型限制

- 管理员可为每个用户配置「可用模型」白名单（存储格式与校验插入点由 design.md 定夺）。
- 代理请求（`/v1/*` 与 `/anthropic/v1/*`）时叠加校验：用户级模型限制与令牌级 `allowed_channels` 限制同时生效，取交集语义。存量令牌已配置的 `allowed_channels` 校验行为不变（用户端编辑 UI 已随 R2.7 移除，仅存量生效）。
- 模型列表端点（`/v1/models`、用户端模型列表）按用户级限制过滤展示。
- 管理台用户编辑界面提供可用模型的配置入口；未配置（空）视为不限制。

### R5 注册模式保留

- `registration_mode`（open / linuxdo_only / closed）功能、设置项、前端选择器原样保留，不受本次重构影响。
- LinuxDO OAuth 登录能力保留（它属于注册/登录体系，不属于共享生态）。

## Constraints

- **不做 breaking 的事**：现有 service 模式部署升级后，用户数据（users、tokens、usage_logs、余额）必须无损保留。
- **部署顺序**：迁移与代码需兼容（新代码读旧库、旧代码读新库均不崩溃，或明确部署顺序要求并在 README 说明）。
- **规范**：Biome（tab 缩进、双引号）、TS strict。**质检门槛（用户已确认）**：`bun run check` 以「不新增 lint 错误」为准——仓库存在 39 个改动前即有的 apps/ui 存量错误（主要 a11y），记为已知技术债留待后续任务；本次改动自身必须零新增，`bun run typecheck` 与 `bun run test` 须全绿。
- **AGENTS.md / README.md** 同步更新（站点模式、共享模式、提现、LDOH 相关章节）。
- 核心代理逻辑改动须保持或补充单测。

## Acceptance Criteria

- [ ] 代码库中不再存在 `site_mode` / `SiteMode` / `getSiteMode` / `setSiteMode` 引用（注册模式 `registration_mode` 相关保留）。
- [ ] 代码库中不再存在提现、LDOH、渠道贡献、shared 标记、分成/审核设置的代码路径与前端入口。
- [ ] 代码库中不再存在 `tip_url` 引用（含 `users.tip_url` 列、profile 更新与前端表单）；根目录 `ldc-reward.user.js` 已删除；用户端令牌编辑无「选择渠道」UI；存量 `allowed_channels` 仍受代理校验（被限制令牌请求白名单外渠道 403 行为不变）。
- [ ] 迁移幂等性：表与 settings 键清理用 IF EXISTS 写法；DROP COLUMN 依赖 D1 迁移单次执行语义（d1_migrations 跟踪，design.md §4）；`schema.sql` 与迁移后结构一致；`withdrawal_orders`、`ldoh_*` 4 张表被删除；`users.withdrawable_balance`、`users.tip_url` 与 channels 表共享生态四列被删除；settings 表中 `site_mode`、`withdrawal_*`、`ldoh_cookie`、`channel_fee_enabled`、`channel_review_enabled`、`user_channel_selection_enabled` 键被清理；`users.allowed_models` 列存在。
- [ ] 未登录访客访问 `/` 跳转登录页；已登录用户进入用户端；`/admin` 管理台正常。
- [ ] 模型广场公开可见模型与价格（无需登录）。
- [ ] 用户注册/登录/登出/me 在三种注册模式下行为与重构前 service 模式一致。
- [ ] 管理员可创建用户、编辑用户余额与状态，并可为用户配置可用模型白名单。
- [ ] 用户级模型限制生效：被限制用户通过 `/v1/chat/completions` 与 `/anthropic/v1/messages` 请求白名单外模型返回 403；`/v1/models` 与用户端模型列表只显示白名单内模型。
- [ ] 未配置限制的用户行为不变（全部启用渠道的模型可用）。
- [ ] `bun run typecheck && bun run test` 全部通过；`bun run check` 零新增错误（存量 39 个 apps/ui 错误为已确认技术债，见 Constraints）。
- [ ] README.md 与 AGENTS.md 不再描述站点模式/共享模式/提现/LDOH，且描述与实际行为一致。

## Out of Scope

- 注册模式的任何行为变更。
- 计费/价格体系调整。
- 渠道负载均衡与重试逻辑调整（除移除 shared 过滤分支外）。
- 历史共享模式数据的导出或备份工具（删表即删，风险已知悉）。
