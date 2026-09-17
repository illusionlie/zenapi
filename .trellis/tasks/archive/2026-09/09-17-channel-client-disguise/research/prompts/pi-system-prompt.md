# pi 默认系统提示词(全文 + 分层分析)

来源:`$PI/dist/core/system-prompt.js` → `buildSystemPrompt()`(pi-coding-agent 0.85.1,直接证据)。
运行时组装顺序:基础模板(静态)→ appendSystemPrompt → `<project_context>`(AGENTS.md 等)→ skills → `Current working directory`。

## 1. 基础模板(静态可复制部分)

以下为无自定义 prompt 时的固定骨架。`${toolsList}`、`${guidelines}`、文档路径三处是运行时变量(见 §2)。

```
You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
${toolsList}

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
${guidelines}

Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${readmePath}
- Additional docs: ${docsPath}
- Examples: ${examplesPath} (extensions, custom tools, SDK)
- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md), environment variables (docs/environment-variables.md)
- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)
```

## 2. 运行时变量判定

| 变量 | 来源 | 动态性 | 伪装可行性 |
|------|------|--------|-----------|
| `${toolsList}` | `selectedTools ∩ toolSnippets`,默认 `["read","bash","edit","write"]`,格式 `- {name}: {snippet}` | 半静态:默认四件套组合固定 | 可复刻默认组合;snippet 文本随版本变化 |
| `${guidelines}` | 按工具集条件生成(如只有 bash 无 grep/find/ls 时 `- Use bash for file operations like ls, rg, find`)+ 调用方传入 promptGuidelines + 固定两条 | 动态 | 固定两条恒在:`- Be concise in your responses`、`- Show file paths clearly when working with files` |
| `${readmePath}` / `${docsPath}` / `${examplesPath}` | 安装目录下的 README/docs/examples 绝对路径(`getReadmePath()` 等) | 动态(随安装位置) | 按目标机器安装形态生成,如 `C:\Users\{user}\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\README.md` |
| `appendSystemPrompt` | 调用方/扩展注入 | 动态 | 网关场景通常为空 |
| `<project_context>` | 工作区 AGENTS.md / CLAUDE.md 等全文,格式 `<project_instructions path="{path}">\n{content}\n</project_instructions>` 包裹 | 动态 | 不可复制;网关伪装时应整体省略或按目标仓库构造 |
| skills 清单 | `formatSkillsForPrompt()` | 动态 | 同上 |
| 末行 | `\nCurrent working directory: {cwd}`(反斜杠归一为 `/`) | 动态 | 按目标用户 OS 构造,如 `Current working directory: D:/Projects/demo` |

自定义 `customPrompt` 分支:若用户配置了自定义 prompt,则基础模板整体不出现,只拼 customPrompt + append + context + cwd。伪装时按"默认安装"处理即用 §1 模板。

## 3. 压缩摘要提示词(静态,全文)

`pi-agent-core/dist/harness/compaction/compaction.js` → `SUMMARIZATION_SYSTEM_PROMPT`(310 字符):

```
You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.
```

(后续为格式模板占位段,完整文本见 [`pi-compaction-prompt.md`](./pi-compaction-prompt.md)。)

## 4. 伪装要点小结

1. 身份行固定且唯一:`You are an expert coding assistant operating inside pi, a coding agent harness.` —— 网关注入的首选锚点。
2. 无环境平台段(pi 不在系统提示词里写 OS/git,这点与 zcode/Claude Code 不同),动态注入集中在 tools/guidelines/文档路径/cwd。
3. 静态部分占比高,复刻默认安装形态成本较低;AGENTS.md 段缺席不致穿帮(无项目上下文是合法状态)。
