"""Product attributes (type text/number/color) with bilingual values.

- Attributes & values are soft-deleted (never hard-deleted).
- An attribute in use by any product variant cannot be deleted.
- Marking an attribute required backfills existing variants with a default value
  (empty text / 0 / white colour).
- ``coding`` attributes give each value a short code that composes variant codes.
"""
from __future__ import annotations

import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user, require_role
from app.core.database import get_db
from app.models.attribute import Attribute, AttributeValue
from app.models.product import Product, ProductVariant
from app.models.user import User
from app.schemas.attribute import AttributeIn, AttributeOut
from app.services.logging import log_action

router = APIRouter(prefix="/attributes", tags=["attributes"])


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", (name or "").strip().lower()).strip("_")
    return slug or "attr"


def _unique_key(db: Session, base: str, exclude_id: int | None = None) -> str:
    base = _slugify(base)[:60]
    key, n = base, 1
    while True:
        q = db.query(Attribute.id).filter(Attribute.key == key)
        if exclude_id is not None:
            q = q.filter(Attribute.id != exclude_id)
        if not db.query(q.exists()).scalar():
            return key
        n += 1
        key = f"{base}_{n}"[:60]


def _usage(db: Session) -> tuple[set[int], set[int]]:
    """(attribute_ids, value_ids) referenced by live (non-deleted) variants."""
    attr_ids: set[int] = set()
    val_ids: set[int] = set()
    rows = (
        db.query(ProductVariant)
        .join(Product, Product.id == ProductVariant.product_id)
        .filter(Product.is_deleted.is_(False), ProductVariant.is_deleted.is_(False))
        .all()
    )
    for v in rows:
        for k, val in (v.attributes or {}).items():
            try:
                attr_ids.add(int(k))
                if val:
                    val_ids.add(int(val))
            except (TypeError, ValueError):
                continue
    return attr_ids, val_ids


def _serialize(attr: Attribute, used_attr_ids: set[int]) -> dict:
    return {
        "id": attr.id,
        "key": attr.key,
        "type": attr.type,
        "name_en": attr.name_en,
        "name_ar": attr.name_ar,
        "is_required": attr.is_required,
        "coding": attr.coding,
        "in_use": attr.id in used_attr_ids,
        "values": [
            {
                "id": v.id,
                "value_en": v.value_en,
                "value_ar": v.value_ar,
                "extra": v.extra,
            }
            for v in attr.values
            if not v.is_deleted
        ],
    }


def _default_value(db: Session, attr: Attribute) -> AttributeValue:
    """Find or create the placeholder default value used to backfill existing
    variants when the attribute becomes required."""
    for v in attr.values:
        if not v.is_deleted and (v.extra or {}).get("default"):
            return v
    if attr.type == "number":
        ven, var, extra = "0", "0", {"default": True}
    elif attr.type == "color":
        ven, var, extra = "White", "أبيض", {"default": True, "hex": "#FFFFFF"}
    else:  # text
        ven, var, extra = "", "", {"default": True}
    dv = AttributeValue(
        attribute_id=attr.id, value_en=ven, value_ar=var, extra=extra, sort_order=999
    )
    attr.values.append(dv)
    db.flush()
    return dv


def _backfill_required(db: Session, attr: Attribute) -> None:
    """Assign the default value to every live variant that lacks this attribute."""
    if not attr.is_required:
        return
    dv = _default_value(db, attr)
    rows = (
        db.query(ProductVariant)
        .join(Product, Product.id == ProductVariant.product_id)
        .filter(Product.is_deleted.is_(False), ProductVariant.is_deleted.is_(False))
        .all()
    )
    key = str(attr.id)
    for v in rows:
        attrs = dict(v.attributes or {})
        if not attrs.get(key):
            attrs[key] = dv.id
            v.attributes = attrs  # reassign so SQLAlchemy flags the JSON dirty


def _ensure_unique_name(db: Session, name_en: str, name_ar: str, exclude_id: int | None = None) -> None:
    """Attribute names must be unique in English and in Arabic (case-insensitive),
    among non-deleted attributes."""
    en = (name_en or "").strip().lower()
    ar = (name_ar or "").strip().lower()
    q = db.query(Attribute).filter(Attribute.is_deleted.is_(False))
    if exclude_id is not None:
        q = q.filter(Attribute.id != exclude_id)
    rows = q.all()
    if any((a.name_en or "").strip().lower() == en for a in rows):
        raise HTTPException(status.HTTP_409_CONFLICT, "products.attrs.errors.nameEnUsed")
    if any((a.name_ar or "").strip().lower() == ar for a in rows):
        raise HTTPException(status.HTTP_409_CONFLICT, "products.attrs.errors.nameArUsed")


def _validate_unique_values(payload: AttributeIn) -> None:
    """Within one attribute, values must be unique in English AND in Arabic
    (case-insensitive). For colours, the hex must be unique too."""
    seen_en: set[str] = set()
    seen_ar: set[str] = set()
    seen_hex: set[str] = set()
    for v in payload.values:
        en = (v.value_en or "").strip().lower()
        ar = (v.value_ar or "").strip().lower()
        if en and en in seen_en:
            raise HTTPException(status.HTTP_409_CONFLICT, "products.attrs.errors.dupValueEn")
        if ar and ar in seen_ar:
            raise HTTPException(status.HTTP_409_CONFLICT, "products.attrs.errors.dupValueAr")
        seen_en.add(en)
        seen_ar.add(ar)
        if payload.type == "color":
            hx = ((v.extra or {}).get("hex") or "").strip().lower()
            if hx:
                if hx in seen_hex:
                    raise HTTPException(status.HTTP_409_CONFLICT, "products.attrs.errors.dupColorHex")
                seen_hex.add(hx)


def _apply_values(db: Session, attr: Attribute, payload: AttributeIn, used_value_ids: set[int]) -> None:
    existing = {v.id: v for v in attr.values}
    seen: set[int] = set()
    for i, v in enumerate(payload.values):
        if v.id and v.id in existing:
            row = existing[v.id]
            row.value_en, row.value_ar = v.value_en, v.value_ar
            row.extra = v.extra
            row.sort_order = i
            row.is_deleted = False
            seen.add(v.id)
        else:
            attr.values.append(
                AttributeValue(
                    value_en=v.value_en,
                    value_ar=v.value_ar,
                    extra=v.extra,
                    sort_order=i,
                )
            )
    # Values removed from the payload: soft-delete only if not referenced.
    for vid, row in existing.items():
        if vid not in seen and not row.is_deleted and not (row.extra or {}).get("default"):
            if vid in used_value_ids:
                continue  # in use — keep it
            row.is_deleted = True


# --------------------------------------------------------------------------- #
# Read
# --------------------------------------------------------------------------- #
@router.get("", response_model=list[AttributeOut])
def list_attributes(db: Session = Depends(get_db), _u: User = Depends(get_current_user)):
    rows = (
        db.query(Attribute)
        .options(selectinload(Attribute.values))
        .filter(Attribute.is_deleted.is_(False))
        .order_by(Attribute.name_en)
        .all()
    )
    used_attr_ids, _ = _usage(db)
    return [_serialize(a, used_attr_ids) for a in rows]


# --------------------------------------------------------------------------- #
# Create / Update / Delete
# --------------------------------------------------------------------------- #
@router.post("", response_model=AttributeOut, status_code=status.HTTP_201_CREATED)
def create_attribute(
    payload: AttributeIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    _ensure_unique_name(db, payload.name_en, payload.name_ar)
    _validate_unique_values(payload)
    attr = Attribute(
        key=_unique_key(db, payload.key or payload.name_en),
        type=payload.type,
        name_en=payload.name_en,
        name_ar=payload.name_ar,
        is_required=payload.is_required,
        coding=payload.coding,
    )
    db.add(attr)
    db.flush()
    _, used_value_ids = _usage(db)
    _apply_values(db, attr, payload, used_value_ids)
    _backfill_required(db, attr)
    db.commit()
    db.refresh(attr)
    log_action(db, action="attribute.create", user_id=user.id, entity="attribute",
               entity_id=attr.id, request=request)
    used_attr_ids, _ = _usage(db)
    return _serialize(attr, used_attr_ids)


@router.put("/{attribute_id}", response_model=AttributeOut)
def update_attribute(
    attribute_id: int,
    payload: AttributeIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    attr = db.get(Attribute, attribute_id)
    if not attr or attr.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attribute not found")
    _ensure_unique_name(db, payload.name_en, payload.name_ar, exclude_id=attribute_id)
    _validate_unique_values(payload)
    was_required = attr.is_required
    attr.type = payload.type
    attr.name_en = payload.name_en
    attr.name_ar = payload.name_ar
    attr.is_required = payload.is_required
    attr.coding = payload.coding
    _, used_value_ids = _usage(db)
    _apply_values(db, attr, payload, used_value_ids)
    if attr.is_required and not was_required:
        _backfill_required(db, attr)
    db.commit()
    db.refresh(attr)
    log_action(db, action="attribute.update", user_id=user.id, entity="attribute",
               entity_id=attr.id, request=request)
    used_attr_ids, _ = _usage(db)
    return _serialize(attr, used_attr_ids)


@router.delete("/{attribute_id}")
def delete_attribute(
    attribute_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Admin")),
):
    attr = db.get(Attribute, attribute_id)
    if not attr or attr.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attribute not found")
    used_attr_ids, _ = _usage(db)
    if attribute_id in used_attr_ids:
        raise HTTPException(status.HTTP_409_CONFLICT, "products.attrs.errors.inUse")
    attr.is_deleted = True
    attr.deleted_at = datetime.utcnow()
    db.commit()
    log_action(db, action="attribute.delete", user_id=user.id, entity="attribute",
               entity_id=attribute_id, request=request)
    return {"ok": True, "id": attribute_id}
