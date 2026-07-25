"""Products API: paginated filtered listing, CRUD (variants, soft delete),
image upload, export/import."""
from __future__ import annotations

import csv
import io
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user, require_role
from app.core.database import get_db
from app.models.attribute import AttributeValue
from app.models.product import Product, ProductImage, ProductVariant
from app.models.user import User
from app.schemas.product import ProductInput, ProductOut, VariantInput
from app.services.codes import (
    code_exists,
    generate_variant_code,
    is_valid_code,
    normalize_code,
)
from app.services.logging import log_action
from app.services.settings import get_currency

router = APIRouter(prefix="/products", tags=["products"])

UPLOAD_DIR = Path(__file__).resolve().parents[3] / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _live_variants(product: Product) -> list[ProductVariant]:
    return [v for v in product.variants if not v.is_deleted]


def _serialize(product: Product) -> dict[str, Any]:
    variants = _live_variants(product)
    images: list[dict] = []
    for v in variants:
        images.extend({"id": img.id, "url": img.url} for img in v.images)
    return {
        "id": product.id,
        "name": product.name,
        "description": product.description,
        "category_id": product.category_id,
        "category_name_en": product.category.name_en if product.category else None,
        "category_name_ar": product.category.name_ar if product.category else None,
        "supplier_id": product.supplier_id,
        "supplier_name": product.supplier.name if product.supplier else None,
        "supplier_price": float(product.supplier_price or 0),
        "min_price": float(product.min_price or 0),
        "price": float(product.price or 0),
        "note": product.note,
        "tags": product.tags,
        "variants": [
            {
                "id": v.id,
                "code": v.code,
                "attributes": v.attributes or {},
                "images": [{"id": img.id, "url": img.url} for img in v.images],
            }
            for v in variants
        ],
        "images": images,
        "created_at": product.created_at,
    }


def _matches_search(product: Product, q: str) -> bool:
    ql = q.lower()
    parts = [product.name or "", product.description or "", product.note or ""]
    parts.extend(str(t) for t in (product.tags or []))
    parts.extend(v.code for v in _live_variants(product))  # search by code
    return any(ql in p.lower() for p in parts)


def _matches_attributes(product: Product, wanted: dict[int, set[int]]) -> bool:
    """True if the product has a variant satisfying every selected attribute."""
    for v in _live_variants(product):
        attrs = {int(k): int(val) for k, val in (v.attributes or {}).items()}
        if all(attrs.get(aid) in vals for aid, vals in wanted.items()):
            return True
    return False


def _apply_variant_images(variant: ProductVariant, urls: list[str] | None):
    variant.images.clear()
    for idx, url in enumerate((urls or [])[:5]):
        variant.images.append(ProductImage(url=url, sort_order=idx))


def _set_variant_code(db: Session, variant: ProductVariant, raw_code: str | None):
    if raw_code and raw_code.strip():
        code = normalize_code(raw_code)
        if not is_valid_code(code):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Code must be at least 3 alphanumeric characters",
            )
        if code_exists(db, code, exclude_variant_id=variant.id):
            raise HTTPException(status.HTTP_409_CONFLICT, f"Code '{code}' is already in use")
        variant.code = code
    elif not variant.code:
        variant.code = generate_variant_code(db)


# --------------------------------------------------------------------------- #
# List (paginated) + facets
# --------------------------------------------------------------------------- #
@router.get("")
def list_products(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
    q: str | None = Query(None),
    category_ids: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    sort: str = Query("newest"),
    price_min: float | None = Query(None),
    price_max: float | None = Query(None),
    attr_values: str | None = Query(None, description="comma-separated attribute_value ids"),
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1, le=100),
):
    base = (
        db.query(Product)
        .options(
            selectinload(Product.variants).selectinload(ProductVariant.images),
            selectinload(Product.category),
            selectinload(Product.supplier),
        )
        .filter(Product.is_deleted.is_(False))
    )
    all_products = base.all()

    max_price = max((float(p.price or 0) for p in all_products), default=0.0) or 1000.0

    rows = all_products
    if category_ids:
        ids = {int(x) for x in category_ids.split(",") if x.strip().isdigit()}
        if ids:
            rows = [p for p in rows if p.category_id in ids]
    if price_min is not None:
        rows = [p for p in rows if float(p.price or 0) >= price_min]
    if price_max is not None:
        rows = [p for p in rows if float(p.price or 0) <= price_max]
    df, dt = _parse_dt(date_from), _parse_dt(date_to)
    if df:
        rows = [p for p in rows if p.created_at and p.created_at >= df]
    if dt:
        rows = [p for p in rows if p.created_at and p.created_at <= dt]
    if q:
        rows = [p for p in rows if _matches_search(p, q)]
    if attr_values:
        value_ids = [int(x) for x in attr_values.split(",") if x.strip().isdigit()]
        if value_ids:
            # Group selected values by their attribute.
            vmap = {
                v.id: v.attribute_id
                for v in db.query(AttributeValue).filter(AttributeValue.id.in_(value_ids)).all()
            }
            wanted: dict[int, set[int]] = {}
            for vid in value_ids:
                aid = vmap.get(vid)
                if aid is not None:
                    wanted.setdefault(aid, set()).add(vid)
            rows = [p for p in rows if _matches_attributes(p, wanted)]

    if sort == "price_asc":
        rows.sort(key=lambda p: float(p.price or 0))
    elif sort == "price_desc":
        rows.sort(key=lambda p: float(p.price or 0), reverse=True)
    else:  # newest / popular
        rows.sort(key=lambda p: (p.created_at or datetime.min, p.id), reverse=True)

    total = len(rows)
    start = (page - 1) * page_size
    page_rows = rows[start : start + page_size]

    return {
        "items": [_serialize(p) for p in page_rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, (total + page_size - 1) // page_size),
        "currency": get_currency(db),
        "facets": {"max_price": max_price},
    }


@router.get("/{product_id}")
def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    product = (
        db.query(Product)
        .options(
            selectinload(Product.variants).selectinload(ProductVariant.images),
            selectinload(Product.category),
            selectinload(Product.supplier),
        )
        .filter(Product.id == product_id, Product.is_deleted.is_(False))
        .first()
    )
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found")
    return _serialize(product)


# --------------------------------------------------------------------------- #
# Image upload
# --------------------------------------------------------------------------- #
@router.post("/upload")
async def upload_image(
    file: UploadFile = File(...),
    _user: User = Depends(require_role("Moderator")),
):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_IMAGE_EXT:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unsupported image type")
    name = f"{uuid.uuid4().hex}{ext}"
    (UPLOAD_DIR / name).write_bytes(await file.read())
    return {"url": f"/uploads/{name}"}


# --------------------------------------------------------------------------- #
# Export / Import
# --------------------------------------------------------------------------- #
_EXPORT_COLUMNS = [
    "name", "description", "category_id", "supplier_id", "supplier_price",
    "min_price", "price", "note", "tags", "code", "attributes", "image_urls",
]


@router.get("/export/csv")
def export_products(
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
    request: Request = None,  # type: ignore[assignment]
):
    products = (
        db.query(Product)
        .options(
            selectinload(Product.variants).selectinload(ProductVariant.images),
        )
        .filter(Product.is_deleted.is_(False))
        .all()
    )
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(_EXPORT_COLUMNS)
    for p in products:
        for v in _live_variants(p):
            writer.writerow([
                p.name, p.description or "", p.category_id or "", p.supplier_id or "",
                float(p.supplier_price or 0), float(p.min_price or 0), float(p.price or 0),
                p.note or "", json.dumps(p.tags or [], ensure_ascii=False),
                v.code, json.dumps(v.attributes or {}, ensure_ascii=False),
                json.dumps([img.url for img in v.images], ensure_ascii=False),
            ])
    log_action(db, action="product.export", user_id=user.id, request=request)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=products.csv"},
    )


@router.post("/import/csv")
async def import_products(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
    request: Request = None,  # type: ignore[assignment]
):
    content = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(content))
    created = 0
    for row in reader:
        name = (row.get("name") or "").strip()
        if not name:
            continue

        def _num(key):
            try:
                return float(row.get(key) or 0)
            except ValueError:
                return 0.0

        def _json(key, default):
            try:
                return json.loads(row.get(key) or "null") or default
            except (ValueError, TypeError):
                return default

        def _int(key):
            val = (row.get(key) or "").strip()
            return int(val) if val.isdigit() else None

        product = Product(
            name=name,
            description=(row.get("description") or "").strip() or None,
            category_id=_int("category_id"),
            supplier_id=_int("supplier_id"),
            supplier_price=_num("supplier_price"),
            min_price=_num("min_price"),
            price=_num("price"),
            note=(row.get("note") or "").strip() or None,
            tags=_json("tags", []),
        )
        variant = ProductVariant(attributes=_json("attributes", {}))
        raw_code = (row.get("code") or "").strip()
        code = normalize_code(raw_code)
        variant.code = code if (code and is_valid_code(code) and not code_exists(db, code)) \
            else generate_variant_code(db)
        for i, url in enumerate(_json("image_urls", [])[:5]):
            variant.images.append(ProductImage(url=url, sort_order=i))
        product.variants.append(variant)
        db.add(product)
        db.flush()
        created += 1
    db.commit()
    log_action(db, action="product.import", user_id=user.id,
               details={"created": created}, request=request)
    return {"created": created}


# --------------------------------------------------------------------------- #
# Create / Update / Soft-delete
# --------------------------------------------------------------------------- #
def _norm_attrs(attrs: dict[str, int] | None) -> dict[str, int]:
    return {str(k): int(v) for k, v in (attrs or {}).items()}


@router.post("", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
def create_product(
    payload: ProductInput,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    product = Product(
        name=payload.name,
        description=payload.description,
        category_id=payload.category_id,
        supplier_id=payload.supplier_id,
        supplier_price=payload.supplier_price,
        min_price=payload.min_price,
        price=payload.price,
        note=payload.note,
        tags=payload.tags,
    )
    db.add(product)
    db.flush()
    for vin in payload.variants:
        variant = ProductVariant(product_id=product.id, attributes=_norm_attrs(vin.attributes))
        _set_variant_code(db, variant, vin.code)
        _apply_variant_images(variant, vin.image_urls)
        product.variants.append(variant)
        db.flush()
    db.commit()
    db.refresh(product)
    log_action(db, action="product.create", user_id=user.id, entity="product",
               entity_id=product.id, details={"variants": len(payload.variants)}, request=request)
    return _serialize(product)


@router.put("/{product_id}", response_model=ProductOut)
def update_product(
    product_id: int,
    payload: ProductInput,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    product = db.get(Product, product_id)
    if not product or product.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found")

    product.name = payload.name
    product.description = payload.description
    product.category_id = payload.category_id
    product.supplier_id = payload.supplier_id
    product.supplier_price = payload.supplier_price
    product.min_price = payload.min_price
    product.price = payload.price
    product.note = payload.note
    product.tags = payload.tags

    existing = {v.id: v for v in product.variants}
    keep_ids: set[int] = set()
    for vin in payload.variants:
        if vin.id and vin.id in existing:
            variant = existing[vin.id]
            variant.attributes = _norm_attrs(vin.attributes)
            _set_variant_code(db, variant, vin.code)
            _apply_variant_images(variant, vin.image_urls)
            keep_ids.add(variant.id)
        else:
            variant = ProductVariant(product_id=product.id, attributes=_norm_attrs(vin.attributes))
            _set_variant_code(db, variant, vin.code)
            _apply_variant_images(variant, vin.image_urls)
            product.variants.append(variant)
            db.flush()
            keep_ids.add(variant.id)
    # Remove variants dropped during editing.
    for vid, variant in existing.items():
        if vid not in keep_ids:
            db.delete(variant)

    db.commit()
    db.refresh(product)
    log_action(db, action="product.update", user_id=user.id, entity="product",
               entity_id=product.id, request=request)
    return _serialize(product)


@router.delete("/{product_id}")
def delete_product(
    product_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    """SOFT delete — the product is flagged, never physically removed."""
    product = db.get(Product, product_id)
    if not product or product.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found")
    product.is_deleted = True
    product.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    log_action(db, action="product.delete", user_id=user.id, entity="product",
               entity_id=product.id, request=request)
    return {"ok": True, "id": product_id}
