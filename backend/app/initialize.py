"""Idempotent database bootstrap.

Flow:
  1. Create the database if missing.
  2. Create tables from the SQLAlchemy models (authoritative schema).
  3. Execute the seed statements in ``database/db.sql`` (roles, the SuperAdmin
     user, brand settings, and all UI translations). All seeds are idempotent
     (INSERT IGNORE), so re-running is safe.

UI translations live ONLY in the DB (``translations`` table, namespace ``ui``);
there are no ``en.json`` / ``ar.json`` files. Edit strings in the DB (or in
``database/db.sql`` for fresh installs).

The SuperAdmin credentials and brand defaults live in ``database/db.sql`` — not
in ``.env``.
"""
from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine, text

from app.core.config import settings
from app.core.database import Base, engine

# Ensure all models are imported so metadata is populated.
import app.models  # noqa: F401

ROOT = Path(__file__).resolve().parents[2]
DB_SQL_PATH = ROOT / "database" / "db.sql"


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


def patch_schema() -> None:
    """Apply lightweight, idempotent column migrations for existing installs.

    ``create_all`` never ALTERs an existing table, so schema changes to already
    provisioned databases are handled here (guarded via information_schema).
    """
    with engine.begin() as conn:
        # product_variants.quantity — per-variant on-hand stock.
        has_qty = conn.execute(
            text(
                "SELECT COUNT(*) FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = :db AND TABLE_NAME = 'product_variants' "
                "AND COLUMN_NAME = 'quantity'"
            ),
            {"db": settings.DB_NAME},
        ).scalar()
        if not has_qty:
            conn.exec_driver_sql(
                "ALTER TABLE `product_variants` "
                "ADD COLUMN `quantity` INT NOT NULL DEFAULT 0"
            )
        # products price columns -> DECIMAL(12,2) for exact 2-decimal money.
        for col in ("supplier_price", "min_price", "price"):
            dtype = conn.execute(
                text(
                    "SELECT DATA_TYPE FROM information_schema.COLUMNS "
                    "WHERE TABLE_SCHEMA = :db AND TABLE_NAME = 'products' "
                    "AND COLUMN_NAME = :col"
                ),
                {"db": settings.DB_NAME, "col": col},
            ).scalar()
            if dtype and dtype.lower() != "decimal":
                conn.exec_driver_sql(
                    f"ALTER TABLE `products` "
                    f"MODIFY COLUMN `{col}` DECIMAL(12,2) DEFAULT 0"
                )


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


def run() -> None:
    print(f"[init] Creating database '{settings.DB_NAME}' if needed...")
    create_database()
    print("[init] Creating tables (SQLAlchemy models)...")
    create_tables()
    print("[init] Patching schema (idempotent migrations)...")
    patch_schema()
    print(f"[init] Applying seeds from {DB_SQL_PATH.name}...")
    run_sql_file()
    print("[init] Done.")


if __name__ == "__main__":
    run()
