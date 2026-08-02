"""Product & variant codes.

Rules (per spec):
- Exactly 8 alphanumeric characters, uppercase (case-insensitive on input).
- Auto-generated codes are random (never sequential/"successive").
- The user may supply a custom code as long as it meets the criteria.
- A product carries its own code (its identifier); each variant carries a
  separate code that differs from the product code.
"""
from __future__ import annotations

import re
import secrets
import string

from sqlalchemy.orm import Session

from app.models.product import Product, ProductVariant

ALPHABET = string.ascii_uppercase + string.digits  # A-Z 0-9
CODE_LEN = 8  # codes are exactly 8 characters
MAX_LEN = CODE_LEN
_CODE_RE = re.compile(rf"^[A-Z0-9]{{{CODE_LEN}}}$")


def normalize_code(raw: str) -> str:
    return (raw or "").strip().upper()


def is_valid_code(code: str) -> bool:
    return bool(_CODE_RE.match(code or ""))


def code_exists(db: Session, code: str, exclude_variant_id: int | None = None) -> bool:
    q = db.query(ProductVariant.id).filter(ProductVariant.code == code)
    if exclude_variant_id is not None:
        q = q.filter(ProductVariant.id != exclude_variant_id)
    return db.query(q.exists()).scalar()


def product_code_exists(db: Session, code: str, exclude_product_id: int | None = None) -> bool:
    q = db.query(Product.id).filter(Product.code == code)
    if exclude_product_id is not None:
        q = q.filter(Product.id != exclude_product_id)
    return db.query(q.exists()).scalar()


def _random_code(length: int = CODE_LEN) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(length))


def generate_variant_code(db: Session) -> str:
    """Return a fresh random (non-sequential) 8-char code, unique across variants."""
    for _ in range(80):
        code = _random_code()
        if not code_exists(db, code):
            return code
    raise RuntimeError("Could not generate a unique variant code")


def generate_product_code(db: Session) -> str:
    """Return a fresh random (non-sequential) 8-char code, unique across products."""
    for _ in range(80):
        code = _random_code()
        if not product_code_exists(db, code):
            return code
    raise RuntimeError("Could not generate a unique product code")


def generate_unique_code(db: Session) -> str:
    """Return a fresh random 8-char code unique across BOTH products and variants.

    Used to pre-fill the (locked) code field in the UI so a product code never
    collides with any existing product or variant code.
    """
    for _ in range(80):
        code = _random_code()
        if not product_code_exists(db, code) and not code_exists(db, code):
            return code
    raise RuntimeError("Could not generate a unique code")


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
    """Auto variant code: a short readable prefix from coding attribute values,
    padded with random characters to an exact length of 8 and made unique."""
    base = (compose_code_base(db, attributes_map) or "")[:4]
    for _ in range(80):
        code = f"{base}{_random_code(CODE_LEN)}"[:CODE_LEN]
        if is_valid_code(code) and not code_exists(db, code):
            return code
    return generate_variant_code(db)
