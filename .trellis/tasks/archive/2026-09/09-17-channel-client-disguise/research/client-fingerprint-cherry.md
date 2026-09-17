# 客户端网络指纹研究:Cherry Studio

> 任务:09-17-channel-client-disguise / 研究代理产出 / 日期 2026-09-17
>
> **证据等级声明**:Cherry Studio **本机已安装**,本报告基于本机安装体解包(`app.asar` 全量提取)静态分析,代码证据均标注 asar 内路径。所有 JS 片段为解包产物原文(rolldown 打包,结构可读)。

## 1. 安装证据

| 项 | 结果 | 证据 |
|----|------|------|
| 安装路径 | `D:\ProgramFiles\CherryStudio\Cherry Studio\` | 注册表 `UninstallString` / `DisplayIcon` |
| 版本 | **2.0.9**(exe `FileVersion 2.0.9`, `ProductVersion 2.0.9.0`;asar `package.json` `"version": "2.0.9"`) | 注册表卸载项 + exe 元数据 + package.json,三者一致 |
| 运行时 | Electron **41.8.0**(exe 内嵌 `Electron/41.8.0` 字符串),捆绑 Node **24.16.0**(ELECTRON_RUN_AS_NODE 实测) | 直接证据 |
| 主进程入口 | `resources/app.asar` 内 `out/main/main.js`(`"main": "./out/main/main.js"`) | package.json |
| 主进程代码 | `out/main/*.js`(152 个 chunk)+ `out/preload` + `out/renderer` | 解包确认 |
| 用户数据 | `C:/Users/NINGMEI/AppData/Roaming/CherryStudio/`(含 2025-10 ~ 2026-09 使用日志,日志中无请求头记录) | 直接证据 |

## 2. HTTP 标识请求头清单(真实 API 请求)

Cherry Studio v2 架构:**所有 LLM API 请求由主进程经 AI SDK(Vercel AI SDK)发出**,走 `globalThis.fetch`(Node undici)→ 本机代理 dispatcher(NodeProxyController,纯路由不注入头)→ 上游。`monitoredFetch`(MainNetworkDevtoolsService)只监听记录,不注入头。

### 2.1 应用级默认头 —— **核心指纹**(`out/main/main.js`)

```js
const defaultAppHeaders = () => {
    return {
        "HTTP-Referer": "https://cherry-ai.com",
        "X-Title": "Cherry Studio"
    };
};
```

| 头 | 值 | 应用范围 | 置信度 |
|----|----|----------|--------|
| `HTTP-Referer` | `https://cherry-ai.com` | `defaultAppHeaders()` 被 spread 进**所有** provider 配置(openai-compatible / openai / anthropic / azure / dashscope / newapi / aihubmix / dmxapi / ollama / vertex / bedrock / open-responses / cherryin 等全部 `build*Config`)及 `defaultHeaders()`(模型列表请求) | 直接证据 |
| `X-Title` | `Cherry Studio` | 同上 | 直接证据 |

### 2.2 鉴权头

| 头 | 值 | 应用范围 | 证据 | 置信度 |
|----|----|----------|------|--------|
| `Authorization` | `Bearer {apiKey}` | openai-compatible:`createOpenAICompatible()` 自动加(`...options.apiKey && { Authorization: ... }`);Anthropic ChatGPT-token 模式 | `out/main/dist-CWqBf2ch.js`(openai-compatible provider);`ai-sdk-openai-CWCa7L1t.js` getHeaders | 直接证据 |
| `X-Api-Key` | `{apiKey}`(**与 Authorization 并存,同值**) | `defaultHeaders()`(所有有 key 的 provider 的模型列表请求)无条件加;chat 路径 `buildCommonOptions` 仅 `aiSdkProviderId === "openai"` 时加 | `main.js` | 直接证据 |
| `x-api-key` | `{apiKey}` | Anthropic 路径(模型列表 `anthropicFetcher` 与 chat getHeaders 均用 x-api-key 而非 Authorization) | `main.js` anthropicFetcher;`ai-sdk-anthropic` getHeaders | 直接证据 |
| `anthropic-version` | `2023-06-01`(`ANTHROPIC_VERSION` 常量) | Anthropic 全路径 | `main.js` | 直接证据 |

⚠️ 对网关的意义:Cherry 对 openai 系 provider 可能**同时发送 `Authorization: Bearer k` 与 `X-Api-Key: k`**。伪装渠道若上游校验 X-Api-Key,注入值应与渠道上游 key 的处理一致(ZenAPI 注入头时需自行决定是否携带真实 key 值的影子头,预设库只记录模式)。

### 2.3 User-Agent —— **关键否定结论**

**Cherry Studio 2.x 的 LLM API 请求 User-Agent 不含 `CherryStudio` 字样。** 真实 UA 由 AI SDK 追加链构成:

```
{基础 UA(undici fetch 默认无)} + ai-sdk/{provider}/{版本} + ai-sdk/provider-utils/{版本} + runtime/{...}
```

| provider 路径 | 实际 UA(还原) | 证据 | 置信度 |
|---------------|----------------|------|--------|
| openai-compatible(自定义/兼容渠道,最常见) | `ai-sdk/openai-compatible/2.0.62 ai-sdk/provider-utils/4.0.40 runtime/node.js/24` | `dist-CWqBf2ch.js` `withUserAgentSuffix$1(headers, `ai-sdk/openai-compatible/${VERSION}`)`,`VERSION = "2.0.62"`;provider-utils 版本与 runtime 推导见下 | 直接证据(拼接链)/ 推断(runtime 段,见 2.4) |
| openai(官方预设) | `ai-sdk/openai/3.0.53 ai-sdk/provider-utils/4.0.40 runtime/node.js/24` | `ai-sdk-openai-CWCa7L1t.js` getHeaders(`ai-sdk/openai/${VERSION}` = 3.0.53) | 同上 |
| anthropic | `ai-sdk/anthropic/3.0.103 ai-sdk/provider-utils/4.0.40 runtime/node.js/24` | `dist-CbQdyIv5.js`(`ai-sdk/anthropic/${VERSION}` = 3.0.103) | 同上 |

拼接顺序证据:`withUserAgentSuffix()` 实现 `headers.set("user-agent", [当前UA, ...后缀].join(" "))`,provider 层先加 `ai-sdk/{provider}/x`,postToApi 层再加 `ai-sdk/provider-utils/4.0.40` + runtime。

### 2.4 `runtime/` 段推导(本机实证)

AI SDK 的 `getRuntimeEnvironmentUserAgent()`:有 `window` → `runtime/browser`;有 `navigator.userAgent` → `runtime/{其小写}`;否则 `runtime/node.js/v{node}`。主进程无 `window`。

本机用 Cherry Studio 自带运行时实测(ELECTRON_RUN_AS_NODE):`node 24.16.0`,`navigator.userAgent === "Node.js/24"`(Node 21+ 全局 navigator)。→ 主进程取 navigator 分支,值为 **`runtime/node.js/24`**(小写化后)。置信度:**推断(高)** — 运行时二进制实测 + 代码分支唯一性;未在真实 Electron 主进程模式捕获出站流量复验。

### 2.5 `CherryStudio/{version}` UA 的真实用途(⚠️ 与预期相反)

存在 `generateUserAgent()`(main.js):

```js
`Mozilla/5.0 (${osString}; ${archString}) AppleWebKit/537.36 (KHTML, like Gecko) CherryStudio/${appVersion} Chrome/124.0.0.0 Safari/537.36`
```

但其调用点仅为:**遥测(AnalyticsService)、更新检查(AppUpdaterService / getUpdateHeaders)、provider registry 拉取** —— **均非 LLM API 请求**。另有更新下载 `{"User-Agent": "CherryStudio"}`(裸值,同样非 API)。全 asar(main/preload/renderer/node_modules)grep 确认 `CherryStudio/` 模板仅此一处定义、无 API 路径引用。

**结论**:调度提示词中「Cherry Studio 的 API 请求 UA 形如 `CherryStudio/x.y.z`」是 **v1 时代特征,在 2.0.9(v2 架构,asar 内有 `v2-refactor-temp` 目录佐证)不成立**。伪装预设若按旧特征注入 UA 反而失真;应按 §2.3 的 ai-sdk 链注入,或干脆不注入 UA(上游若只校验 HTTP-Referer/X-Title 则无需 UA)。

### 2.6 其他头

| 头 | 值 | 场景 | 置信度 |
|----|----|------|--------|
| `X-Source` | `cherry-studio` | 仅 `radeon-cloud`(AMD)provider,`getExtraHeaders()` 强制;通用 API 请求**不带** | 直接证据 |
| `ai-gateway-protocol-version` | `0.0.1` | 仅 Vercel AI Gateway 预设 | 直接证据(条件) |
| (用户自定义) | `provider.settings.extraHeaders` | 每个 provider 可配,排在最后可覆盖默认 | 直接证据 |

## 3. 默认系统提示词

**结论:无默认系统提示词。** 伪装只需头部,不需要注入提示词。

证据(`out/main/main.js`,直接证据):

```js
const DEFAULT_ASSISTANT_NAME = "Cherry Assistant";   // zh locale 显示「Cherry 助手」
const DEFAULT_ASSISTANT_EMOJI = "😀";
const DEFAULT_ASSISTANT_PROMPT = "";
```

默认助手(`DEFAULT_ASSISTANT_SEED`)prompt 为**空字符串**;新建对话不注入任何系统消息。asar 全量检索中不存在「每次请求固定注入的 system 前缀」。

仅以下**用户显式触发**的功能携带内置提示词(不构成默认指纹,列出备查):

| 功能 | 提示词 | 位置 |
|------|--------|------|
| 内置翻译 | `TRANSLATE_PROMPT = "You are a translation expert. Your only task is to translate text enclosed with <translate_input> ..."` | main.js |
| Agents(代理)功能创建默认 | `instructions: req.instructions \|\| "You are a helpful assistant."`(仅 AgentService 建代理时的字段默认值,非聊天路径) | main.js |
| 内置 Claude Code 运行时(dsh-bridge) | 出站 UA `claude-cli/2.1.75` + `x-app: cli`( anthropic-messages 运行时),用于内置 agent 会话,非普通 provider 聊天 | `node_modules/@cherrystudio/dsh-bridge/dist/runtime/anthropic-messages.mjs` |

## 4. 伪装要点(给 ZenAPI 预设的直接结论)

1. **必带头仅两个**:`HTTP-Referer: https://cherry-ai.com` + `X-Title: Cherry Studio`。这两个头是 Cherry Studio 唯一稳定、全 provider 覆盖的自我标识,也是中转上游最可能校验的特征。
2. **UA 策略**:真实 UA 是 ai-sdk 链(§2.3)。预设建议注入 `ai-sdk/openai-compatible/2.0.62 ai-sdk/provider-utils/4.0.40 runtime/node.js/24`;若上游不查 UA 可留空。**不要**注入 `CherryStudio/2.0.9` Mozilla 形 UA(那是遥测特征,出现在 API 侧反而暴露伪装)。
3. **提示词**:空,`client_default_system_prompt` 字段留空即可(与 PRD R2「预设含提示词」不冲突,空是合法值)。
4. **Anthropic 渠道变体**:走 anthropic 协议时另带 `anthropic-version: 2023-06-01` + `x-api-key`,UA 换 `ai-sdk/anthropic/3.0.103` 前缀。预设若要精细,可按上游 api_format 出两个变体;MVP 建议单预设(多数中转只看 Referer/X-Title)。

## 5. 意外发现汇总

- **UA 反直觉**(§2.5):`CherryStudio/{version}` UA 存在于二进制但只用于遥测/更新;API 请求 UA 是 ai-sdk 链。这是对任务假设的直接修正。
- **X-Api-Key 与 Authorization 双写**(§2.2):同 key 双头是 Cherry 的真实行为,网关侧需注意头名大小写不敏感合并(`x-api-key`)。
- **v2 架构**:LLM 请求全部收口主进程 AI SDK;renderer 不直接发 LLM 请求;`monitoredFetch`/NodeProxyController 不注入任何头。
- **内置 Claude Code 代理**(dsh-bridge):Cherry 内置了以 `claude-cli/2.1.75` UA 出站的 agent 运行时,用户用该功能时上游看到的是 claude-cli 特征 —— 说明「客户端伪装特征」在 Cherry 内部本身就有多套,预设按「普通聊天」路径建模即可。
- Electron 41.8.0 / Node 24.16.0 / AI SDK provider-utils 4.0.40:UA 链中的版本号随 Cherry 版本升级变化,预设快照属性同 Codex(PRD 已排除自动同步)。
