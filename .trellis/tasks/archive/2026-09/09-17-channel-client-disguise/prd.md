# 渠道客户端伪装(请求头 + 系统提示词注入)

## Goal

为渠道增加「客户端伪装」能力:管理员在渠道上配置一组**伪装请求头**与一段**客户端默认系统提示词**,代理转发时自动注入,使上游看到的流量特征(User-Agent / X-Title / HTTP-Referer 等头部与首条 system 提示词)与指定客户端一致。用于应对按客户端特征放行 / 差异化计费 / 风控的中转上游。

## Confirmed Decisions(用户已拍板)

| # | 决策 | 结论 |
|---|------|------|
| D1 | 预设客户端清单 | Cline、Pi、ZCode、Codex、Cherry Studio、Kilo Code 六个。**取证来源修正**:本机实装的为 Kilo Code 7.3.16、Cherry Studio 2.0.9、pi 0.85.1、ZCode 3.12.3(本机二进制/asar/npm 产物提取);Cline 与 Codex 本机未安装,改用官方仓库锚定版本提取(Cline v4.1.19 @ GitHub `27fe60d7`;Codex @ rust-v0.154.0),证据等级已在研究报告中标注 |
| D2 | 提示词合并策略 | **前置注入**:伪装提示词作为第一条 system,用户自带 system 顺延在后 |
| D3 | 伪装头优先级 | 插在全局注入与渠道级之间:剔除 → 全局注入 → **伪装头** → 渠道级 custom_headers |
| D4 | 测试链路范围 | **全部应用**:`/test-model` 与 Playground 注入头+提示词;连通性测试(`/v1/models` 探活)仅注入头(无对话 body) |
| D5 | 预设可靠性标注 | 指纹存在未验证环节的预设在 UI 中标「（测试）」:**Codex**(本机未安装,UA 终端段为快照猜测)与 **ZCode**(LLM 路径签名头家族未确证、语言/时区为环境真值)标测试;Cline / Kilo Code / pi / Cherry Studio(开源源码或本机实装直接证据)不标 |

## Background(现状盘点,来自代码勘察)

- `channels` 表已有 `custom_headers_json`,经任务 `09-14-global-custom-headers` 统一到全部 api_format 生效;头策略唯一入口 `apps/worker/src/utils/proxy-headers.ts` 的 `applyHeaderPolicy(headers, policy, channelCustomJson)`,顺序:剔除 → 全局注入 → 渠道级,后应用者赢。
- 三条代理路径收敛到 `buildChannelRequest`(`proxy.ts`,openai 透传 / anthropic / responses / custom 四分支);`anthropic-proxy.ts` 为 fresh Headers 白名单式构造,同样统一调用 `applyHeaderPolicy`(3 处);`playground.ts` 复用 `buildChannelRequest` 且 `policy=null`;`/test-model`(`routes/channels.ts`)同样走 `buildChannelRequest` 且豁免全局策略。
- 格式转换 `format-converter.ts` 已覆盖 system 三形态:OpenAI messages / Anthropic 顶层 `system`(string 或 blocks)/ Responses `instructions`。
- spec 契约 `.trellis/spec/api-worker/backend/proxy-headers.md`:禁止分支内联 merge 头;连通性测试(`channel-testing.ts`)**不走** `applyHeaderPolicy`(保留 custom-only merge,避免行为外溢);Playground 的 incomingHeaders 为空 Headers。
- 通道 CRUD 在 `routes/channels.ts` + `services/channel-repo.ts`(显式列名绑定),UI 链路 `ui core/types.ts ChannelForm` → `constants.ts initialChannelForm` → `ChannelsView.tsx` → `AdminApp.tsx`。

## Research 产物(`research/`,预设数据唯一来源)

| 客户端 | 报告 | 提示词 | 关键指纹(静态快照锚点) |
|--------|------|--------|--------------------------|
| Cline v4.1.19 | `client-fingerprint-vscode.md` §2 | `prompts/cline-system-prompt.md` + `cline-templates/` | 自配 provider 链路几乎零身份头(仅 AI SDK UA 链);身份头仅其自家计费 API;act 模板静态段 |
| Kilo Code 7.3.16 | `client-fingerprint-vscode.md` §1 | `prompts/kilo-system-prompt.md` + `kilo-templates/` | `UA: Kilo-Code/7.3.16`、`HTTP-Referer: https://kilocode.ai`、`X-Title: Kilo Code`;anthropic 链路 UA 为 `opencode/7.3.16` 且无 Referer/X-Title |
| pi 0.85.1 | `client-fingerprint-pi.md` | `prompts/pi-system-prompt.md` | `UA: pi ({os} {release}; {arch})`;OAuth 态伪装 Claude Code(`claude-cli/2.1.251` + `x-app: cli`);OpenRouter 归因头 |
| ZCode 3.12.3 | `client-fingerprint-zcode.md` | `prompts/zcode-system-prompt.md` | `UA: ZCode/{version}`、`X-Title: Z Code@cli`、`HTTP-Referer: https://zcode.z.ai`、`X-ZCode-Agent: glm`、`X-Client-Language/Timezone` 等 |
| Codex rust-v0.154.0 | `client-fingerprint-codex.md` | `prompts/codex-system-prompt.md`(+ gpt-5.2 模板) | `originator: codex_cli_rs`、`UA: codex_cli_rs/{ver} ({os} {ver}; {arch}) …`;instructions 注入位(Responses 协议) |
| Cherry Studio 2.0.9 | `client-fingerprint-cherry.md` | **无默认系统提示词**(main.js 直接证据) | `HTTP-Referer: https://cherry-ai.com` + `X-Title: Cherry Studio`(唯一稳定标识);UA 实为 ai-sdk 链,不含 CherryStudio 字样 |

**快照规则(适用于全部预设)**:
1. 只取**静态稳定值**;随会话/设备变化的头(`X-Task-ID`、`session-id`、`thread-id`、`x-client-request-id`、`X-Device-Mid`、`x-session-affinity` 等)**省略**,预设 note 注明原因(固定假随机值比缺失更可疑)。
2. 提示词只取**静态段**;cwd / git 状态 / 日期 / 平台真值等动态注入段不伪造,预设 note 注明。
3. 版本号进 UA/头值即被锚定(如 `Kilo-Code/7.3.16`),客户端更新后需手工刷新预设——快照语义,可预期。
4. `os.release()` 类 OS 真值取快照机值(Windows 10.0.26100 等),note 注明。

## Requirements

- **R1 渠道级伪装配置**:渠道新增 `disguise_headers_json`(JSON 对象头)与 `disguise_system_prompt`(文本)两个可空字段,独立于 `custom_headers_json`;留空 = 不伪装。
- **R2 内置预设库**:UI 侧六预设(R2 数据 = Research 产物表),含来源与版本锚点标注;选中即填充渠道字段(存解析后的具体值),可手工微调,可清除。
- **R3 代理注入**:伪装头经 `applyHeaderPolicy` 链按 D3 顺序注入全部 8 个上游分支;提示词按 D2 前置注入 openai / anthropic / responses 三协议(含 `/v1/responses` 透传注 instructions);`custom` 格式仅注入头不解释 body。
- **R4 测试链路**:按 D4 范围应用(连通性测试仅头,且不收敛 `applyHeaderPolicy`,维持 spec 契约)。
- **R5 管理台 UI**:渠道编辑弹窗「客户端伪装」分组(预设下拉 / 头 textarea + JSON 校验提示 / 提示词 textarea / 说明警示文案)。
- **R6 零回归**:未配置伪装的渠道行为与现状完全一致(既有 25 个头策略用例不改动即绿 + 新增零回归断言)。

## Acceptance Criteria

- **AC1**:创建/编辑渠道可设置两个伪装字段,保存后 GET 回显一致;清空保存 = 关闭伪装。
- **AC2**:UI 预设下拉含六项,选中后两字段填充为该预设 research 快照值;Codex 与 ZCode 两项名称带「（测试）」后缀且附近有图例说明;手工改动后保存生效;「清除伪装」清空两字段。
- **AC3**:对配置了伪装的渠道,上游请求头满足 剔除 → 全局注入 → 伪装头 → 渠道级(同名头后应用者赢);`policy=null` 调用方(Playground / test-model)伪装头仍生效。
- **AC4**:三协议入站(含格式互转)的最终上游 body 中,伪装提示词位于 system 首位(openai 前插 system 消息;anthropic system 前置 string/text block;responses instructions 前缀拼接);请求原带 system 时用户内容完整保留在后;`/v1/responses` 透传注入 instructions;custom 分支 body 不变。
- **AC5**:`/test-model` 与 Playground 的上游请求带伪装头+提示词;连通性测试(`/v1/models`)带伪装头、无提示词注入(无对话 body)、不携带全局策略头。
- **AC6**:两字段为空的渠道,头与 body 与现状逐字节一致(零回归基线测试)。
- **AC7**:`disguise_headers_json` 为非法 JSON 时按空配置处理,代理请求不报错。
- **AC8**:每个预设值可在 research/ 产物中溯源(报告 + 提示词文件),note 标注版本锚点与快照限制。

## Out of Scope

- 令牌级/用户级伪装粒度(仅渠道)。
- 动态会话头伪造(随机 ID / 时间戳 / 实时平台真值按请求生成)。
- TLS / HTTP2 指纹伪装(Workers 运行时限制)。
- 预设自动更新 / 与客户端版本联动。
- pi「OAuth 态即 Claude Code」衍生的 claude-code 独立预设(研究已备料,本期不做)。
