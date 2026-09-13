# Database Guidelines

> Database patterns and conventions for this project.

---

## Overview

<!--
Document your project's database conventions here.

Questions to answer:
- What ORM/query library do you use?
- How are migrations managed?
- What are the naming conventions for tables/columns?
- How do you handle transactions?
-->

(To be filled by the team)

---

## Query Patterns

<!-- How should queries be written? Batch operations? -->

(To be filled by the team)

---

## Migrations

D1 迁移位于 `apps/worker/migrations/`，编号 `NNNN_name.sql`，由 `d1_migrations` 表跟踪、**单次执行**。新增迁移用 `bun run --filter api-worker db:migrate` 本地验证。

### Convention: 迁移与 schema.sql 必须同一变更内同步

**What**: 新增/删除表列时，`NNNN_xxx.sql` 与 `src/db/schema.sql` 必须同一提交内更新，且迁移终态与 schema.sql 逐字段一致。

**Why**: schema.sql 是新部署建库的事实来源（init 流程直接执行），漂移会导致新库与升级库结构不一致。历史教训：`0008_tip_url.sql` 给 channels 加了列但 schema.sql 从未记录，直到 0019 清理时才发现（该列在 worker 代码中零引用，属于历史漂移的死列）。

**验证方式**: 迁移本地执行后对比 schema；或如 0019 质检时用 bun:sqlite 构造前一迁移终态迷你库跑真实迁移文件断言终态。

### Convention: DROP COLUMN 不可重入，幂等性分层处理

**What**: `DROP TABLE IF EXISTS` / `DELETE` 可安全重写；`ALTER TABLE ... DROP COLUMN` **无 IF EXISTS 语法**，重复执行报 duplicate column 错。

**Why**: d1_migrations 跟踪保证迁移单次执行，文件内幂等只需尽力（表/键用 IF EXISTS），DROP COLUMN 依赖单次执行语义即可，不要为它造 PRAGMA 探测 hack。不可逆性需在迁移文件头注释与 README 部署契约中如实交代（参见 README「数据库迁移与升级顺序」）。

### Scenario: JSON-in-TEXT 列的 SQL 批量改写（0019 实战沉淀）

#### 1. Scope / Trigger
- 触发：迁移中批量改写 JSON-in-TEXT 列（如 channels.models_json 去内嵌字段）。此类改写有两个非显然陷阱（见 §7）。

#### 2. Signatures
```sql
UPDATE channels SET models_json = (
  SELECT json_group_array(
    CASE WHEN je.type = 'object'
         THEN json_remove(je.value, '$.shared')
         ELSE je.value END)
  FROM json_each(
    CASE WHEN json_valid(channels.models_json) THEN channels.models_json ELSE '[]' END
  ) AS je
) WHERE models_json IS NOT NULL AND models_json != ''
  AND EXISTS (
    SELECT 1 FROM json_each(
      CASE WHEN json_valid(channels.models_json) THEN channels.models_json ELSE '[]' END) AS je2
    WHERE je2.type = 'object' AND json_extract(je2.value, '$.shared') IS NOT NULL);
```

#### 3. Contracts
- 存量数据形态：JSON 对象数组 `[{id, input_price?, output_price?, enabled?, ...}]`、legacy 纯字符串数组 `["gpt-4o"]`、`[]`、空串、NULL、畸形 JSON —— 六种都必须不炸且语义正确。

#### 4. Validation & Error Matrix
- 畸形 JSON 行 → 守卫后跳过（不报 malformed JSON）
- 字符串数组元素 → `je.type` 判定后原样保留（不进 json_remove）
- NULL / 空串 → WHERE 排除

#### 5. Good/Base/Bad Cases
- Good: `[{"id":"m","shared":true}]` → `[{"id":"m"}]`
- Base: `["gpt-4o"]` / `[]` / NULL → 原样
- Bad: 畸形 JSON 行导致整条 UPDATE 报错回滚

#### 6. Tests Required
- 边界矩阵单测或 bun:sqlite 实测（0019 质检用例：正常/无 shared/legacy 字符串数组/`[]`/空串/畸形/NULL 七种）。

#### 7. Wrong vs Correct
**Wrong**（两个真实缺陷）：
```sql
-- 缺陷 1：SQLite 不保证 WHERE 谓词求值顺序，畸形 JSON 可能在 json_valid 短路前进入 json_each
WHERE json_valid(models_json) AND EXISTS (SELECT 1 FROM json_each(models_json) ...)
-- 缺陷 2：json_type(value) 把 legacy 字符串元素当 JSON 解析，模型名不是合法 JSON 字面量直接抛错
WHERE json_type(value) = 'object'
```
**Correct**：`json_each` 入参用 `CASE WHEN json_valid(...) ... ELSE '[]'` 包裹；元素类型用 **json_each 自带的 `type` 列**（非 json_type 函数）判定，json_remove/json_extract 均用 CASE 保证只对 object 元素求值。

---

## Naming Conventions

<!-- Table names, column names, index names -->

(To be filled by the team)

---

## Common Mistakes

<!-- Database-related mistakes your team has made -->

(To be filled by the team)
