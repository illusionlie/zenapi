# 技术设计 — 渠道客户端伪装(请求头 + 系统提示词注入)

> 前置阅读:`.trellis/spec/api-worker/backend/proxy-headers.md`(头策略契约)、
> `research/` 下各客户端指纹研究产物。

## 1. 架构总览

伪装 = 渠道级两个新增字段 + 一条注入链:

```
渠道配置                      代理链路
┌──────────────────────┐    ┌─────────────────────────────────────────┐
│ disguise_headers_json │───▶│ applyHeaderPolicy(头):                   │
│ disguise_system_prompt│───▶│   剔除 → 全局注入 → 伪装头 → 渠道级 custom │
└──────────────────────┘    ├─────────────────────────────────────────┐
                            │ injectDisguisePrompt(body, protocol):     │
                            │   openai messages / anthropic system /    │
                            │   responses instructions —— 前置注入       │
                            └─────────────────────────────────────────┘
```

- **头注入**:扩展 `applyHeaderPolicy` 加第 4 个可选参数,保持「头策略唯一入口」契约,严禁分支内联 merge。
- **提示词注入**:新纯函数模块 `utils/client-disguise.ts`,按目标协议注入 `buildChannelRequest` 内(转换完成后)与 `anthropic-proxy.ts` 各分支。
- **预设库**:仅存在于 UI(`apps/ui/src/core/client-presets.ts`);渠道存**解析后的具体值**,worker 无需预设库,选中预设 = UI 填充字段,可再手工微调。

## 2. 数据契约

### 2.1 D1(迁移 `0021_channel_client_disguise.sql` + `schema.sql` 同步)

```sql
ALTER TABLE channels ADD COLUMN disguise_headers_json TEXT;   -- JSON 对象字符串,与 custom_headers_json 同风格
ALTER TABLE channels ADD COLUMN disguise_system_prompt TEXT;  -- 纯文本,前置注入的伪装系统提示词
```

- 两列均可空;NULL/空 = 不伪装(零回归基线)。
- 读取容错:`disguise_headers_json` 非法 JSON 按空处理,不阻断代理(与全局头读取宽容原则一致)。
- `ChannelRecord` 类型(`channel-repo.ts`)加 `disguise_headers_json: string | null`、`disguise_system_prompt: string | null`,Insert/Update 输入与 SQL 列名同步扩展。

### 2.2 写入校验

- 沿用 `custom_headers` 现状风格:`trim() || null`,后端**不做**严格 400 校验(区别于 settings 的 fail-closed,渠道字段历史上就是宽容存储)。
- UI 侧轻量校验:伪装头 textarea 失焦时尝试 `JSON.parse`,非法时行内警示(不阻断提交,与 custom_headers 一致)。

### 2.3 头策略链(核心契约变更)

`utils/proxy-headers.ts`:

```ts
export function applyHeaderPolicy(
	headers: Headers,
	policy: ProxyHeaderPolicy | null,
	channelCustomJson: string | null | undefined,
	disguiseJson?: string | null,   // 新增,可选 → 现有调用点源兼容
): void;
```

应用顺序(后应用者赢):**剔除 → 全局注入 → 伪装头 → 渠道级 custom_headers**。
- `policy === null`(Playground / test-model)时跳过全局两步,**伪装头与渠道级仍生效**(D4 决策)。
- 内部实现:复用 `parseExtraHeaders(disguiseJson) ?? {}` 容错解析后逐个 `set`。

特例:`services/channel-testing.ts` 的 `fetchChannelModels` 保持**不收敛**到 `applyHeaderPolicy`(spec 警告:收敛会让 openai/anthropic 渠道连通性测试开始带渠道级 custom 头,行为外溢);仅在其现有 custom-only merge 旁**新增**伪装头 merge(parse 后 set,伪装头先应用、custom 后应用,保持全局顺序语义)。

## 3. 提示词注入(`utils/client-disguise.ts`)

```ts
// 三协议注入,均为纯函数(mutate 传入 body),可单测
export function injectSystemPromptOpenAI(body: Record<string, unknown>, prompt: string): void;
// body.messages 为数组时在最前 unshift {role:"system", content: prompt};非数组/缺失则创建 [system]

export function injectSystemPromptAnthropic(body: Record<string, unknown>, prompt: string): void;
// body.system:未设置 → string prompt;string → prompt + "\n\n" + 原值;
// blocks 数组 → 在最前 unshift {type:"text", text: prompt}(不动原 blocks 的 cache_control)

export function injectSystemPromptResponses(body: Record<string, unknown>, prompt: string): void;
// body.instructions:未设置/空 → prompt;有 → prompt + "\n\n" + 原值
```

### 3.1 注入点接线矩阵(全部 8 处)

| # | 位置 | 头(disguiseJson) | 提示词 | 说明 |
|---|------|:---:|:---:|------|
| 1 | `proxy.ts` openai 透传分支 | ✅ | ✅ 仅 chat | `parsedBody.messages` 为数组即注入(mutate + `JSON.stringify`),embeddings 等无 messages 的 body 自然跳过 |
| 2 | `proxy.ts` anthropic 分支 | ✅ | ✅ | `openaiToAnthropicRequest` 转换完成后注入 |
| 3 | `proxy.ts` responses chat 入站分支 | ✅ | ✅ | `openaiToResponsesRequest` 转换完成后注入 instructions |
| 4 | `proxy.ts` `/v1/responses` 透传分支 | ✅ | ✅ | mutate `parsedBody.instructions` 后 stringify;伪装一致性优先于 R4「原样透传」(R4 本意是不解释 store / previous_response_id 状态,注入不违反) |
| 5 | `proxy.ts` custom 分支 | ✅ | ❌ | body 结构未知,不解释 |
| 6 | `anthropic-proxy.ts` anthropic 透传分支 | ✅ | ✅ | anthropic body 顶层 system 注入(复用 effectiveRequestText stringify 链路) |
| 7 | `anthropic-proxy.ts` openai 转换分支 | ✅ | ✅ | `channelOpenaiBody` messages 注入 |
| 8 | `anthropic-proxy.ts` custom 分支 | ✅ | ❌ | 同 #5 |

- `buildChannelRequest` 签名加第 10 个可选参数 `disguisePrompt?: string | null`(在 `policy` 之后),`proxy.ts` / `playground.ts` / `channels.ts test-model` 三个调用方传入;anthropic-proxy 三分支自行调用注入函数。
- 测试链路(D4):`playground.ts` 与 `channels.ts /test-model` 传完整头+提示词;`channel-testing.ts` 连通性仅头(§2.3 特例)。
- 提示词注入只在 prompt 非空时执行;注入时机在模型别名替换之后(handler 先改 model,再进 buildChannelRequest),互不干扰。

## 4. 预设库(UI 侧)

`apps/ui/src/core/client-presets.ts`:

```ts
export type ClientPreset = {
	id: string;            // "cline" | "kilo-code" | "pi" | "zcode" | "codex" | "cherry-studio"
	name: string;          // 展示名(含版本锦点,如 "Cline v4.1.19")
	headers: Record<string, string>;    // 真实提取,来自 research/
	systemPrompt: string;  // 真实提取静态段;Cherry Studio 为空串(无默认提示词,纯头部伪装)
	note: string;          // 快照限制说明(见下方快照规则)
};
export const CLIENT_PRESETS: ClientPreset[];
```

预设内容规则(来自 research 结论,与 prd「快照规则」一致):

1. **只取静态稳定头**;随会话/设备变化头(`X-Task-ID`、`session-id`、`thread-id`、`x-client-request-id`、`X-Device-Mid`、`x-session-affinity` 等)一律省略,note 注明(固定假随机值比缺失更可疑)。
2. **提示词只取静态段**:cwd/git/日期/平台真值等动态段不伪造。
3. **版本锦点**:UA/头值中的版本号被锚定到 research 提取版本,note 说明需手工刷新。
4. 每个预设的 note 需含证据来源(本机实装提取 / 官方仓库锝定):Cline v4.1.19 与 Codex rust-v0.154.0 为官方源码证据,其余为本机产物提取。
5. 特殊预设:Cherry Studio 无 systemPrompt(纯头);Kilo Code 的 anthropic 链路 UA 是 `opencode/7.3.16`(与主 UA 不同)——预设按主链路(openai-compatible)为准,note 提示 anthropic 链路差异;pi 预设 note 提示其 OAuth 态自带 Claude Code 伪装头(本期不纳入)。
6. **可靠性标注(D5)**:指纹存在未验证环节的预设在展示名后缀「（测试）」:`Codex CLI 0.154.0（测试）`(本机未安装,UA 终端 token/OS 段为快照猜测)、`ZCode 3.12.3（测试）`(LLM 路径签名头家族未确证;语言/时区/OS 版本为环境真值)。UI 需附图例说明「（测试）= 指纹存在未验证环节,建议实测后再投入使用」;其余四预设不标。

预设数据与 research 溯源映射:

| 预设 | 头来源 | 提示词来源 |
|------|--------|------------|
| cline | `research/client-fingerprint-vscode.md` §2 | `research/prompts/cline-system-prompt.md` |
| kilo-code | 同上 §1 | `research/prompts/kilo-system-prompt.md`(取 soul+默认 role+静态段拼装) |
| pi | `research/client-fingerprint-pi.md` | `research/prompts/pi-system-prompt.md` |
| zcode | `research/client-fingerprint-zcode.md` | `research/prompts/zcode-system-prompt.md`(静态 section) |
| codex | `research/client-fingerprint-codex.md` | `research/prompts/codex-system-prompt.md` |
| cherry-studio | `research/client-fingerprint-cherry.md` | 无(空串) |

- 预设以**静态快照**形式固化在 UI bundle;预设更新不自动传播到已配置渠道(渠道存具体值,重新选择即刷新)——透明且可预期。
- 内容较大(Cline/Kilo 提示词数十 KB)时接受 bundle 增量(gzip 后可忽略);若单预设 > 50KB 触发权衡(见 §7),当前按直入 bundle 处理。

## 5. UI(渠道编辑弹窗)

- `core/types.ts`:`Channel` + `ChannelForm` 加 `disguise_headers: string`、`disguise_system_prompt: string`(form 用 string 承接 textarea)。
- `constants.ts`:`initialChannelForm` 补两空串。
- `AdminApp.tsx`:编辑回填(`?? ""`)、提交携带。
- `ChannelsView.tsx`:表单新增「客户端伪装」分组:
  1. 预设下拉(placeholder「选择预设客户端…」,选中即覆盖填充两个字段,可再手改;含「清除伪装」动作 = 清空两字段);
  2. 伪装请求头 textarea(JSON,placeholder 示例 `{"User-Agent": "..."}`;失焦 JSON.parse 警示);
  3. 伪装系统提示词 textarea;
  4. 说明文案:作用范围(全部代理路径 + 测试链路;连通性测试仅头)、与 custom_headers 的优先级关系(伪装头先应用,同名头渠道级 custom 可覆盖)、提示词前置注入语义。
- 渠道列表不新增列(伪装状态经编辑弹窗查看,避免表格过载)。

## 6. 权衡记录

| 决策 | 备选 | 理由 |
|------|------|------|
| 渠道存解析后具体值 | 存预设 ID,worker 代理时解析 | worker 零耦合预设库;管理员可见可微调;预设更新不隐式传播(稳定性) |
| 预设库放 UI constants | worker 常量 + `/api/client-presets` 端点;settings KV 可编辑 | 最简;无新端点无迁移;bundle 增量可接受 |
| `applyHeaderPolicy` 加第 4 参 | 独立 `applyDisguiseHeaders` 函数 | 保持唯一入口(spec 反对内联/散落);可选参数对 8 个现有调用点源兼容 |
| openai 透传 mutate parsedBody 再 stringify | 保持 requestText 原文不动 | 已有 stream_options 注入先例(同模式);伪装必须改 body,无法两全 |
| responses 透传注入 instructions | 严格遵守原样透传 | 伪装渠道半程裸奔无意义;R4 本意是状态语义不解释 |
| custom 分支不注入提示词 | 尽力注入 | body 结构未知,盲改可能损坏请求 |
| 后端宽容存储(不做 400) | 写入严格校验 | 与 custom_headers 现状一致,避免同表两套哲学;UI 兜底 |

## 7. 兼容性与回滚

- 两列可空,未配置渠道所有行为与现状一致(零回归,测试断言)。
- 预设快照随客户端版本漂移:属预期限制,`note` 文案告知。
- 回滚:代码回退即可;D1 列保留无害(无需 down 迁移)。
- 风险:伪装头覆盖内置鉴权头(Authorization 等)导致上游 401 —— 与 custom_headers 同类风险,UI 文案警示兜底,不加保护名单(spec 既有决策)。

## 8. 测试计划

- `tests/proxy-headers.test.ts` 扩展:disguise 参数矩阵(全局 < 伪装 < 渠道级覆盖;policy=null 时伪装仍生效;disguise 非法 JSON 容错)。
- 新增 `tests/client-disguise.test.ts`:三协议注入函数全分支(无 system / string / blocks / instructions 已存在)、`buildChannelRequest` 各格式 × 伪装集成(含 responses 透传、custom 不注入)、零回归基线(不传新参数 = 现状)。
- 既有 25 个头策略用例必须全绿(第 4 参缺省不改变行为)。
