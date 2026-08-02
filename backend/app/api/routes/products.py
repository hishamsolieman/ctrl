"""Products API: paginated filtered listing, CRUD (variants, soft delete),
image upload, export/import."""
from __future__ import annotations

import csv
import io
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user, require_role
from app.core.database import get_db
from app.models.attribute import Attribute, AttributeValue
from app.models.category import Category
from app.models.product import Product, ProductImage, ProductVariant
from app.models.supplier import Supplier
from app.models.user import User
from app.schemas.product import ProductInput, ProductOut, VariantInput
from app.services.codes import (
    CODE_LEN,
    code_exists,
    generate_product_code,
    generate_unique_code,
    generate_variant_code,
    is_valid_code,
    make_variant_code,
    normalize_code,
    product_code_exists,
)
from app.services.logging import log_action
from app.services.settings import get_currency

router = APIRouter(prefix="/products", tags=["products"])


class ProductBulkUpdate(BaseModel):
    ids: list[int] = Field(min_length=1)
    category_id: int | None = None
    supplier_id: int | None = None
    supplier_price: float | None = None
    min_price: float | None = None
    price: float | None = None
    note: str | None = None


class ProductBulkDelete(BaseModel):
    ids: list[int] = Field(min_length=1)


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


def _product_qty(product: Product) -> int:
    return sum(int(v.quantity or 0) for v in _live_variants(product))


def _image_id(url: str) -> int | str:
    """Export helper: a DB-backed image ('/images/42') exports as just its id (42).

    Anything else (legacy '/uploads/...' or an absolute URL) is left untouched.
    """
    m = re.fullmatch(r"/images/(\d+)", (url or "").strip())
    return int(m.group(1)) if m else url


def _image_url(ref: Any) -> str:
    """Import helper: a bare id (42 or '42') becomes '/images/42'; a path stays as-is."""
    s = str(ref).strip()
    if s.isdigit():
        return f"/images/{s}"
    return s


def _serialize(product: Product) -> dict[str, Any]:
    variants = _live_variants(product)
    images: list[dict] = []
    for v in variants:
        images.extend({"id": img.id, "url": img.url} for img in v.images)
    # Fallback: if the product has no images, use its category's image.
    if not images and product.category and product.category.image_id:
        images = [{"id": 0, "url": f"/images/{product.category.image_id}"}]
    return {
        "id": product.id,
        "code": product.code,
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
        "attributes": product.attributes or {},
        "quantity": sum(int(v.quantity or 0) for v in variants),
        "variants": [
            {
                "id": v.id,
                "code": v.code,
                "attributes": v.attributes or {},
                "images": [{"id": img.id, "url": img.url} for img in v.images],
                "quantity": int(v.quantity or 0),
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


def _matches_attributes(
    product: Product, wanted: dict[int, set[int]], coding_ids: set[int]
) -> bool:
    """A product matches when:
    - every selected GLOBAL (non-coding) attribute is satisfied by the product's
      shared selection, AND
    - the selected CODING attributes are all satisfied by a single variant.
    """
    global_wanted = {aid: vals for aid, vals in wanted.items() if aid not in coding_ids}
    coding_wanted = {aid: vals for aid, vals in wanted.items() if aid in coding_ids}

    prod_attrs = {int(k): int(v) for k, v in (product.attributes or {}).items()}
    if not all(prod_attrs.get(aid) in vals for aid, vals in global_wanted.items()):
        return False

    if not coding_wanted:
        return True
    for v in _live_variants(product):
        attrs = {int(k): int(val) for k, val in (v.attributes or {}).items()}
        if all(attrs.get(aid) in vals for aid, vals in coding_wanted.items()):
            return True
    return False


def _apply_variant_images(variant: ProductVariant, urls: list[str] | None):
    variant.images.clear()
    for idx, url in enumerate((urls or [])[:5]):
        variant.images.append(ProductImage(url=url, sort_order=idx))


def _set_product_code(db: Session, product: Product, raw_code: str | None):
    if raw_code and raw_code.strip():
        code = normalize_code(raw_code)
        if not is_valid_code(code):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "products.modal.codeInvalid")
        if product_code_exists(db, code, exclude_product_id=product.id):
            raise HTTPException(status.HTTP_409_CONFLICT, "products.modal.codeInUse")
        product.code = code
    elif not product.code:
        product.code = generate_product_code(db)


def _set_variant_code(db: Session, variant: ProductVariant, raw_code: str | None):
    if raw_code and raw_code.strip():
        code = normalize_code(raw_code)
        if not is_valid_code(code):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "products.modal.codeInvalid")
        if code_exists(db, code, exclude_variant_id=variant.id):
            raise HTTPException(status.HTTP_409_CONFLICT, "products.modal.codeInUse")
        variant.code = code
    elif not variant.code:
        # Auto code: readable prefix from coding attribute values + random (8 chars).
        variant.code = make_variant_code(db, variant.attributes)


# --------------------------------------------------------------------------- #
# List (paginated) + facets
# --------------------------------------------------------------------------- #
@router.get("")
def list_products(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
    q: str | None = Query(None),
    stock: str = Query("all", description="all | in | out"),
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
    if stock == "in":
        rows = [p for p in rows if _product_qty(p) > 0]
    elif stock == "out":
        rows = [p for p in rows if _product_qty(p) <= 0]
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
            coding_ids = {
                a.id for a in db.query(Attribute.id, Attribute.coding)
                .filter(Attribute.coding.is_(True)).all()
            }
            rows = [p for p in rows if _matches_attributes(p, wanted, coding_ids)]

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


@router.get("/check-name")
def check_product_name(
    name: str = Query(...),
    exclude_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """True when another (non-deleted) product already uses this exact name.
    A name is not an identifier, so duplicates are allowed — this only warns."""
    term = (name or "").strip().lower()
    if not term:
        return {"exists": False}
    q = db.query(Product.id).filter(
        Product.is_deleted.is_(False), func.lower(Product.name) == term
    )
    if exclude_id is not None:
        q = q.filter(Product.id != exclude_id)
    return {"exists": db.query(q.exists()).scalar()}


@router.get("/generate-code")
def generate_code(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """A fresh, unique 8-char code to pre-fill the (locked) code field."""
    return {"code": generate_unique_code(db)}


@router.get("/check-code")
def check_code(
    code: str = Query(...),
    kind: str = Query("product", description="product | variant"),
    exclude_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Validate a (possibly user-edited) code: is it well-formed and free?

    Codes are checked for global uniqueness (across both products and variants)
    so an edited product code can never clash with an existing variant, and
    vice-versa.
    """
    norm = normalize_code(code)
    if not is_valid_code(norm):
        return {"valid": False, "exists": False}
    if kind == "variant":
        exists = code_exists(db, norm, exclude_variant_id=exclude_id) or product_code_exists(db, norm)
    else:
        exists = product_code_exists(db, norm, exclude_product_id=exclude_id) or code_exists(db, norm)
    return {"valid": True, "exists": exists}


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
#
# One CSV row per variant. Products are grouped by `product_code` (the product's
# identifier). Category/supplier/attributes are exported as TEXT names, matched
# back to ids case-insensitively on import. Images export as bare DB ids.
# --------------------------------------------------------------------------- #
_EXPORT_COLUMNS = [
    "product_code", "name", "description", "category", "supplier",
    "supplier_price", "min_price", "price", "note", "tags",
    "global_attributes", "variant_code", "variant_attributes", "quantity", "image_ids",
]


def _attrs_to_text(db: Session, attrs_map: dict | None) -> dict[str, str]:
    """{attr_id: value_id} -> {attribute_name_en: value_name_en}."""
    out: dict[str, str] = {}
    for k, vid in (attrs_map or {}).items():
        attr = db.get(Attribute, int(k))
        val = db.get(AttributeValue, int(vid)) if vid else None
        if attr and val:
            out[attr.name_en] = val.value_en
    return out


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
            selectinload(Product.category),
            selectinload(Product.supplier),
        )
        .filter(Product.is_deleted.is_(False))
        .all()
    )
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(_EXPORT_COLUMNS)
    for p in products:
        cat = p.category.name_en if p.category else ""
        sup = p.supplier.name if p.supplier else ""
        global_txt = json.dumps(_attrs_to_text(db, p.attributes), ensure_ascii=False)
        for v in _live_variants(p):
            writer.writerow([
                p.code, p.name, p.description or "", cat, sup,
                float(p.supplier_price or 0), float(p.min_price or 0), float(p.price or 0),
                p.note or "", json.dumps(p.tags or [], ensure_ascii=False),
                global_txt, v.code,
                json.dumps(_attrs_to_text(db, v.attributes), ensure_ascii=False),
                int(v.quantity or 0),
                # Only DB-backed image ids — never a filesystem path.
                json.dumps([i for img in v.images if isinstance(i := _image_id(img.url), int)],
                           ensure_ascii=False),
            ])
    log_action(db, action="product.export", user_id=user.id, request=request)
    return StreamingResponse(
        iter([buf.getvalue().encode("utf-8-sig")]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=products.csv"},
    )


def _import_lookups(db: Session):
    """Build case-insensitive name->id maps for categories, suppliers, attributes
    and their values (used to resolve the text columns back to ids)."""
    cat_by_name: dict[str, int] = {}
    for c in db.query(Category).all():
        for nm in (c.name_en, c.name_ar):
            if nm:
                cat_by_name[nm.strip().lower()] = c.id
    sup_by_name = {
        (s.name or "").strip().lower(): s.id for s in db.query(Supplier).all() if s.name
    }
    attr_by_name: dict[str, int] = {}
    val_by_attr: dict[int, dict[str, int]] = {}
    attrs = (
        db.query(Attribute)
        .options(selectinload(Attribute.values))
        .filter(Attribute.is_deleted.is_(False))
        .all()
    )
    for a in attrs:
        for nm in (a.name_en, a.name_ar):
            if nm:
                attr_by_name[nm.strip().lower()] = a.id
        vmap: dict[str, int] = {}
        for v in a.values:
            if v.is_deleted:
                continue
            for vv in (v.value_en, v.value_ar):
                if vv:
                    vmap[vv.strip().lower()] = v.id
        val_by_attr[a.id] = vmap
    return cat_by_name, sup_by_name, attr_by_name, val_by_attr


def _text_to_attrs(text_map: dict, attr_by_name: dict, val_by_attr: dict) -> dict[str, int]:
    """{attribute_name: value_name} -> {attr_id: value_id} (case-insensitive)."""
    out: dict[str, int] = {}
    for aname, vname in (text_map or {}).items():
        aid = attr_by_name.get((aname or "").strip().lower())
        if not aid:
            continue
        vid = val_by_attr.get(aid, {}).get((str(vname) or "").strip().lower())
        if vid:
            out[str(aid)] = vid
    return out


@router.post("/import/csv")
async def import_products(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
    request: Request = None,  # type: ignore[assignment]
):
    content = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(content))
    cat_by_name, sup_by_name, attr_by_name, val_by_attr = _import_lookups(db)

    created = 0   # new products inserted
    updated = 0   # existing products matched by code
    variants = 0  # variants inserted
    session_products: dict[str, Product] = {}  # product_code -> Product (this import)

    for row in reader:
        name = (row.get("name") or "").strip()
        pcode = normalize_code(row.get("product_code") or "")
        if not name and not pcode:
            continue

        def _num(key):
            try:
                return round(float(row.get(key) or 0), 2)
            except (ValueError, TypeError):
                return 0.0

        def _int(key):
            try:
                return max(0, int(float(row.get(key) or 0)))
            except (ValueError, TypeError):
                return 0

        def _json(key, default):
            try:
                return json.loads(row.get(key) or "null") or default
            except (ValueError, TypeError):
                return default

        cat_id = cat_by_name.get((row.get("category") or "").strip().lower())
        sup_id = sup_by_name.get((row.get("supplier") or "").strip().lower())
        global_attrs = _text_to_attrs(_json("global_attributes", {}), attr_by_name, val_by_attr)
        variant_attrs = _text_to_attrs(_json("variant_attributes", {}), attr_by_name, val_by_attr)

        # Resolve the product by code: reuse within this import, then the DB.
        # Match regardless of is_deleted — the code column is UNIQUE, so a
        # soft-deleted product still owns its code; we revive it on re-import
        # instead of colliding with the reserved code.
        product = session_products.get(pcode) if pcode else None
        first_occurrence = product is None
        if product is None and pcode and is_valid_code(pcode):
            product = db.query(Product).filter(Product.code == pcode).first()

        if product is None:
            product = Product(name=name or "Unnamed")
            _set_product_code(db, product, pcode if (pcode and is_valid_code(pcode)) else None)
            db.add(product)
            created += 1
        elif first_occurrence:
            if product.is_deleted:
                product.is_deleted = False  # revive a previously-deleted product
            updated += 1
        # (Re)apply shared fields from the row.
        if name:
            product.name = name
        product.description = (row.get("description") or "").strip() or None
        product.category_id = cat_id
        product.supplier_id = sup_id
        product.supplier_price = _num("supplier_price")
        product.min_price = _num("min_price")
        product.price = _num("price")
        product.note = (row.get("note") or "").strip() or None
        product.tags = _json("tags", [])
        product.attributes = global_attrs
        db.flush()
        session_products[product.code] = product

        # Resolve the variant: update an existing one on THIS product, else add.
        vcode = normalize_code(row.get("variant_code") or "")
        variant = None
        if vcode and is_valid_code(vcode):
            match = db.query(ProductVariant).filter(ProductVariant.code == vcode).first()
            if match and match.product_id == product.id:
                variant = match
                if getattr(variant, "is_deleted", False):
                    variant.is_deleted = False  # revive a previously-deleted variant
        if variant is None:
            variant = ProductVariant(product_id=product.id, attributes=variant_attrs)
            product.variants.append(variant)
            if vcode and is_valid_code(vcode) and not code_exists(db, vcode):
                variant.code = vcode
            else:
                variant.code = make_variant_code(db, variant_attrs)
            variants += 1
        variant.attributes = variant_attrs
        variant.quantity = _int("quantity")

        raw_images = _json("image_ids", None)
        if raw_images is None:
            raw_images = _json("image_urls", [])  # backward-compat with older exports
        _apply_variant_images(variant, [_image_url(r) for r in (raw_images or [])[:5]])
        db.flush()

    db.commit()
    log_action(db, action="product.import", user_id=user.id,
               details={"created": created, "updated": updated, "variants": variants}, request=request)
    return {"created": created, "updated": updated, "variants": variants}


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
        attributes=_norm_attrs(payload.attributes),
    )
    _set_product_code(db, product, payload.code)
    db.add(product)
    db.flush()
    for vin in payload.variants:
        variant = ProductVariant(
            product_id=product.id,
            attributes=_norm_attrs(vin.attributes),
            quantity=vin.quantity,
        )
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

    _set_product_code(db, product, payload.code)
    product.name = payload.name
    product.description = payload.description
    product.category_id = payload.category_id
    product.supplier_id = payload.supplier_id
    product.supplier_price = payload.supplier_price
    product.min_price = payload.min_price
    product.price = payload.price
    product.note = payload.note
    product.tags = payload.tags
    product.attributes = _norm_attrs(payload.attributes)

    existing = {v.id: v for v in product.variants}
    keep_ids: set[int] = set()
    for vin in payload.variants:
        if vin.id and vin.id in existing:
            variant = existing[vin.id]
            variant.attributes = _norm_attrs(vin.attributes)
            variant.quantity = vin.quantity
            _set_variant_code(db, variant, vin.code)
            _apply_variant_images(variant, vin.image_urls)
            keep_ids.add(variant.id)
        else:
            variant = ProductVariant(
                product_id=product.id,
                attributes=_norm_attrs(vin.attributes),
                quantity=vin.quantity,
            )
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


@router.post("/clear-all")
def clear_all_products(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Admin")),
):
    """Soft-delete EVERY product (empties the store). Never a physical delete."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    rows = db.query(Product).filter(Product.is_deleted.is_(False)).all()
    for p in rows:
        p.is_deleted = True
        p.deleted_at = now
    db.commit()
    log_action(db, action="product.clear_all", user_id=user.id,
               details={"count": len(rows)}, request=request)
    return {"ok": True, "count": len(rows)}


@router.post("/bulk-update")
def bulk_update_products(
    payload: ProductBulkUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    """Apply the provided (enabled) fields to every selected product."""
    sent = [f for f in payload.model_fields_set if f != "ids"]
    if not sent:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "products.bulk.noFields")
    rows = (
        db.query(Product)
        .filter(Product.id.in_(payload.ids), Product.is_deleted.is_(False))
        .all()
    )
    for p in rows:
        for f in sent:
            val = getattr(payload, f)
            if f == "note":
                val = (val or "").strip() or None
            elif f in ("supplier_price", "min_price", "price") and val is not None:
                val = round(float(val), 2)
            setattr(p, f, val)
    db.commit()
    log_action(db, action="product.bulk_update", user_id=user.id, entity="product",
               details={"ids": payload.ids, "fields": sent}, request=request)
    return {"updated": len(rows), "fields": sent}


@router.post("/bulk-delete")
def bulk_delete_products(
    payload: ProductBulkDelete,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    """Soft-delete the selected products (never a physical delete)."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    rows = (
        db.query(Product)
        .filter(Product.id.in_(payload.ids), Product.is_deleted.is_(False))
        .all()
    )
    for p in rows:
        p.is_deleted = True
        p.deleted_at = now
    db.commit()
    log_action(db, action="product.bulk_delete", user_id=user.id, entity="product",
               details={"deleted": [p.id for p in rows]}, request=request)
    return {"deleted": [p.id for p in rows]}


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
