# 前端 + 文档 + 规范 清单（site_mode 移除重构）

> 状态：调查中（边查边写）。所有结论带 文件路径:行号。行号基于当前 main 工作区（未提交改动仅含 .gitignore 与任务目录，不影响）。

## 1. siteMode 前端引用点

### 1.1 App.tsx（顶层路由分发，`apps/ui/src/App.tsx`，全文 372 行）

| 位置 | 内容 | 处置 |
|---|---|---|
| App.tsx:5 | `import type { RegistrationMode, SiteMode, User }` | 删除 `SiteMode`（保留 `RegistrationMode`） |
| App.tsx:30 | `const [siteMode, setSiteMode] = useState<SiteMode \| null>(null);` | 删除 state |
| App.tsx:60-88 | `useEffect` 拉取 `/api/public/site-info`（App.tsx:71），`:73 setSiteMode(result.site_mode)`；`:86 .catch(() => setSiteMode("personal"))` | **保留拉取但去掉 site_mode 字段**——site-info 同时返回 `registration_mode` / `linuxdo_enabled` / `require_invite_code` / `announcement`，这些都是保留功能。失败回退值 `"personal"` 需删除 |
| App.tsx:173-192 | admin 路由：`path.startsWith("/admin")` 不等待 siteMode，未登录渲染 `LoginView`，已登录渲染 `AdminApp` | 不变（注释 `:173 "no need to wait for siteMode/userCheck"` 可顺带改写） |
| App.tsx:197-200 | `if (siteMode === null) return null;`（等待 siteMode 再路由） | **可整体删除**：site-info 拉取失败不再阻塞路由。替代方案：用单独的 `siteInfoLoaded` state 或直接允许 registration_mode 默认值渲染（registration_mode 默认 `"open"`，site-info 到达后更新）。建议保留一个「已加载」标记避免登录页闪烁表单，具体由 design.md 定夺 |
| App.tsx:203-208 | personal 模式：`if (siteMode === "personal") { history.replaceState(null, "", "/admin"); setPath("/admin"); return null; }` | **整段删除**（personal 强制跳 /admin 的唯一位置） |
| App.tsx:210-222 | 首页 `/` 重定向：有 token 且 userRecord → `/user`；否则 → `/login`（App.tsx:215/221） | **保留不动**——这正是 PRD 验收标准「未登录访客访问 / 跳转登录页；已登录用户进入用户端」的现有 service 行为 |
| App.tsx:224-296 | `/user` 路由：无 token / userRecord 无效 → 渲染 `PublicApp`（App.tsx:236-243、255-262）；有效 → `UserApp`（App.tsx:271-278，`:296` 传 `siteMode={siteMode}`） | 删除 PublicApp/UserApp 的 `siteMode` prop 传递 |
| App.tsx:302-338 | 公开路由（/login、/register）：已登录用户重定向 `/user`（`:286`）；渲染 `PublicApp`（`:318-327`，`:326 siteMode={siteMode}`） | 删除 `siteMode` prop |

**移除后路由分发建议**：始终按现有 service 行为——
1. `/admin*` → LoginView / AdminApp（不变）；
2. `/` → 已登录 `/user`、未登录 `/login`（不变）；
3. `/user*` → 未登录/无效 token 跳 `/login`，有效渲染 UserApp（不变）；
4. 其余（/login、/register）→ PublicApp（不变）。
唯一删除的是 `siteMode === null` 阻塞（App.tsx:197-200）与 personal 重定向（App.tsx:203-208）。

### 1.2 PublicApp.tsx（`apps/ui/src/PublicApp.tsx`，全文 203 行）

定位：**登录/注册页容器**（不是模型广场）。内容：顶部导航（ZenAPI logo、登录/注册切换、「管理后台」入口）+ `UserLoginView` / `UserRegisterView`，外加 LinuxDO OAuth 回调处理（PublicApp.tsx:45-70）。

| 位置 | 内容 | 处置 |
|---|---|---|
| PublicApp.tsx:15 | `siteMode: "personal" \| "service" \| "shared";`（PublicAppProps） | 删除 |
| PublicApp.tsx:24 | 解构 `siteMode` | 删除 |
| PublicApp.tsx:155 | `<UserRegisterView siteMode={siteMode} ...>` | 删除 prop |
| PublicApp.tsx:31-41 | `page` state（login/register 切换） | 保留 |
| PublicApp.tsx:122-136 | 注册页 nav（「登录」「管理后台」按钮） | 保留 |
| PublicApp.tsx:143-166 | 登录页 nav（registrationMode !== "closed" 时显示「注册」按钮 PublicApp.tsx:147-156） | 保留（注册模式逻辑不动） |

**移除后**：PublicApp 本身保留（登录/注册是 service 模式核心），仅去掉 siteMode prop。LinuxDO 回调（含 `registration_disabled` 等错误文案 PublicApp.tsx:55-64）原样保留。

### 1.3 core/types.ts（`apps/ui/src/core/types.ts`）

| 位置 | 内容 | 处置 |
|---|---|---|
| types.ts:132 | `export type SiteMode = "personal" \| "service" \| "shared";` | 删除 |
| types.ts:140 | `Settings.site_mode: SiteMode;` | 删除 |
| types.ts:220 | `SettingsForm.site_mode: SiteMode;` | 删除 |
| types.ts:133 | `RegistrationMode` | **保留** |

### 1.4 SettingsView.tsx（`apps/ui/src/features/SettingsView.tsx`，全文 741 行）

| 位置 | 内容 | 处置 |
|---|---|---|
| SettingsView.tsx:24-35 | `siteModeOptions` 常量（三模式选项：自用/服务/共享） | **整块删除** |
| SettingsView.tsx:176-195 | 站点模式 `<select id="site-mode" name="site_mode">` 表单块 | **整块删除** |
| SettingsView.tsx:196 | `{settingsForm.site_mode !== "personal" && (<>` 包裹注册模式/签到奖励/初始额度/邀请码开关（:198-286） | **去掉条件包裹，内容无条件渲染**（这些是保留项） |
| SettingsView.tsx:50-67 | `registrationModeOptions`（开放注册/仅 LinuxDO/关闭注册） | **保留不动** |
| SettingsView.tsx:198-286 | 注册模式 select、签到奖励、新用户初始额度、需要邀请码 checkbox（当前在 `!== "personal"` 条件内） | 保留内容，去条件 |
| SettingsView.tsx:638 | `{settingsForm.site_mode !== "personal" && settingsForm.require_invite_code === "true" && (` 邀请码管理面板 | **去掉 site_mode 条件**，仅保留 `require_invite_code === "true"` 条件 |
| SettingsView.tsx:297 / :319 / :345 / :369 | `site_mode === "shared"` 条件块（channel_fee_enabled / user_channel_selection_enabled / channel_review_enabled / ldoh_cookie） | **整块删除**（详见 §2.7） |

### 1.5 其它 siteMode 引用（grep 全量确认，`siteMode|site_mode|SiteMode`）

| 文件:行 | 内容 | 归属章节 |
|---|---|---|
| UserApp.tsx:13,55,88,150,334,338 | SiteMode import / prop / 请求类型 / `siteMode !== "shared"` 拦截 | §2.1 |
| AdminApp.tsx:22,180,703,1158 | import / settingsForm 初始化 `?? "personal"` / 提交 `site_mode` / 传给子视图 | §1.6 |
| ChannelsView.tsx:6,57,63,66,260,319,992 | import / prop / `defaultShared = siteMode === "shared"` / 表单 siteMode prop | §2.4 |
| SettingsView.tsx:6（SiteMode import）| type import | §1.4 |
| core/constants.ts:57 | `initialSettingsForm.site_mode: "personal"` | §1.6 |
| features/UserRegisterView.tsx:2,6,22,55 | import / prop / `siteMode === "personal"` 返回「自用模式暂不开放注册」提示块（:55-90 区段） | §1.7 |

### 1.6 AdminApp.tsx 与 core/constants.ts 的 site_mode 数据流

- `apps/ui/src/AdminApp.tsx:180`：`site_mode: settings.site_mode ?? "personal"`（settingsForm 初始化，由 `/api/settings` 返回构造）。
- `apps/ui/src/AdminApp.tsx:703`：保存设置时提交 `site_mode: settingsForm.site_mode`（settings PUT）。
- `apps/ui/src/AdminApp.tsx:1158`：`siteMode={data.settings?.site_mode ?? "personal"}` 传给 ChannelsView。
- `apps/ui/src/core/constants.ts:57`：`initialSettingsForm.site_mode: "personal"`。
- 处置：以上四处全部删除；`SettingsForm`/`Settings` 类型同步删字段（§1.3）。

### 1.7 UserRegisterView.tsx 的 personal 拦截

- `apps/ui/src/features/UserRegisterView.tsx:55-90`：`if (siteMode === "personal")` 返回「此站点为自用模式，暂不开放注册。」占位卡片（含硬编码的 api-worker.metayuandao.workers.dev 提示链接，:78-90）。**整块删除**，正常渲染注册表单。
- `:2`（import SiteMode）、`:6`（prop 类型）、`:22`（解构）一并删除。

## 2. 共享模式生态（前端部分）

### 2.1 UserApp.tsx（`apps/ui/src/UserApp.tsx`，全文 588 行）——用户端外壳与导航

**需删除的导航/路由条目**：
- UserApp.tsx:52：`userTabToPath` 中 `channels: "/user/channels"`；
- UserApp.tsx:66：`userPathToTab` 中 `"/user/channels": "channels"`；
- core/constants.ts:27：`userTabs` 的 `{ id: "channels", label: "贡献渠道" }`；
- types.ts:196-198：`UserTabId` 联合类型 `"channels"`（:199 前）；
- UserApp.tsx:25-37：`ChannelItem` 类型（贡献渠道专用）；
- UserApp.tsx:18 / :41：`UserChannelsView` import 与渲染（:397-406）；
- UserApp.tsx:90-99：`channels` state、`channelAliases` state；
- UserApp.tsx:160-166：`loadChannels`（`GET /api/u/channels`）；
- UserApp.tsx:192：`loadTab` 中 `if (tabId === "channels") await loadChannels();`；
- UserApp.tsx:332-339：`visibleTabs` useMemo——`siteMode !== "shared"` 时过滤掉 channels tab（**移除后整个 useMemo 可简化为直接用 `userTabs`**，同时删掉 :13/:55/:88 的 SiteMode 引用）；
- UserApp.tsx:148-152：`loadModels` 的响应类型含 `site_mode: SiteMode`（`GET /api/u/models`，后端移除该字段后前端类型同步删）；
- UserApp.tsx:368-374：`UserTokensView` 的 `channelSelectionEnabled={dashboardData?.user_channel_selection_enabled}` prop（设置项删除后失效，处置见 §2.6 决策点）；
- UserApp.tsx:397-406：`UserChannelsView` 渲染及 `channelReviewEnabled={dashboardData?.channel_review_enabled ?? false}` prop。

**保留项（勿动）**：dashboard/monitoring/models/tokens/usage 五个 tab（UserApp.tsx:46-58、61-67）、LinuxDO 绑定/解绑（:99-126、:254-267）、令牌 CRUD（:245-306）、充值回调提示（:113-116 recharge ok）。

### 2.2 提现（withdrawal）前端点

| 位置 | 内容 |
|---|---|
| UserDashboard.tsx:165-167 | `withdrawAmount/withdrawLoading/withdrawNotice` state |
| UserDashboard.tsx:236-265 | `handleWithdraw` → `POST /api/u/withdrawal/create`（:249） |
| UserDashboard.tsx:366-437 | 「余额提现」卡片（`data.withdrawal_enabled` 条件，:367）：可提现余额/手续费率展示（:373-376）、LinuxDO 绑定前置校验（:379-382）、提现表单与到账换算预览（:384-430） |
| UserDashboard.tsx:448-452 | 「余额」统计卡内 `可提现: ${data.withdrawable_balance.toFixed(2)}` 子行（withdrawal_enabled 条件） |
| AdminApp.tsx:192-194 | settingsForm 初始化 withdrawal_enabled/fee_rate/mode |
| AdminApp.tsx:712-714 | 保存设置提交 withdrawal_* 三项 |
| SettingsView.tsx:397-418 | 「启用余额提现」checkbox（`site_mode !== "personal"` 条件） |
| SettingsView.tsx:420-480 | 手续费率输入 + 提现模式 select（lenient/strict，`withdrawal_enabled === "true"` 条件） |
| types.ts:145-147 | `Settings.withdrawal_enabled/withdrawal_fee_rate/withdrawal_mode` |
| types.ts:223-225 | `SettingsForm.withdrawal_*`（字符串表单态） |
| types.ts:275-276 | `UserDashboardData.withdrawable_balance/withdrawal_enabled/withdrawal_fee_rate` |
| constants.ts:60-62 | `initialSettingsForm.withdrawal_*` |
| core/api.ts | **无提现专属函数**（api.ts 为通用 fetch 封装，全文 39 行，无需改） |

处置：以上全部删除。

### 2.3 LDOH 前端点

**AdminApp（`apps/ui/src/AdminApp.tsx`，1288 行）**：
- :15-17 `LdohSite/LdohSiteMaintainer/LdohViolation` import；:32 `LdohView` import；
- :63 `tabToPath` 的 `ldoh: "/admin/ldoh"`；:76 `pathToTab` 的 `"/admin/ldoh": "ldoh"`；
- :115-121 `ldohSites/ldohViolations/ldohPendingMaintainers/ldohPendingChannels` 四个 state；
- :217-260 `loadLdoh`（`GET /api/ldoh/sites` :219、`GET /api/ldoh/violations` :224、遍历 sites 拉 maintainers/pending channels :229-259）；
- :278 `if (tabId === "ldoh") await loadLdoh();`；:291 loadTab 依赖数组；
- :585-693 十个 `handleLdoh*` 回调（sync/block-all/sites CRUD/maintainers approve-reject-add-remove/channels approve-reject）；
- :720 settings 提交含 `ldoh_cookie`；
- :1244-1262 `activeTab === "ldoh"` 渲染 `LdohView`；
- core/constants.ts:21 admin `tabs` 的 `{ id: "ldoh", label: "公益站" }`；types.ts:199 `TabId` 的 `"ldoh"`。

**LdohView.tsx（`apps/ui/src/features/LdohView.tsx`，631 行）**：整个文件为管理台公益站页面（站点列表/同步/封禁/待审维护者/待审贡献渠道）。**整文件删除**。

**UserApp 侧**：UserChannelsView.tsx:169-200 拉 `/api/u/ldoh/sites`（维护者面板）、:209-299 block/approve/reject/claim 等操作（详见 §2.5）；UserDashboard.tsx:612-656 「违规记录」耻辱墙（`data.violations`，LdohViolation 表格）。

**types.ts**：:156/:236 `ldoh_cookie`（Settings/SettingsForm）、:288 `UserDashboardData.violations`、:333-370 `LdohSite/LdohSiteMaintainer/LdohViolation` 三类型。constants.ts:73 `ldoh_cookie`。

处置：以上全部删除；`/api/public/contributions` 端点在前端无直接调用（grep `/api/public/` 仅命中 site-info，见 §3.2），其删除不产生前端影响。

### 2.4 渠道编辑 shared 开关（AdminApp 渠道表单，`apps/ui/src/features/ChannelsView.tsx`，1154 行）

- :10-17 `ParsedModel` 类型含 `shared` 字段（:15）；
- :19-36 `parseModelLines(text, defaultShared)`——按 `id|input|output|shared|enabled` 五段竖线格式解析，shared 缺省取 defaultShared（:32）；
- :38-51 `rebuildModelsText`——回写时输出五段竖线格式（:48）；
- :52-58 `ModelPricingEditorProps.siteMode: SiteMode`；
- :63 siteMode 解构、:66 `const defaultShared = siteMode === "shared"`（**移除后 shared 语义整体消失**）；
- :70-72 sharedCount/allShared/noneShared；:88-91 `updateShared`；:101-104 `toggleAll`（全部共享）；
- :140-170 工具栏「{sharedCount}/{parsed.length} 共享」「全部共享」「全部取消」按钮组；
- :193-203 每行「共享/私有」切换 pill（:195-202）；
- :260（props 类型）/ :319（解构）/ :992 `<ModelPricingEditor siteMode={siteMode}>`（:991-995）；
- AdminApp.tsx:1158 是 siteMode 的下发源头（§1.6）。

处置：`ParsedModel.shared`、defaultShared、updateShared/toggleAll、共享按钮组、共享/私有 pill 全部删除；模型文本格式从五段退回四段（**注意**：后端 channel models JSON 内嵌 shared 标记由迁移清理，前端 `rebuildModelsText` 输出格式需与后端解析同步——设计时确认四段格式的 enabled 位位置，避免 `id|input|output|enabled` 与后端预期错位）。保留：启用/禁用 pill（updateEnabled :93-97、:188-192）、定价输入（:205 起）、别名配置（:998-1015）。

### 2.5 渠道贡献视图（`apps/ui/src/features/UserChannelsView.tsx`，1228 行）

**整文件删除**。内容：用户贡献渠道 CRUD（`/api/u/channels` POST :411 / PATCH :405 / DELETE :444）、模型定价/别名/收费（charge_enabled 展示 :819-824、表单 :1173-1180）、贡献说明（contribution_note）、LDOH 维护者面板（mySites/siteChannels/siteViolations/claimUrl state :146-160，`/api/u/ldoh/*` 调用 :169-299）。

连带删除：
- UserApp.tsx 中全部引用（§2.1 已列）；
- types.ts:234-243 `ContributionChannel/ContributionEntry` 与 types.ts:277 `UserDashboardData.contributions`；
- UserDashboard.tsx:27-138 `ContributionBoard`（贡献榜组件，表格 id `zenapi-contribution-board` :45）与 :581-583 渲染（`data.contributions.length > 0` 条件）；
- UserDashboard.tsx:612-656 违规记录耻辱墙（§2.3）。

**决策点 A（design.md 需定）**：UserDashboard.tsx:494-533「个人设置-打赏链接（tip_url）」仅服务贡献榜展示（types.ts:252 `User.tip_url`、types.ts:265 `ContributionEntry.tip_url`、`PATCH /api/u/profile` UserDashboard.tsx:199-208）。贡献榜删除后 tip_url 失去展示位。PRD 未明确列出——建议随贡献榜一并移除（含 User 类型字段），需 design.md 决策。

**决策点 B（design.md 需定）**：根目录 `ldc-reward.user.js`（38KB 用户脚本）为「ZenAPI 贡献榜打赏」油猴脚本，依赖 `#zenapi-contribution-board` 选择器（ldc-reward.user.js:86）与 `data-contributor-name` 属性（:1157）、`@match https://zenapi.top/*`（:17-19）。贡献榜删除后此脚本失效。属于共享生态外围产物，PRD 未列出——是否随本次删除需用户/design.md 确认。

### 2.6 令牌渠道选择（user_channel_selection_enabled 消费点）

- UserApp.tsx:368-374：`channelSelectionEnabled={dashboardData?.user_channel_selection_enabled}` 传入 UserTokensView；
- UserTokensView.tsx:15/:27/:106：prop 与 `showChannelSelection = channelSelectionEnabled && multiChannelModels.length > 0`；
- UserTokensView.tsx:70-98 `selectedMap`（allowed_channels 选择状态，含 toggleChannel :83-92）、:186-193 编辑按钮可见性（`showChannelSelection &&`）、编辑模态（:270 起）。

**决策点 C（design.md 需定）**：PRD 删除 `user_channel_selection_enabled` 设置，但 R4 明确保留「令牌级 allowed_channels 限制」（代理侧校验取交集）。设置删除后 `dashboardData?.user_channel_selection_enabled` 恒为 undefined → 用户端渠道选择 UI 自动隐藏。方案（a）后端 `/api/u/dashboard` 不再返回该字段，前端删除 channelSelectionEnabled prop 与相关 UI（令牌 allowed_channels 仅存量生效、不可再编辑）；方案（b）UI 无条件显示渠道选择。倾向（a）（做减法），需 design.md 确认。

### 2.7 SettingsView 中分成/审核设置块

- SettingsView.tsx:297-312：`channel_fee_enabled`「启用渠道贡献者收费」（shared 条件）；
- SettingsView.tsx:319-335：`user_channel_selection_enabled`「允许用户选择渠道」；
- SettingsView.tsx:345-361：`channel_review_enabled`「用户贡献渠道需审核」；
- SettingsView.tsx:369-395：`ldoh_cookie`「LDOH Cookie（公益站同步）」输入框。
- 连带：types.ts:142-144（Settings 三字段）、:221-222（SettingsForm）、constants.ts:58-59、AdminApp.tsx:188-191（初始化）/ :705-707（提交）。
处置：全部删除。

### 2.8 withdrawable_balance 展示点（用户仪表盘）

- UserDashboard.tsx:373（提现卡片内「可提现余额」）、:450-452（余额统计卡内「可提现」子行）。两处均随提现卡片/withdrawal_enabled 条件一并删除（§2.2）。

## 3. 用户级模型限制（前端设计输入）

### 3.1 管理台用户管理现状（`apps/ui/src/features/UsersView.tsx`，400 行）

- 用户列表表格（:96-192）：邮箱/用户名/角色/余额/状态/注册时间/操作（编辑、启停、删除），无模型相关列；
- 创建模态（:165-264）：`createForm` 字段 email/name/password/balance（:38-43），`onCreate` 提交（:45-57）；
- 编辑模态（:266-399）：`editForm` 字段 name/balance/status/password（:44-50），`openEdit` 回填（:59-71），`handleEdit` 组装 patch（:73-88，`patch.password` 仅在有值时附加 :82-84）；
- 数据流：`UsersViewProps.onUpdate(id, patch: Record<string, unknown>)`（:17）→ AdminApp.tsx:1055-1068 `handleUserUpdate` → `PATCH /api/users/${id}`（:1058）；创建走 AdminApp.tsx:1034-1052 `handleUserCreate` → `POST /api/users`（:1042）；用户列表 `GET /api/users`（AdminApp.tsx:213）。

**「可用模型」编辑入口建议**：加在**编辑模态**（UsersView.tsx:266-399）最自然——与余额/状态同级新增一个「可用模型」区块；`handleEdit` 的 patch 机制（`Record<string, unknown>`）天然支持追加 `allowed_models` 字段（参照 :82-84 password 的可选字段模式：空 = 不限制，非空 = 白名单）。创建模态可暂不加（PRD R4 只要求「用户编辑界面提供配置入口」）。数据回填需 `User` 类型（types.ts:245-256）与 `/api/users` 列表接口返回 allowed_models 字段。

### 3.2 用户端模型广场取数（`apps/ui/src/features/UserModelsView.tsx`，102 行）

- 取数链路：UserApp.tsx:148-152 `loadModels` → `GET /api/u/models` → `setModels(result.models)`（`PublicModelItem[]`）→ UserApp.tsx:390-392 `<UserModelsView models={models} />`；
- 展示：模型卡片网格 + 搜索过滤（UserModelsView.tsx:26-35 本地 filter），每卡片列渠道与输入/输出价格（:56-100）；
- **影响点**：若后端 `/api/u/models` 按用户白名单过滤返回（推荐，与 `/v1/models` 一致），**UserModelsView 与 UserApp 无需改动**（纯展示消费方）；前端唯一联动是 UserApp.tsx:150 响应类型的 `site_mode` 字段删除（§2.1）。另注：用户端模型选择器（UserTokensView.tsx:99-105 `multiChannelModels`）同样消费 `models` prop——白名单过滤后令牌渠道选择候选也自动收敛，无额外改动。
- 管理台模型广场（ModelsView，747 行）走 `GET /api/models`（AdminApp.tsx:159，聚合全部启用渠道），不受用户级限制影响。

### 3.3 「多选模型」交互先例（可复用）

**最佳先例——渠道「拉取模型」多选弹窗**（07-27-channel-model-picker 任务刚落地）：
- UI：ChannelsView.tsx:899-988——固定定位模态（搜索框 :912-924、全选/取消全选 :926-935、checkbox 列表 :949-966、底部「确认加入（已选 N）」:970-984）；
- 状态与逻辑：AdminApp.tsx:106-109 `fetchedModels/fetchedSearch/selectedFetched: Set<string>`、`handleFetchModels`（:741-764，POST `/api/channels/fetch_models`）、`toggleFetchedModel`（:766-774）、`toggleAllFetched`（:776-785）、`confirmFetchedModels`（:787-811，去重后追加到 models 文本）；
- 用户编辑的「可用模型」选择器可直接复用此交互骨架：搜索 + checkbox + 全选 + 已选计数；候选模型源可用 `GET /api/models`（AdminApp.tsx:159 已有）或复用 ModelItem 列表。样式类（rounded-lg/border-stone-200/accent-amber-500 checkbox 等）与 Biome tab/双引号规范一致。

次要先例：ChannelsView ModelPricingEditor 的逐行 pill 切换（:188-203）适合「已选模型的移除/状态切换」形态；UserTokensView 的 allowed_channels 逐模型展开选择（:70-98）适合「模型→渠道」二级结构，本次用户级白名单是单级结构，用 §3.3 主先例即可。

## 4. 文档与规范

（调查中）

## 5. 前端测试现状

- **前端测试文件：不存在。** 全仓 `find *.test.ts / *.test.tsx / *.spec.ts`（排除 node_modules）零命中；根 `tests/` 目录不存在（AGENTS.md §3 布局图与 §5「核心逻辑须有单测，置于 tests/」描述的是规划约定，当前实际无任何测试文件）。
- vitest.config.ts:4 `include: ["tests/**/*.test.ts"]`，environment node——即使补测试也是 worker 侧纯函数，不覆盖 UI 组件（无 jsdom/前端测试基建）。
- 含义：本次重构的前端改动**无既有测试可回归**，验证依赖 `bun run typecheck`（tsc --noEmit 会捕捉删除类型后的引用残留）+ `bun run check`（Biome）+ 手动冒烟。PRD 验收项「`bun run test` 通过」在无测试文件时天然满足（vitest 空跑）。
