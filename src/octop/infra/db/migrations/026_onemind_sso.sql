-- OneMind enterprise iframe SSO: seed the default role template (four menus).
-- Idempotent: INSERT OR IGNORE keeps an existing customized role untouched.
INSERT OR IGNORE INTO user_role (
    user_role_id, user_role_name, description, permissions, policies,
    created_at, updated_at
) VALUES (
    '01JQ0NEM1ND000000000000000',
    'OneMind 用户',
    'OneMind 平台免登用户默认角色（四个功能菜单）',
    '["onemind_qa", "onemind_write", "onemind_review", "onemind_analysis"]',
    '[]',
    CAST(strftime('%s', 'now') AS INTEGER),
    CAST(strftime('%s', 'now') AS INTEGER)
);

UPDATE _schema_version SET version = 26;
