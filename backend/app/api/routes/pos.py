"""Point-of-Sale (Cashier) API.

Responsibilities:
- Resolve products by scanned code (a variant/code-unit code, or a single-variant
  product code) to a concrete *stock unit* (a non-coding attribute combination).
- Let cashiers switch a line's non-coding attributes (e.g. size) to an in-stock
  sibling under the same code; coding attributes (baked into the code) are locked.
- Manage cross-cashier *stock holds* so concurrent cashier tabs cannot oversell.
- Look up customers by phone (auto-fill name) and record completed sales, which
  deduct stock and release that tab's holds.

Stock accounting
----------------
``VariantStock.quantity`` is the physical on-hand count of one sellable unit. A
``SaleHold`` row reserves some of it for a given ``hold_key`` (one per cashier
tab). For a given tab the amount it may hold of a stock unit is::

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
from app.models.attribute import Attribute, AttributeValue
from app.models.customer import Customer
from app.models.payment_method import PaymentMethod
from app.models.product import Product, ProductVariant, VariantStock
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
    stock_id: int
    quantity: int = Field(ge=0)


class SwitchIn(BaseModel):
    hold_key: str = Field(min_length=1, max_length=64)
    stock_id: int  # the line's current stock unit
    attributes: dict[str, int] = Field(default_factory=dict)  # target non-coding combo


class ReleaseIn(BaseModel):
    hold_key: str = Field(min_length=1, max_length=64)
    stock_id: int | None = None


class CustomerIn(BaseModel):
    phone: str | None = None
    name: str | None = None


class CheckoutItemIn(BaseModel):
    stock_id: int
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


def _held_by_others(db: Session, stock_id: int, hold_key: str) -> int:
    total = (
        db.query(func.coalesce(func.sum(SaleHold.quantity), 0))
        .filter(
            SaleHold.stock_id == stock_id,
            SaleHold.hold_key != hold_key,
            SaleHold.updated_at >= _fresh_cutoff(),
        )
        .scalar()
    )
    return int(total or 0)


def _available(db: Session, stock: VariantStock, hold_key: str) -> int:
    """Max quantity this tab may hold of the stock unit (on-hand minus other holds)."""
    return max(0, int(stock.quantity or 0) - _held_by_others(db, stock.id, hold_key))


def _labels_from_map(db: Session, m: dict | None) -> tuple[list[str], list[str]]:
    en, ar = [], []
    for _aid, vid in (m or {}).items():
        val = db.get(AttributeValue, int(vid)) if vid else None
        if val:
            en.append(val.value_en or "")
            ar.append(val.value_ar or val.value_en or "")
    return en, ar


def _variant_labels(db: Session, variant: ProductVariant | None) -> tuple[str, str]:
    """Human labels for a variant's coding selection, in EN and AR."""
    if not variant:
        return "", ""
    en, ar = _labels_from_map(db, variant.attributes)
    return " · ".join(p for p in en if p), " · ".join(p for p in ar if p)


def _full_labels(db: Session, stock: VariantStock) -> tuple[str, str]:
    """Combined coding + non-coding labels for a sale snapshot."""
    variant = stock.variant
    en_v, ar_v = _labels_from_map(db, variant.attributes if variant else {})
    en_s, ar_s = _labels_from_map(db, stock.attributes)
    en = [p for p in (en_v + en_s) if p]
    ar = [p for p in (ar_v + ar_s) if p]
    return " · ".join(en), " · ".join(ar)


_VARIANT_LOAD = (
    selectinload(VariantStock.variant).selectinload(ProductVariant.product).selectinload(
        Product.category
    ),
    selectinload(VariantStock.variant).selectinload(ProductVariant.images),
    selectinload(VariantStock.variant).selectinload(ProductVariant.stocks),
)


def _load_stock(db: Session, stock_id: int) -> VariantStock | None:
    stock = (
        db.query(VariantStock)
        .options(*_VARIANT_LOAD)
        .filter(VariantStock.id == stock_id)
        .first()
    )
    if not stock or not stock.variant or stock.variant.is_deleted:
        return None
    product = stock.variant.product
    if not product or product.is_deleted:
        return None
    return stock


def _resolve_variant_by_code(db: Session, raw: str) -> ProductVariant | None:
    """Find a code unit (variant) from a scanned code.

    Priority: an exact variant code, then a product code (its single live
    variant). A multi-variant product code is ambiguous and returns None.
    """
    code = normalize_code(raw)
    variant = (
        db.query(ProductVariant)
        .options(
            selectinload(ProductVariant.product).selectinload(Product.category),
            selectinload(ProductVariant.images),
            selectinload(ProductVariant.stocks),
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
            selectinload(Product.variants).selectinload(ProductVariant.stocks),
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


def _default_stock(db: Session, variant: ProductVariant, hold_key: str) -> VariantStock | None:
    """First stock unit with free availability, else the first stock (if any)."""
    stocks = list(variant.stocks or [])
    if not stocks:
        return None
    for s in stocks:
        if _available(db, s, hold_key) > 0:
            return s
    return stocks[0]


def _variant_image(variant: ProductVariant | None) -> str | None:
    if not variant:
        return None
    if variant.images:
        return variant.images[0].url
    product = variant.product
    if product and product.category and product.category.image_id:
        return f"/images/{product.category.image_id}"
    return None


def _line(db: Session, stock: VariantStock, quantity: int, hold_key: str) -> dict:
    variant = stock.variant
    product = variant.product if variant else None
    en, ar = _variant_labels(db, variant)
    siblings = list(variant.stocks or []) if variant else []

    # Non-coding attributes present across the sibling stocks, preserving order.
    nc_ids: list[int] = []
    seen: set[int] = set()
    for s in siblings:
        for k in (s.attributes or {}).keys():
            ik = int(k)
            if ik not in seen:
                seen.add(ik)
                nc_ids.append(ik)

    nc_attrs = []
    for aid in nc_ids:
        attr = db.get(Attribute, aid)
        if not attr:
            continue
        values = []
        vseen: set[int] = set()
        for s in siblings:
            vid = (s.attributes or {}).get(str(aid), (s.attributes or {}).get(aid))
            if not vid or int(vid) in vseen:
                continue
            vseen.add(int(vid))
            av = db.get(AttributeValue, int(vid))
            if av:
                values.append({
                    "value_id": av.id,
                    "value_en": av.value_en,
                    "value_ar": av.value_ar,
                    "hex": (av.extra or {}).get("hex"),
                })
        nc_attrs.append({
            "attr_id": aid,
            "name_en": attr.name_en,
            "name_ar": attr.name_ar,
            "type": attr.type,
            "values": values,
        })

    siblings_payload = [
        {
            "stock_id": s.id,
            "attributes": {str(k): int(v) for k, v in (s.attributes or {}).items()},
            "available": _available(db, s, hold_key),
        }
        for s in siblings
    ]

    return {
        "stock_id": stock.id,
        "variant_id": variant.id if variant else None,
        "product_id": product.id if product else None,
        "code": variant.code if variant else "",
        "name": product.name if product else (variant.code if variant else ""),
        "variant_en": en,
        "variant_ar": ar,
        "image": _variant_image(variant),
        "price": float(product.price or 0) if product else 0.0,
        "min_price": float(product.min_price or 0) if product else 0.0,
        "quantity": quantity,
        "available": _available(db, stock, hold_key),
        "on_hand": int(stock.quantity or 0),
        "nc_attrs": nc_attrs,
        "selected": {str(k): int(v) for k, v in (stock.attributes or {}).items()},
        "siblings": siblings_payload,
    }


def _get_hold(db: Session, hold_key: str, stock_id: int) -> SaleHold | None:
    return (
        db.query(SaleHold)
        .filter(SaleHold.hold_key == hold_key, SaleHold.stock_id == stock_id)
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
    variant = _resolve_variant_by_code(db, payload.code)
    if not variant:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pos.errors.notFound")

    stock = _default_stock(db, variant, payload.hold_key)
    if not stock:
        raise HTTPException(status.HTTP_409_CONFLICT, "pos.errors.outOfStock")

    available = _available(db, stock, payload.hold_key)
    hold = _get_hold(db, payload.hold_key, stock.id)
    current = int(hold.quantity) if hold else 0
    if current >= available:
        raise HTTPException(status.HTTP_409_CONFLICT, "pos.errors.outOfStock")

    new_qty = current + 1
    if hold:
        hold.quantity = new_qty
        hold.updated_at = _now()
    else:
        db.add(SaleHold(hold_key=payload.hold_key, stock_id=stock.id,
                        quantity=new_qty, user_id=user.id))
    db.commit()
    db.refresh(stock)
    return _line(db, stock, new_qty, payload.hold_key)


@router.post("/holds/set")
def set_qty(payload: SetQtyIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _prune_stale(db)
    stock = _load_stock(db, payload.stock_id)
    if not stock:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pos.errors.notFound")

    available = _available(db, stock, payload.hold_key)
    clamped = max(0, min(payload.quantity, available))
    hold = _get_hold(db, payload.hold_key, stock.id)
    if clamped <= 0:
        if hold:
            db.delete(hold)
    elif hold:
        hold.quantity = clamped
        hold.updated_at = _now()
    else:
        db.add(SaleHold(hold_key=payload.hold_key, stock_id=stock.id,
                        quantity=clamped, user_id=user.id))
    db.commit()
    db.refresh(stock)
    line = _line(db, stock, clamped, payload.hold_key)
    # `capped` signals the UI to warn that not enough stock was free.
    line["capped"] = clamped < payload.quantity
    return line


@router.post("/holds/switch")
def switch_stock(payload: SwitchIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Move a line to a sibling stock unit (same code, different non-coding attrs).
    The hold quantity is carried over, clamped to the destination's availability."""
    _prune_stale(db)
    current = _load_stock(db, payload.stock_id)
    if not current:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pos.errors.notFound")

    variant = current.variant
    target = {str(k): int(v) for k, v in (payload.attributes or {}).items()}
    dest = next(
        (s for s in variant.stocks
         if {str(k): int(v) for k, v in (s.attributes or {}).items()} == target),
        None,
    )
    if not dest:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pos.errors.notFound")

    cur_hold = _get_hold(db, payload.hold_key, current.id)
    qty = int(cur_hold.quantity) if cur_hold else 0

    if dest.id == current.id:
        return _line(db, dest, qty, payload.hold_key)

    dest_avail = _available(db, dest, payload.hold_key)
    if qty > 0 and dest_avail <= 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "pos.errors.outOfStock")
    moved = min(qty, dest_avail)

    # Repoint the current hold to the destination stock (merging any existing one).
    existing_dest = _get_hold(db, payload.hold_key, dest.id)
    if existing_dest and (not cur_hold or existing_dest.id != cur_hold.id):
        db.delete(existing_dest)
    if cur_hold:
        cur_hold.stock_id = dest.id
        cur_hold.quantity = moved
        cur_hold.updated_at = _now()
    elif moved > 0:
        db.add(SaleHold(hold_key=payload.hold_key, stock_id=dest.id,
                        quantity=moved, user_id=user.id))
    db.commit()
    db.refresh(dest)
    line = _line(db, dest, moved, payload.hold_key)
    line["capped"] = moved < qty
    return line


@router.post("/holds/release")
def release(payload: ReleaseIn, db: Session = Depends(get_db), _u: User = Depends(get_current_user)):
    q = db.query(SaleHold).filter(SaleHold.hold_key == payload.hold_key)
    if payload.stock_id is not None:
        q = q.filter(SaleHold.stock_id == payload.stock_id)
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
    prepared: list[tuple[VariantStock, CheckoutItemIn]] = []
    for item in payload.items:
        stock = _load_stock(db, item.stock_id)
        if not stock:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "pos.errors.notFound")
        product = stock.variant.product
        min_price = float(product.min_price or 0)
        if round(item.unit_price, 2) < round(min_price, 2):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "pos.errors.priceBelowMin")
        if int(stock.quantity or 0) < item.quantity:
            raise HTTPException(status.HTTP_409_CONFLICT, "pos.errors.stock")
        prepared.append((stock, item))

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
    for stock, item in prepared:
        variant = stock.variant
        product = variant.product
        unit = round(item.unit_price, 2)
        list_price = float(product.price or 0)
        min_price = float(product.min_price or 0)
        line_total = round(unit * item.quantity, 2)
        en, _ar = _full_labels(db, stock)
        sale.items.append(SaleItem(
            product_id=product.id,
            variant_id=variant.id,
            stock_id=stock.id,
            code=variant.code,
            name=f"{product.name}{(' · ' + en) if en else ''}",
            unit_price=unit,
            min_price=round(min_price, 2),
            quantity=item.quantity,
            line_total=line_total,
        ))
        stock.quantity = int(stock.quantity or 0) - item.quantity  # deduct stock
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
