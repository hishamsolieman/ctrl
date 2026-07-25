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


def _value_token(value_en: str) -> str:
    """A short readable token from a value name, e.g. 'Red' -> 'RED', 'XL' -> 'XL'."""
    token = re.sub(r"[^A-Z0-9]", "", (value_en or "").upper())
    return token[:3]


def compose_code_base(db: Session, attributes_map: dict | None) -> str | None:
    """Build a readable code prefix from the selected values of every ``coding``
    attribute (the "AND" of size/color/... values). Returns None when no coding
    attributes apply."""
    # Imported here to avoid a circular import at module load.
    from app.models.attribute import Attribute, AttributeValue

    if not attributes_map:
        return None
    coding_attrs = (
        db.query(Attribute)
        .filter(Attribute.coding.is_(True), Attribute.is_deleted.is_(False))
        .order_by(Attribute.sort_order, Attribute.id)
        .all()
    )
    if not coding_attrs:
        return None
    parts: list[str] = []
    for a in coding_attrs:
        vid = attributes_map.get(str(a.id), attributes_map.get(a.id))
        if not vid:
            continue
        val = db.get(AttributeValue, int(vid))
        if val:
            token = _value_token(val.value_en)
            if token:
                parts.append(token)
    base = "".join(parts)
    return base or None


def make_variant_code(db: Session, attributes_map: dict | None) -> str:
    """Auto variant code: a readable prefix from coding attribute values plus a
    random suffix to guarantee global uniqueness (falls back to fully random)."""
    base = compose_code_base(db, attributes_map)
    if not base:
        return generate_variant_code(db)
    base = base[:MAX_LEN - 3]
    for _ in range(60):
        code = f"{base}{_random_code(3)}"
        if is_valid_code(code) and not code_exists(db, code):
            return code
    return generate_variant_code(db)
