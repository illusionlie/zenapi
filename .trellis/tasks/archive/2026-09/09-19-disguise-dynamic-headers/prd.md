# 渠道伪装动态头模板与 OpenCode 客户端预设

## Goal

为渠道客户端伪装机制增加「动态头模板」能力：伪装请求头的值可包含**每次上游请求实时解析**的模板占位符（通用 uuid / 时间戳 + OpenCode 专用会话/请求 ID 生成器），使伪装头指纹可以携带合法的实时成分；并基于该能力新增第七个预设「OpenCode」。用于应对按客户端特征放行 / 差异化计费 / 风控的中转上游。

## Confirmed Decisions（用户已拍板）

| # | 决策 | 结论 |
|---|------|------|
| D1 | 实现路线（2026-09-19 用户选定） | **动态头模板通用能力 + OpenCode 动态预设**。不做 body 改写（强制流式 / 注入 tools）；Zen 免费额度为非目标（其校验已含 body 规则，且官方明示免费额度仅限 opencode 客户端使用） |
| D2 | 能力定位 | 通用模板机制（uuid / 时间戳等通用变量 + opencode 专用 ID 生成器），不是 opencode 专用 hack；为后续其他客户端（如 Codex 的 x-client-request-id）升级动态头铺路 |
| D3 | 会话 ID 策略（2026-09-19 用户选定） | `msg_` 与 `ses_` 均**每请求全新生成**：无状态、时间戳永远新鲜（ses 同样内嵌时间戳，粘性必变旧）；代价是连续请求表现为「每次新会话」，与真实长会话模式略有偏差，可接受 |

## Background（证据链详见 [research/opencode-zen-disguise.md](./research/opencode-zen-disguise.md)）

- OpenCode 对 opencode 系 provider 每请求发送 `x-opencode-request: msg_*` / `x-opencode-session: ses_*`，ID 为源码内算法本地生成：**前 12 hex 内嵌毫秒时间戳**（`Date.now()×4096+counter`，ses 按位取反），后 14 位 base62 随机；无签名/HMAC。乱填会被 Zen 网关 403 拒绝。
- 现有六预设的设计规则是「随会话变化的头一律省略——固定假随机值比缺失更可疑」（`apps/ui/src/core/client-presets.ts` 头注），因此现有机制对 opencode 这类"身份头全动态"的客户端**结构性不可伪装**——这是本任务要补的能力缺口。
- linux.do 2912664 实测：仅伪装头部在 Zen 免费额度上已被 body 校验（`stream:true` + `name=bash` tool + tools≥2）封死；本任务明确不追该场景（见 D1 / Out of Scope）。

## Requirements

- **R1 动态头模板（worker）**：伪装头（`disguise_headers_json`）的**值**支持 `{{...}}` 占位符，在上游请求构建时解析（每次调用独立生成，重试轮 / 换渠道 / 换 Key 天然各自新鲜）：
  - 通用变量：`{{uuid}}`（UUID v4）、`{{timestamp_ms}}`（Unix 毫秒）；
  - OpenCode 专用：`{{opencode_request_id}}`（`msg_` 前缀）、`{{opencode_session_id}}`（`ses_` 前缀），生成算法与源码一致（BigInt + `crypto.getRandomValues`，Workers 原生支持）；
  - 未知占位符**原样保留**（可预测、无破坏，fail-open 与伪装域既有语义一致）；
  - 模板解析**仅作用于伪装头**：`custom_headers_json` 与全局注入/剔除头不解释模板，保持字面值；
  - 解析时机在头应用层（`applyHeaderPolicy` 链），`parseDisguiseHeaders` 等读侧不受影响。
- **R2 OpenCode 预设（UI）**：`client-presets.ts` 第七预设——头 = UA 快照 + `x-opencode-client: cli` + `x-opencode-project: global` + 两个模板占位符；提示词 = `default.txt` 静态段 + 中性 environment 块（实施时从源码提取）；note 标注版本锚点、动态模板说明、「不适用于 Zen 免费额度」警示、版本漂移提示。
- **R3 测试链路**：`/test-model`、Playground、连通性测试沿用 09-17 任务 D4 语义，模板随各自路径独立解析。
- **R4 零回归**：不含占位符的伪装头行为与现状逐字节一致；六既有预设不受影响。
- **R5 文档**：AGENTS.md §8 补动态模板语义一句话；`.trellis/spec` 若有伪装相关条目同步。

## Acceptance Criteria

- **AC1**：`{{uuid}}`、`{{timestamp_ms}}`、`{{opencode_request_id}}` 渲染为格式合法且连续两次请求互不相同的值；`msg_*` ID 为前缀 + 26 字符（12 hex 时间戳段可解码回当前毫秒 ±60s 容差 + 14 base62 随机段），算法单测覆盖（含 ses 取反分支解码）。
- **AC2**：`{{opencode_session_id}}` 渲染为 `ses_` 前缀 + 26 字符（12 hex 段按位取反后可解码回当前毫秒 ±60s 容差），且与 `{{opencode_request_id}}` 一样每请求互不相同。
- **AC3**：未知占位符 `{{nope}}` 原样出现在上游头值中，请求不报错。
- **AC4**：无占位符渠道（含六预设、手工 JSON）上游请求头与 body 与现状逐字节一致（零回归断言）。
- **AC5**：同一模板串写入 `custom_headers_json` 时上游收到字面值 `{{uuid}}`，证明解析域仅伪装头。
- **AC6**：UI 第七预设选中即填充含占位符的 JSON 与提示词、可手工微调、可清除；note 与「（测试）」标记按 R2 呈现。
- **AC7**：重试 / 换渠道 / 换 Key 场景下每次上游请求的动态值独立生成（不跨 attempt 复用）。
- **AC8**：`bun run check && bun run typecheck && bun run test` 全绿。

## Out of Scope

- 请求 body 改写（强制 `stream:true`、注入假 tools）——Zen 免费额度场景明确放弃（D1）。
- Zen 免费额度的可用性承诺——预设 note 明示不支持。
- 既有六预设升级为动态头（Codex `x-client-request-id`、ZCode `X-Device-Mid` 等）——能力就绪后另开任务。
- 伪装提示词动态段伪造（cwd / 日期 / 平台真值）——沿用「静态段 + 中性环境值」既有规则。

## Open Questions

（无——所有用户侧决策已收敛，见 Confirmed Decisions。）
