"""HWID lock for the Tauri desktop shell.

``settings.licensed_hwid`` holds an AES-256-GCM token (from tools/hwid/encrypt_hwid.py).
At boot the desktop app decrypts that token and compares it to this PC's
motherboard+processor id. The web client never uses this.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.crypto import decrypt
from app.services.settings import get_setting

LICENSED_HWID_KEY = "licensed_hwid"


def normalize_hwid(raw: str | None) -> str:
    return "".join((raw or "").split()).upper()


def is_licensed(db: Session, raw: str) -> bool:
    want = normalize_hwid(raw)
    stored = (get_setting(db, LICENSED_HWID_KEY, "") or "").strip()
    if not want or not stored:
        return False
    try:
        got = normalize_hwid(decrypt(stored))
    except Exception:
        return False
    return bool(got and got == want)
