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
        # suppliers.address — mandatory supplier address.
        has_addr = conn.execute(
            text(
                "SELECT COUNT(*) FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = :db AND TABLE_NAME = 'suppliers' "
                "AND COLUMN_NAME = 'address'"
            ),
            {"db": settings.DB_NAME},
        ).scalar()
        if not has_addr:
            conn.exec_driver_sql(
                "ALTER TABLE `suppliers` ADD COLUMN `address` TEXT NULL AFTER `email`"
            )
        # suppliers.created_at — used for month-over-month "new suppliers" trend.
        has_sup_created = conn.execute(
            text(
                "SELECT COUNT(*) FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = :db AND TABLE_NAME = 'suppliers' "
                "AND COLUMN_NAME = 'created_at'"
            ),
            {"db": settings.DB_NAME},
        ).scalar()
        if not has_sup_created:
            conn.exec_driver_sql(
                "ALTER TABLE `suppliers` "
                "ADD COLUMN `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
            )
        # supplier_invoices.invoice_date — mandatory (API-level) invoice date.
        has_inv_date = conn.execute(
            text(
                "SELECT COUNT(*) FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = :db AND TABLE_NAME = 'supplier_invoices' "
                "AND COLUMN_NAME = 'invoice_date'"
            ),
            {"db": settings.DB_NAME},
        ).scalar()
        if not has_inv_date:
            conn.exec_driver_sql(
                "ALTER TABLE `supplier_invoices` ADD COLUMN `invoice_date` DATE NULL AFTER `amount`"
            )
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

        def _has_col(table: str, col: str) -> bool:
            return bool(
                conn.execute(
                    text(
                        "SELECT COUNT(*) FROM information_schema.COLUMNS "
                        "WHERE TABLE_SCHEMA = :db AND TABLE_NAME = :t AND COLUMN_NAME = :c"
                    ),
                    {"db": settings.DB_NAME, "t": table, "c": col},
                ).scalar()
            )

        # attributes.is_global — new independent flag. Existing installs preserve
        # behavior: non-coding attributes were effectively global before.
        if not _has_col("attributes", "is_global"):
            conn.exec_driver_sql(
                "ALTER TABLE `attributes` "
                "ADD COLUMN `is_global` TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_required`"
            )
            conn.exec_driver_sql("UPDATE `attributes` SET `is_global` = 1 WHERE `coding` = 0")

        # sale_items.stock_id — link a sold line to its stock unit (history).
        if not _has_col("sale_items", "stock_id"):
            conn.exec_driver_sql(
                "ALTER TABLE `sale_items` ADD COLUMN `stock_id` INT NULL AFTER `variant_id`, "
                "ADD INDEX `ix_sale_items_stock_id` (`stock_id`)"
            )

        # sale_items.attributes — JSON snapshot of the sold attributes.
        if not _has_col("sale_items", "attributes"):
            conn.exec_driver_sql(
                "ALTER TABLE `sale_items` ADD COLUMN `attributes` JSON NULL AFTER `name`"
            )

        # sale_items.list_price — catalog price at sale time (subtotal = Σ list·qty).
        if not _has_col("sale_items", "list_price"):
            conn.exec_driver_sql(
                "ALTER TABLE `sale_items` "
                "ADD COLUMN `list_price` DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `unit_price`"
            )
            # Backfill: assume no discount for historical rows (list = sold price).
            conn.exec_driver_sql(
                "UPDATE `sale_items` SET `list_price` = `unit_price` WHERE `list_price` = 0"
            )

        # sales cash-handling columns: amount paid + exact/raw change.
        for col in ("paid_amount", "change_amount", "change_raw"):
            if not _has_col("sales", col):
                conn.exec_driver_sql(
                    f"ALTER TABLE `sales` "
                    f"ADD COLUMN `{col}` DECIMAL(12,2) NOT NULL DEFAULT 0"
                )

        # sales.is_backtrack — flags manual/back-dated invoices (vs POS sales).
        if not _has_col("sales", "is_backtrack"):
            conn.exec_driver_sql(
                "ALTER TABLE `sales` "
                "ADD COLUMN `is_backtrack` TINYINT(1) NOT NULL DEFAULT 0"
            )

        # users.image_id — optional avatar (base64 image in `images`).
        if not _has_col("users", "image_id"):
            conn.exec_driver_sql(
                "ALTER TABLE `users` ADD COLUMN `image_id` INT NULL AFTER `locale`"
            )

        # Drop legacy sales snapshot columns — customer + payment are read via FK.
        for col in ("customer_name", "customer_phone", "payment_method"):
            if _has_col("sales", col):
                conn.exec_driver_sql(f"ALTER TABLE `sales` DROP COLUMN `{col}`")

        # Backfill one stock unit per existing variant that has none, carrying the
        # legacy per-variant quantity. Idempotent via NOT EXISTS.
        conn.exec_driver_sql(
            "INSERT INTO `product_variant_stocks` (`variant_id`, `attributes`, `quantity`) "
            "SELECT pv.id, NULL, pv.quantity FROM `product_variants` pv "
            "WHERE NOT EXISTS (SELECT 1 FROM `product_variant_stocks` s "
            "WHERE s.variant_id = pv.id)"
        )

        # sale_holds now reserves a STOCK unit, not a variant. Holds are transient
        # (2h TTL), so an old-schema table is simply dropped and recreated.
        if _has_col("sale_holds", "variant_id"):
            conn.exec_driver_sql("DROP TABLE `sale_holds`")
            Base.metadata.tables["sale_holds"].create(bind=conn)

        # sale_holds.flexible — marks a product-code-scanned line (coding editable).
        if not _has_col("sale_holds", "flexible"):
            conn.exec_driver_sql(
                "ALTER TABLE `sale_holds` "
                "ADD COLUMN `flexible` TINYINT(1) NOT NULL DEFAULT 0 AFTER `quantity`"
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
