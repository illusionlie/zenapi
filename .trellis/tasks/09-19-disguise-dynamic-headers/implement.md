# Implement: 渠道伪装动态头模板与 OpenCode 客户端预设

> 顺序执行；每步独立可回滚。验证命令汇总见 §V。

## Step 1 worker 纯函数（design §1/§2）

- [ ] `apps/worker/src/utils/client-disguise.ts`：
  - `genOpencodeRequestId` / `genOpencodeSessionId`（内部 `genOpencodeId(desc, now?)`，算法与偏差声明见 design）；
  - `TEMPLATE_RESOLVERS` 注册表 + `resolveDisguiseTemplate(value)`（fast path + 未知占位符保留）；
  - 文件头注释补动态模板语义（与既有 fail-open 注释风格一致）。
- [ ] `tests/client-disguise.test.ts` 新增 design §6-1/6-2 用例。
- 验证：`bun run test -- client-disguise`。
- 回滚点：纯增量文件，revert 即回。

## Step 2 接线（design §3）

- [ ] `apps/worker/src/utils/proxy-headers.ts` `applyHeaderPolicy` 伪装分支包 `resolveDisguiseTemplate`。
- [ ] `apps/worker/src/services/channel-testing.ts` 探针直设伪装头处（:65-66）同样包 resolver。
- [ ] `tests/proxy-headers.test.ts` 扩展 design §6-3（伪装渲染 + custom 字面量对照 + 零回归）。
- [ ] `tests/client-disguise.test.ts` 补 design §6-4（连续两次 buildChannelRequest 渲染值不同）。
- 验证：`bun run test -- proxy-headers client-disguise`；既有用例零改动即绿。
- 回滚点：两处接线各自一行改动，可独立撤销。

## Step 3 UI 预设（design §4）

- [ ] 提取提示词：拉取 `sst/opencode` dev 分支 `packages/opencode/src/session/prompt/default.txt`，静态正文 + 中性 environment 块 → 归档 `research/prompts/opencode-system-prompt.md`（记录 commit 锚点）。
- [ ] `apps/ui/src/core/client-presets.ts` 新增 `opencode` 预设（头集/占位符/note 按 design §4，不标 testing）。
- [ ] `apps/ui/src/features/ChannelsView.tsx` 伪装分组说明文案追加占位符支持说明一句。
- 验证：`bun run typecheck`；UI 侧无独立单测框架覆盖预设数据（数据文件），review 门禁人工核对 note 与头集。
- 回滚点：预设条目独立。

## Step 4 文档

- [ ] `AGENTS.md` §8 追加一行：伪装头值支持每请求解析的 `{{...}}` 动态占位符（仅伪装头解释，custom/全局头按字面值）。

## Step 5 全量门禁 + review

- [ ] `bun run check && bun run typecheck && bun run test`（AC8）。
- [ ] 派发 `trellis-check` 子代理：对照 prd AC1–AC8 与 design §6 清单逐条核验。

## V. 验证命令

```bash
bun run test -- client-disguise proxy-headers   # 分步
bun run check && bun run typecheck && bun run test  # 全量门禁
```

## 风险与注意

- `proxy-headers.ts` 为代理热路径：fast path 必须先于正则；零回归断言不通过 = 立即停手回查。
- 预设 note 中「不适用于 Zen 免费额度」警示不可省略（PRD D1 边界的 UI 呈现）。
- 提示词提取只取静态段：default.txt 若含运行时占位符，按既有预设惯例填中性值并写入 research 归档。
