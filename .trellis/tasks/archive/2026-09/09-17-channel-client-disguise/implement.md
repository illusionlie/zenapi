# 执行计划 — 渠道客户端伪装

> 每步完成即勾选;门禁命令:`cd <repo-root> && bun run check && bun run typecheck && bun run test`

## Step 1 数据层(schema + 迁移 + repo)

- [x] `apps/worker/migrations/0021_channel_client_disguise.sql`:两条 `ALTER TABLE channels ADD COLUMN`(disguise_headers_json / disguise_system_prompt,TEXT 可空)。
- [x] `apps/worker/src/db/schema.sql`:channels 表定义同步两列。
- [x] `services/channel-repo.ts`:`ChannelRecord`(若类型在此或其消费处)、`ChannelInsertInput` / `ChannelUpdateInput` 加两字段;`insertChannel` / `updateChannel` / 查询 SELECT 列同步。
- [x] 验证:`bun run typecheck`(此时应仍绿,新字段暂无消费者)。
- 回滚点:迁移文件独立,可整文件删除。

## Step 2 伪装工具模块 + 头策略扩展

- [x] 新建 `apps/worker/src/utils/client-disguise.ts`:
  - `parseDisguiseHeaders(raw)`(容错,非法 → `{}`);
  - `injectSystemPromptOpenAI` / `injectSystemPromptAnthropic` / `injectSystemPromptResponses`(design §3 契约)。
- [x] `utils/proxy-headers.ts`:`applyHeaderPolicy` 加第 4 可选参数 `disguiseJson`,顺序 剔除 → 全局 → 伪装 → 渠道级;`policy=null` 时伪装仍生效。
- [x] 新建 `tests/client-disguise.test.ts`(design §8)。
- [x] `tests/proxy-headers.test.ts` 扩展 disguise 矩阵;确认既有 25 用例不改动即绿。
- 验证:`bun run test`(proxy-headers + client-disguise 全绿)。
- 回滚点:第 4 参可选,可整体 revert 不影响调用方。

## Step 3 代理链路接线

- [x] `proxy.ts`:`buildChannelRequest` 加第 10 参 `disguisePrompt?: string | null`;五个分支按 design §3.1 矩阵接线(#1 openai 透传仅 messages 数组时 mutate+stringify;#4 responses 透传注入 instructions;#5 custom 仅头)。
- [x] `proxy.ts` 主 handler:调用处透传 `channel.disguise_headers_json`(经 applyHeaderPolicy 第 4 参)与 `disguise_system_prompt`。
- [x] `anthropic-proxy.ts`:三分支(anthropic 透传 / openai 转换 / custom)按矩阵接线;预载处并行读取渠道两字段(已在 ChannelRecord 中,无额外查询)。
- [x] `playground.ts`:传伪装头 + 提示词(policy 仍 null)。
- [x] `routes/channels.ts` `/test-model`:channelLike 补两字段 + 调用传参。
- [x] `services/channel-testing.ts` `fetchChannelModels`:现有 custom merge 旁新增伪装头 merge(不收敛 applyHeaderPolicy,保持 spec 警告)。
- 验证:`bun run test` 全绿;手工 `bun run dev:worker` 用 curl 验证 openai / anthropic 两入站的头与 body 注入。
- 回滚点:各文件独立可 revert;此步完成即后端功能完备。

## Step 4 渠道 CRUD 字段

- [x] `routes/channels.ts`:create(`POST`)与 update(`PUT` 三态)接入 `disguise_headers` / `disguise_system_prompt`(trim || null;undefined 回退现值);GET 返回两字段。
- 验证:`bun run test`;curl 建/改渠道验证持久化。
- 回滚点:CRUD 独立。

## Step 5 UI(预设库 + 渠道表单)

- [x] `apps/ui/src/core/client-presets.ts`:`CLIENT_PRESETS` 六预设,数据与 note 按 design §4 溯源表从 `research/` 各报告提取(遵守快照规则:省略随机会话头、提示词只取静态段、版本锦点、来源标注;Cherry Studio 提示词为空串)。
- [x] `core/types.ts`:`Channel` / `ChannelForm` 加字段;`core/constants.ts`:`initialChannelForm` 补空串。
- [x] `AdminApp.tsx`:编辑回填 + 提交映射。
- [x] `features/ChannelsView.tsx`:「客户端伪装」分组(design §5:预设下拉 / 头 textarea + JSON 失焦校验 / 提示词 textarea / 说明与警示文案;预设 note 以小字展示)。
- 验证:`bun run dev:ui` 手动走查:选预设 → 字段填充 → 保存 → 重开回显;清除伪装;Cherry Studio 纯头预设。
- 回滚点:UI 独立,可单独 revert。

## Step 6 全量门禁 + 冒烟

- [x] `bun run check && bun run typecheck && bun run test` 全绿。
- [x] 本地 D1 迁移:`cd apps/worker && bunx wrangler d1 migrations apply api-worker --local`(冒烟前置)。
- [ ] 手动冒烟矩阵(见 design §8 / §7):未配置渠道零回归;配置 Cline 预设后 `/v1/chat/completions` 上游收到伪装 UA + 前置 system;anthropic 入站同理;连通性测试仅带头。

## Step 7 Spec 更新(Phase 3.3 前置)

- [x] `.trellis/spec/api-worker/backend/proxy-headers.md`:Signature 补第 4 参 `disguiseJson`、顺序契约改为四层(剔除→全局→伪装→渠道级)、Gotchas 补「channel-testing 伪装头内联 merge 不收敛」与「policy=null 时伪装仍生效」语义。
- [x] 如实现中发现 design 未覆盖的契约,同步补录。

## 风险文件

- `proxy.ts` / `anthropic-proxy.ts`(高流量核心路径,分支多,改动需逐分支核对)
- `proxy-headers.ts`(spec 契约文件,签名变更需同步 spec —— 收尾阶段更新 proxy-headers.md)
