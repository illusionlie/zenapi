# 技术设计：用户端「我的令牌」完全对齐管理端

## D1 前端 — `UserTokensView.tsx` 重构

### D1.1 Props 扩展（对齐 TokensView 的受控分页模式）

```tsx
type UserTokensViewProps = {
	pagedTokens: Token[];
	tokenPage: number;
	tokenPageSize: number;
	tokenTotal: number;
	tokenTotalPages: number;
	onCreate: (name: string, allowedModels: string[]) => void; // 签名保持不变，创建表单状态留组件内
	onPageChange: (next: number) => void;
	onPageSizeChange: (next: number) => void;
	onToggle: (id: string, status: string) => void;   // 新增
	onDelete: (id: string) => void;
	onReveal: (id: string) => void;
	editingToken: Token | null;
	onEdit: (token: Token) => void;
	onCloseEditModal: () => void;
	onEditSubmit: (data: { name: string; allowedModels: string[] }) => void;
	onFetchModelCandidates: () => Promise<string[]>;
};
```

创建模态的内部状态（`showCreateModal` / `tokenName` / `createSelectedModels`）留在组件内（现状），`onCreate(name, allowedModels)` 签名保持不变。

### D1.2 视觉规格（逐项照抄 `TokensView.tsx`）

- 外层卡片：`rounded-2xl border border-stone-200 bg-white p-5 shadow-lg`；标题行 `font-['Space_Grotesk']` + 「N 个」计数 pill + 「创建令牌」按钮（**逐字照抄 TokensView 主按钮**：`h-10 md:h-9 rounded-full bg-stone-900 px-4 text-xs font-semibold ... ease-smooth-out hover:-translate-y-0.5 hover:shadow-lg`）。
- 桌面表格：`grid grid-cols-[...]` 列配置，本视图列集为 **名称 / 前缀 / 已用/额度 / 模型限制 / 状态 / 创建时间 / 操作**（7 列，去掉管理端的「归属用户」与本视图的「渠道限定」）；表头 `bg-stone-50 px-4 py-3 text-xs uppercase tracking-widest text-stone-500`；行 `divide-y divide-stone-100`。
- 状态徽章：`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold`，启用 `border-emerald-100 bg-emerald-50 text-emerald-600`，停用 `border-stone-200 bg-stone-100 text-stone-500`。
- 操作按钮：药丸样式 `h-10 rounded-full border ... hover:shadow-lg`，与管理端同款（复制=石色底、编辑/启停=白底；删除=白底 `text-red-500`，保留破坏性操作红色语义；启停按钮文案按当前状态显示反向操作「停用/启用」）。
- 移动端卡片：`mt-4 md:hidden space-y-3` 结构照抄 TokensView（名称/前缀头部 + 徽章 + 元信息行 + 药丸按钮组）。
- 分页控件：整段照抄 TokensView（`buildPageItems` 页码、省略号、前后翻页禁用态、每页条数 select、`ease-smooth-out` 过渡、amber focus ring）。
- 模态：`Modal` 的 `sheet` 模式 + `panelClass="w-full max-w-xl rounded-t-2xl md:rounded-2xl ..."`、uppercase label、`focus:border-amber-400 focus:ring-amber-200`，对齐 TokensView 创建模态。
- 删除 `parseAllowedChannels` 与「渠道限定」单元格渲染；`renderModelLimit` 保留（与管理端同实现，可从 TokensView 导出共享或复制——见 D3）。

### D1.3 空态与分页空态

- 空列表文案保留「暂无令牌，点击上方按钮创建。」（用户语境）。

## D2 前端 — `UserApp.tsx` 状态与回调

照搬 `AdminApp.tsx` 的令牌分页模式：

- `const [tokenPage, setTokenPage] = useState(1)`、`const [tokenPageSize, setTokenPageSize] = useState(10)`。
- `tokenTotalPages = Math.max(1, Math.ceil(tokens.length / tokenPageSize))`；`pagedTokens = tokens.slice((tokenPage-1)*tokenPageSize, ...)`（useMemo）。
- `onPageSizeChange` 时 `setTokenPage(1)`；删除成功后 `setTokenPage(prev => Math.min(prev, tokenTotalPages))` clamp（参照 AdminApp L1134）。
- 新增 `handleUserTokenToggle(id, status)`：`toggleStatus(status)`（`core/utils` 已有）→ PATCH `/api/u/tokens/:id` body `{ status: next }` → `loadTokens()` → `toast.success("令牌已启用/停用")`，错误 `toast.error`。

## D3 复用清单（禁止重复造轮子）

| 复用项 | 位置 |
|--------|------|
| `buildPageItems` | `apps/ui/src/core/utils.ts` L41 |
| `toggleStatus` | `apps/ui/src/core/utils.ts` L36 |
| `formatDateTime` | `apps/ui/src/core/utils.ts` |
| `Modal`（sheet 模式） | `apps/ui/src/features/Modal.tsx` |
| `ModelAllowlistPicker` | `apps/ui/src/features/ModelAllowlistPicker.tsx`（创建/编辑模态继续用） |
| `serializeAllowlist` | worker 侧 `routes/user-api.ts` 已引入 |
| `resolveTokenUpdate` 参考实现 | `apps/worker/src/services/token-update.ts` |

`renderModelLimit` 两端同实现：**从 TokensView 导出并共享**（`export const renderModelLimit`），UserTokensView 导入，避免第三份拷贝。

## D4 后端 — `routes/user-api.ts` PATCH 扩展

### D4.1 新纯函数 `resolveUserTokenUpdate`（放 `services/token-update.ts`）

用户端可用字段为 **name / status / allowed_models** 的子集，不透传管理端全量 resolver：

```ts
export type UserTokenUpdateResult =
	| { ok: true; values: { name: string; status: string; allowed_models: string | null } }
	| { ok: false; error: "missing_body" | "invalid_name" | "invalid_status" | "invalid_allowed_models" };

export function resolveUserTokenUpdate(body: unknown, existing: {
	name: string; status: string; allowed_models: string | null;
}): UserTokenUpdateResult;
```

三态语义（与管理端 D5.2 对齐）：
- `undefined` → 保留 existing
- `null` → `status`/`name` 视为 undefined（保留）；`allowed_models` = 清除（不限制）
- 具体值 → 严格校验：`status` 仅 `"active" | "disabled"`，否则 `invalid_status`；`allowed_models` 经 `serializeAllowlist`，失败 `invalid_allowed_models`；`name` 非空字符串，否则 `invalid_name`

### D4.2 路由改动

- **forbidden 检查前置不变**，清单缩小为 `["quota_total", "quota_used", "allowed_channels"]`（`status` 移出）→ 命中 400 `field_not_editable`。
- SELECT existing 追加 `status` 列。
- 调用 `resolveUserTokenUpdate(body, existing)` → 失败 400 错误码透出 → 成功 `UPDATE tokens SET name = ?, status = ?, allowed_models = ?, updated_at = ? WHERE id = ? AND user_id = ?`。
- 更新注释：移除 "status admin-only" 的 D5.3 表述，改为 "quota/channel fields are admin-only; users may edit name, status and allowed_models"。
- 不改动：GET / POST / DELETE / reveal 与 `tokenAuth`。

## D5 测试设计（`tests/token-update.test.ts` 扩展）

`resolveUserTokenUpdate` 用例：

1. 全 undefined → 三字段均为 existing 值
2. `status: "active"` / `"disabled"` → 正常写入
3. `status: "enabled"`（非法值）→ `invalid_status`
4. `status: null` → 保留 existing（视为 undefined）
5. `allowed_models: null` → 清除为 null；`allowed_models: ["m1"]` → 序列化；非法元素 → `invalid_allowed_models`
6. `name: ""` / 非字符串 → `invalid_name`
7. body 为数组/原始值 → `missing_body`

用户端路由的 forbidden 拒绝逻辑如可低成本集成测试则补一条（`quota_total` → 400），否则以纯函数测试 + AC4 人工验收为准。

## D6 兼容性与风险

- **存量 `allowed_channels`**：仅展示层移除，服务端 `tokenAuth` → `filterAllowedChannels` 校验链不动；存量受限令牌行为零变化。
- **用户停用自己的令牌**：仅影响该用户自己的 API 调用；管理员仍可在管理端重新启用 → 无恢复路径缺失。
- **前端切片分页**：与管理端一致，接受全量列表的性能特征（用户令牌数 << 管理端渠道数）。
- **回滚**：改动集中在 4 个文件（UserTokensView / UserApp / user-api.ts / token-update.ts + 测试），单 commit 可整体 revert。
