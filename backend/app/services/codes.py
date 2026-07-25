"""Product-variant codes.

Rules (per spec):
- Alphanumeric, uppercase (case-insensitive on input), at least 3 characters.
- Auto-generated codes are random (never sequential/"successive").
- The user may supply a custom code as long as it meets the criteria.
"""
from __future__ import annotations

import re
import secrets
import string

from sqlalchemy.orm import Session

from app.models.product import ProductVariant

ALPHABET = string.ascii_uppercase + string.digits  # A-Z 0-9
MIN_LEN = 3
MAX_LEN = 32
_GEN_LEN = 6  # default length for auto-generated codes (>= MIN_LEN)
_CODE_RE = re.compile(rf"^[A-Z0-9]{{{MIN_LEN},{MAX_LEN}}}$")


def normalize_code(raw: str) -> str:
    return (raw or "").strip().upper()


def is_valid_code(code: str) -> bool:
    return bool(_CODE_RE.match(code or ""))


def code_exists(db: Session, code: str, exclude_variant_id: int | None = None) -> bool:
    q = db.query(ProductVariant.id).filter(ProductVariant.code == code)
    if exclude_variant_id is not None:
        q = q.filter(ProductVariant.id != exclude_variant_id)
    return db.query(q.exists()).scalar()


def _random_code(length: int = _GEN_LEN) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(length))


def generate_variant_code(db: Session) -> str:
    """Return a fresh random (non-sequential) code, unique across variants."""
    for _ in range(60):
        code = _random_code()
        if not code_exists(db, code):
            return code
    raise RuntimeError("Could not generate a unique product code")
