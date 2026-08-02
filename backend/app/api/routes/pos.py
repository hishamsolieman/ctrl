"""Point-of-Sale (Cashier) API.

Responsibilities:
- Resolve products by scanned code (variant code, or a single-variant product code).
- Manage cross-cashier *stock holds* so concurrent cashier tabs cannot oversell.
- Look up customers by phone (auto-fill name) and record completed sales, which
  deduct stock and release that tab's holds.

Stock accounting
----------------
``variant.quantity`` is the physical on-hand count. A ``SaleHold`` row reserves
some of it for a given ``hold_key`` (one per cashier tab). For a given tab the
amount it may hold of a variant is::

    available = on_hand - (sum of fresh holds owned by OTHER keys)

Holds older than ``HOLD_TTL`` are treated as abandoned and ignored (and pruned
opportunistically) so a closed tab never locks stock permanently.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.attribute import AttributeValue
from app.models.customer import Customer
from app.models.payment_method import PaymentMethod
from app.models.product import Product, ProductVariant
from app.models.sale import Sale, SaleItem
from app.models.sale_hold import SaleHold
from app.models.user import User
from app.services.codes import normalize_code
from app.services.logging import log_action
from app.services.settings import get_currency

router = APIRouter(prefix="/pos", tags=["pos"])

HOLD_TTL = timedelta(hours=2)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _fresh_cutoff() -> datetime:
    return _now() - HOLD_TTL


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class ScanIn(BaseModel):
    hold_key: str = Field(min_length=1, max_length=64)
    code: str = Field(min_length=1, max_length=64)


class SetQtyIn(BaseModel):
    hold_key: str = Field(min_length=1, max_length=64)
    variant_id: int
    quantity: int = Field(ge=0)


class ReleaseIn(BaseModel):
    hold_key: str = Field(min_length=1, max_length=64)
    variant_id: int | None = None


class CustomerIn(BaseModel):
    phone: str | None = None
    name: str | None = None


class CheckoutItemIn(BaseModel):
    variant_id: int
    quantity: int = Field(ge=1)
    unit_price: float = Field(ge=0)


class CheckoutIn(BaseModel):
    hold_key: str = Field(min_length=1, max_length=64)
    payment_method_id: int | None = None
    customer: CustomerIn | None = None
    items: list[CheckoutItemIn] = Field(min_length=1)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _prune_stale(db: Session) -> None:
    db.query(SaleHold).filter(SaleHold.updated_at < _fresh_cutoff()).delete(
        synchronize_session=False
    )


def _held_by_others(db: Session, variant_id: int, hold_key: str) -> int:
    total = (
        db.query(func.coalesce(func.sum(SaleHold.quantity), 0))
        .filter(
            SaleHold.variant_id == variant_id,
            SaleHold.hold_key != hold_key,
            SaleHold.updated_at >= _fresh_cutoff(),
        )
        .scalar()
    )
    return int(total or 0)


def _available(db: Session, variant: ProductVariant, hold_key: str) -> int:
    """Max quantity this tab may hold of the variant (on-hand minus other holds)."""
    return max(0, int(variant.quantity or 0) - _held_by_others(db, variant.id, hold_key))


def _variant_labels(db: Session, variant: ProductVariant) -> tuple[str, str]:
    """Human labels for a variant's attribute selection, in EN and AR."""
    en_parts, ar_parts = [], []
    for _aid, vid in (variant.attributes or {}).items():
        val = db.get(AttributeValue, int(vid)) if vid else None
        if val:
            en_parts.append(val.value_en or "")
            ar_parts.append(val.value_ar or val.value_en or "")
    return " · ".join(p for p in en_parts if p), " · ".join(p for p in ar_parts if p)


def _resolve_by_code(db: Session, raw: str) -> ProductVariant | None:
    """Find a sellable variant from a scanned code.

    Priority: an exact variant code, then a product code (its single live
    variant). A multi-variant product code is ambiguous and returns None.
    """
    code = normalize_code(raw)
    variant = (
        db.query(ProductVariant)
        .options(
            selectinload(ProductVariant.product).selectinload(Product.category),
            selectinload(ProductVariant.images),
        )
        .filter(ProductVariant.code == code, ProductVariant.is_deleted.is_(False))
        .first()
    )
    if variant and variant.product and not variant.product.is_deleted:
        return variant
    product = (
        db.query(Product)
        .options(
            selectinload(Product.variants).selectinload(ProductVariant.images),
            selectinload(Product.category),
        )
        .filter(Product.code == code, Product.is_deleted.is_(False))
        .first()
    )
    if product:
        live = [v for v in product.variants if not v.is_deleted]
        if len(live) == 1:
            return live[0]
    return None


def _variant_image(variant: ProductVariant) -> str | None:
    """First variant image, falling back to the product's category image."""
    if variant.images:
        return variant.images[0].url
    product = variant.product
    if product and product.category and product.category.image_id:
        return f"/images/{product.category.image_id}"
    return None


def _line(db: Session, variant: ProductVariant, quantity: int, hold_key: str) -> dict:
    product = variant.product
    en, ar = _variant_labels(db, variant)
    return {
        "variant_id": variant.id,
        "product_id": product.id if product else None,
        "code": variant.code,
        "name": product.name if product else variant.code,
        "variant_en": en,
        "variant_ar": ar,
        "image": _variant_image(variant),
        "price": float(product.price or 0) if product else 0.0,
        "min_price": float(product.min_price or 0) if product else 0.0,
        "quantity": quantity,
        "available": _available(db, variant, hold_key),
        "on_hand": int(variant.quantity or 0),
    }


def _get_hold(db: Session, hold_key: str, variant_id: int) -> SaleHold | None:
    return (
        db.query(SaleHold)
        .filter(SaleHold.hold_key == hold_key, SaleHold.variant_id == variant_id)
        .first()
    )


def _serialize_sale(sale: Sale) -> dict:
    return {
        "id": sale.id,
        "invoice_no": sale.invoice_no,
        "customer_name": sale.customer_name,
        "customer_phone": sale.customer_phone,
        "payment_method": sale.payment_method,
        "item_count": sale.item_count,
        "subtotal": float(sale.subtotal or 0),
        "discount": float(sale.discount or 0),
        "total": float(sale.total or 0),
        "created_at": sale.created_at.isoformat() if sale.created_at else None,
        "items": [
            {
                "code": i.code,
                "name": i.name,
                "unit_price": float(i.unit_price or 0),
                "quantity": i.quantity,
                "line_total": float(i.line_total or 0),
            }
            for i in sale.items
        ],
    }


# --------------------------------------------------------------------------- #
# Bootstrap + customer lookup
# --------------------------------------------------------------------------- #
@router.get("/bootstrap")
def bootstrap(db: Session = Depends(get_db), _u: User = Depends(get_current_user)):
    methods = (
        db.query(PaymentMethod)
        .filter(PaymentMethod.is_active.is_(True))
        .order_by(PaymentMethod.sort_order, PaymentMethod.id)
        .all()
    )
    return {
        "currency": get_currency(db),
        "payment_methods": [
            {"id": m.id, "code": m.code, "name_en": m.name_en, "name_ar": m.name_ar}
            for m in methods
        ],
    }


@router.get("/customers/lookup")
def lookup_customer(
    phone: str = Query(...),
    db: Session = Depends(get_db),
    _u: User = Depends(get_current_user),
):
    p = (phone or "").strip()
    if not p:
        return {"found": False, "name": ""}
    c = db.query(Customer).filter(Customer.phone == p).first()
    return {"found": bool(c), "name": c.name if c else ""}


# --------------------------------------------------------------------------- #
# Holds
# --------------------------------------------------------------------------- #
@router.post("/holds/scan")
def scan(payload: ScanIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _prune_stale(db)
    variant = _resolve_by_code(db, payload.code)
    if not variant:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pos.errors.notFound")

    available = _available(db, variant, payload.hold_key)
    hold = _get_hold(db, payload.hold_key, variant.id)
    current = int(hold.quantity) if hold else 0
    if current >= available:
        raise HTTPException(status.HTTP_409_CONFLICT, "pos.errors.outOfStock")

    new_qty = current + 1
    if hold:
        hold.quantity = new_qty
        hold.updated_at = _now()
    else:
        db.add(SaleHold(hold_key=payload.hold_key, variant_id=variant.id,
                        quantity=new_qty, user_id=user.id))
    db.commit()
    db.refresh(variant)
    return _line(db, variant, new_qty, payload.hold_key)


@router.post("/holds/set")
def set_qty(payload: SetQtyIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _prune_stale(db)
    variant = (
        db.query(ProductVariant)
        .options(
            selectinload(ProductVariant.product).selectinload(Product.category),
            selectinload(ProductVariant.images),
        )
        .filter(ProductVariant.id == payload.variant_id, ProductVariant.is_deleted.is_(False))
        .first()
    )
    if not variant:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pos.errors.notFound")

    available = _available(db, variant, payload.hold_key)
    clamped = max(0, min(payload.quantity, available))
    hold = _get_hold(db, payload.hold_key, variant.id)
    if clamped <= 0:
        if hold:
            db.delete(hold)
    elif hold:
        hold.quantity = clamped
        hold.updated_at = _now()
    else:
        db.add(SaleHold(hold_key=payload.hold_key, variant_id=variant.id,
                        quantity=clamped, user_id=user.id))
    db.commit()
    db.refresh(variant)
    line = _line(db, variant, clamped, payload.hold_key)
    # `capped` signals the UI to warn that not enough stock was free.
    line["capped"] = clamped < payload.quantity
    return line


@router.post("/holds/release")
def release(payload: ReleaseIn, db: Session = Depends(get_db), _u: User = Depends(get_current_user)):
    q = db.query(SaleHold).filter(SaleHold.hold_key == payload.hold_key)
    if payload.variant_id is not None:
        q = q.filter(SaleHold.variant_id == payload.variant_id)
    q.delete(synchronize_session=False)
    db.commit()
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Checkout
# --------------------------------------------------------------------------- #
def _next_invoice_no(db: Session) -> str:
    n = int(db.query(func.count(Sale.id)).scalar() or 0) + 1
    for _ in range(50):
        candidate = f"INV-{n:06d}"
        if not db.query(Sale.id).filter(Sale.invoice_no == candidate).first():
            return candidate
        n += 1
    return f"INV-{int(_now().timestamp())}"


def _upsert_customer(db: Session, data: CustomerIn | None) -> Customer | None:
    if not data:
        return None
    phone = (data.phone or "").strip() or None
    name = (data.name or "").strip()
    if not phone and not name:
        return None
    if phone:
        cust = db.query(Customer).filter(Customer.phone == phone).first()
        if cust:
            if name and cust.name != name:
                cust.name = name
            return cust
    if not name:
        return None
    cust = Customer(phone=phone, name=name)
    db.add(cust)
    db.flush()
    return cust


@router.post("/checkout")
def checkout(payload: CheckoutIn, request: Request,
             db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _prune_stale(db)

    # Load + validate every line before mutating anything.
    prepared: list[tuple[ProductVariant, CheckoutItemIn]] = []
    for item in payload.items:
        variant = (
            db.query(ProductVariant)
            .options(selectinload(ProductVariant.product))
            .filter(ProductVariant.id == item.variant_id, ProductVariant.is_deleted.is_(False))
            .first()
        )
        if not variant or not variant.product or variant.product.is_deleted:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "pos.errors.notFound")
        min_price = float(variant.product.min_price or 0)
        if round(item.unit_price, 2) < round(min_price, 2):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "pos.errors.priceBelowMin")
        if int(variant.quantity or 0) < item.quantity:
            raise HTTPException(status.HTTP_409_CONFLICT, "pos.errors.stock")
        prepared.append((variant, item))

    payment = db.get(PaymentMethod, payload.payment_method_id) if payload.payment_method_id else None
    customer = _upsert_customer(db, payload.customer)

    sale = Sale(
        invoice_no=_next_invoice_no(db),
        user_id=user.id,
        customer_id=customer.id if customer else None,
        payment_method_id=payment.id if payment else None,
        customer_name=customer.name if customer else (payload.customer.name if payload.customer else None),
        customer_phone=customer.phone if customer else (payload.customer.phone if payload.customer else None),
        payment_method=payment.name_en if payment else None,
    )

    item_count = 0
    subtotal = 0.0
    discount = 0.0
    for variant, item in prepared:
        product = variant.product
        unit = round(item.unit_price, 2)
        min_price = float(product.min_price or 0)
        list_price = float(product.price or 0)
        line_total = round(unit * item.quantity, 2)
        en, ar = _variant_labels(db, variant)
        sale.items.append(SaleItem(
            product_id=product.id,
            variant_id=variant.id,
            code=variant.code,
            name=f"{product.name}{(' · ' + en) if en else ''}",
            unit_price=unit,
            min_price=round(min_price, 2),
            quantity=item.quantity,
            line_total=line_total,
        ))
        variant.quantity = int(variant.quantity or 0) - item.quantity  # deduct stock
        item_count += item.quantity
        subtotal += line_total
        # Discount = list price minus the (possibly reduced) sold price.
        discount += round(max(0.0, list_price - unit) * item.quantity, 2)

    sale.item_count = item_count
    sale.subtotal = round(subtotal, 2)
    sale.discount = round(discount, 2)
    sale.total = round(subtotal, 2)
    db.add(sale)

    # Release this tab's holds — the stock has now been physically deducted.
    db.query(SaleHold).filter(SaleHold.hold_key == payload.hold_key).delete(
        synchronize_session=False
    )
    db.commit()
    db.refresh(sale)
    log_action(db, action="pos.sale", user_id=user.id, entity="sale", entity_id=sale.id,
               details={"invoice": sale.invoice_no, "total": sale.total, "items": item_count},
               request=request)
    return _serialize_sale(sale)
