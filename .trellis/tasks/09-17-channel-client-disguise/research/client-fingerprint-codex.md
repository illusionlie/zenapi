# 客户端网络指纹研究:OpenAI Codex CLI

> 任务:09-17-channel-client-disguise / 研究代理产出 / 日期 2026-09-17
>
> **证据等级声明**:Codex CLI **在本机(Windows)未安装**(详见 §1),无法做本机二进制/日志提取。本报告全部结论基于 **官方 openai/codex 源码仓库**,以最新稳定 release tag `rust-v0.154.0`(worktree commit `6b9826e`)为准,并与 `main` HEAD(2026-09-17,`e269f216`)交叉对照。凡标注「直接证据」的条目均给出源码文件级锚点;版本漂移风险单列(§6)。

## 1. 安装证据

| 项 | 结果 |
|----|------|
| `where codex` | ❌ 未找到 |
| npm 全局 `@openai/codex`(`AppData/Roaming/npm/node_modules`) | ❌ 不存在(仅有 pi/opencli/trellis 等) |
| bun / pnpm / cargo / scoop / chocolatey / winget 全局 | ❌ 均无 |
| npx 缓存(`AppData/Local/npm-cache/_npx`) | ❌ 无 codex 包 |
| `~/.codex` 配置目录(`C:/Users/NINGMEI/.codex`) | ❌ 不存在 |
| VS Code / Cursor 扩展目录(`openai.chatgpt` 等) | ❌ 无 |
| WSL | ❌ 无已安装发行版,无从查起 |
| D 盘全盘浅层搜索(`codex*.exe/cmd/ps1`) | ❌ 无 |
| 注册表卸载项 | ❌ 无(仅 Cherry Studio 命中) |

**结论**:本机无 Codex CLI 及任何派生安装(VS Code 扩展、npm 包均无)。`D:/AI/CLIProxyAPIPlus/codex-*` 目录为第三方代理 CLIProxyAPI 的测试产物,与 Codex 本体无关,不构成安装证据。

**影响**:PRD D1「用户本机均有安装」对 Codex 不成立。如需「本机提取」级证据(尤其 UA 中终端字段的真实取值),需用户安装 Codex 后重跑研究;本报告按官方源码先行交付,供预设库直接取值。

## 2. HTTP 标识请求头清单

Codex 默认 provider 走 **Responses API**(`wire_api: Responses`),请求 `POST {base_url}/responses`。以下头按「每次请求都会带 / 条件携带」组织。

### 2.1 默认客户端头(所有请求,`codex-rs/login/src/auth/default_client.rs`)

| 头 | 值模板 | 证据 | 置信度 |
|----|--------|------|--------|
| `originator` | `codex_cli_rs`(常量 `DEFAULT_ORIGINATOR`) | `default_client.rs:40`,`default_headers()` 中无条件 insert | 直接证据 |
| `User-Agent` | `{originator}/{version} ({os_type} {os_version}; {arch}) {terminal_ua}` | `default_client.rs` `get_codex_user_agent()`:`format!("{}/{build_version} ({} {}; {}) {}", originator, os_type, os_version, arch, user_agent())` | 直接证据 |
| (residency 头) | 仅当受管 residency 要求存在时插入(`us`) | `default_headers()` | 直接证据(条件头) |

**User-Agent 实例化**(Windows 终端):
```
codex_cli_rs/0.154.0 (Windows 10; x86_64) Windows Terminal
```
- `{version}` = `CARGO_PKG_VERSION`(即 release 版本号 0.154.0)。
- `{os_type} {os_version}` 来自 `os_info` crate(Windows 上形如 `Windows 10` / `Windows 11` — 取决于 os_info 对 build 号的判定,非真实产品名)。
- `{terminal_ua}` 来自 `codex_terminal_detection::user_agent()`(`terminal-detection/src/lib.rs:234`),按 `TERM_PROGRAM`(+`TERM_PROGRAM_VERSION`)→ `WEZTERM_VERSION`/iTerm2/kitty/Ghostty → `TERM` 兜底检测,**随用户实际终端变化**(如 `iTerm2`、`Windows Terminal`、`ghostty` 等)。⚠️ 这意味着 Codex 的 UA 尾段不是常量,伪装时需按目标场景固定一个合理终端 token。

### 2.2 Responses 请求头(`codex-rs/core/src/client.rs` + `codex-rs/codex-api`)

| 头 | 值模板 | 何时携带 | 证据 | 置信度 |
|----|--------|----------|------|--------|
| `Authorization` | `Bearer {token}`(API key 或 ChatGPT access token) | 有凭据时(API key 模式与 ChatGPT 模式均如此) | `model-provider/src/bearer_auth_provider.rs` `add_auth_headers()` | 直接证据 |
| `ChatGPT-Account-ID` | `{account_id}`(uuid) | **仅 ChatGPT 登录态**(`CodexAuth::Chatgpt*` 有 account_id);API key 模式不带 | 同上 + `auth_provider_from_auth()`(`model-provider/src/auth.rs:307-325`) | 直接证据 |
| `X-OpenAI-Fedramp` | `true` | 仅 FedRAMP 账号 | `bearer_auth_provider.rs` | 直接证据(罕见分支) |
| `session-id` | `{session_id}`(uuid v4) | 每次 Responses 请求(`build_session_headers`) | `codex-api/src/requests/headers.rs:8`;取值 `responses_session_id()`(`client.rs:557`) = `prompt_cache_key` 或子代理 session_id | 直接证据 |
| `thread-id` | `{thread_id}`(uuid,会话级) | 每次 Responses 请求 | `codex-api/src/requests/headers.rs:11` | 直接证据 |
| `x-client-request-id` | `{thread_id}` | 每次 Responses 请求 | `codex-api/src/endpoint/responses.rs:120` | 直接证据 |
| `x-openai-subagent` | `review` / `compact` / `memory_consolidation` / `collab_spawn` / 自定义 | 仅子代理会话 | `codex-api/src/requests/headers.rs` `subagent_header()` | 直接证据(条件头) |
| `x-codex-turn-state` | turn 状态串 | turn 中途 | `client.rs` `build_responses_headers()` | 直接证据(条件头) |
| `x-codex-beta-features` | config 提供的串 | 配置了 beta features 时 | 同上 | 直接证据(条件头) |
| `x-codex-routing-hint` / `x-codex-installation-id` / `x-codex-parent-thread-id` / `x-codex-window-id` | 各场景元数据 | 条件携带 | `client.rs:155-163` 常量定义 | 直接证据(条件头) |
| `version` | `0.154.0`(`CARGO_PKG_VERSION`) | openai 内置 provider 固定头 | `model-provider-info/src/lib.rs` `create_openai_provider()` `http_headers: [("version", ...)]` | 直接证据 |
| `OpenAI-Organization` / `OpenAI-Project` | env `OPENAI_ORGANIZATION` / `OPENAI_PROJECT` | 设置了环境变量时 | 同上 `env_http_headers` | 直接证据(条件头) |
| `OpenAI-Beta` | `responses_websockets=2026-02-06` | **仅 WebSocket 传输握手**;HTTP 流式请求在 0.154.0 **不带** OpenAI-Beta | `client.rs:1290`(`RESPONSES_WEBSOCKETS_V2_BETA_HEADER_VALUE`)、`cli/src/doctor.rs:2289` | 直接证据 |

⚠️ **版本漂移注意(对伪装关键)**:
- 旧版 Codex(2025 年代,0.2x–0.5x)HTTP `/responses` 请求带 `OpenAI-Beta: responses=experimental` 与 `session_id: {uuid}`(下划线);当前 0.154.0 已改为 `session-id`(连字符)+ `thread-id`,且 HTTP 路径无 OpenAI-Beta。中转上游看到哪种特征取决于用户 Codex 版本。预设库建议**按当前 release(0.154.x)取值**。
- `originator` 可被 `CODEX_INTERNAL_ORIGINATOR_OVERRIDE` 环境变量覆盖(如 IDE 集成用 `codex_vscode`);CLI 默认恒为 `codex_cli_rs`。

### 2.3 端点习惯

| 场景 | base_url | 请求路径 |
|------|----------|----------|
| API key 模式(默认) | `https://api.openai.com/v1` | `POST /responses`(SSE 流式) |
| ChatGPT 登录模式 | `https://chatgpt.com/backend-api/codex` | `POST /responses` |
| 自定义 provider(config.toml `model_providers`) | 用户指定 `base_url` | `wire_api: "responses"` → `/responses`;`"chat"` → chat completions |

证据:`model-provider-info/src/lib.rs:296-306`(base_url 选择)、`:40`(`CHATGPT_CODEX_BASE_URL`)、`codex-api/src/endpoint/responses.rs:42`(`Self::Responses => "/responses"`)。置信度:直接证据。

**重试行为**(供网关对照):上游重试 base_delay 200ms、重试 5xx / transport 错误、**不重试 429**(`to_api_provider()` 中 `retry_429: false`)。与 ZenAPI「重试 5xx/429」策略相反,伪装流量需接受上游会以 Codex 的重试策略再次打过来。

## 3. 默认系统提示词(base instructions)

### 3.1 注入机制

`ResponsesApiRequest.instructions` 字段承载基础指令(`codex-api/src/common.rs:285`,`#[serde(skip_serializing_if = "String::is_empty")]`),即 **Responses 协议原生的顶层 `instructions` 参数**,不是 input 消息。模板选择逻辑(`models-manager/src/model_info.rs` + `models-manager/models.json`):

1. **模型目录模板优先**:`models.json` 内嵌 11 个模型的 `instructions_template`,按请求 slug 精确匹配(gpt-5.2 / gpt-5.5 / gpt-5.6-sol / gpt-6-astra 等),模板开头为身份行 `You are Codex, an agent based on GPT-5...` 或 `You are GPT-5.2 running in the Codex CLI...`。
2. **回退模板**:`codex-rs/models-manager/prompt.md`(`BASE_INSTRUCTIONS = include_str!("../prompt.md")`,`model_info.rs:17`),用于未知模型 / 无元数据场景(自定义 provider + 非目录模型 slug → **正是 ZenAPI 这类自定义 base_url 的典型命中路径**)。
3. **人格段**:`# Personality` 小节按用户人格设置替换/剥离(`strip_personality_section`),默认人格文案内置于模板。

### 3.2 主指令全文(必需)

- **回退主指令(prompt.md)**:`research/prompts/codex-system-prompt.md`(21,178 字节)。身份行:`You are a coding agent running in the Codex CLI, a terminal-based coding assistant. Codex CLI is an open source project led by OpenAI. ...`
- **代表性模型模板(gpt-5.2)**:`research/prompts/codex-gpt-5.2-model-template.md`(磁盘 21,970 字节 / 21,544 字符,取自 `models.json` 内嵌 `instructions_template`,即随二进制分发的规范版本)。身份行:`You are GPT-5.2 running in the Codex CLI, a terminal-based coding assistant. ...`
- 其他目录模型模板长度:gpt-6-astra 21,261 字符;gpt-5.6-sol/terra/luna 17,730 字符;gpt-5.5 19,754 字符(`models.json`,可见模型)。

### 3.3 次要模板(可选项,伪装默认不需要)

| 模板 | 路径 | 字节 | 触发场景 |
|------|------|------|----------|
| compact 压缩 | `codex-rs/prompts/templates/compact/prompt.md` + `summary_prefix.md` | 435 / 399 | 上下文压缩请求 |
| review 评审 | `codex-rs/prompts/templates/review/rubric.md` | 7,780 | `/review` 子代理(经 `x-openai-subagent: review` 标记) |
| init 命令 | `codex-rs/tui/assets/prompt_for_init_command.md` | 1,877 | `/init` 生成 AGENTS.md |
| 权限/沙盒 | `codex-rs/prompts/templates/permissions/**` | 121–3,718 | 审批策略说明 |
| realtime | `codex-rs/prompts/templates/realtime/backend_prompt.md` | 4,978 | 语音实时端点(非 chat) |

置信度:直接证据(源码仓库文件级)。

## 4. 伪装要点(给 ZenAPI 预设的直接结论)

1. **必带头**:`originator: codex_cli_rs`、`User-Agent: codex_cli_rs/{ver} ({os} {ver}; {arch}) {terminal}`、`Authorization: Bearer ...`、`session-id`/`thread-id`/`x-client-request-id`(uuid)。版本头 `version: {ver}` 仅 openai 内置 provider 带,自定义 provider 场景通常无 → 预设可不注入。
2. **UA 不可完全静态**:版本号与终端 token 都在变。预设建议固定 `codex_cli_rs/0.154.0 (Windows 10; x86_64) Windows Terminal` 这类「合理快照」,文档明示快照属性(PRD Out-of-Scope 已排除自动更新,一致)。
3. **提示词注入位点与 Codex 原生语义对齐**:Codex 走 Responses 协议时基础指令在**顶层 `instructions` 字段**;ZenAPI 的前置注入策略(伪装提示词作为第一条 system)在转换为 Responses 上游时会自然并入 `instructions`(format-converter 已合并 system/developer → instructions),语义兼容。
4. **`prompt_cache_key`**:`ResponsesApiRequest.prompt_cache_key` = session uuid(`client.rs:540-551`),伪装请求可不带(上游对无此字段按可缓存性自行处理)。

## 5. 意外发现汇总

- **UA 随终端变化**(§2.1):`terminal-detection` 使 UA 尾段依赖用户终端环境,不存在唯一「真值」。
- **session_id 头更名**:旧 `session_id` → 新 `session-id` + `thread-id` 双头(§2.2),伪装预设若混合旧特征反而失真。
- **OpenAI-Beta 在当前 HTTP 路径缺席**(§2.2):`responses=experimental` 是历史特征,当前版本只在 WebSocket 握手出现。
- **上游重试策略差异**(§2.3):Codex 不重试 429,ZenAPI 重试;经 ZenAPI 转发后同一请求可能经历两套重试叠加。
- 本机 `D:/AI/CLIProxyAPIPlus/` 有第三方 CLI 代理及其 codex 命名的测试残留,搜索时易误判,已排除(§1)。
