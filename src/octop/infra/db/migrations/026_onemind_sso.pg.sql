-- OneMind enterprise iframe SSO: seed the default role template (four menus).
-- Idempotent: ON CONFLICT keeps an existing customized role untouched.
INSERT INTO user_role (
    user_role_id, user_role_name, description, permissions, policies,
    created_at, updated_at
) VALUES (
    '01JQ0NEM1ND000000000000000',
    'OneMind 用户',
    'OneMind 平台免登用户默认角色（四个功能菜单）',
    '["onemind_qa", "onemind_write", "onemind_review", "onemind_analysis"]',
    '[]',
    EXTRACT(EPOCH FROM NOW())::BIGINT,
    EXTRACT(EPOCH FROM NOW())::BIGINT
)
ON CONFLICT (user_role_id) DO NOTHING;

UPDATE _schema_version SET version = 26;
