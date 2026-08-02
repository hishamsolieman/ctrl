"""Suppliers: CRUD, delete-constraint, and headline stats for the page cards."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_role
from app.core.database import get_db
from app.models.product import Product
from app.models.supplier import Supplier
from app.models.user import User
from app.services.logging import log_action
from app.services.settings import get_currency

router = APIRouter(prefix="/suppliers", tags=["suppliers"])


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class SupplierIn(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    phone: str | None = None
    email: str | None = None
    address: str = Field(min_length=1)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _active_product_counts(db: Session) -> dict[int, int]:
    """{supplier_id: number of non-deleted products}."""
    rows = (
        db.query(Product.supplier_id, func.count(Product.id))
        .filter(Product.is_deleted.is_(False), Product.supplier_id.isnot(None))
        .group_by(Product.supplier_id)
        .all()
    )
    return {sid: cnt for sid, cnt in rows}


def _active_usage(db: Session, supplier_id: int) -> int:
    return (
        db.query(Product.id)
        .filter(Product.supplier_id == supplier_id, Product.is_deleted.is_(False))
        .count()
    )


def _serialize(s: Supplier, counts: dict[int, int]) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "phone": s.phone,
        "email": s.email,
        "address": s.address,
        "product_count": counts.get(s.id, 0),
    }


def _month_bounds(now: datetime | None = None) -> tuple[datetime, datetime]:
    """(start_of_this_month, start_of_last_month) at 00:00."""
    now = now or datetime.now()
    start_this = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if start_this.month == 1:
        start_last = start_this.replace(year=start_this.year - 1, month=12)
    else:
        start_last = start_this.replace(month=start_this.month - 1)
    return start_this, start_last


def _spend_by_supplier(db: Session) -> dict[int, float]:
    """Total money paid to each supplier: supplier_price x on-hand quantity,
    summed across every non-deleted product/variant."""
    spend: dict[int, float] = {}
    products = (
        db.query(Product)
        .filter(Product.is_deleted.is_(False), Product.supplier_id.isnot(None))
        .all()
    )
    for p in products:
        qty = sum(v.quantity or 0 for v in p.variants if not v.is_deleted)
        spend[p.supplier_id] = spend.get(p.supplier_id, 0.0) + float(p.supplier_price or 0) * qty
    return spend


def _trend(month: float, prev: float) -> dict:
    if month > prev:
        direction = "up"
    elif month < prev:
        direction = "down"
    else:
        direction = "flat"
    return {"month": round(month, 2), "prev": round(prev, 2), "dir": direction}


# --------------------------------------------------------------------------- #
# Read
# --------------------------------------------------------------------------- #
@router.get("")
def list_suppliers(db: Session = Depends(get_db), _u: User = Depends(get_current_user)):
    counts = _active_product_counts(db)
    rows = (
        db.query(Supplier)
        .filter(Supplier.is_active.is_(True))
        .order_by(func.lower(Supplier.name))
        .all()
    )
    return [_serialize(s, counts) for s in rows]


@router.get("/stats")
def supplier_stats(db: Session = Depends(get_db), _u: User = Depends(get_current_user)):
    """Headline numbers + month-over-month trends for the page's stat cards.

    Note: with no purchase/transaction ledger in the schema, "this month" is
    derived from ``created_at`` (products/suppliers added this month). Spend uses
    ``supplier_price x on-hand quantity``.
    """
    start_this, start_last = _month_bounds()
    counts = _active_product_counts(db)
    spend = _spend_by_supplier(db)
    suppliers = db.query(Supplier).filter(Supplier.is_active.is_(True)).all()
    total = len(suppliers)
    products = sum(counts.get(s.id, 0) for s in suppliers)
    total_spend = round(sum(spend.get(s.id, 0.0) for s in suppliers), 2)

    top = None
    if suppliers:
        best = max(suppliers, key=lambda s: spend.get(s.id, 0.0))
        if spend.get(best.id, 0.0) > 0:
            top = {"name": best.name, "spend": round(spend.get(best.id, 0.0), 2)}

    # New suppliers this month vs last month.
    sup_month = sum(1 for s in suppliers if s.created_at and s.created_at >= start_this)
    sup_prev = sum(
        1 for s in suppliers
        if s.created_at and start_last <= s.created_at < start_this
    )

    # Products added (bought) & spend, this month vs last month.
    live = (
        db.query(Product)
        .filter(Product.is_deleted.is_(False), Product.supplier_id.isnot(None))
        .all()
    )
    prod_month = prod_prev = 0
    spend_month = spend_prev = 0.0
    for p in live:
        if not p.created_at:
            continue
        qty = sum(v.quantity or 0 for v in p.variants if not v.is_deleted)
        val = float(p.supplier_price or 0) * qty
        if p.created_at >= start_this:
            prod_month += 1
            spend_month += val
        elif p.created_at >= start_last:
            prod_prev += 1
            spend_prev += val

    return {
        "total": total,
        "totalTrend": _trend(sup_month, sup_prev),
        "products": products,
        "productsTrend": _trend(prod_month, prod_prev),
        "spend": total_spend,
        "spendTrend": _trend(spend_month, spend_prev),
        "currency": get_currency(db),
        "top": top,
    }


@router.get("/{supplier_id}")
def get_supplier(
    supplier_id: int,
    db: Session = Depends(get_db),
    _u: User = Depends(get_current_user),
):
    s = db.get(Supplier, supplier_id)
    if not s or not s.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Supplier not found")
    return _serialize(s, _active_product_counts(db))


# --------------------------------------------------------------------------- #
# Create / Update / Delete
# --------------------------------------------------------------------------- #
def _name_taken(db: Session, name: str, exclude_id: int | None = None) -> bool:
    q = db.query(Supplier.id).filter(
        Supplier.is_active.is_(True), func.lower(Supplier.name) == name.strip().lower()
    )
    if exclude_id is not None:
        q = q.filter(Supplier.id != exclude_id)
    return db.query(q.exists()).scalar()


@router.post("", status_code=status.HTTP_201_CREATED)
def create_supplier(
    payload: SupplierIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    if _name_taken(db, payload.name):
        raise HTTPException(status.HTTP_409_CONFLICT, "suppliers.errors.nameTaken")
    sup = Supplier(
        name=payload.name.strip(),
        phone=(payload.phone or "").strip() or None,
        email=(payload.email or "").strip() or None,
        address=payload.address.strip(),
        is_active=True,
    )
    db.add(sup)
    db.commit()
    db.refresh(sup)
    log_action(db, action="supplier.create", user_id=user.id, entity="supplier",
               entity_id=sup.id, request=request)
    return _serialize(sup, _active_product_counts(db))


@router.put("/{supplier_id}")
def update_supplier(
    supplier_id: int,
    payload: SupplierIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    sup = db.get(Supplier, supplier_id)
    if not sup or not sup.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Supplier not found")
    if _name_taken(db, payload.name, exclude_id=supplier_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "suppliers.errors.nameTaken")
    sup.name = payload.name.strip()
    sup.phone = (payload.phone or "").strip() or None
    sup.email = (payload.email or "").strip() or None
    sup.address = payload.address.strip()
    db.commit()
    db.refresh(sup)
    log_action(db, action="supplier.update", user_id=user.id, entity="supplier",
               entity_id=sup.id, request=request)
    return _serialize(sup, _active_product_counts(db))


@router.delete("/{supplier_id}")
def delete_supplier(
    supplier_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    """Remove a supplier. Blocked while active products still reference it;
    soft-deleted products are detached (supplier_id -> NULL)."""
    sup = db.get(Supplier, supplier_id)
    if not sup or not sup.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Supplier not found")
    used = _active_usage(db, supplier_id)
    if used > 0:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Supplier is used by {used} product(s) and cannot be deleted.",
        )
    db.query(Product).filter(Product.supplier_id == supplier_id).update(
        {Product.supplier_id: None}, synchronize_session=False
    )
    db.delete(sup)
    db.commit()
    log_action(db, action="supplier.delete", user_id=user.id, entity="supplier",
               entity_id=supplier_id, request=request)
    return {"ok": True, "id": supplier_id}
