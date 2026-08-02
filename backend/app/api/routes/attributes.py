"""Product attributes (type text/number/color) with bilingual values.

- Attributes & values are soft-deleted (never hard-deleted).
- An attribute in use by any product variant cannot be deleted.
- Marking an attribute required backfills existing variants with a default value
  (empty text / 0 / white colour).
- ``coding`` attributes give each value a short code that composes variant codes.
"""
from __future__ import annotations

import csv
import io
import json
import re
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
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
# Export / Import (CSV)
# --------------------------------------------------------------------------- #
_EXPORT_COLUMNS = ["name_en", "name_ar", "type", "is_required", "coding", "values"]


def _truthy(value) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


@router.get("/export/csv")
def export_attributes(
    q: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
    request: Request = None,  # type: ignore[assignment]
):
    """Export the live attributes matching the on-screen search. `values` is a
    JSON array of {value_en, value_ar, hex?} so colours keep their palette."""
    query = (
        db.query(Attribute)
        .options(selectinload(Attribute.values))
        .filter(Attribute.is_deleted.is_(False))
    )
    term = (q or "").strip()
    if term:
        like = f"%{term}%"
        query = query.filter(
            or_(Attribute.name_en.ilike(like), Attribute.name_ar.ilike(like), Attribute.key.ilike(like))
        )
    rows = query.order_by(func.lower(Attribute.name_en)).all()

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(_EXPORT_COLUMNS)
    for a in rows:
        vals = []
        for v in a.values:
            if v.is_deleted:
                continue
            item = {"value_en": v.value_en, "value_ar": v.value_ar}
            hx = (v.extra or {}).get("hex")
            if hx:
                item["hex"] = hx
            vals.append(item)
        w.writerow([
            a.name_en, a.name_ar, a.type,
            int(bool(a.is_required)), int(bool(a.coding)),
            json.dumps(vals, ensure_ascii=False),
        ])
    log_action(db, action="attribute.export", user_id=user.id, request=request)
    # UTF-8 BOM so Excel renders Arabic correctly.
    return StreamingResponse(
        iter([buf.getvalue().encode("utf-8-sig")]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=attributes.csv"},
    )


@router.post("/import/csv")
async def import_attributes(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
    request: Request = None,  # type: ignore[assignment]
):
    content = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(content))
    created = 0
    skipped = 0
    seen_en: set[str] = set()
    seen_ar: set[str] = set()
    existing = db.query(Attribute).filter(Attribute.is_deleted.is_(False)).all()
    taken_en = {(a.name_en or "").strip().lower() for a in existing}
    taken_ar = {(a.name_ar or "").strip().lower() for a in existing}

    for row in reader:
        name_en = (row.get("name_en") or "").strip()
        name_ar = (row.get("name_ar") or "").strip()
        if not name_en or not name_ar:
            continue
        ken, kar = name_en.lower(), name_ar.lower()
        # Skip names that already exist (DB) or repeat within the file.
        if ken in taken_en or kar in taken_ar or ken in seen_en or kar in seen_ar:
            skipped += 1
            continue

        atype = (row.get("type") or "text").strip().lower()
        if atype not in {"text", "number", "color"}:
            atype = "text"
        try:
            raw_vals = json.loads(row.get("values") or "[]")
        except (ValueError, TypeError):
            raw_vals = []

        attr = Attribute(
            key=_unique_key(db, name_en),
            type=atype,
            name_en=name_en,
            name_ar=name_ar,
            is_required=_truthy(row.get("is_required")),
            coding=_truthy(row.get("coding")),
        )
        db.add(attr)
        db.flush()

        vseen_en: set[str] = set()
        vseen_ar: set[str] = set()
        for i, rv in enumerate(raw_vals if isinstance(raw_vals, list) else []):
            if not isinstance(rv, dict):
                continue
            ven = (rv.get("value_en") or "").strip()
            var = (rv.get("value_ar") or "").strip()
            if not ven or not var:
                continue
            if ven.lower() in vseen_en or var.lower() in vseen_ar:
                continue  # drop in-attribute duplicate values
            vseen_en.add(ven.lower())
            vseen_ar.add(var.lower())
            extra = None
            if atype == "color":
                hx = (rv.get("hex") or "").strip()
                if hx:
                    extra = {"hex": hx}
            attr.values.append(AttributeValue(value_en=ven, value_ar=var, extra=extra, sort_order=i))

        if attr.is_required:
            _backfill_required(db, attr)

        seen_en.add(ken)
        seen_ar.add(kar)
        created += 1

    db.commit()
    log_action(db, action="attribute.import", user_id=user.id,
               details={"created": created, "skipped": skipped}, request=request)
    return {"created": created, "skipped": skipped}


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


class ValueIn(BaseModel):
    """A single value to append to an existing attribute. For `number` types the
    number is carried in `value_en`; for `color` types `hex` is the palette."""
    value_en: str = Field(default="", max_length=255)
    value_ar: str = Field(default="", max_length=255)
    hex: str | None = None


@router.post("/{attribute_id}/values", status_code=status.HTTP_201_CREATED)
def add_attribute_value(
    attribute_id: int,
    payload: ValueIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    """Append a value to an existing attribute (used from the product modal)."""
    attr = db.get(Attribute, attribute_id)
    if not attr or attr.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attribute not found")

    if attr.type == "number":
        num = (payload.value_en or "").strip()
        if not num:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "products.attrs.modal.valueRequired")
        value_en = value_ar = num
        extra = None
    elif attr.type == "color":
        if not payload.value_en.strip() or not payload.value_ar.strip():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "products.attrs.modal.valueRequired")
        value_en, value_ar = payload.value_en.strip(), payload.value_ar.strip()
        extra = {"hex": (payload.hex or "#8eff19")}
    else:  # text
        if not payload.value_en.strip() or not payload.value_ar.strip():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "products.attrs.modal.valueRequired")
        value_en, value_ar = payload.value_en.strip(), payload.value_ar.strip()
        extra = None

    # Values must be unique within the attribute (EN, AR, and hex for colours).
    en_l, ar_l = value_en.lower(), value_ar.lower()
    hex_l = (extra or {}).get("hex", "").lower() if extra else ""
    for v in attr.values:
        if v.is_deleted:
            continue
        if (v.value_en or "").strip().lower() == en_l:
            raise HTTPException(status.HTTP_409_CONFLICT, "products.attrs.errors.dupValueEn")
        if (v.value_ar or "").strip().lower() == ar_l:
            raise HTTPException(status.HTTP_409_CONFLICT, "products.attrs.errors.dupValueAr")
        if attr.type == "color" and ((v.extra or {}).get("hex") or "").strip().lower() == hex_l:
            raise HTTPException(status.HTTP_409_CONFLICT, "products.attrs.errors.dupColorHex")

    nv = AttributeValue(value_en=value_en, value_ar=value_ar, extra=extra, sort_order=len(attr.values))
    attr.values.append(nv)
    db.commit()
    db.refresh(attr)
    db.refresh(nv)
    log_action(db, action="attribute.value.add", user_id=user.id, entity="attribute",
               entity_id=attr.id, request=request)
    used_attr_ids, _ = _usage(db)
    return {"attribute": _serialize(attr, used_attr_ids), "value_id": nv.id}


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
