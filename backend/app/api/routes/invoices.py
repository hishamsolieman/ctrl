"""Invoice / sales management.

A management view over completed sales (``Sale``): search by invoice or by item,
headline stats (overall + this month), and — for Admin / SuperAdmin only —
editing an existing sale or back-dating a manual invoice.

Stock rules (mirroring the POS):
- Removing a line, or reducing its quantity, RETURNS that many units to the
  originating ``VariantStock`` (inventory goes up).
- Adding a line, or increasing its quantity, DEDUCTS from inventory (blocked when
  not enough on-hand).
Every mutation writes a detailed JSON action-log entry describing the before /
after totals, per-line changes and the exact stock movements.
"""
from __future__ import annotations

import csv
import io
import json
from collections import defaultdict
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_role
from app.core.database import get_db
from app.models.customer import Customer
from app.models.payment_method import PaymentMethod
from app.models.product import Product, ProductVariant, VariantStock
from app.models.sale import Sale, SaleItem
from app.models.user import User
from app.services.logging import log_action
from app.services.settings import get_currency

# Reuse the POS helpers so invoicing behaves identically to checkout.
from app.api.routes.pos import (
    _VARIANT_LOAD,
    _attr_snapshot,
    _full_labels,
    _load_stock,
    _next_invoice_no,
    _normalize_phone,
    _phone_regex,
    _phone_valid,
    _variant_image,
)

router = APIRouter(prefix="/invoices", tags=["invoices"])

PAGE_SIZE_MAX = 100


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class CustomerIn(BaseModel):
    phone: str | None = None
    name: str | None = None


class InvoiceItemIn(BaseModel):
    id: int | None = None          # existing SaleItem id (None → new line)
    stock_id: int | None = None    # required for new lines
    quantity: int = Field(ge=1)
    unit_price: float = Field(ge=0)


class InvoiceUpdateIn(BaseModel):
    customer: CustomerIn | None = None
    payment_method_id: int | None = None
    items: list[InvoiceItemIn] = Field(min_length=1)


class NewItemIn(BaseModel):
    stock_id: int
    quantity: int = Field(ge=1)
    unit_price: float = Field(ge=0)


class InvoiceCreateIn(BaseModel):
    customer: CustomerIn | None = None
    payment_method_id: int | None = None
    items: list[NewItemIn] = Field(min_length=1)
    created_at: datetime | None = None   # optional back-dated timestamp


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _clamp_price(unit: float, min_p: float, list_p: float) -> float:
    u = round(float(unit or 0), 2)
    if list_p and u > list_p:
        u = list_p
    if u < min_p:
        u = min_p
    return round(u, 2)


def _month_start(now: datetime | None = None) -> datetime:
    now = now or datetime.now()
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _upsert_customer(db: Session, data: CustomerIn | None) -> Customer | None:
    """Find/create a customer. An empty phone with a name = a named 'unknown'
    walk-in; nothing at all = no customer linked."""
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


def _seller_names(db: Session, sales: list[Sale]) -> dict[int, str]:
    ids = {s.user_id for s in sales if s.user_id}
    if not ids:
        return {}
    rows = db.query(User.id, User.full_name, User.username).filter(User.id.in_(ids)).all()
    return {uid: (full or uname) for uid, full, uname in rows}


def _serialize(sale: Sale, seller: str | None) -> dict:
    return {
        "id": sale.id,
        "invoice_no": sale.invoice_no,
        "created_at": sale.created_at.isoformat() if sale.created_at else None,
        "is_backtrack": bool(sale.is_backtrack),
        "seller": seller,
        "customer_id": sale.customer_id,
        "customer_name": sale.customer.name if sale.customer else None,
        "customer_phone": sale.customer.phone if sale.customer else None,
        "payment_method_id": sale.payment_method_id,
        "payment_method_code": sale.payment.code if sale.payment else None,
        "payment_method_en": sale.payment.name_en if sale.payment else None,
        "payment_method_ar": sale.payment.name_ar if sale.payment else None,
        "item_count": sale.item_count,
        "subtotal": float(sale.subtotal or 0),
        "discount": float(sale.discount or 0),
        "total": float(sale.total or 0),
        "paid_amount": float(sale.paid_amount or 0),
        "change_amount": float(sale.change_amount or 0),
        "change_raw": float(sale.change_raw or 0),
        "items": [
            {
                "id": i.id,
                "stock_id": i.stock_id,
                "code": i.code,
                "name": i.name,
                "attributes": i.attributes or [],
                "unit_price": float(i.unit_price or 0),
                "list_price": float(i.list_price or i.unit_price or 0),
                "min_price": float(i.min_price or 0),
                "quantity": i.quantity,
                "line_total": float(i.line_total or 0),
            }
            for i in sale.items
        ],
    }


def _item_log(i: SaleItem) -> dict:
    return {
        "sale_item_id": i.id,
        "stock_id": i.stock_id,
        "code": i.code,
        "name": i.name,
        "quantity": i.quantity,
        "unit_price": float(i.unit_price or 0),
        "line_total": float(i.line_total or 0),
    }


def _totals_log(sale: Sale) -> dict:
    return {
        "item_count": sale.item_count,
        "subtotal": float(sale.subtotal or 0),
        "discount": float(sale.discount or 0),
        "total": float(sale.total or 0),
    }


def _recompute(sale: Sale) -> None:
    item_count = 0
    subtotal = 0.0
    discount = 0.0
    for it in sale.items:
        qty = int(it.quantity or 0)
        unit = round(float(it.unit_price or 0), 2)
        list_price = round(float(it.list_price or 0), 2)
        it.line_total = round(unit * qty, 2)
        item_count += qty
        subtotal += round(list_price * qty, 2)
        discount += round(max(0.0, list_price - unit) * qty, 2)
    sale.item_count = item_count
    sale.subtotal = round(subtotal, 2)
    sale.discount = round(discount, 2)
    sale.total = round(subtotal - discount, 2)
    # Admin correction: record it as exactly paid (no cash-change bookkeeping).
    sale.paid_amount = sale.total
    sale.change_amount = 0
    sale.change_raw = 0


def _load_sale(db: Session, sale_id: int) -> Sale | None:
    return (
        db.query(Sale)
        .options(selectinload(Sale.items))
        .filter(Sale.id == sale_id)
        .first()
    )


def _customer_log(sale: Sale) -> dict:
    c = sale.customer
    return {
        "id": c.id if c else None,
        "name": c.name if c else None,
        "phone": c.phone if c else None,
    }


def _filtered_sales_query(
    db: Session,
    *,
    search: str = "",
    by: str = "invoice",
    date_from: str | None = None,
    date_to: str | None = None,
):
    """Shared list/export filter matching the invoices page search bar."""
    q = db.query(Sale).outerjoin(Customer, Sale.customer_id == Customer.id)
    s = (search or "").strip()
    if s:
        like = f"%{s}%"
        if by == "item":
            sub = db.query(SaleItem.sale_id).filter(
                or_(SaleItem.name.ilike(like), SaleItem.code.ilike(like))
            )
            q = q.filter(Sale.id.in_(sub))
        else:
            q = q.filter(
                or_(
                    Sale.invoice_no.ilike(like),
                    Customer.name.ilike(like),
                    Customer.phone.ilike(like),
                )
            )
    if date_from:
        try:
            q = q.filter(Sale.created_at >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            q = q.filter(Sale.created_at <= datetime.fromisoformat(date_to))
        except ValueError:
            pass
    return q


# --------------------------------------------------------------------------- #
# Read
# --------------------------------------------------------------------------- #
@router.get("")
def list_invoices(
    search: str = Query("", max_length=120),
    by: str = Query("invoice"),   # "invoice" | "item"
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=PAGE_SIZE_MAX),
    db: Session = Depends(get_db),
    _u: User = Depends(require_role("Moderator")),
):
    q = _filtered_sales_query(
        db, search=search, by=by, date_from=date_from, date_to=date_to
    )
    total = q.count()
    rows = (
        q.options(selectinload(Sale.items))
        .order_by(Sale.created_at.desc(), Sale.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    names = _seller_names(db, rows)
    return {
        "items": [_serialize(s_, names.get(s_.user_id)) for s_ in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, (total + page_size - 1) // page_size),
    }


@router.get("/export/csv")
def export_invoices(
    search: str = Query("", max_length=120),
    by: str = Query("invoice"),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
    request: Request = None,  # type: ignore[assignment]
):
    """CSV of every invoice matching the current filters (all pages).

    Includes seller, customer JSON, totals, and line items as JSON.
    """
    q = _filtered_sales_query(
        db, search=search, by=by, date_from=date_from, date_to=date_to
    )
    rows = (
        q.options(selectinload(Sale.items))
        .order_by(Sale.created_at.desc(), Sale.id.desc())
        .all()
    )
    names = _seller_names(db, rows)

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        [
            "invoice_no",
            "created_at",
            "is_backtrack",
            "seller",
            "customer",
            "payment_en",
            "payment_ar",
            "item_count",
            "subtotal",
            "discount",
            "total",
            "items",
        ]
    )
    for sale in rows:
        serialized = _serialize(sale, names.get(sale.user_id))
        w.writerow(
            [
                sale.invoice_no,
                serialized["created_at"] or "",
                1 if sale.is_backtrack else 0,
                serialized["seller"] or "",
                json.dumps(
                    {
                        "id": serialized["customer_id"],
                        "name": serialized["customer_name"],
                        "phone": serialized["customer_phone"],
                    },
                    ensure_ascii=False,
                ),
                serialized["payment_method_en"] or "",
                serialized["payment_method_ar"] or "",
                serialized["item_count"],
                serialized["subtotal"],
                serialized["discount"],
                serialized["total"],
                json.dumps(serialized["items"], ensure_ascii=False),
            ]
        )

    log_action(
        db,
        action="invoice.export",
        user_id=user.id,
        details={
            "count": len(rows),
            "search": search.strip() or None,
            "by": by,
            "date_from": date_from,
            "date_to": date_to,
        },
        request=request,
    )
    return StreamingResponse(
        iter([buf.getvalue().encode("utf-8-sig")]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=invoices.csv"},
    )


def _bucket(db: Session, since: datetime | None) -> dict:
    q = db.query(
        func.count(Sale.id),
        func.coalesce(func.sum(Sale.total), 0),
        func.coalesce(func.sum(Sale.item_count), 0),
        func.coalesce(func.sum(Sale.discount), 0),
    )
    if since is not None:
        q = q.filter(Sale.created_at >= since)
    invoices, revenue, items, discount = q.one()
    return {
        "invoices": int(invoices or 0),
        "revenue": round(float(revenue or 0), 2),
        "items": int(items or 0),
        "discount": round(float(discount or 0), 2),
    }


@router.get("/stats")
def invoice_stats(db: Session = Depends(get_db), _u: User = Depends(require_role("Moderator"))):
    return {
        "overall": _bucket(db, None),
        "month": _bucket(db, _month_start()),
        "currency": get_currency(db),
    }


@router.get("/stock/search")
def stock_search(
    q: str = Query("", max_length=120),
    limit: int = Query(20, ge=1, le=50),
    db: Session = Depends(get_db),
    _u: User = Depends(require_role("Moderator")),
):
    """Search in-stock sellable units for the invoice picker.

    Requires a search term so we never scan the full inventory (which may be
    huge). Only rows with ``on_hand > 0`` are returned.
    """
    s = q.strip()
    if not s:
        return []
    like = f"%{s}%"
    query = (
        db.query(VariantStock)
        .join(ProductVariant, VariantStock.variant_id == ProductVariant.id)
        .join(Product, ProductVariant.product_id == Product.id)
        .filter(
            Product.is_deleted.is_(False),
            ProductVariant.is_deleted.is_(False),
            VariantStock.quantity > 0,
            or_(
                Product.name.ilike(like),
                Product.code.ilike(like),
                ProductVariant.code.ilike(like),
            ),
        )
        .options(*_VARIANT_LOAD)
    )
    rows = query.order_by(func.lower(Product.name), VariantStock.id).limit(limit).all()
    out = []
    for st in rows:
        variant = st.variant
        product = variant.product if variant else None
        if not product:
            continue
        en, ar = _full_labels(db, st)
        out.append({
            "stock_id": st.id,
            "product_id": product.id,
            "code": variant.code if variant else "",
            "name": product.name,
            "label_en": en,
            "label_ar": ar,
            "image": _variant_image(variant),
            "price": float(product.price or 0),
            "min_price": float(product.min_price or 0),
            "on_hand": int(st.quantity or 0),
        })
    return out


@router.get("/{sale_id}")
def get_invoice(sale_id: int, db: Session = Depends(get_db),
                _u: User = Depends(require_role("Moderator"))):
    sale = _load_sale(db, sale_id)
    if not sale:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invoice not found")
    names = _seller_names(db, [sale])
    return _serialize(sale, names.get(sale.user_id))


# --------------------------------------------------------------------------- #
# Create (back-dated / manual) — Admin+
# --------------------------------------------------------------------------- #
@router.post("", status_code=status.HTTP_201_CREATED)
def create_invoice(
    payload: InvoiceCreateIn,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role("Admin")),
):
    # Back-dated / manual invoices must carry an explicit date.
    if payload.created_at is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invoices.errors.dateRequired")

    normalized_phone = _normalize_phone(payload.customer.phone) if payload.customer else None
    if not _phone_valid(_phone_regex(db), normalized_phone):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "pos.errors.invalidPhone")

    # Validate + aggregate stock demand before mutating.
    prepared: list[tuple[VariantStock, NewItemIn]] = []
    demand: dict[int, int] = defaultdict(int)
    for li in payload.items:
        stock = _load_stock(db, li.stock_id)
        if not stock:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "pos.errors.notFound")
        demand[stock.id] += li.quantity
        prepared.append((stock, li))
    for sid, need in demand.items():
        st = db.get(VariantStock, sid)
        if int(st.quantity or 0) < need:
            raise HTTPException(status.HTTP_409_CONFLICT, "invoices.errors.stock")

    payment = db.get(PaymentMethod, payload.payment_method_id) if payload.payment_method_id else None
    customer = _upsert_customer(db, payload.customer)

    sale = Sale(
        invoice_no=_next_invoice_no(db),
        user_id=actor.id,
        customer_id=customer.id if customer else None,
        payment_method_id=payment.id if payment else None,
        is_backtrack=True,
    )
    if payload.created_at:
        sale.created_at = payload.created_at.replace(tzinfo=None)

    added_log = []
    for stock, li in prepared:
        variant = stock.variant
        product = variant.product
        list_price = round(float(product.price or 0), 2)
        min_price = round(float(product.min_price or 0), 2)
        unit = _clamp_price(li.unit_price, min_price, list_price)
        sale.items.append(SaleItem(
            product_id=product.id,
            variant_id=variant.id,
            stock_id=stock.id,
            code=variant.code,
            name=product.name,
            attributes=_attr_snapshot(db, stock),
            unit_price=unit,
            list_price=list_price,
            min_price=min_price,
            quantity=li.quantity,
            line_total=round(unit * li.quantity, 2),
        ))
        stock.quantity = int(stock.quantity or 0) - li.quantity  # deduct
        added_log.append({"stock_id": stock.id, "code": variant.code,
                          "quantity": li.quantity, "unit_price": unit})

    _recompute(sale)
    db.add(sale)
    db.commit()
    db.refresh(sale)

    log_action(
        db,
        action="invoice.backtrack",
        user_id=actor.id,
        entity="sale",
        entity_id=sale.id,
        details={
            "invoice_no": sale.invoice_no,
            "is_backtrack": True,
            "created_at": sale.created_at.isoformat() if sale.created_at else None,
            "backdated": payload.created_at.isoformat() if payload.created_at else None,
            "seller": {
                "id": actor.id,
                "username": actor.username,
                "full_name": actor.full_name,
            },
            "customer": {
                "id": customer.id if customer else None,
                "name": customer.name if customer else None,
                "phone": customer.phone if customer else None,
            },
            "payment": {
                "id": payment.id if payment else None,
                "name_en": payment.name_en if payment else None,
                "name_ar": payment.name_ar if payment else None,
            },
            "items": [_item_log(i) for i in sale.items],
            "items_added": added_log,
            "stock_movements": {str(sid): -need for sid, need in demand.items()},
            "totals": _totals_log(sale),
        },
        request=request,
    )
    names = _seller_names(db, [sale])
    return _serialize(sale, names.get(sale.user_id))


# --------------------------------------------------------------------------- #
# Update existing sale — Admin+
# --------------------------------------------------------------------------- #
@router.put("/{sale_id}")
def update_invoice(
    sale_id: int,
    payload: InvoiceUpdateIn,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role("Admin")),
):
    sale = _load_sale(db, sale_id)
    if not sale:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invoice not found")

    existing = {it.id: it for it in sale.items}
    incoming_ids = {li.id for li in payload.items if li.id}
    for li in payload.items:
        if li.id and li.id not in existing:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "invoices.errors.badItem")

    before = {"totals": _totals_log(sale), "items": [_item_log(i) for i in sale.items]}

    # +ve delta = give back to inventory; -ve = take from inventory.
    stock_delta: dict[int, int] = defaultdict(int)
    removed_log, updated_log, added_log = [], [], []

    # Removals.
    for it in sale.items:
        if it.id not in incoming_ids:
            if it.stock_id:
                stock_delta[it.stock_id] += it.quantity
            removed_log.append(_item_log(it))

    # Updates + new lines.
    new_lines: list[tuple[NewItemIn, VariantStock]] = []
    for li in payload.items:
        if li.id:
            it = existing[li.id]
            delta = li.quantity - it.quantity
            if delta != 0 and it.stock_id:
                stock_delta[it.stock_id] += -delta
        else:
            if not li.stock_id:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "invoices.errors.badItem")
            stock = _load_stock(db, li.stock_id)
            if not stock:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "pos.errors.notFound")
            stock_delta[stock.id] += -li.quantity
            new_lines.append((li, stock))

    # Validate availability for every net-negative movement.
    for sid, delta in stock_delta.items():
        st = db.get(VariantStock, sid)
        if st is None:
            continue
        if int(st.quantity or 0) + delta < 0:
            raise HTTPException(status.HTTP_409_CONFLICT, "invoices.errors.stock")

    # Apply stock movements.
    for sid, delta in stock_delta.items():
        st = db.get(VariantStock, sid)
        if st is not None:
            st.quantity = int(st.quantity or 0) + delta

    # Apply removals.
    for it in list(sale.items):
        if it.id not in incoming_ids:
            sale.items.remove(it)
            db.delete(it)

    # Apply quantity / price updates.
    for li in payload.items:
        if not li.id:
            continue
        it = existing[li.id]
        list_price = round(float(it.list_price or 0), 2)
        min_price = round(float(it.min_price or 0), 2)
        unit = _clamp_price(li.unit_price, min_price, list_price)
        if it.quantity != li.quantity or float(it.unit_price or 0) != unit:
            updated_log.append({
                "sale_item_id": it.id, "code": it.code,
                "quantity": {"from": it.quantity, "to": li.quantity},
                "unit_price": {"from": float(it.unit_price or 0), "to": unit},
            })
        it.quantity = li.quantity
        it.unit_price = unit
        it.line_total = round(unit * li.quantity, 2)

    # Apply new lines.
    for li, stock in new_lines:
        variant = stock.variant
        product = variant.product
        list_price = round(float(product.price or 0), 2)
        min_price = round(float(product.min_price or 0), 2)
        unit = _clamp_price(li.unit_price, min_price, list_price)
        sale.items.append(SaleItem(
            product_id=product.id,
            variant_id=variant.id,
            stock_id=stock.id,
            code=variant.code,
            name=product.name,
            attributes=_attr_snapshot(db, stock),
            unit_price=unit,
            list_price=list_price,
            min_price=min_price,
            quantity=li.quantity,
            line_total=round(unit * li.quantity, 2),
        ))
        added_log.append({"stock_id": stock.id, "code": variant.code,
                          "quantity": li.quantity, "unit_price": unit})

    # Customer / payment.
    if payload.customer is not None:
        normalized_phone = _normalize_phone(payload.customer.phone)
        if not _phone_valid(_phone_regex(db), normalized_phone):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "pos.errors.invalidPhone")
        customer = _upsert_customer(db, payload.customer)
        sale.customer_id = customer.id if customer else None
    sale.payment_method_id = payload.payment_method_id or None

    _recompute(sale)
    db.commit()
    db.refresh(sale)

    payment = db.get(PaymentMethod, sale.payment_method_id) if sale.payment_method_id else None
    log_action(
        db,
        action="invoice.update",
        user_id=actor.id,
        entity="sale",
        entity_id=sale.id,
        details={
            "invoice_no": sale.invoice_no,
            "is_backtrack": bool(sale.is_backtrack),
            "editor": {
                "id": actor.id,
                "username": actor.username,
                "full_name": actor.full_name,
            },
            "customer": _customer_log(sale),
            "payment": {
                "id": payment.id if payment else None,
                "name_en": payment.name_en if payment else None,
                "name_ar": payment.name_ar if payment else None,
            },
            "before": before,
            "after": {
                "totals": _totals_log(sale),
                "items": [_item_log(i) for i in sale.items],
            },
            "items_added": added_log,
            "items_removed": removed_log,
            "items_updated": updated_log,
            "stock_movements": {str(sid): d for sid, d in stock_delta.items() if d},
        },
        request=request,
    )
    names = _seller_names(db, [sale])
    return _serialize(sale, names.get(sale.user_id))
