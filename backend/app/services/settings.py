"""Helpers for DB-backed key/value settings (currency, brand, ...)."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.setting import Setting

CURRENCY_KEY = "currency"
DEFAULT_CURRENCY = "EGP"


def get_setting(db: Session, key: str, default: str = "") -> str:
    row = db.get(Setting, key)
    return row.value if row and row.value else default


def set_setting(db: Session, key: str, value: str) -> None:
    db.merge(Setting(key=key, value=value))
    db.commit()


def get_currency(db: Session) -> str:
    return get_setting(db, CURRENCY_KEY, DEFAULT_CURRENCY)
