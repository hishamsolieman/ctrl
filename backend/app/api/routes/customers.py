"""Customers: read-only directory + per-customer sales history.

Customers are created implicitly at the POS (by phone). This module exposes a
management view: headline stats, a searchable list with per-customer order
aggregates, and each customer's invoices (with line items). Only the *name* may
be edited — customers are never deleted from here.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user, require_role
from app.core.database import get_db
from app.models.customer import Customer
from app.models.sale import Sale
from app.models.user import User
from app.services.logging import log_action
from app.services.settings import get_currency

router = APIRouter(prefix="/customers", tags=["customers"])


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class CustomerUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=180)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _month_bounds(now: datetime | None = None) -> tuple[datetime, datetime]:
    """(start_of_this_month, start_of_last_month) at 00:00."""
    now = now or datetime.now()
    start_this = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if start_this.month == 1:
        start_last = start_this.replace(year=start_this.year - 1, month=12)
    else:
        start_last = start_this.replace(month=start_this.month - 1)
    return start_this, start_last


def _trend(month: float, prev: float) -> dict:
    if month > prev:
        direction = "up"
    elif month < prev:
        direction = "down"
    else:
        direction = "flat"
    return {"month": round(month, 2), "prev": round(prev, 2), "dir": direction}


def _aggregates(db: Session) -> dict[int, dict]:
    """{customer_id: {orders, spent, last_order_at}} across all their sales."""
    rows = (
        db.query(
            Sale.customer_id,
            func.count(Sale.id),
            func.coalesce(func.sum(Sale.total), 0),
            func.max(Sale.created_at),
        )
        .filter(Sale.customer_id.isnot(None))
        .group_by(Sale.customer_id)
        .all()
    )
    return {
        cid: {
            "orders": int(cnt or 0),
            "spent": round(float(spent or 0), 2),
            "last_order_at": last.isoformat() if last else None,
        }
        for cid, cnt, spent, last in rows
    }


def _serialize(c: Customer, agg: dict[int, dict]) -> dict:
    a = agg.get(c.id, {})
    return {
        "id": c.id,
        "name": c.name,
        "phone": c.phone,
        "orders": a.get("orders", 0),
        "spent": a.get("spent", 0.0),
        "last_order_at": a.get("last_order_at"),
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def _serialize_sale(sale: Sale) -> dict:
    return {
        "id": sale.id,
        "invoice_no": sale.invoice_no,
        "created_at": sale.created_at.isoformat() if sale.created_at else None,
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
# Read
# --------------------------------------------------------------------------- #
@router.get("")
def list_customers(db: Session = Depends(get_db), _u: User = Depends(get_current_user)):
    agg = _aggregates(db)
    rows = db.query(Customer).order_by(func.lower(Customer.name)).all()
    return [_serialize(c, agg) for c in rows]


@router.get("/stats")
def customer_stats(db: Session = Depends(get_db), _u: User = Depends(get_current_user)):
    start_this, start_last = _month_bounds()
    agg = _aggregates(db)
    customers = db.query(Customer).all()
    total = len(customers)

    orders = sum(a["orders"] for a in agg.values())
    revenue = round(sum(a["spent"] for a in agg.values()), 2)

    # Top customer by lifetime spend.
    top = None
    if agg:
        best_id = max(agg, key=lambda cid: agg[cid]["spent"])
        if agg[best_id]["spent"] > 0:
            best = db.get(Customer, best_id)
            if best:
                top = {"name": best.name, "spent": agg[best_id]["spent"]}

    # New customers this vs last month.
    cust_month = sum(1 for c in customers if c.created_at and c.created_at >= start_this)
    cust_prev = sum(
        1 for c in customers if c.created_at and start_last <= c.created_at < start_this
    )

    # Orders + revenue this vs last month (by sale date).
    sales = db.query(Sale.created_at, Sale.total).filter(Sale.customer_id.isnot(None)).all()
    ord_month = ord_prev = 0
    rev_month = rev_prev = 0.0
    for created_at, tot in sales:
        if not created_at:
            continue
        if created_at >= start_this:
            ord_month += 1
            rev_month += float(tot or 0)
        elif created_at >= start_last:
            ord_prev += 1
            rev_prev += float(tot or 0)

    return {
        "total": total,
        "totalTrend": _trend(cust_month, cust_prev),
        "orders": orders,
        "ordersTrend": _trend(ord_month, ord_prev),
        "revenue": revenue,
        "revenueTrend": _trend(rev_month, rev_prev),
        "currency": get_currency(db),
        "top": top,
    }


@router.get("/{customer_id}/sales")
def customer_sales(
    customer_id: int,
    db: Session = Depends(get_db),
    _u: User = Depends(get_current_user),
):
    cust = db.get(Customer, customer_id)
    if not cust:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
    sales = (
        db.query(Sale)
        .options(selectinload(Sale.items))
        .filter(Sale.customer_id == customer_id)
        .order_by(Sale.created_at.desc(), Sale.id.desc())
        .all()
    )
    return [_serialize_sale(s) for s in sales]


# --------------------------------------------------------------------------- #
# Update (name only) — no create/delete from here.
# --------------------------------------------------------------------------- #
@router.patch("/{customer_id}")
def update_customer(
    customer_id: int,
    payload: CustomerUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    cust = db.get(Customer, customer_id)
    if not cust:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
    cust.name = payload.name.strip()
    db.commit()
    db.refresh(cust)
    log_action(db, action="customer.update", user_id=user.id, entity="customer",
               entity_id=cust.id, request=request)
    return _serialize(cust, _aggregates(db))
