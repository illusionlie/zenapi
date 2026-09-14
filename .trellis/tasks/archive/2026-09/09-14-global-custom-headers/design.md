# 技术设计 — 系统设置全局自定义请求头（注入/剔除）与渠道级统一

## 1. 总体形态

新增一个公共头策略模块 + 一条 settings 配置链路，两条代理链路（`/v1`、`/anthropic/v1`）的
**全部 6 个上游 fetch 分支**统一接入；`buildChannelRequest` 通过可选参数接收策略以保住
Playground 豁免边界。无 schema 变更、无路由挂载变更。

```
settings 表 (proxy_extra_headers / proxy_remove_headers)
        │ loadProxyHeaderPolicy()  ← 每代理请求一次，与渠道查询并行
        ▼
ProxyHeaderPolicy { extraHeaders, removeHeaders }
        │
        ├─ proxy.ts handler ──────────► buildChannelRequest(..., policy)
        │                                    ├─ openai 透传分支   → applyHeaderPolicy()
        │                                    ├─ anthropic 分支    → applyHeaderPolicy()
        │                                    └─ custom 分支       → applyHeaderPolicy()（替换内联 merge）
        ├─ anthropic-proxy.ts handler ─► 三个分支构造内置头后各自 applyHeaderPolicy()
        └─ playground.ts ─────────────► buildChannelRequest(..., null)  ← 豁免全局，渠道级仍生效
```

## 2. 上游分支接入矩阵

| # | 位置 | 头构造方式 | 全局注入 | 全局剔除 | 渠道级（现状 → 目标） |
|---|------|-----------|:--:|:--:|------|
| 1 | `proxy.ts` `buildChannelRequest` openai 分支 | 透传 incoming + 覆盖 `Authorization`/`x-api-key` | ✅ | ✅ 实效 | ❌ → ✅ |
| 2 | `proxy.ts` `buildChannelRequest` anthropic 分支 | 透传 incoming + 覆盖鉴权、删 `Authorization` | ✅ | ✅ 实效 | ❌ → ✅ |
| 3 | `proxy.ts` `buildChannelRequest` custom 分支 | 透传 incoming + 内联 merge 渠道级 | ✅ | ✅ 实效 | ✅（改为统一调用） |
| 4 | `anthropic-proxy.ts` anthropic 透传分支 | **fresh Headers 白名单式** | ✅ | no-op（统一调用） | ❌ → ✅ |
| 5 | `anthropic-proxy.ts` openai 转换分支 | **fresh Headers 白名单式** | ✅ | no-op（统一调用） | ❌ → ✅ |
| 6 | `anthropic-proxy.ts` custom 分支 | fresh Headers + 内联 merge 渠道级 | ✅ | no-op（统一调用） | ✅（改为统一调用） |

不接入全局策略的位置：
- `playground.ts`（传 `null` policy；渠道级继续生效 —— 统一后的**已知行为变化**：openai/anthropic
  渠道的 Playground 请求将开始携带渠道级头，符合「渠道身份」语义）。
- `services/channel-testing.ts` `fetchChannelModels`（连通性测试 / 拉取模型维持现状：仅渠道级）。

## 3. 数据契约

### settings 表键

| key | 值格式 | 缺省语义 |
|-----|--------|---------|
| `proxy_extra_headers` | JSON 对象字符串，键为头名、值全为字符串 | 未设置 / 空串 / 解析失败 → 空配置 |
| `proxy_remove_headers` | JSON 字符串数组 | 同上 |

存储**原文 JSON 字符串**（与 `custom_headers_json` 同风格）；解析容错放在读取侧（R4 宽容读取）。

### API

- `GET /api/settings` 新增返回字段：`proxy_extra_headers: string`、`proxy_remove_headers: string`（未设置为 `""`）。
- `PUT /api/settings` 可选接收两字段（string）：
  - `""` = 清空；非法 JSON / 类型不符 → 400 `invalid_proxy_extra_headers` / `invalid_proxy_remove_headers`
    （沿用 settings 路由现有 snake_case 错误码风格，见 spec error-handling.md）。
  - 校验逻辑复用 §4 的 parse 函数（parse 成功才落库），保证「写入的必是合法的」。

## 4. 核心模块：`apps/worker/src/utils/proxy-headers.ts`（新建）

```ts
export type ProxyHeaderPolicy = {
	extraHeaders: Record<string, string>;
	removeHeaders: string[];
};

/** 校验并解析注入头 JSON；非法返回 null（供 PUT 校验与读取容错共用） */
export function parseExtraHeaders(raw: string | null | undefined): Record<string, string> | null;

/** 校验并解析剔除头 JSON（字符串数组）；非法返回 null */
export function parseRemoveHeaders(raw: string | null | undefined): string[] | null;

/** 读取两项 settings 并合成 policy（一次 SQL，WHERE key IN 两个绑定参数）；解析失败按空处理 */
export async function loadProxyHeaderPolicy(db: D1Database): Promise<ProxyHeaderPolicy>;

/**
 * 应用头策略到待发上游的 Headers：
 *   1) removeHeaders 逐个 headers.delete()（Headers API 大小写不敏感）
 *   2) extraHeaders 逐个 headers.set()
 *   3) channelCustomJson（渠道级）逐个 headers.set() —— 后应用者赢
 * policy 传 null 时跳过 1)2)（Playground 豁免），渠道级 3) 照常执行。
 */
export function applyHeaderPolicy(
	headers: Headers,
	policy: ProxyHeaderPolicy | null,
	channelCustomJson: string | null | undefined,
): void;
```

设计要点：
- **单一应用顺序**：「剔除 → 全局注入 → 渠道级」固定在一个函数里，6 个分支行为不可能漂移。
- **渠道级 merge 从 3 处内联代码收敛**到 `applyHeaderPolicy`（代码复用，顺带修复分支 1/2/4/5 不生效）。
- fresh Headers 分支（4/5/6）剔除为 no-op 但仍调用 —— 一致性优先，防未来分支改动遗漏。

## 5. 接入点改造

### 5.1 `proxy.ts`

- `buildChannelRequest` 增加末位可选参数 `policy?: ProxyHeaderPolicy | null`（默认 `null` → 仅渠道级生效）。
  三个分支在设置完内置头之后、`return` 之前统一调用 `applyHeaderPolicy(headers, policy, channel.custom_headers_json)`；
  custom 分支删除现有内联 merge 块。
- 主 handler：`loadProxyHeaderPolicy(c.env.DB)` 与活跃渠道查询**并行**（`Promise.all`），
  结果传入重试循环内的 `buildChannelRequest` 调用（每请求只读一次库，重试轮不复读）。

### 5.2 `anthropic-proxy.ts`

- handler 同样并行预载 policy。
- 三个分支（anthropic 透传 / openai 转换 / custom）构造完内置头后、`fetch` 前调用
  `applyHeaderPolicy(headers, policy, channel.custom_headers_json)`；custom 分支删除内联 merge。

### 5.3 `playground.ts`

- `buildChannelRequest` 调用处不传 policy（用默认 `null`），代码零改动即可豁免；
  在调用处加一行注释说明豁免意图。

### 5.4 `services/settings.ts` + `routes/settings.ts`

- service 新增 `get/setProxyExtraHeaders`、`get/setProxyRemoveHeaders`（存取原文，模式照抄 `setAnnouncement`）。
- route GET 补两个返回字段；PUT 补两个校验分支（parse 失败 → 400）。

## 6. 前端（apps/ui，api-worker-ui/frontend 规范）

| 文件 | 改动 |
|------|------|
| `core/types.ts` | `Settings`、`SettingsForm` 各加 `proxy_extra_headers: string`、`proxy_remove_headers: string` |
| `core/constants.ts` | `initialSettingsForm` 补两个空串字段 |
| `AdminApp.tsx` | `loadSettings` 映射（`?? ""`）、`handleSettingsSubmit` 提交两字段 |
| `features/SettingsView.tsx` | 表单末尾（公告字段之后）加两个 `lg:col-span-2` 文本域：`font-mono`、placeholder 示例、说明文案（作用范围 / 优先级 / 覆盖鉴权头警示） |
| `features/ChannelsView.tsx` | 删除 `channelForm.api_format === "custom"` 条件使字段常显；说明文案更新为「对所有 API 格式生效，同名头覆盖系统注入头与内置鉴权头」 |

UI 文案须传达：注入/剔除仅对 API 代理链路生效（Playground 与连通性测试不套用）；
同名头优先级 渠道级 > 全局 > 内置；覆盖 `Authorization` 等鉴权头可能导致上游 401。

## 7. 权衡记录

| 决策 | 备选 | 理由 |
|------|------|------|
| policy 由调用方显式传入 `buildChannelRequest` | 函数内部自动读 settings | Playground 豁免需要显式边界；读库时机由调用方控制（并行、每请求一次） |
| 允许注入/渠道级覆盖内置鉴权头 | 保护名单禁止覆盖 | 现状 custom 分支即「后 merge 赢」可覆盖 `x-api-key`，回退该能力属隐性 breaking；规则单一更可预期，风险用 UI 警示兜底 |
| fresh Headers 分支也统一调用 applyHeaderPolicy | 仅透传分支处理 | no-op 无害；防未来新增分支遗漏策略 |
| settings 存原文 JSON、读取容错 | 存结构化多行 KV | 与 `custom_headers_json` 风格一致；settings 是 KV 表，无需迁移 |
| 错误码 `invalid_proxy_extra_headers` 等 | `ERR_SETTINGS_*` 前缀 | 沿用 settings 路由既有 snake_case 风格（spec error-handling.md 现状） |

## 8. 兼容性与回滚

- **无 D1 迁移**：`settings` 为 KV 表，两 key 缺失 = 空配置 = 行为与 main 一致。
- **行为变化清单**（仅此二处，均在 PRD 注明）：
  1. openai/anthropic 渠道的代理请求开始携带渠道级 custom_headers（本次目标本身）。
  2. Playground 对 openai/anthropic 渠道开始携带渠道级头（全局头仍豁免）。
- **回滚**：纯代码回滚（git revert），无数据回滚需求；已保存的两项 settings 键残留无害。

## 9. 测试设计（Vitest，`tests/`）

新建 `tests/proxy-headers.test.ts`：

1. `parseExtraHeaders`：合法对象 / 值含非字符串 / 非对象 JSON / 空串 / null → 容错矩阵。
2. `parseRemoveHeaders`：合法数组 / 含非字符串元素 / 非数组 / 空串 / null。
3. `applyHeaderPolicy` 顺序断言（用可观测 Headers 实例）：
   - 剔除先生效（透传头被删）；
   - 全局注入生效且可覆盖内置头；
   - 渠道级覆盖全局；
   - `policy = null` 时仅渠道级生效。
4. `buildChannelRequest` 三格式 ×（policy 注入 + 渠道级覆盖）矩阵：openai / anthropic / custom
   渠道各断言上游 Headers 关键头（`Authorization` 覆盖不被注入头误伤除非同名、注入头存在、渠道级赢）。

`loadProxyHeaderPolicy` 涉及 D1 绑定，按现有 tests/ 风格以纯函数测试为主；
若现有测试无 D1 mock 先例则不为它写集成测试（保持与 filter-allowed-channels 等测试同粒度）。
