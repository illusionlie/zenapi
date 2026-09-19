# Research: OpenCode 请求头实时生成机制与 Zen 网关校验（伪装可行性取证）

> 采集日期：2026-09-18/19。两源互证：linux.do 帖子（社区实测） + sst/opencode 官方源码。
> 用途：任务 09-19-disguise-dynamic-headers（动态头模板 + OpenCode 预设）的证据基础。

## 1. 事件背景（linux.do/t/topic/2912664，2026-09-17，帖主 saqjs-ld）

- 报错现象：三方网关反代 opencode zen 免费模型时被上游拒绝：

  ```json
  HTTP 403 {"type":"error","error":{"type":"FreeTierError",
    "message":"Error from provider (Console): OpenCode's free tier can only be used from within OpenCode"}}
  ```

  —— Zen 网关**主动做客户端指纹校验**，明示免费额度仅限 opencode 客户端内使用。
- 帖主抓包得到 opencode CLI 1.18.31 的完整必需头：

  ```
  User-Agent: opencode/1.18.31 ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14
  x-opencode-client: cli
  x-opencode-project: global
  x-opencode-request: msg_0ada1b968001cxm5rgh28JxlDH
  x-opencode-session: ses_f525e4699ffe5hmrr6t1FiPVca
  ```

- 「x-opencode-request / x-opencode-session 是 opencode cli 本地算出来的，乱填是不可以的」——即上游至少校验 ID 格式，大概率校验内嵌时间戳新鲜度。
- **时间线（重要）**：帖主给出实时生成 ID 的脚本后「据反馈，该方案已经无效」；Zen 随即升级为 **body 校验**：
  - `"stream": true` 必须存在；
  - `tools` 数组必须含 `name=bash` 的项（schema 内容不校验，可最小化）；
  - `tools` 数量 ≥ 2（第二个任意名）。
  帖主结论：「只能反代 oc cli（更好）或者自动加这种特定格式的转发器。我缴械了」。

## 2. ID 生成算法（帖主自 opencode 源码逆向，与抓包样本格式吻合）

```js
function gen(desc) {
  let last = 0, ctr = 0;
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const ts = Date.now();
  ctr = (ts !== last) ? 1 : ctr + 1;          // 同毫秒自增（真实实现有状态；单次生成恒为 1）
  last = ts;
  let v = BigInt(ts) * 0x1000n + BigInt(ctr);  // timestamp << 12 | counter
  if (desc) v = ~v;                            // ses_：按位取反；msg_：原值
  let time = "";
  for (let i = 0; i < 6; i++)
    time += Number((v >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, "0"); // 大端 6 字节 → 12 hex
  const rnd = [...crypto.getRandomValues(new Uint8Array(14))]
    .map(b => chars[b % 62]).join("");         // 14 位 base62 随机
  return time + rnd;                           // 26 字符
}
// ses_ + gen(true)，msg_ + gen(false)
```

结构验证：`msg_0ada1b968001cxm5rgh28JxlDH` 前缀后 26 字符 = 12 hex（时间戳段）+ 14 base62（随机段）✓。

**关键性质**：ID 前 12 位 hex 可解码回毫秒时间戳（msg_ 直接解码；ses_ 先按位取反再解码）→
服务器可校验新鲜度。**没有签名 / HMAC / 校验和**（源码证实，见 §3）→
伪装端只需「每请求实时生成」即可，无需任何密钥材料。

Workers 运行时可用性：`BigInt`、`crypto.getRandomValues`、`Date.now()` 均原生支持，纯函数可实现。

## 3. 官方源码锚点（sst/opencode @ dev 分支）

头生成核心：`packages/opencode/src/session/llm/request.ts` 的 `prepare()` 返回值：

```ts
headers: {
  ...(input.model.providerID.startsWith("opencode")
    ? {
        ...(opencodeProjectID ? { "x-opencode-project": opencodeProjectID } : {}),
        "x-opencode-session": input.sessionID,
        "x-opencode-request": input.user.id,
        "x-opencode-client": input.flags.client,
        "User-Agent": USER_AGENT,          // "opencode/${InstallationVersion}"
      }
    : {
        "x-session-affinity": input.sessionID,
        "X-Session-Id": input.sessionID,
        "User-Agent": USER_AGENT,
      }),
  ...(input.parentSessionID ? { "x-parent-session-id": input.parentSessionID } : {}),
  ...input.model.headers,   // 模型/供应商配置头
  ...headers,               // chat.headers 插件触发器（可覆盖一切）
}
```

- **无时间戳头、无 Date.now、无 hash/HMAC** 出现在该文件的头逻辑中——「实时计算」的全部内容就是
  每消息/每会话生成的 ID（§2 算法）。
- 抓包 UA 的 `ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14` 后缀来自 Vercel AI SDK / Bun 运行时的
  UA 追加层，版本随 opencode 发布漂移。
- `x-opencode-client` 值来自 `input.flags.client`（CLI 场景 = `cli`）；`x-opencode-project` 抓包样本
  为 `global`。
- 默认系统提示词：静态段在 `packages/opencode/src/session/prompt/default.txt`（另有
  PROMPT_ANTHROPIC / GPT / GEMINI 等按模型分档的变体，见 `session/system.ts`）；
  动态段（cwd / worktree / git 与否 / platform / 日期 / 项目引用 / skills / mcp）由
  `SystemPrompt.Service.environment()` 运行时注入。

## 4. 对 ZenAPI 伪装机制的推论

1. **静态预设（现机制）对 opencode 必然失败**：配置时固化的 ID 时间戳立刻变旧；这与现有六预设
   「随会话变化的头一律省略——固定假随机值比缺失更可疑」（`apps/ui/src/core/client-presets.ts` 头注）
   的规则一致，opencode 恰恰是身份头全部动态的客户端 → 需要动态头模板能力才能伪装。
2. **动态头模板是通用能力**：uuid / 时间戳类占位符对所有「内嵌实时成分」的客户端都有用
   （如 Codex 预设 note 中提到的 x-client-request-id「每次请求 uuid」被省略，同理）。
3. **能力边界必须写死**：Zen 免费额度已升级到 body 校验（§1 时间线），纯头部伪装在该场景**已死**；
   追 body 校验（强制流式 + 注入假 tools）侵入网关核心且改请求语义，列为非目标。
   动态预设的目标场景：付费 Zen 端点、按 opencode 特征做风控/放行的普通中转上游。
4. 版本漂移风险：UA 双版本号（opencode/ai-sdk/bun）是快照值，需在预设 note 标注「随版本漂移需手工刷新」，
   与现有预设惯例一致。

## 5. 来源

- linux.do 帖子：https://linux.do/t/topic/2912664 （含生成脚本原帖与 body 校验更新）
- opencode 源码：https://github.com/sst/opencode/blob/dev/packages/opencode/src/session/llm/request.ts
- opencode 系统提示词：https://github.com/sst/opencode/tree/dev/packages/opencode/src/session/prompt/
