-- 0021: 渠道客户端伪装（请求头 + 系统提示词注入）
-- 两列均可空；NULL/空 = 不伪装（零回归基线）。
-- disguise_headers_json: JSON 对象字符串（与 custom_headers_json 同风格，
--   写入宽容存储、读取容错：非法 JSON 按空配置处理，不阻断代理请求）。
-- disguise_system_prompt: 纯文本，代理转发时按协议前置注入的伪装系统提示词
--   （openai messages / anthropic system / responses instructions）。
ALTER TABLE channels ADD COLUMN disguise_headers_json TEXT;
ALTER TABLE channels ADD COLUMN disguise_system_prompt TEXT;
