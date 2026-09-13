-- 0019: remove shared ecosystem (site_mode / withdrawal / LDOH / contributions)
-- 移除站点模式与共享模式生态：
--   1. DROP 共享生态 5 表
--   2. DROP 失效列（users.withdrawable_balance / users.tip_url、channels 共享生态四列）
--   3. 清理 8 个废弃 settings 键
--   4. channels.models_json 去除内嵌 shared 标记（json_each + json_remove 重写）
--   5. 新增 users.allowed_models（用户级可用模型白名单，JSON 字符串数组，NULL = 不限制）

-- 1. DROP 共享生态 5 表（含各自索引，表删则索引随删）
DROP TABLE IF EXISTS withdrawal_orders;
DROP TABLE IF EXISTS ldoh_violations;
DROP TABLE IF EXISTS ldoh_blocked_urls;
DROP TABLE IF EXISTS ldoh_site_maintainers;
DROP TABLE IF EXISTS ldoh_sites;

-- 2. DROP 失效列（SQLite 3.35+ / D1 支持 DROP COLUMN；
--    D1 迁移由 d1_migrations 跟踪单次执行，本段依赖单次执行语义，不可重入）
ALTER TABLE users DROP COLUMN withdrawable_balance;
ALTER TABLE users DROP COLUMN tip_url;
ALTER TABLE channels DROP COLUMN contributed_by;
ALTER TABLE channels DROP COLUMN charge_enabled;
ALTER TABLE channels DROP COLUMN contribution_note;
ALTER TABLE channels DROP COLUMN tip_url;

-- 3. 清理废弃 settings 键
DELETE FROM settings WHERE key IN (
  'site_mode',
  'withdrawal_enabled',
  'withdrawal_fee_rate',
  'withdrawal_mode',
  'ldoh_cookie',
  'channel_fee_enabled',
  'channel_review_enabled',
  'user_channel_selection_enabled'
);

-- 4. channels.models_json 去除内嵌 shared 键
--    安全守卫说明：
--    a) json_each 一律吃 CASE 守卫后的安全值（SQLite 不保证 WHERE 谓词求值顺序，
--       畸形 JSON 会让 json_each 直接报错）；
--    b) 元素类型用 json_each 的 type 列判断，不能用 json_type(value)：
--       legacy 字符串数组的元素 value 是裸文本（如 'gpt-4o'），
--       json_type 会把它当 JSON 解析而报 malformed JSON；
--    c) json_remove / json_extract 均用 CASE 保证只对 object 元素求值；
--    d) EXISTS 守卫保证仅重写真正含 shared 标记的行，'[]' / NULL / 纯字符串数组
--       天然跳过。
UPDATE channels SET models_json = (
  SELECT json_group_array(
    CASE WHEN je.type = 'object'
      THEN json_remove(je.value, '$.shared')
      ELSE je.value END
  )
  FROM json_each(
    CASE WHEN models_json IS NOT NULL AND models_json != '' AND json_valid(models_json)
      THEN models_json ELSE '[]' END
  ) AS je
) WHERE models_json IS NOT NULL
  AND models_json != ''
  AND json_valid(models_json)
  AND EXISTS (
    SELECT 1 FROM json_each(
      CASE WHEN models_json IS NOT NULL AND models_json != '' AND json_valid(models_json)
        THEN models_json ELSE '[]' END
    ) AS je
    WHERE je.type = 'object'
      AND json_extract(CASE WHEN je.type = 'object' THEN je.value END, '$.shared') IS NOT NULL
  );

-- 5. 用户级可用模型白名单（R4）：JSON 字符串数组，NULL = 不限制
ALTER TABLE users ADD COLUMN allowed_models TEXT;
