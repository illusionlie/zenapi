# 客户端网络指纹:ZCode(智谱 z.ai 桌面端 + CLI agent)

> 调查时间:2026-09-17 · 方法:对本机安装产物静态 grep(zcode.cjs 为 11.4MB 压缩 bundle,符号名经 `-mangle-props` 前已保留函数命名注记,可还原)
> 结论均标注置信度;未抓包验证实际上线请求。

## 1. 安装证据【直接证据】

| 项 | 值 | 证据 |
|----|-----|------|
| 桌面应用 | `D:/ProgramFiles/ZCode/ZCode.exe`(Electron) | 实测目录;`Uninstall ZCode.exe` |
| 桌面应用版本 | **3.12.3**(win-x64) | `C:/Users/NINGMEI/AppData/Local/@zcodedesktop-updater/pending/update-info.json` → `ZCode-3.12.3-win-x64.exe`;`~/.zcode/v2/runtime/provider/windows-x86_64/3.12.3/` 目录名双证 |
| CLI agent 内核 | `D:/ProgramFiles/ZCode/resources/glm/zcode.cjs`(单文件 bundle,11,416,833 B) | 实测;自识 `zcode` / `zcode-cli` |
| agent 运行时版本 | **0.13.3**(`glm` 运行时;二进制名 `zcode-agent.exe`,spawn 参数 `app-server --stdio`;node 入口 `zcode.cjs`) | bundle 内 `getZCodeAgentRuntime()` 返回对象 `mer`,`version:"0.13.3"` |
| 数据目录 | `~/.zcode/`(`cli/` 运行数据、`v2/` provider/runtime 配置) | 实测 |
| 供应方 | 智谱(z.ai);feedback URL 指向 zhipu-ai.feishu.cn;默认 LLM 端点 bigmodel Anthropic 兼容协议(`~/.zcode/v2/config.json` 中 `builtin:bigmodel`,`"kind": "anthropic"`) | 直接证据 |

版本层级(重要):`User-Agent: ZCode/{version}` 的 `{version}` 取 `ZCODE_APP_VERSION` 环境变量,否则传入的 `appVersion`(agent 运行时 0.13.3),缺失时 `unknown`。桌面进程侧(3.12.3)与 agent 侧(0.13.3)是两套头构建器(见 §2.1/§2.2)。

## 2. HTTP 标识请求头

### 2.1 CLI agent 头构建器 `buildCliZCodeSourceHeaders`(g6n)【直接证据】

```js
{
  "HTTP-Referer": $p(e),                      // 端点 origin,见 2.4
  "User-Agent": `ZCode/${n ?? "unknown"}`,    // n = env.ZCODE_APP_VERSION ?? appVersion
  ...n ? { "X-ZCode-App-Version": n } : {},
  "X-Title": `Z Code@${r}`,                   // r = detectDefaultProviderSourceTitle()
  "X-Release-Channel": e_(e),                 // "production" | "test"(ZCODE_ENV)
  "X-Client-Language": locale,                // Intl.DateTimeFormat().resolvedOptions().locale,如 "zh-CN"
  "X-Client-Timezone": tz,                    // 同上 .timeZone,如 "Asia/Shanghai"
  "X-ZCode-Agent": "glm",                     // 固定
  ...createRuntimePlatformHeaders()           // 见下
}
```

`createRuntimePlatformHeaders`(f6n):
- `X-Platform`: `{process.platform}-{os.arch()}`(如 `win32-x64`),二者均可打印字符才发
- `X-Os-Category`: `windows|macos|linux`(darwin→macos,win32→windows,其余 linux)
- `X-Os-Version`: `os.release()`(如 `10.0.26100`)

`X-Title` 的 sourceTitle 判定(`detectDefaultProviderSourceTitle`,PSs):`process.argv` 含 `app-server` 或 `agent-server` → `electron`,否则 `cli`。即 CLI 形态为 **`Z Code@cli`**,嵌在桌面端内跑 app-server 时为 **`Z Code@electron`**。

### 2.2 桌面进程头构建器 `buildZCodeSourceHeadersFromContext`(vYe)【直接证据】

同族头,差异:无 `X-ZCode-Agent`;`HTTP-Referer` 默认 `https://zcode.z.ai`(JN);`X-Title` 默认 `Z Code@electron`(sourceTitle 可覆盖);静态兜底常量 `cer = {"User-Agent":"ZCode/unknown","HTTP-Referer":"https://zcode.z.ai","X-Title":"Z Code@electron"}`。所有值经 `normalizeZCodeSourceHeaderValue`(trim + `/^[\x20-\x7e]+$/` 可打印校验),非法→缺省。

### 2.3 LLM 请求协议头(Vercel AI SDK 内嵌)【直接证据】

zcode.cjs 内嵌 Vercel AI SDK(`ai-sdk/*` 版本注记):anthropic 3.0.81、openai 3.0.65、openai-compatible 2.0.60、gateway 3.0.121、provider-utils 4.0.27/4.0.39、通用 `ai-sdk/6.0.193`。

Anthropic 协议(builtin:bigmodel 默认走此协议):
- `anthropic-version: 2023-06-01`
- 鉴权:`Authorization: Bearer {authToken}` **或** `x-api-key: {apiKey}`(二选一)
- `User-Agent` 链式拼接(mergeHeaders jg):`ZCode/{v} ai-sdk/anthropic/3.0.81`(在 2.1 头集之上追加后缀)
- `anthropic-beta`:由 AI SDK anthropic provider 的 beta 机制传入(`getBetasFromHeaders`);bundle 内**未发现静态默认 beta 串**【未找到,标注】
- x-stainless 系:AI SDK 非 Stainless 官方 SDK,**无** x-stainless 头(与 pi 相反,推断,置信度高)

OpenAI-compatible 协议:`User-Agent: ZCode/{v} ai-sdk/openai-compatible/2.0.60`,`Authorization: Bearer`。

### 2.4 `HTTP-Referer` 的取值链【直接证据】

`$p()`(endpoint origin):`ZCODE_BASE_URL` / `ZCODE_ENDPOINT_ORIGIN` → 按环境取 `ZCODE_PRODUCTION_BASE_URL` / `ZCODE_TEST_BASE_URL` → 兜底:
- production(默认):`https://zcode.z.ai`
- test:`https://zcode.chatglm.site`

### 2.5 动态 / 随机 id 头【直接证据】

| 头/机制 | 值 | 说明 |
|---------|-----|------|
| `X-Device-Mid` | 持久化随机设备 id | `ensureCliDeviceMid`:状态文件 `~/.zcode/v2/telemetry-state*`,首跑生成、后续复用;**伪装时不可复制他人值,应每租户固定一个随机值**。仅桌面构建器 vYe 输出(含 deviceMid 上下文时);CLI 构建器 g6n 未见此头 |
| 请求签名家族 | `x-client-sig`、`x-client-pow`、`x-off-peak-ticket-id`、`x-aliyun-captcha-verify-param` | 出现在 sanitize 脱敏清单与 `buildSigningRequestInit`/`createCodingPlanSignatureConfig`(coding-plan 本地签名服务 socket/token),用于 z.ai 计费面接口;LLM 推理请求是否携带未确证【部分未找到】 |

### 2.6 未找到的项
- 静态 `anthropic-beta` 默认值:未找到(可能由服务端下发或按需启用)。
- `OpenAI-Beta`:bundle 内无(仅 pi 的 codex 链路有)。

## 3. 系统提示词(分层组装)

ZCode 的系统提示词是**命名 section 流水线**,每个 section 带 `{name, source, injectionTarget, cacheHint}` 元数据。全部 section【直接证据,函数名注记还原】:

| # | Section name | source | injectionTarget | cacheHint | 动/静 |
|---|--------------|--------|-----------------|-----------|-------|
| 1 | CLI Prefix | cli_prefix | system | stable | **静态**: `You are ZCode, an interactive coding agent` |
| 2 | Agent Identity | identity | system | stable | **静态**(双变体:默认 / Output Style 激活时),含安全声明与 `# Harness` |
| 3 | Environment Info | env_info | system | dynamic | 动态:`# Environment` + cwd / is git repo / Platform / Shell / OS Version / powered-by model |
| 4 | System Context | system_context | system | dynamic | 动态:gitStatus 快照 + branch/main branch/user/status/recent commits |
| 5 | Skills | skills | **meta_user** | dynamic | 动态:可用 skills 清单 |
| 6 | Request User Context | request_user_context | **meta_user** | dynamic | 动态:`# agentsMd` + 工作区指令文件全文 + MEMORY.md 索引 |
| 7 | Current Date | current_date | **meta_user** | dynamic | 动态:`# currentDate\nToday's date is {date}.` |
| 8 | Memory | memory | system | dynamic | **静态模板 + 动态路径**(`{memoryRoot}`):记忆文件格式说明 |
| 9 | ZCode Desktop Context | desktop_context | system | stable | **静态**(仅桌面端):Markdown 链接 / `::code-comment{...}` 指令规范 |
| 10 | Dynamic Behavior | dynamic_behavior | system | dynamic | **静态文本**(代码风格 / 与用户沟通 / 自主运行段) |
| 11 | Output Style | output_style | system | dynamic | 动态(用户选择 Output Style 时) |
| 12 | Context Management | context_management | system | dynamic | **静态文本**(上下文压缩说明 + 行为约束) |
| 13 | Session-specific guidance | session_guidance | system | dynamic | 动态(条件,如 `/<skill-name>` 用法) |
| 14 | Custom System Prompt | custom_system_prompt | system | stable | 用户自定义 |

关键细节:
- Agent Identity 段(静态)全文:见 [`prompts/zcode-system-prompt.md`](./prompts/zcode-system-prompt.md)。开头双变体:默认 `You are an interactive ZCode agent that helps users with software engineering tasks.`;Output Style 激活时改为 `You respond to the user according to the active Output Style below while using ZCode's tools and instructions.`
- `# agentsMd` 段措辞(与 Claude Code 同源):`Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.`
- 子代理提示词(GeneralPurpose / Explore / Compact)已提取至 [`prompts/zcode-subagent-prompts.md`](./prompts/zcode-subagent-prompts.md)。Explore 为只读模式强约束;Compact 为压缩指令。
- 彩蛋:memory 选择子代理提示词直接写 `You are selecting memories that will be useful to Claude Code...`(从 Claude Code 移植时未改名)【直接证据】。

## 4. 对伪装功能的关键结论

1. ZCode 的指纹头是**自报家门式**的一整套(`X-ZCode-Agent: glm`、`X-Title: Z Code@cli`、`X-ZCode-App-Version`),复刻成本低且值可静态化,但 `X-Client-Language/Timezone` 是运行环境真值,不同用户间不一致——伪装时应按目标用户族群生成而非全局常量。
2. UA 为复合串 `ZCode/{agent版本} ai-sdk/anthropic/3.0.81`,两个版本号都要对上;`ZCODE_APP_VERSION` 环境变量可覆盖首段,天然支持伪装注入。
3. `X-Device-Mid` 是持久随机 id(仅桌面形态),网关侧若要伪装需为每个用户生成并保持稳定。
4. 提示词伪装方面:静态可复制的只有 CLI Prefix + Agent Identity + Dynamic Behavior + Context Management 等 stable/dynamic-但内容固定段;Environment/System Context/agentsMd/Current Date 全部是运行时真值,网关注入时需自行构造。
