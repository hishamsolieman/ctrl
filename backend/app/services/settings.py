"""Helpers for DB-backed key/value settings (currency, brand, ...)."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.setting import Setting

CURRENCY_KEY = "currency"
DEFAULT_CURRENCY = "EGP"

PHONE_REGEX_KEY = "customer_phone_regex"
DEFAULT_PHONE_REGEX = r"^(?:\+20|0)1[0125]\d{8}$"

BRANCH_ADDRESS_KEY = "branch_address"
REPORT_LOGO_KEY = "report_logo"
INVOICE_LOGO_KEY = "invoice_logo"
INVOICE_LANGUAGE_KEY = "invoice_language"
DEFAULT_INVOICE_LANGUAGE = "auto"
INVOICE_LANGUAGES = ("auto", "en", "ar")

BACKUP_DURATION_KEY = "backup_duration_hours"
DEFAULT_BACKUP_DURATION = "24"
BACKUP_LAST_AT_KEY = "backup_last_at"


def get_setting(db: Session, key: str, default: str = "") -> str:
    row = db.get(Setting, key)
    return row.value if row and row.value else default


def set_settings(db: Session, values: dict[str, str], *, commit: bool = True) -> None:
    for key, value in values.items():
        db.merge(Setting(key=key, value="" if value is None else str(value)))
    if commit:
        db.commit()


def set_setting(db: Session, key: str, value: str) -> None:
    set_settings(db, {key: value})


def get_currency(db: Session) -> str:
    return get_setting(db, CURRENCY_KEY, DEFAULT_CURRENCY)


def get_backup_duration_hours(db: Session) -> int:
    raw = get_setting(db, BACKUP_DURATION_KEY, DEFAULT_BACKUP_DURATION)
    try:
        n = int(str(raw).strip())
        return n if n >= 1 else int(DEFAULT_BACKUP_DURATION)
    except ValueError:
        return int(DEFAULT_BACKUP_DURATION)


def get_general_settings(db: Session) -> dict:
    return {
        "branch_address": get_setting(db, BRANCH_ADDRESS_KEY, ""),
        "report_logo": get_setting(db, REPORT_LOGO_KEY, ""),
        "invoice_logo": get_setting(db, INVOICE_LOGO_KEY, ""),
        "customer_phone_regex": get_setting(db, PHONE_REGEX_KEY, DEFAULT_PHONE_REGEX),
        "currency": get_currency(db),
        "invoice_language": get_setting(db, INVOICE_LANGUAGE_KEY, DEFAULT_INVOICE_LANGUAGE),
        "backup_duration_hours": get_backup_duration_hours(db),
    }
