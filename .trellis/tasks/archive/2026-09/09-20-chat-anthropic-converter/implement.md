# 执行计划 — Chat Completions ↔ Anthropic Messages 转换器补全

> 前置：`prd.md`（需求与 AC）、`design.md`（映射矩阵与决策 D1–D8）、`research/anthropic-conversion-surface.md`（文档事实依据）。实施顺序即提交顺序，每步一个 commit、独立可 revert。全程无 schema / 迁移 / 路由 / 配置面改动。

## Step 1 — 请求转换补全（`openaiToAnthropicRequest`）

- [x] `max_completion_tokens ?? max_tokens ?? 8192`（design §2.1；对齐 responses 方向优先级写法 format-converter.ts:1128）
- [x] `developer` 角色并入 system 提取（现 :215-221 else 分支移出）
- [x] thinking 映射：`extractReasoningEffort`（import 自 `utils/reasoning.ts`）→ 档位表（design §2.2：ratio 0.1/0.2/0.5/0.8/0.95，clamp `[1024, max_tokens-1]`；`none` 不发字段；数字型视为显式 budget clamp 后直用）
- [x] `thinking` 对象直通逃生舱（最小校验：对象且含合法 `type`）
- [x] 产物含 thinking 时 `delete temperature / top_p`（D5，直通与映射两路都过此剥离）
- [x] `tool_choice:"none"` → `{type:"none"}`（不再删 tools）
- [x] user content 数组逐部件映射（design §2.3）：text / image_url（http→url source、data URL→base64 source）/ file（PDF→document）/ input_audio 丢弃 / 未知丢弃；丢块 `console.warn`；空数组回退空 text 块
- [x] `role=tool` content 数组取 text 部件拼接（现仅字符串）

**验证**：`bun run typecheck`；新增用例随 Step 4 一起跑。**回滚点**：单 commit revert。

## Step 2 — 非流式响应补全（`anthropicToOpenaiResponse` + 停止原因映射）

- [x] `mapStopReason` 补全：refusal→content_filter、model_context_window_exceeded→length、pause_turn→stop（design §3）
- [x] `mapFinishReason` 补全：default 分支中 content_filter→refusal（共享函数，反方向自动受益）
- [x] thinking 块 → `message.reasoning_content`（`\n\n` 拼接，有才出现字段）；redacted_thinking 不回传
- [x] usage 口径换算（D6）：prompt 三项和 + `prompt_tokens_details.cached_tokens` + `completion_tokens_details.reasoning_tokens`（有值时）

**验证**：`bun run typecheck`。**回滚点**：单 commit revert。

## Step 3 — 流式转换修复（`createAnthropicToOpenaiStreamTransform`）

- [x] `message_start` 不再发 usage chunk，改为缓存 `input_tokens / cache_read_input_tokens / cache_creation_input_tokens`
- [x] thinking 块状态跟踪 + `thinking_delta` → `delta.reasoning_content` 增量 chunk；`signature_delta` / `citations_delta` 显式忽略
- [x] `message_delta` 产出唯一 usage chunk：缓存三项 + `output_tokens`（累计值直取）+ thinking_tokens 映射（D6 / design §4）
- [x] 双 `[DONE]` 修复：`flush()` 不再补发（`message_stop` 分支保留）
- [x] `error` 事件 → 终止 chunk（finish_reason:"stop"）+ `console.warn`（D8，前缀标签遵循 logging 规范）

**验证**：`bun run typecheck`。**回滚点**：单 commit revert。

## Step 4 — 测试套件（`tests/format-converter-anthropic.test.ts` 新建）

- [x] 按 design §7 四组用例编写，逐条覆盖 AC1–AC9（模式照抄 `format-converter-responses.test.ts`：纯函数直调 + `runStreamTransform` + `parseSseData`）
- [x] AC4 联动断言：转换后的流喂给 `parseUsageFromSse`，断言 `prompt_tokens > 0` 且 cache 口径正确
- [x] 存量回归锁定：消息合并、tool 往返、tool_use 流式索引、ping 吞掉、`[DONE]` 计数恰一

**验证（审查门）**：`bun run check && bun run typecheck && bun run test` 全绿——此处为全量门禁，任何红灯不得带入 Step 5。

## Step 5 — 文档同步

- [x] AGENTS.md §8 追加：anthropic 渠道转换行为（thinking 映射与采样剥离、image/file 部件支持面、audio 丢弃、usage 口径与 `[DONE]` 语义、已知限制：工具往返签名、temperature 代际）
- [x] README 若有代理行为对应段落，同步一句级说明（无则跳过）

## Step 6 — 收尾

- [x] 全量门禁复跑：`bun run check && bun run typecheck && bun run test`
- [x] 自查 AC1–AC10 逐条勾验，更新 prd.md 勾选状态
- [ ] 按 Trellis Phase 3：spec 沉淀（如有新教训）→ 提交 → 归档

## 风险与注意

- **`parseUsageFromSse` 取末 chunk**：Step 3 完成前，流式 usage 落库口径是错的（现状即如此）；Step 3 + Step 4 合入后由测试锁定，不存在中间态破坏（三步同 PR 合入）。
- **`mapStopReason` 为共享函数**：改动影响 `anthropic-proxy.ts` 反方向——新增映射值只会在上游真的返回 refusal/pause_turn 等新枚举时才触发，存量上游行为不变（design §5，AC9 锁定）。
- **`thinking` 直通逃生舱**：不做深度 schema 校验，非法对象会被上游 400 并原样透传——与「透传上游错误」的既有代理行为一致。
- 实施中若发现文档实抓与上游实测行为冲突（如某兼容端点不认 `url` source），以「保守丢弃 + warn」为默认修正方向，必要时回 PRD 改 FR5。
