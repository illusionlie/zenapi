# 客户端网络指纹:pi (@earendil-works/pi-coding-agent)

> 调查时间:2026-09-17 · 方法:对本机 dist 编译产物静态 grep,未抓包(标注为推断的项均为源码级推断,置信度较高)
> 证据根目录:`C:/Users/NINGMEI/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/`(下文缩写 `$PI`)

## 1. 安装证据【直接证据】

| 项 | 值 | 证据 |
|----|-----|------|
| 安装路径 | `C:/Users/NINGMEI/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/` | `npm prefix -g` 全局 node_modules 实测 |
| 版本 | **0.85.1** | `$PI/package.json` `"version": "0.85.1"` |
| bin | `pi` → `dist/bundle/cli.js` | package.json `bin` 字段 |
| HTTP 层 | 内嵌依赖包 `@earendil-works/pi-ai` **0.85.1**(shrinkwrap 随包分发,位于 `$PI/node_modules/@earendil-works/pi-ai`) | 实测目录 |
| 打包的官方 SDK | `openai` **6.40.0**、`@anthropic-ai/sdk` **0.123.0**、`@google/genai` 1.52.0、`@aws-sdk/client-bedrock-runtime` 3.1048.0 | pi-ai package.json dependencies |

关键源文件:
- `$PI/node_modules/@earendil-works/pi-ai/dist/utils/pi-user-agent.js` —— LLM 请求 UA
- `$PI/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js` / `openai-responses.js` / `openai-codex-responses.js`
- `$PI/node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js`
- `$PI/dist/core/provider-attribution.js` —— 按上游 host 附加归因头
- `$PI/dist/utils/pi-user-agent.js` —— pi 自身 HTTP(非 LLM)UA,注意与 pi-ai 的同名函数**不同**

## 2. HTTP 标识请求头

### 2.1 两个不同的 getPiUserAgent【直接证据,易混淆点】

| 函数 | 输出模板 | 用途 |
|------|----------|------|
| pi-ai 版(`pi-ai/dist/utils/pi-user-agent.js`)| `pi ({os.platform()} {os.release()}; {os.arch()})`,浏览器回退 `pi (browser)` | **LLM API 请求**(OpenAI 系、Codex)|
| pi 本体版(`$PI/dist/utils/pi-user-agent.js`)| `pi/{version} ({process.platform}; node/{ver} 或 bun/{ver}; {arch})` | pi 自身 HTTP:版本检查、资源目录、安装遥测(`pi.dev/api/report-install`)、包管理 CLI |

例(本机 win32 运行):LLM 请求 UA ≈ `pi (win32 10.0.26100; x64)`;自身请求 UA ≈ `pi/0.85.1 (win32; node/v22.x; x64)`。
伪装场景应复刻**pi-ai 版**(进 LLM 网关的那个):`pi (win32 10.0.26100; x64)` —— 注意它**不含版本号**、平台后是 OS release(如 `10.0.26100`)而非固定字串。

### 2.2 OpenAI 协议链路(`/v1/chat/completions`、`/v1/responses` 上游)【直接证据】

`openai-completions.js:548` / `openai-responses.js:177`:

```js
const headers = { "User-Agent": getPiUserAgent(), ...model.headers };
// (+ copilot 动态头 / 会话亲和头,见下)
return new OpenAI({ apiKey, baseURL: model.baseUrl, defaultHeaders: headers, ... });
```

| 头 | 值模板 | 备注 |
|----|--------|------|
| `User-Agent` | `pi ({platform} {release}; {arch})` | pi 覆盖 SDK 默认 UA(defaultHeaders 传入)|
| `x-session-id` / `session_id` + `x-client-request-id` + `x-session-affinity` | sessionId(UUID) | 仅当 `compat.sendSessionAffinityHeaders` 开启(openrouter/openai 两种格式)|
| SDK 运行时生成 | `X-Stainless-Lang: js`、`X-Stainless-Package-Version: 6.40.0`、`X-Stainless-OS`、`X-Stainless-Arch`、`X-Stainless-Runtime: node`、`X-Stainless-Runtime-Version`、重试时 `X-Stainless-Retry-Count` 等 | openai SDK 内部 `getPlatformProperties()`(detect-platform.js),运行时生成 |
| SDK 默认 UA(被覆盖) | `OpenAI/JS 6.40.0`(取 `constructor.name`) | pi 传入的 defaultHeaders 优先,正常情况下见不到 |

OpenAI-Beta 类头:**未发现** pi 在 OpenAI 主链路注入 beta 头(仅 Codex 链路有,见 2.4)。

### 2.3 Anthropic 协议链路【直接证据】

`anthropic-messages.js` `createClient()` 分两条路径:

**a) API Key 路径(常规)**:
```js
defaultHeaders = { accept: "application/json",
                   "anthropic-dangerous-direct-browser-access": "true",
                   ...(sessionAffinity ? {"x-session-affinity": sessionId} : {}) }
new Anthropic({ apiKey, baseURL: model.baseUrl, ... })
```
- `User-Agent`:**pi 不覆盖** → @anthropic-ai/sdk 默认 `Anthropic/JS 0.123.0`(client.js `getUserAgent()`)
- `X-Stainless-*` 系列:SDK 运行时生成(同 openai SDK 模式,Package-Version 0.123.0)
- `anthropic-version: 2023-06-01`:SDK 默认
- `x-api-key: {key}`:SDK 鉴权

**b) OAuth 路径(apiKey 含 `sk-ant-oat`)—— ⭐ pi 伪装成 Claude Code**:
```js
defaultHeaders = { accept: "application/json",
                   "anthropic-dangerous-direct-browser-access": "true",
                   "user-agent": `claude-cli/2.1.251`,   // claudeCodeVersion = "2.1.251"(硬编码,anthropic-messages.js:41)
                   "x-app": "cli" }
```
且 beta 特性串追加 `claude-code-20250219, oauth-2025-04-20`。工具名走 `toClaudeCodeName` 归一化。

**anthropic-beta 头的值域**(`buildParams` features,按需拼接去重)【直接证据】:

| feature 常量 | 触发条件 |
|--------------|----------|
| `claude-code-20250219` | OAuth token(伪装分支)|
| `oauth-2025-04-20` | OAuth token |
| `fine-grained-tool-streaming-2025-05-14` | `shouldUseFineGrainedToolStreamingBeta(model, context)` |
| `interleaved-thinking-2025-05-14` | reasoning + thinkingEnabled + 非 forceAdaptiveThinking |
| `server-side-fallback-2026-07-01` | `shouldUseServerSideFallbackBeta(model)` |
| `mid-conversation-output-config-2026-07-01`、`thinking-binding-controls-2026-08-01` | `compat.supportsMidConvoEffort === true` |

### 2.4 OpenAI Codex 链路(ChatGPT 后端,`chatgpt.com/backend-api`)【直接证据】

`openai-codex-responses.js` `buildBaseCodexHeaders`:

| 头 | 值模板 |
|----|--------|
| `Authorization` | `Bearer {oauth_access_token}` |
| `chatgpt-account-id` | JWT 中的 `chatgpt_account_id` |
| `originator` | **`pi`**(固定)|
| `User-Agent` | `pi ({platform} {release}; {arch})` |
| `OpenAI-Beta` | SSE:`responses=experimental`;WebSocket:`responses_websockets=2026-02-06` |
| `session-id` / `x-client-request-id` | sessionId(uuidv7)或 WS requestId |

### 2.5 上游归因头(provider-attribution.js,按 host 条件附加)【直接证据】

条件:安装遥测开启(`isInstallTelemetryEnabled`);OpenCode 会话头除外。

| 上游 | 附加头 |
|------|--------|
| openrouter.ai | `HTTP-Referer: https://pi.dev`、`X-OpenRouter-Title: pi`、`X-OpenRouter-Categories: cli-agent` |
| integrate.api.nvidia.com | `X-BILLING-INVOKE-ORIGIN: Pi` |
| api.cloudflare.com / gateway.ai.cloudflare.com | `User-Agent: pi-coding-agent` |
| opencode.ai(provider opencode*) | `x-opencode-session: {sessionId}`、`x-opencode-client: pi` |

### 2.6 未找到的项
- pi 在 LLM 请求上无 `x-app`(仅 Claude Code 伪装分支有)、无 `X-Title`/`HTTP-Referer`(仅 OpenRouter 归因分支)。
- 无随机 id 头;session 亲和头为确定性 UUID,受 compat 开关控制。

## 3. 系统提示词

- 构建:`$PI/dist/core/system-prompt.js` `buildSystemPrompt()`。分层与动静态判定见 [`prompts/pi-system-prompt.md`](./prompts/pi-system-prompt.md)。
- 身份行(静态):`You are an expert coding assistant operating inside pi, a coding agent harness. ...`
- 动态注入:工具清单(随启用工具变化)、guidelines(随工具集变化)、pi 文档绝对路径(随安装位置变化)、`appendSystemPrompt`、项目上下文文件(AGENTS.md 等全文)、skills 清单、末行 `Current working directory: {cwd}`。
- 另有压缩用 `SUMMARIZATION_SYSTEM_PROMPT`(310 字符,静态)在 pi-agent-core `harness/compaction/compaction.js`,全文见 [`prompts/pi-compaction-prompt.md`](./prompts/pi-compaction-prompt.md)。

## 4. 对伪装功能的关键结论

1. **OpenAI 链路最易复刻**:UA 一个头即可覆盖 pi 默认形态(`pi (win32 10.0.26100; x64)`),但若上游校验 `x-stainless-*` 系列则需伪造 SDK 运行时头(平台相关,可静态生成)。
2. **Anthropic 链路有两种形态**:API-key 形态(UA=`Anthropic/JS 0.123.0` + x-stainless)与 OAuth 形态(`claude-cli/2.1.251` + `x-app: cli` + beta 串)。伪装时需先确定模仿哪条。
3. pi 自身 UA **不带版本号**(pi-ai 版),`os.release()` 是 Windows 实际 build 号(如 10.0.26100),伪装值需按目标机器族群取值。
4. `anthropic-beta` 值域固定且含未来日期串(2026-07-01/2026-08-01),照抄即可。
