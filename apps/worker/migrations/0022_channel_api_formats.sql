-- 0022: 渠道多 API 格式能力声明（api_formats JSON 数组）
-- api_formats: JSON 数组，声明该上游原生支持的 API 格式集合
--   （白名单 openai/responses/anthropic/custom，custom 独占不得组合）。
-- api_format 列保留为镜像列（应用层双写 = 规范序首元素），保证：
--   1) 旧版本代码回滚后仍可读（首元素 = 主格式，降级可用）；
--   2) monitoring GROUP BY 与 New API 兼容层零改动。
-- 回填：存量渠道 api_formats = [原 api_format]，迁移前语义逐渠道等价。
-- 幂等：WHERE api_formats IS NULL 保证可重放（重复执行不重复回填）。
ALTER TABLE channels ADD COLUMN api_formats TEXT;
UPDATE channels SET api_formats = json_array(api_format) WHERE api_formats IS NULL;
