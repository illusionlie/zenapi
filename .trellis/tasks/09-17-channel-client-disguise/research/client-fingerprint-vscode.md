# VS Code AI 客户端网络指纹研究:Cline 与 Kilo Code

> 任务:为 ZenAPI「渠道客户端伪装」功能提取本机 VS Code 扩展中 Cline 与 Kilo Code 的网络指纹(请求头 + 系统提示词)。
> 研究日期:2026-09-17 · 研究者:trellis-research · Kilo Code 为本机二进制静态提取(逐字节偏移),Cline 为 GitHub 官方仓库源码提取(v4.1.19,非本机证据,见 §2),全部结论标注直接证据/推断。

## 结论速览

| 客户端 | 安装状态 | LLM 流量路径 | 核心可伪装头 | 提示词产出 |
|---|---|---|---|---|
| **Kilo Code** | ✅ 7.3.16(唯一 VS Code 实例) | 全部经 `bin/kilo.exe`(Bun 内核) | `User-Agent: Kilo-Code/7.3.16`、`HTTP-Referer`、`X-Title`、`X-KILOCODE-*` 系、`x-kilo-*` 系 | `prompts/kilo-system-prompt.md`(108,535 B) |
| **Cline** | ❌ 本机未安装(取证改走 GitHub 官方仓库) | `@cline/llms` + Vercel AI SDK(v4 架构) | cline 计费 provider:`User-Agent: Cline/4.1.19`、`HTTP-Referer`、`X-Title`、`X-CLIENT-*`/`X-PLATFORM-*`/`X-CORE-VERSION`/`X-Task-ID`;标准 provider 无身份头 | `prompts/cline-system-prompt.md`(16,656 B) |

---

## 1. Kilo Code(kilocode.kilo-code 7.3.16)

### 1.1 安装证据(直接证据)

| 项 | 值 |
|---|---|
| 扩展目录 | `D:/ProgramFiles/VSCode/data/extensions/kilocode.kilo-code-7.3.16-win32-x64/` |
| VS Code | 便携版 `D:/ProgramFiles/VSCode/Code.exe`(data 目录模式,本机唯一实例) |
| name / version | `kilo-code` / `7.3.16`(package.json,`engines.vscode: ^1.105.1`) |
| 关键产物 | `dist/extension.js`(7,659,031 B,扩展宿主)、`dist/agent-manager.js`(19,069,972 B)、`dist/webview.js`(18,690,488 B)、`bin/kilo.exe`(~140 MB,Bun 编译内核) |

**架构定性(直接证据)**:extension.js 的 `getCliPath()` 以 `path.join(extensionPath,"bin", process.platform==="win32"?"kilo.exe":"kilo")` 定位内核并以子进程方式启动 Kilo server;启动 env 注入 `KILO_SERVER_PASSWORD`、`KILO_CLIENT:"vscode"`、`KILO_ENABLE_QUESTION_TOOL:"true"`、`KILOCODE_FEATURE:"vscode-extension"`、`KILOCODE_EDITOR_NAME:"${vscode.env.appName} ${vscode.version}"`(extension.js @299217 上下文)。
extension.js 内 **0 处** provider 端点/SDK 证据(`api.anthropic.com`、`openrouter.ai/api`、`api.openai.com`、`chat/completions`、`streamText`、`X-Stainless`、`anthropic-beta`、`HTTP-Referer` 全部 0 命中)→ **LLM 请求 100% 由 kilo.exe 发出**,头证据以 kilo.exe 为准。
(置信度:直接证据)

### 1.2 HTTP 标识请求头

以下均提取自 `bin/kilo.exe`(逐字节偏移基于该文件;Bun 嵌入 chunk 以 `\x00B:/~BUN/root/chunk-<id>.js\x00// @bun\n` 分隔,跨 chunk 引用已通过 import/export 映射还原)。

#### 1.2.1 会话主链路头拼装(session stream 调用,kilo.exe @120909912,直接证据)

```js
headers: {
  ...(model.providerID.startsWith("kilo")
    ? { "x-kilo-project": projectId,            // f,openai-oauth 项目 id;仅 kilo 提供商
        "x-kilo-session":   sessionID,
        "x-kilo-request":   user.id,
        "x-kilo-client":    env.KILO_CLIENT }      // VS Code 下 === "vscode"(extension 注入 env,直接证据)
    : { "x-session-affinity": sessionID,
        ...(parentSessionID ? { "x-parent-session-id": parentSessionID } : {}),
        "User-Agent": `opencode/${VERSION}`,       // VERSION = "7.3.16"(chunk-yw1cq5y9 的 WG)
        ...(model.providerID !== "anthropic" ? YU : void 0) }),   // YU 见 1.2.2
  ...(isKiloGateway ? { "x-kilocode-mode": agent.name.toLowerCase() } : {}),   // x-kilocode-mode(小写)
  ...(isKiloGateway && projectId  ? { "X-KILOCODE-PROJECTID": projectId } : {}),
  ...(isKiloGateway && machineId  ? { "X-KILOCODE-MACHINEID": machineId } : {}),
  ...(isKiloGateway               ? { "X-KILOCODE-TASKID": sessionID } : {}),
  ...(isKiloGateway && parentID   ? { "X-KILOCODE-PARENT-TASKID": parentID } : {}),
  ...(isKiloGateway && feature    ? { "X-KILOCODE-FEATURE": feature } : {}),   // VS Code 下 env KILOCODE_FEATURE="vscode-extension"
  ...model.headers,   // 提供商级头(1.2.3 表)经模型配置并入,可覆盖上述同名头
  ...k
}
```

- 头名常量表(kilo.exe @125326645,chunk-hj5czjvt):`kf="X-KILOCODE-TASKID"`、`sx="X-KILOCODE-PARENT-TASKID"`、`Cf="X-KILOCODE-PROJECTID"`、`Tf="X-KILOCODE-TESTER"`、`Lf="X-KILOCODE-EDITORNAME"`、`Rf="X-KILOCODE-MACHINEID"`、`K1="X-KILOCODE-FEATURE"`。同区还有 env 名 `KILOCODE_EDITOR_NAME`、`KILOCODE_VERSION`、`KILOCODE_FEATURE`。(直接证据)
- `isKiloGateway` = `model.api.npm === "@kilocode/kilo-gateway"`(@120906585,直接证据)→ `X-KILOCODE-*` 系与 `x-kilocode-mode` 仅在走 Kilo 自家网关模型时发送;普通 openai-compatible/anthropic 渠道不发。
- `x-kilo-client` 取值 = `process.env.KILO_CLIENT ?? "cli"`(@123729552),VS Code 扩展固定注入 `"vscode"`;另有 `"cli"/"jetbrains"/"acp"/"app"/"desktop"` 取值。(直接证据)
- 另发现版本串模板 `oD=\`kilo/${VERSION}/${VERSION}/${KILO_CLIENT}\``(@122857801,`kilo/7.3.16/.../vscode` 形态),与自动更新检查相关,是否入请求头未确认。(推断)

#### 1.2.2 `YU` —— 非 anthropic 提供商的默认头表(直接证据)

`YU`(chunk-xzwnnxrg 的 `JG`,kilo.exe @122247974):

```js
{ "HTTP-Referer": "https://kilocode.ai",
  "X-Title":      "Kilo Code",
  "User-Agent":   `Kilo-Code/${VERSION}` }        // → "Kilo-Code/7.3.16"
```

由于它在对象字面量中**后置展开**,`User-Agent` 覆盖前者的 `opencode/7.3.16` → **非 anthropic 提供商最终 UA 为 `Kilo-Code/7.3.16`**。`HTTP-Referer: https://kilocode.ai` 与 `X-Title: Kilo Code` 同样进入所有非 anthropic 请求(除非被 provider 级头覆盖)。

#### 1.2.3 提供商级头表(provider 定义,直接证据,kilo.exe @122257774–122264711)

| 提供商 ID | headers |
|---|---|
| `kilo`(自家网关) | `HTTP-Referer: https://kilo.ai/`、`X-Title: Kilo Code` |
| `openrouter` | `HTTP-Referer: https://kilo.ai/`、`X-Title: Kilo Code` |
| `llmgateway` | `HTTP-Referer: https://kilo.ai/`、`X-Title: Kilo Code`、`X-Source: kilo` |
| `nvidia` | `HTTP-Referer: https://kilo.ai/`、`X-Title: Kilo Code`、`X-BILLING-INVOKE-ORIGIN: KiloCode` |
| `vercel` | `http-referer: https://kilo.ai/`(小写)、`x-title: Kilo Code`(小写) |
| `zenmux` | `HTTP-Referer: https://kilo.ai/`、`X-Title: Kilo Code` |
| `cerebras` | `X-Cerebras-3rd-Party-Integration: Kilo Code` |

注意新旧 referer 双值:`YU` 默认表用 `https://kilocode.ai`,provider 级覆盖用 `https://kilo.ai/`(新品牌域名)。经 `openrouter` 等 provider 的请求最终 Referer 为 `https://kilo.ai/`;其余 openai-compatible 渠道(无 provider 定义时)保持 `https://kilocode.ai`。

#### 1.2.4 OpenRouter SDK 类路径(@125638049 / @125645561,直接证据)

```
Authorization: Bearer {OPENROUTER_API_KEY}
X-OpenRouter-Title: {appName}          // appName 存在时
HTTP-Referer: {appUrl}                 // appUrl 存在时
X-Provider-API-Keys: {JSON.stringify(api_keys)}   // 多 key 聚合时
```
且 SDK 内 `combineUserAgent`(@125641959)逻辑为:**请求头中已存在 `user-agent` 则原样保留**,否则才拼默认 → 会话级 UA(`Kilo-Code/7.3.16`)不会被 SDK 默认(`ai-sdk/openrouter/2.8.1`)覆盖。

#### 1.2.5 OpenAI-compatible 链路 vs Anthropic 链路差异(综合判定)

| 头 | OpenAI-compatible(chat/completions 类) | Anthropic(messages) |
|---|---|---|
| `User-Agent` | **`Kilo-Code/7.3.16`**(YU 覆盖) | **`opencode/7.3.16`**(YU 不展开;@ai-sdk/anthropic 内部默认 UA `ai-sdk/anthropic/3.0.71` 因"已有 UA 保留"逻辑不生效,*aG="3.0.71" 见 @125729002 附近*) |
| `HTTP-Referer` / `X-Title` | `https://kilocode.ai` + `Kilo Code`(或 provider 表覆盖 `https://kilo.ai/`) | **不发送**(providerID==="anthropic" 时 YU 被排除) |
| `x-session-affinity` / `x-parent-session-id` | 发送(sessionID,UUID 形态,值含随机性) | 同样发送 |
| `x-api-key` / `anthropic-version` | 不发送 | `anthropic-version: 2023-06-01`;beta 特性启用时动态 `anthropic-beta: <逗号列表>`(@115839168;文件接口固定含 `files-api-2025-04-14`) |
| `X-Stainless-*`(@anthropic-ai/sdk 原生客户端,Lang/OS/Arch/Runtime/Runtime-Version/Package-Version/Helper-Method) | 不发送 | kilo.exe 内含官方 SDK,特定调用(文件/计数等)会带;主聊天链路走 AI SDK 不带(推断) |
| `x-kilo-*` / `X-KILOCODE-*` | 见 1.2.1 条件 | 同左,与模型链路正交 |

#### 1.2.6 未伪装请求的兜底 UA

若某请求路径未显式设 UA,Bun fetch 默认 UA 为 `Bun/<runtime版本>`(kilo.exe 内嵌 Bun 运行时行为)。未观察到主链路触发该情况。(推断)

### 1.3 系统提示词

- **产出文件**:`research/prompts/kilo-system-prompt.md`(108,535 B;含组装逻辑伪代码、10 个 provider 变体全文、soul 全文、6 个内置模式 roleDefinition 全文、动态块模板),逐模板另存于 `research/prompts/kilo-templates/*.txt`。
- **组装结构**(直接证据,kilo.exe session chunk @120905276):
  `system = soul("You are Kilo, a highly skilled software engineer...") + (agent.prompt || 模型变体模板) + 会话动态追加 + 用户自定义`,以空格连接;F 数组各元素作为**独立的多条 system 消息**发送。
- **默认模式(Code,等价 act)**:agent.prompt = mode roleDefinition(默认 Code 模式为 *"You are Kilo Code, a highly skilled software engineer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices."*,158 B,dist/extension.js),**存在时整体替换模型变体模板**;soul 层(3,082 B)恒在首位。
- **模型变体**(agent.prompt 缺省时):claude→`gh`("You are Kilo, the best coding agent on the planet...",8,178 B),其余默认→`dh`(8,637 B),gpt→`sy`/`vh`,gemini→`ch`,kimi→`ay`,ling→`mh`,codex→`eE`,gpt55→`ny`,trinity→`th`(内容仍为 "You are opencode,..." 上游残留)。
- **伪装要点**:身份句同时存在 "You are Kilo, ..." 与 "You are Kilo Code, ..." 两种形态;`<env>` 块含硬编码 `Platform: win32` 字面量;`<environment_details>` 含本地时间与工作目录(动态,伪装注入时应视为可变段)。

---

## 2. Cline(claude-dev v4.1.19)

> **取证来源差异声明**:本机未安装 Cline(搜索证据见 §2.4),本节全部证据来自 **GitHub 官方仓库 `cline/cline` release tag `v4.1.19`**(commit `27fe60d79f24a6f1c15d4f85cf07d76f6baf7cd0`,tag 日期 2026-09-17),shallow clone 至系统临时目录从未压缩源码提取。属**非本机证据**,与 Kilo Code 的本机二进制提取并列时请注意口径差异;版本迭代后指纹可能漂移。

### 2.1 架构与安装形态(直接证据)

| 项 | 值 |
|---|---|
| 仓库形态 | monorepo:`apps/vscode`(扩展,name `claude-dev`,version `4.1.19`,publisher `Cline Bot Inc.`)+ `sdk/packages/{llms,core,shared,agents,llms,...}` |
| LLM 请求路径 | `@cline/llms`(`sdk/packages/llms`)统一构造 provider,基于 **Vercel AI SDK**(`@ai-sdk/anthropic@4.0.42`、`@ai-sdk/openai-compatible@3.0.37`、`@openrouter/ai-sdk-provider` 等),VS Code 扩展经 `@cline/core` local runtime 启动会话 |
| 头构造中心 | `sdk/packages/llms/src/providers/request-headers.ts`(`resolveProviderRequestHeaders`) |

### 2.2 HTTP 标识请求头(直接证据,除特别标注)

#### A. Cline 计费 provider(`cline` / `cline-pass`,即走 Cline 官方 API 的请求)

`DEFAULT_CLINE_REQUEST_HEADERS` + 专属字段(request-headers.ts:36-79;VS Code 取值见 `cline-session-factory.ts:1046`、`getHostVersion.ts`、`ClineClient` 枚举):

| 头 | 值模板(VS Code 宿主) | 说明 |
|---|---|---|
| `HTTP-Referer` | `https://cline.bot` | 默认常量 |
| `X-Title` | `Cline` | 默认常量 |
| `User-Agent` | `Cline/{client.version}` → **`Cline/4.1.19`** | client.version = 扩展版本 |
| `X-CLIENT-TYPE` | `VSCode Extension` | `ClineClient.VSCode` 枚举值;CLI 为 `cline-cli` |
| `X-CLIENT-VERSION` | `4.1.19` | |
| `X-PLATFORM` | `Visual Studio Code` | `vscode.env.appName`(Insiders 等会不同) |
| `X-PLATFORM-VERSION` | `{vscode.version}` | VS Code 本体版本 |
| `X-CORE-VERSION` | `{@cline/core 版本}` | core 包版本 |
| `X-Task-ID` | `{sessionId}` | **随机会话 ID**,每会话变化 |
| `X-IS-MULTIROOT` | `true`/`false` | 多根工作区标志 |

#### B. `openai-codex` provider(ChatGPT OAuth 链路)

`originator: cline`、`session_id: {sessionId}`、`User-Agent: Cline/{npm 包版本 ?? "1.0.0"}`、`ChatGPT-Account-Id: {JWT 解析的 account id}`(request-headers.ts:107-135)。

#### C. `opencode-go` provider

`x-opencode-session: {sessionId}`、`User-Agent: Cline/{client.version ?? coreVersion}`(request-headers.ts:139-146;builtins.ts:778 另有 defaults `User-Agent: "Cline/SDK"`)。

#### D. 标准 provider(anthropic / openai / openrouter / openai-compatible 等)——**无 Cline 身份头**

v4.1.19 对这些 provider **不注入任何 Cline 标识头**(`resolveProviderRequestHeaders` 仅透传用户配置的 stored/config/session 三层 headers);特别是 openrouter 聊天链路走 `@ai-sdk/openai-compatible`,**不再发送 3.x 时代的 `HTTP-Referer: https://cline.bot` / `X-Title: Cline`**。线上头由 AI SDK 决定:

| 头 | Anthropic 链路 | OpenAI-compatible 链路 |
|---|---|---|
| 认证 | `x-api-key: {apiKey}`(OAuth 时 `Authorization: Bearer`) | `Authorization: Bearer {apiKey}` |
| 协议版本 | `anthropic-version: 2023-06-01`(直接证据,`@ai-sdk/anthropic@4.0.42` getHeaders) | 无 |
| `anthropic-beta` | 配置 betas / server-side 工具(web_search 等)时出现 | 无 |
| `User-Agent` | `ai-sdk/anthropic/4.0.42 ai-sdk/provider-utils/5.0.30 runtime/{宿主 UA 小写}`(链式后缀,直接证据:`withUserAgentSuffix` + `postToApi` 源码) | `ai-sdk/provider-utils/5.0.30 runtime/{宿主 UA 小写}` |
| `runtime/{...}` | VS Code 扩展宿主(Node≥21.1)取 `navigator.userAgent.toLowerCase()`(Electron/Chrome UA 串);Node<21.1 为 `runtime/node.js/v{ver}` | 同左 |

(UA 后缀机制置信度:直接证据 —— `@ai-sdk/provider-utils@5.0.30` `post-to-api.ts` 对每个请求执行 `withUserAgentSuffix(headers, "ai-sdk/provider-utils/5.0.30", getRuntimeEnvironmentUserAgent())`;`withUserAgentSuffix` 保留已有 UA 再追加。)

用户亦可在 provider 设置自定义三层 headers(stored/config/session),required 头最后展开、优先级最高(request-headers.ts:158-168)。

#### E. OpenAI-compatible vs Anthropic 差异小结

- 走 **cline 计费 provider** 时:两条协议链路都带同一套完整身份头(A 组),与协议无关。
- 走**用户自配 provider** 时:两个链路都**无 Cline 身份头**,仅 AI SDK 默认 UA 形态不同(anthropic 多 `ai-sdk/anthropic/{ver}` 前缀段与 `anthropic-version`);伪装时"模拟 Cline 头"对自配 provider 链路等价于**不发** Referer/X-Title。

### 2.3 系统提示词

- **产出文件**:`research/prompts/cline-system-prompt.md`(16,656 B;组装逻辑 + 全部模板全文),模板单文件在 `research/prompts/cline-templates/`。
- **默认 act 模式基础模板** = `CLINE_SYSTEM_PROMPT_ACT_MODE`(`sdk/packages/shared/src/prompt/system/act.ts`,3,695 B):紧凑单段提示词,身份行为 *"You are Cline, an AI coding agent."*,内嵌 `<env>` 块(`Platform/Date/IDE/Working Directory` 四占位符)与并行工具调用规则;**无 3.x 时代的巨型工具说明段**(v4 用 native tool calling,工具以 schema 传输)。
- **拼装**(直接证据,`buildClineSystemPrompt`):act 模板 + 占位符替换(`win32`/本地日期/`VS Code`/工作区根路径)+ 规则槽(用户规则 + `MODE_TAG_INSTRUCTIONS`)+ 工作区元数据 JSON(仅 cline/cline-pass)。plan 模式无独立模板,复用 act + Plan 契约段;yolo 模式有独立模板(3,613 B)。
- **伪装要点**:占位符四项为动态值;`MODE_TAG_INSTRUCTIONS` 为静态必带段;工具清单由网关侧 tool schema 决定,与提示词解耦。

### 2.4 本机未安装的搜索证据(与首轮研究一致)

`C:/Users/NINGMEI/.vscode*` 不存在;唯一 VS Code(便携版 `D:/ProgramFiles/VSCode`)的 `extensions.json`/`.obsolete`/目录列表无 `saoudrizwan.claude-dev`;家目录(深度 6)、Roaming(深度 3)、`D:/`(深度 7)搜索 `*cline*`/`*claude-dev*` 均无扩展目录命中。

---

## 3. 方法与可复现性

- 二进制定位:`grep -a -o -E` 逐头名/字符串扫描 → Python 逐字节上下文提取;Bun chunk 边界以 `\x00B:/~BUN/root/<name>.js\x00// @bun\n` 分隔符切割;跨 chunk 变量(`YU/XU/TU/BU/yU/UU/GU/c0/cH`)经 `import{a as b}from"chunk-*.js"` 与 `export{local as exported}` 双向映射还原到定义。
- 模板提取:手写扫描器处理模板字面量(反引号转义、`${}` 花括号配平),11 个 Kilo 模板均 0 插值,与二进制逐字节一致。
- 置信度标注规则:**直接证据** = 二进制/源码内可定位的字面量或代码;**推断** = 依据运行时语义/SDK 通用行为推导,未逐路径验证。
- Cline 取证流程:`git ls-remote --tags` 锚定最新 release(v4.1.19)→ `git clone --depth 1 --branch v4.1.19` 至 `mktemp -d` 系统临时目录(未入项目仓库)→ 源码 grep/精读;AI SDK 上游行为以对应版本源码(`@ai-sdk/anthropic@4.0.42`、`@ai-sdk/provider-utils@5.0.30`)与 jsdelivr npm 产物核对。
- 关键字节偏移(基于 `bin/kilo.exe`,140,220,999 B):JG/YU 头表 @122247974;provider 头表 @122257774–122264711;OpenRouter 类 @125638049;会话头拼装 @120909912;`S=isKiloGateway` 判定 @120906585;system 组装 @120905276;soul `ey` @120896293;变体模板 @120800474–120888531;`WG="7.3.16"` 在 chunk-yw1cq5y9.js;头名常量 @125326645(chunk-hj5czjvt)。
