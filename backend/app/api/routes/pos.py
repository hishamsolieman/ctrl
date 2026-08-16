"""Point-of-Sale (Cashier) API.

Responsibilities:
- Resolve products by scanned code to a concrete *stock unit*:
  * a variant/code-unit code → that variant (coding attributes locked);
  * a single-variant product code → its lone variant;
  * a multi-variant product code → the first in-stock variant, added as a
    *flexible* line whose coding attributes (e.g. color) may also be switched.
- Let cashiers switch a line's non-coding attributes (e.g. size) to an in-stock
  sibling; on flexible lines coding attributes switch across variants too, which
  updates the displayed variant code. Availability is filtered per selection.
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

import math
import re
import secrets
import string
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
from app.services.settings import get_currency, get_setting

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
    attributes: dict[str, int] = Field(default_factory=dict)  # target full combo
    anchor: int | None = None  # the attribute the cashier just changed


class ReleaseIn(BaseModel):
    hold_key: str = Field(min_length=1, max_length=64)
    stock_id: int | None = None


class CartOpenIn(BaseModel):
    hold_key: str = Field(min_length=1, max_length=64)


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
    paid_amount: float | None = None  # cash tendered (ignored for non-cash)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
PHONE_REGEX_KEY = "customer_phone_regex"
DEFAULT_PHONE_REGEX = r"^(?:\+20|0)1[0125]\d{8}$"


def _phone_regex(db: Session) -> str:
    return get_setting(db, PHONE_REGEX_KEY, DEFAULT_PHONE_REGEX)


def _phone_valid(regex: str, phone: str | None) -> bool:
    """Validate a (normalized) phone against the configured regex. Empty is OK
    (phone is optional); a bad regex in config fails open (treated as valid)."""
    if not phone:
        return True
    try:
        return bool(re.match(regex, phone))
    except re.error:
        return True


def _normalize_phone(raw: str | None) -> str | None:
    """Canonicalize a phone number to E.164-ish form.

    Local Egyptian numbers (``01099379989``) become ``+201099379989``; a leading
    ``00`` international prefix becomes ``+``; an existing ``+`` is preserved.
    """
    p = (raw or "").strip()
    if not p:
        return None
    plus = p.startswith("+")
    digits = re.sub(r"\D", "", p)
    if not digits:
        return None
    if plus:
        return "+" + digits
    if digits.startswith("00"):
        return "+" + digits[2:]
    if digits.startswith("0"):
        # National (trunk-0) number → Egypt country code.
        return "+20" + digits[1:]
    return "+" + digits


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


def _attr_snapshot(db: Session, stock: VariantStock) -> list[dict]:
    """Frozen list of the sold attributes (name + value + hex per language).

    Stored on the sale item so later edits to attributes/values never change a
    completed invoice. Intentionally NOT a foreign key to live attribute rows.
    """
    variant = stock.variant
    combined: dict = {}
    combined.update((variant.attributes or {}) if variant else {})
    combined.update(stock.attributes or {})
    snap: list[dict] = []
    for aid, vid in combined.items():
        attr = db.get(Attribute, int(aid)) if aid else None
        av = db.get(AttributeValue, int(vid)) if vid else None
        if not attr or not av:
            continue
        snap.append({
            "name_en": attr.name_en,
            "name_ar": attr.name_ar,
            "value_en": av.value_en,
            "value_ar": av.value_ar,
            "hex": (av.extra or {}).get("hex"),
        })
    return snap


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


def _resolve_scan(
    db: Session, raw: str, hold_key: str
) -> tuple[ProductVariant | None, bool]:
    """Resolve a scanned code to a code unit (variant) and a *flexible* flag.

    - An exact *variant* code → that variant, ``flexible=False`` (coding locked).
    - A *product* code with a single live variant → that variant, ``flexible=False``.
    - A *product* code with multiple live variants → the first variant that has
      free stock (else the first variant), ``flexible=True``. Flexible lines let
      the cashier switch coding attributes (e.g. color) across variants.
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
        return variant, False
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
            return live[0], False
        if len(live) > 1:
            # First variant with an available stock unit, else the first variant.
            for v in live:
                if any(_available(db, s, hold_key) > 0 for s in (v.stocks or [])):
                    return v, True
            return live[0], True
    return None, False


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


def _product_variants(db: Session, product_id: int) -> list[ProductVariant]:
    """All live variants of a product, with their stock units eagerly loaded."""
    return (
        db.query(ProductVariant)
        .options(selectinload(ProductVariant.stocks))
        .filter(
            ProductVariant.product_id == product_id,
            ProductVariant.is_deleted.is_(False),
        )
        .all()
    )


def _line(db: Session, stock: VariantStock, quantity: int, hold_key: str,
          flexible: bool = False) -> dict:
    variant = stock.variant
    product = variant.product if variant else None
    en, ar = _variant_labels(db, variant)

    # Combo scope. A *flexible* line (scanned by product code) may switch coding
    # attributes across ALL of the product's variants; otherwise only the
    # non-coding siblings under the current variant participate.
    if flexible and product:
        variants = _product_variants(db, product.id)
    else:
        variants = [variant] if variant else []

    # A "combo" is one sellable stock unit plus its full (coding + non-coding)
    # attribute map. We also collect the coding/non-coding attribute id order.
    combos: list[dict] = []
    coding_ids: list[int] = []
    nc_ids: list[int] = []
    seen_c: set[int] = set()
    seen_n: set[int] = set()
    for v in variants:
        for k in (v.attributes or {}).keys():
            ik = int(k)
            if ik not in seen_c:
                seen_c.add(ik)
                coding_ids.append(ik)
        for s in (v.stocks or []):
            for k in (s.attributes or {}).keys():
                ik = int(k)
                if ik not in seen_n:
                    seen_n.add(ik)
                    nc_ids.append(ik)
            full = {str(kk): int(vv) for kk, vv in (v.attributes or {}).items()}
            full.update({str(kk): int(vv) for kk, vv in (s.attributes or {}).items()})
            combos.append({
                "stock_id": s.id,
                "full": full,
                "available": _available(db, s, hold_key),
            })

    # Current selection = the current stock's full attribute map (coding + nc).
    selected = {str(k): int(v) for k, v in (variant.attributes or {}).items()} if variant else {}
    selected.update({str(k): int(v) for k, v in (stock.attributes or {}).items()})

    def _val_available(attr_id: int, value_id: int) -> bool:
        """Whether an attribute may be set to a value given the current selection.

        A coding option keeps the OTHER coding selections fixed (it selects a
        variant); a non-coding option keeps ALL coding selections fixed (it
        selects a stock within the chosen variant). The current stock is always
        allowed even when its free availability is exhausted.
        """
        a = str(attr_id)
        v = int(value_id)
        for c in combos:
            if c["full"].get(a) != v:
                continue
            keep = True
            for cid in coding_ids:
                k = str(cid)
                if k == a:
                    continue
                if c["full"].get(k) != selected.get(k):
                    keep = False
                    break
            if not keep:
                continue
            if c["available"] > 0 or c["stock_id"] == stock.id:
                return True
        return False

    def _values_for(attr_id: int) -> list[dict]:
        vals: list[dict] = []
        vseen: set[int] = set()
        for c in combos:
            vid = c["full"].get(str(attr_id))
            if not vid or vid in vseen:
                continue
            vseen.add(vid)
            av = db.get(AttributeValue, vid)
            if av:
                vals.append({
                    "value_id": av.id,
                    "value_en": av.value_en,
                    "value_ar": av.value_ar,
                    "hex": (av.extra or {}).get("hex"),
                    "available": _val_available(attr_id, av.id),
                })
        return vals

    # Coding attributes — locked (variant-code scan) or editable dropdown
    # (product-code scan). One entry per attribute for its table column.
    coding_attrs = []
    for aid in coding_ids:
        attr = db.get(Attribute, aid)
        cur = selected.get(str(aid))
        av = db.get(AttributeValue, cur) if cur else None
        if not attr or not av:
            continue
        entry = {
            "attr_id": aid,
            "name_en": attr.name_en,
            "name_ar": attr.name_ar,
            "type": attr.type,
            "value_id": av.id,
            "value_en": av.value_en,
            "value_ar": av.value_ar,
            "hex": (av.extra or {}).get("hex"),
            "editable": flexible,
        }
        if flexible:
            entry["values"] = _values_for(aid)
        coding_attrs.append(entry)

    # Non-coding attributes — always editable (pick an in-stock sibling).
    nc_attrs = []
    for aid in nc_ids:
        attr = db.get(Attribute, aid)
        if not attr:
            continue
        nc_attrs.append({
            "attr_id": aid,
            "name_en": attr.name_en,
            "name_ar": attr.name_ar,
            "type": attr.type,
            "values": _values_for(aid),
        })

    siblings_payload = [
        {"stock_id": c["stock_id"], "attributes": c["full"], "available": c["available"]}
        for c in combos
    ]

    return {
        "stock_id": stock.id,
        "variant_id": variant.id if variant else None,
        "product_id": product.id if product else None,
        "code": variant.code if variant else "",
        "name": product.name if product else (variant.code if variant else ""),
        "category_en": product.category.name_en if product and product.category else "",
        "category_ar": product.category.name_ar if product and product.category else "",
        "variant_en": en,
        "variant_ar": ar,
        "image": _variant_image(variant),
        "price": float(product.price or 0) if product else 0.0,
        "min_price": float(product.min_price or 0) if product else 0.0,
        "quantity": quantity,
        "available": _available(db, stock, hold_key),
        "on_hand": int(stock.quantity or 0),
        "coding_editable": flexible,
        "coding_attrs": coding_attrs,
        "nc_attrs": nc_attrs,
        "selected": selected,
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
        "customer_name": sale.customer.name if sale.customer else None,
        "customer_phone": sale.customer.phone if sale.customer else None,
        "payment_method_en": sale.payment.name_en if sale.payment else None,
        "payment_method_ar": sale.payment.name_ar if sale.payment else None,
        "item_count": sale.item_count,
        "subtotal": float(sale.subtotal or 0),
        "discount": float(sale.discount or 0),
        "total": float(sale.total or 0),
        "paid_amount": float(sale.paid_amount or 0),
        "change_amount": float(sale.change_amount or 0),
        "change_raw": float(sale.change_raw or 0),
        "created_at": sale.created_at.isoformat() if sale.created_at else None,
        "items": [
            {
                "code": i.code,
                "name": i.name,
                "attributes": i.attributes or [],
                "unit_price": float(i.unit_price or 0),
                "list_price": float(i.list_price or i.unit_price or 0),
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
        "phone_regex": _phone_regex(db),
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
    p = _normalize_phone(phone)
    if not p:
        return {"found": False, "name": "", "normalized": ""}
    c = db.query(Customer).filter(Customer.phone == p).first()
    return {"found": bool(c), "name": c.name if c else "", "normalized": p}


# --------------------------------------------------------------------------- #
# Holds
# --------------------------------------------------------------------------- #
@router.post("/holds/scan")
def scan(payload: ScanIn, request: Request,
         db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _prune_stale(db)
    variant, flexible = _resolve_scan(db, payload.code, payload.hold_key)
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
        hold.flexible = flexible
        hold.updated_at = _now()
    else:
        db.add(SaleHold(hold_key=payload.hold_key, stock_id=stock.id,
                        quantity=new_qty, flexible=flexible, user_id=user.id))
    db.commit()
    db.refresh(stock)
    log_action(db, action="pos.item.add", user_id=user.id, entity="stock", entity_id=stock.id,
               details={"cart": payload.hold_key, "code": payload.code, "quantity": new_qty},
               request=request)
    return _line(db, stock, new_qty, payload.hold_key, flexible)


@router.post("/holds/set")
def set_qty(payload: SetQtyIn, request: Request,
            db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _prune_stale(db)
    stock = _load_stock(db, payload.stock_id)
    if not stock:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pos.errors.notFound")

    available = _available(db, stock, payload.hold_key)
    clamped = max(0, min(payload.quantity, available))
    hold = _get_hold(db, payload.hold_key, stock.id)
    flexible = bool(hold.flexible) if hold else False
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
    log_action(db, action="pos.item.qty", user_id=user.id, entity="stock", entity_id=stock.id,
               details={"cart": payload.hold_key, "quantity": clamped},
               request=request)
    line = _line(db, stock, clamped, payload.hold_key, flexible)
    # `capped` signals the UI to warn that not enough stock was free.
    line["capped"] = clamped < payload.quantity
    return line


def _resolve_switch_target(
    db: Session, current: VariantStock, target: dict[str, int],
    anchor: int | None, flexible: bool, hold_key: str,
) -> VariantStock | None:
    """Pick the destination stock for a requested attribute change.

    Non-flexible lines only switch non-coding siblings under the current
    variant. Flexible lines may switch coding attributes across the product's
    variants: the ``anchor`` (the attribute the cashier just changed) is fixed,
    and among the available combos we keep as many of the other requested values
    as possible (so changing color auto-selects a valid size).
    """
    product = current.variant.product if current.variant else None
    variants = (
        _product_variants(db, product.id)
        if flexible and product
        else ([current.variant] if current.variant else [])
    )
    combos: list[tuple[VariantStock, dict[str, int]]] = []
    for v in variants:
        base = {str(k): int(vv) for k, vv in (v.attributes or {}).items()}
        for s in (v.stocks or []):
            full = dict(base)
            full.update({str(k): int(vv) for k, vv in (s.attributes or {}).items()})
            combos.append((s, full))

    a = str(anchor) if anchor is not None else None
    want = target.get(a) if a is not None else None

    best: VariantStock | None = None
    best_key: tuple = (1 << 30, 1 << 30, 1 << 30)
    for s, full in combos:
        # Honor the anchored attribute exactly (when provided).
        if a is not None and full.get(a) != want:
            continue
        avail = _available(db, s, hold_key)
        if avail <= 0 and s.id != current.id:
            continue
        score = sum(1 for k, val in target.items() if full.get(k) == val)
        key = (-score, 0 if avail > 0 else 1, s.id)
        if key < best_key:
            best_key = key
            best = s
    return best


@router.post("/holds/switch")
def switch_stock(payload: SwitchIn, request: Request,
                 db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Move a line to another in-stock unit for a changed attribute.

    For a variant-code line this switches non-coding siblings (e.g. size); for a
    product-code (flexible) line it can also switch coding attributes across
    variants, updating the displayed code. The hold quantity is carried over,
    clamped to the destination's availability."""
    _prune_stale(db)
    current = _load_stock(db, payload.stock_id)
    if not current:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pos.errors.notFound")

    cur_hold = _get_hold(db, payload.hold_key, current.id)
    flexible = bool(cur_hold.flexible) if cur_hold else False
    target = {str(k): int(v) for k, v in (payload.attributes or {}).items()}

    dest = _resolve_switch_target(
        db, current, target, payload.anchor, flexible, payload.hold_key
    )
    if not dest:
        raise HTTPException(status.HTTP_409_CONFLICT, "pos.errors.outOfStock")

    qty = int(cur_hold.quantity) if cur_hold else 0

    if dest.id == current.id:
        return _line(db, dest, qty, payload.hold_key, flexible)

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
                        quantity=moved, flexible=flexible, user_id=user.id))
    db.commit()
    db.refresh(dest)
    log_action(db, action="pos.item.switch", user_id=user.id, entity="stock", entity_id=dest.id,
               details={"cart": payload.hold_key, "from": current.id, "to": dest.id, "quantity": moved},
               request=request)
    line = _line(db, dest, moved, payload.hold_key, flexible)
    line["capped"] = moved < qty
    return line


@router.post("/holds/release")
def release(payload: ReleaseIn, request: Request,
            db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = db.query(SaleHold).filter(SaleHold.hold_key == payload.hold_key)
    if payload.stock_id is not None:
        q = q.filter(SaleHold.stock_id == payload.stock_id)
    q.delete(synchronize_session=False)
    db.commit()
    if payload.stock_id is not None:
        log_action(db, action="pos.item.remove", user_id=user.id, entity="stock",
                   entity_id=payload.stock_id, details={"cart": payload.hold_key}, request=request)
    else:
        log_action(db, action="pos.cart.close", user_id=user.id,
                   details={"cart": payload.hold_key}, request=request)
    return {"ok": True}


@router.post("/cart/open")
def cart_open(payload: CartOpenIn, request: Request,
              db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Log that a cashier opened a new cart tab (no state kept server-side)."""
    log_action(db, action="pos.cart.open", user_id=user.id,
               details={"cart": payload.hold_key}, request=request)
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Checkout
# --------------------------------------------------------------------------- #
_INV_ALPHABET = string.ascii_uppercase + string.digits  # A-Z 0-9
_INV_LEN = 10


def _next_invoice_no(db: Session) -> str:
    """INV- followed by 10 random uppercase alphanumeric chars; unique per sale."""
    for _ in range(80):
        candidate = "INV-" + "".join(secrets.choice(_INV_ALPHABET) for _ in range(_INV_LEN))
        if not db.query(Sale.id).filter(Sale.invoice_no == candidate).first():
            return candidate
    raise RuntimeError("Could not generate a unique invoice number")


def _upsert_customer(db: Session, data: CustomerIn | None) -> Customer | None:
    if not data:
        return None
    phone = _normalize_phone(data.phone)
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
        list_price = float(product.price or 0)
        # Never allow selling above the list price — cap it defensively.
        if round(item.unit_price, 2) > round(list_price, 2):
            item.unit_price = list_price
        if round(item.unit_price, 2) < round(min_price, 2):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "pos.errors.priceBelowMin")
        if int(stock.quantity or 0) < item.quantity:
            raise HTTPException(status.HTTP_409_CONFLICT, "pos.errors.stock")
        prepared.append((stock, item))

    # Validate the (normalized) phone against the configured regex.
    normalized_phone = _normalize_phone(payload.customer.phone) if payload.customer else None
    if not _phone_valid(_phone_regex(db), normalized_phone):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "pos.errors.invalidPhone")

    payment = db.get(PaymentMethod, payload.payment_method_id) if payload.payment_method_id else None
    customer = _upsert_customer(db, payload.customer)

    sale = Sale(
        invoice_no=_next_invoice_no(db),
        user_id=user.id,
        customer_id=customer.id if customer else None,
        payment_method_id=payment.id if payment else None,
    )

    item_count = 0
    subtotal = 0.0
    discount = 0.0
    for stock, item in prepared:
        variant = stock.variant
        product = variant.product
        unit = round(item.unit_price, 2)
        list_price = round(float(product.price or 0), 2)
        min_price = float(product.min_price or 0)
        line_total = round(unit * item.quantity, 2)
        sale.items.append(SaleItem(
            product_id=product.id,
            variant_id=variant.id,
            stock_id=stock.id,
            code=variant.code,
            name=product.name,
            attributes=_attr_snapshot(db, stock),
            unit_price=unit,
            list_price=list_price,
            min_price=round(min_price, 2),
            quantity=item.quantity,
            line_total=line_total,
        ))
        stock.quantity = int(stock.quantity or 0) - item.quantity  # deduct stock
        item_count += item.quantity
        # Subtotal is the GROSS amount (before discount): Σ list·qty.
        subtotal += round(list_price * item.quantity, 2)
        # Discount = list price minus the (possibly reduced) sold price.
        discount += round(max(0.0, list_price - unit) * item.quantity, 2)

    sale.item_count = item_count
    sale.subtotal = round(subtotal, 2)
    sale.discount = round(discount, 2)
    # Total is the NET amount (after discount): subtotal − discount = Σ sold·qty.
    total = round(subtotal - discount, 2)
    sale.total = total

    # Cash: capture tendered amount and compute exact + "raw" (rounded-up) change.
    # Card (and anything non-cash): exact, nothing tendered/changed.
    is_cash = bool(payment and (payment.code or "").lower() == "cash")
    if is_cash:
        paid = round(float(payload.paid_amount or 0), 2)
        if paid < total:  # never accept less than the invoice — bump to total
            paid = total
        rounded_total = float(math.ceil(total))  # e.g. 1238.44 -> 1239
        sale.paid_amount = paid
        sale.change_amount = round(max(0.0, paid - total), 2)         # exact (61.56)
        sale.change_raw = round(max(0.0, paid - rounded_total), 2)    # raw   (61.00)
    else:
        sale.paid_amount = total
        sale.change_amount = 0
        sale.change_raw = 0
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
