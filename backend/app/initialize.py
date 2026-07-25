"""Idempotent database bootstrap.

Flow:
  1. Create the database if missing.
  2. Create tables from the SQLAlchemy models (authoritative schema).
  3. Execute the seed statements in ``database/db.sql`` (roles, the SuperAdmin
     user, brand settings, starter translations). All seeds are idempotent
     (INSERT IGNORE), so re-running is safe.

The SuperAdmin credentials and brand defaults live in ``database/db.sql`` — not
in ``.env``.
"""
from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import create_engine, text

from app.core.config import settings
from app.core.database import Base, engine

# Ensure all models are imported so metadata is populated.
import app.models  # noqa: F401

ROOT = Path(__file__).resolve().parents[2]
DB_SQL_PATH = ROOT / "database" / "db.sql"
LOCALES_DIR = ROOT / "frontend" / "src" / "i18n" / "locales"


def create_database() -> None:
    """Create the target schema if it does not exist."""
    server = create_engine(settings.server_url_no_db, future=True)
    with server.connect() as conn:
        conn.execute(
            text(
                f"CREATE DATABASE IF NOT EXISTS `{settings.DB_NAME}` "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )
        )
        conn.commit()
    server.dispose()


def create_tables() -> None:
    Base.metadata.create_all(bind=engine)


def _split_statements(sql: str) -> list[str]:
    """Strip line comments/blank lines and split into individual statements."""
    lines = [
        ln for ln in sql.splitlines()
        if ln.strip() and not ln.strip().startswith("--")
    ]
    cleaned = "\n".join(lines)
    return [s.strip() for s in cleaned.split(";") if s.strip()]


def run_sql_file() -> None:
    """Execute db.sql. Skips DDL that the ORM already handled; seeds the rest."""
    if not DB_SQL_PATH.exists():
        raise FileNotFoundError(f"Missing schema file: {DB_SQL_PATH}")
    sql = DB_SQL_PATH.read_text(encoding="utf-8")
    with engine.begin() as conn:
        for stmt in _split_statements(sql):
            head = stmt[:40].upper()
            # Skip server-level DDL; tables come from SQLAlchemy models.
            if head.startswith("CREATE DATABASE") or head.startswith("USE "):
                continue
            # exec_driver_sql avoids SQLAlchemy's ':' / '%' parameter parsing.
            conn.exec_driver_sql(stmt)


def _flatten(prefix: str, obj: dict, out: dict[str, str]) -> None:
    for k, v in obj.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            _flatten(key, v, out)
        else:
            out[key] = str(v)


def seed_ui_translations() -> None:
    """Migrate UI strings from the frontend JSON files into the DB `translations`
    table (namespace 'ui', flat dotted keys). The DB is the runtime source of
    truth; running init syncs the bundled JSON into it (upsert).
    """
    if not LOCALES_DIR.exists():
        print(f"[init] Skipping UI translations (no {LOCALES_DIR}).")
        return
    params: list[tuple[str, str, str, str]] = []
    for locale in ("en", "ar"):
        path = LOCALES_DIR / f"{locale}.json"
        if not path.exists():
            continue
        flat: dict[str, str] = {}
        _flatten("", json.loads(path.read_text(encoding="utf-8")), flat)
        for key, value in flat.items():
            params.append(("ui", key, locale, value))
    if not params:
        return
    with engine.begin() as conn:
        conn.exec_driver_sql(
            "INSERT INTO `translations` (`namespace`, `key`, `locale`, `value`) "
            "VALUES (%s, %s, %s, %s) "
            "ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
            params,
        )
    print(f"[init] Seeded {len(params)} UI translation rows.")


def run() -> None:
    print(f"[init] Creating database '{settings.DB_NAME}' if needed...")
    create_database()
    print("[init] Creating tables (SQLAlchemy models)...")
    create_tables()
    print(f"[init] Applying seeds from {DB_SQL_PATH.name}...")
    run_sql_file()
    print("[init] Seeding UI translations from frontend locales...")
    seed_ui_translations()
    print("[init] Done.")


if __name__ == "__main__":
    run()
