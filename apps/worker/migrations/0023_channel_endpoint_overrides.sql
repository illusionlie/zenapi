-- 0023: 渠道每格式独立端点覆盖（endpoint_overrides JSON 对象）
-- endpoint_overrides: JSON 对象，键白名单 openai/responses/anthropic
--   （custom 语义是 base_url 即完整 URL，不可覆盖），值为该格式的专用
--   上游端点；读取经 resolveEndpointBaseUrl（覆盖优先，兜底 base_url 推导）。
-- 回填：无——存量渠道 NULL 即「全部格式走 base_url 推导」，行为与迁移前
--   逐字节一致；读侧 parseEndpointOverrides 对脏数据容错兜底为空对象。
ALTER TABLE channels ADD COLUMN endpoint_overrides TEXT;
