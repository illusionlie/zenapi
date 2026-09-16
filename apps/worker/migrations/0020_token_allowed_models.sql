-- Add per-token model allowlist (JSON string array; NULL = unrestricted).
ALTER TABLE tokens ADD COLUMN allowed_models TEXT;
