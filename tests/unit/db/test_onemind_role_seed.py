"""OneMind default role: seeded by the startup repair pass, not by a migration.

The fork used to ship the seed as its own `026_onemind_sso` pair. Upstream later
took 025 and 026 for `025_user_mfa` and `026_invite_redemptions`, so a fork-specific
number would collide again on every sync. The seed now runs with the other
always-repaired objects, and databases the fork recorded at version 26 — without
upstream 025/026 — must converge on a fresh install.
"""

from __future__ import annotations

import os
import re
import shutil
import uuid
from pathlib import Path

import pytest
from tests.support.postgresql import requires_postgresql

from octop.infra.db import migrate
from octop.infra.db.migrate import _current_version, _max_discovered_version, run_migrations
from octop.infra.db.pool import DatabasePool, SqlitePool

ONEMIND_ROLE_ID = "01JQ0NEM1ND000000000000000"
ONEMIND_PERMISSIONS = ["onemind_analysis", "onemind_qa", "onemind_review", "onemind_write"]


def _fork_v26_migrations(tmp_path: Path) -> Path:
    """Migrations as the fork shipped them before the sync: 001–024 plus a 026 of its own."""
    target = tmp_path / "fork-migrations"
    target.mkdir()
    for path in sorted(migrate._MIGRATIONS_DIR.iterdir()):
        match = re.match(r"(\d{3})_", path.name)
        if match and int(match.group(1)) <= 24:
            shutil.copy2(path, target / path.name)
    for name in ("026_fork_seed.sql", "026_fork_seed.pg.sql"):
        (target / name).write_text("UPDATE _schema_version SET version = 26;", encoding="utf-8")
    return target


def _schema_snapshot(db: DatabasePool) -> tuple[dict[str, frozenset[str]], frozenset[str]]:
    """Table -> column names, plus index names, for one schema."""
    with db.connect() as conn:
        if db.dialect == "postgresql":
            columns = [
                (row[0], row[1])
                for row in conn.execute(
                    "SELECT table_name, column_name FROM information_schema.columns "
                    "WHERE table_schema = current_schema()"
                ).fetchall()
            ]
            indexes = {
                row[0]
                for row in conn.execute(
                    "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()"
                ).fetchall()
            }
        else:
            tables = [
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
                ).fetchall()
            ]
            columns = []
            indexes = set()
            for table in tables:
                for row in conn.execute(f'PRAGMA table_info("{table}")').fetchall():
                    columns.append((table, row[1]))
                indexes.update(
                    row[0] for row in conn.execute(f'PRAGMA index_list("{table}")').fetchall()
                )
    tables: dict[str, set[str]] = {}
    for table, column in columns:
        tables.setdefault(table, set()).add(column)
    return {table: frozenset(names) for table, names in tables.items()}, frozenset(indexes)


def _role(db: DatabasePool) -> object:
    with db.connect() as conn:
        return conn.execute(
            "SELECT permissions, description FROM user_role WHERE user_role_id = ?",
            (ONEMIND_ROLE_ID,),
        ).fetchone()


def _assert_role_is_seeded_and_kept(db: DatabasePool) -> None:
    run_migrations(db)
    row = _role(db)
    assert row is not None
    # The seed carries the four OneMind menus; later repair passes add baseline
    # navigation permissions to every template, so only the OneMind set is pinned.
    permissions = set(json_loads(row[0]))
    assert set(ONEMIND_PERMISSIONS) <= permissions

    with db.transaction() as conn:
        conn.execute(
            "UPDATE user_role SET description = 'customized' WHERE user_role_id = ?",
            (ONEMIND_ROLE_ID,),
        )
    run_migrations(db)
    assert _role(db)[1] == "customized"

    with db.transaction() as conn:
        conn.execute("DELETE FROM user_role WHERE user_role_id = ?", (ONEMIND_ROLE_ID,))
    run_migrations(db)
    assert _role(db) is not None


def _assert_fork_v26_converges_on_fresh_install(
    db: DatabasePool, fork_dir: Path, fresh: DatabasePool
) -> None:
    original_dir = migrate._MIGRATIONS_DIR
    migrate._MIGRATIONS_DIR = fork_dir
    try:
        run_migrations(db)
    finally:
        migrate._MIGRATIONS_DIR = original_dir
    assert _current_version(db) == 26

    run_migrations(fresh)
    run_migrations(db)

    max_version = _max_discovered_version(db.dialect)
    assert _current_version(db) == max_version
    assert _current_version(fresh) == max_version
    assert _schema_snapshot(db) == _schema_snapshot(fresh)
    assert _role(db) is not None


def json_loads(text: object) -> list[str]:
    import json

    return json.loads(str(text))


def test_sqlite_seeds_role_and_keeps_customized_template(tmp_path: Path) -> None:
    db = SqlitePool(tmp_path / "roles.db")
    try:
        _assert_role_is_seeded_and_kept(db)
    finally:
        db.close()


def test_sqlite_fork_v26_database_converges_on_fresh_install(tmp_path: Path) -> None:
    fork_dir = _fork_v26_migrations(tmp_path)
    db = SqlitePool(tmp_path / "fork-v26.db")
    fresh = SqlitePool(tmp_path / "fresh.db")
    try:
        _assert_fork_v26_converges_on_fresh_install(db, fork_dir, fresh)
    finally:
        db.close()
        fresh.close()


def _postgres_pool() -> DatabasePool:
    import psycopg
    from psycopg.conninfo import conninfo_to_dict, make_conninfo

    from octop.infra.db.pool import PostgresPool

    url = os.environ["OCTOP_TEST_DATABASE_URL"]
    schema = "onemind_role_" + uuid.uuid4().hex[:12]
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(f'CREATE SCHEMA "{schema}"')
    info = conninfo_to_dict(url)
    info["options"] = f"-c search_path={schema}"
    return PostgresPool(make_conninfo(**info))


@requires_postgresql
@pytest.mark.postgresql
def test_postgresql_seeds_role_and_keeps_customized_template() -> None:
    db = _postgres_pool()
    try:
        _assert_role_is_seeded_and_kept(db)
    finally:
        db.close()


@requires_postgresql
@pytest.mark.postgresql
def test_postgresql_fork_v26_database_converges_on_fresh_install(tmp_path: Path) -> None:
    fork_dir = _fork_v26_migrations(tmp_path)
    db = _postgres_pool()
    fresh = _postgres_pool()
    try:
        _assert_fork_v26_converges_on_fresh_install(db, fork_dir, fresh)
    finally:
        db.close()
        fresh.close()
