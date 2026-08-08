"""Funds management — business gross value, revenue and cashflow.

Admin/SuperAdmin only. The model the business runs on:

* **gross value** = total paid to suppliers (product cost) + manual fund entries
* **gross profit** = Σ (qty × sold price) − Σ (qty × supplier price) over sold items
* **current revenue** = gross profit − expenses (all users)
* **estimated revenue** = actual so far + the recent daily run rate × the days left
  in the month / year
* **estimated cashflow** = the recent daily operating rate (sales collected −
  expenses) projected over the next 30 days. Stock purchases are deliberately left
  out: that money is held as inventory and already counted in the gross value.

Monthly series cover the last 12 months; ``baseline`` carries everything older so
the frontend can draw true cumulative lines. Supplier invoices are dated by
``invoice_date`` (falling back to ``created_at``) and expenses by ``spent_at``,
i.e. the accounting date the user chose rather than the row's insert time.
"""
from __future__ import annotations

import calendar
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.core.database import get_db
from app.models.expense import Expense
from app.models.fund import Fund
from app.models.sale import Sale
from app.models.supplier import Supplier
from app.models.supplier_invoice import SupplierInvoice
from app.models.user import User
from app.services.analytics import PROFIT, as_dt, f2, item_query, sum_profit
from app.services.logging import log_action
from app.services.settings import get_currency

router = APIRouter(prefix="/funds", tags=["funds"])

PAGE = 10
MONTHS = 12
TOP_SUPPLIERS = 7
# Trailing window used to derive the daily run rate behind every projection.
RATE_WINDOW = 30

# Supplier invoices are dated by invoice_date, falling back to the insert time.
_INV_DATE = func.coalesce(SupplierInvoice.invoice_date, func.date(SupplierInvoice.created_at))

_f = f2
_as_dt = as_dt
_profit = sum_profit


def _month_key(col):
    return func.date_format(col, "%Y-%m")


def _window_start() -> date:
    """First day of the month, MONTHS-1 months back (start of the 12-month window)."""
    today = date.today()
    y, m = today.year, today.month - (MONTHS - 1)
    while m <= 0:
        m += 12
        y -= 1
    return date(y, m, 1)


def _sum(db: Session, col, *filters) -> float:
    q = db.query(func.coalesce(func.sum(col), 0))
    if filters:
        q = q.filter(*filters)
    return _f(q.scalar())


class FundIn(BaseModel):
    amount: float
    note: str = Field(min_length=1, max_length=2000)
    occurred_at: date


def _validate(payload: FundIn) -> str:
    if payload.amount == 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "funds.errors.amountRequired")
    note = payload.note.strip()
    if not note:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "funds.errors.noteRequired")
    return note


def _serialize(f: Fund) -> dict:
    return {
        "id": f.id,
        "amount": _f(f.amount),
        "note": f.note,
        "occurred_at": f.occurred_at.isoformat() if f.occurred_at else None,
        "created_by": f.creator.username if f.creator else None,
        "created_at": f.created_at.isoformat() if f.created_at else None,
    }


@router.get("/overview")
def overview(db: Session = Depends(get_db), _u: User = Depends(require_role("Admin"))):
    win_start = _window_start()
    win_dt = datetime.combine(win_start, time.min)

    today = date.today()
    month_start = today.replace(day=1)
    year_start = today.replace(month=1, day=1)
    rate_start = today - timedelta(days=RATE_WINDOW - 1)

    # --- headline figures (all time) ---------------------------------------
    supplier_paid = _sum(db, SupplierInvoice.amount)
    manual_funds = _sum(db, Fund.amount)
    gross_value = _f(supplier_paid + manual_funds)
    expenses_total = _sum(db, Expense.amount)
    sales_total = _sum(db, Sale.total)
    # Current revenue: margin actually earned on sold items, less every expense.
    gross_profit = _profit(db)
    revenue = _f(gross_profit - expenses_total)
    revenue_month = _f(
        _profit(db, Sale.created_at >= _as_dt(month_start))
        - _sum(db, Expense.amount, Expense.spent_at >= month_start)
    )
    revenue_year = _f(
        _profit(db, Sale.created_at >= _as_dt(year_start))
        - _sum(db, Expense.amount, Expense.spent_at >= year_start)
    )

    # --- projections from the trailing daily run rate ----------------------
    first_sale = db.query(func.min(Sale.created_at)).scalar()
    active_days = RATE_WINDOW
    if first_sale:
        since_first = (today - first_sale.date()).days + 1
        active_days = max(1, min(RATE_WINDOW, since_first))

    revenue_rate_win = _f(
        _profit(db, Sale.created_at >= _as_dt(rate_start))
        - _sum(db, Expense.amount, Expense.spent_at >= rate_start)
    )
    cash_in_win = _sum(db, Sale.total, Sale.created_at >= _as_dt(rate_start))
    cash_out_win = _sum(db, Expense.amount, Expense.spent_at >= rate_start)

    has_history = first_sale is not None
    revenue_per_day = revenue_rate_win / active_days if has_history else 0.0
    cash_per_day = (cash_in_win - cash_out_win) / active_days if has_history else 0.0

    days_left_month = calendar.monthrange(today.year, today.month)[1] - today.day
    days_left_year = (today.replace(month=12, day=31) - today).days

    # --- pre-window baselines (for cumulative lines) ----------------------
    baseline = {
        "supplier": _sum(db, SupplierInvoice.amount, _INV_DATE < win_start),
        "funds": _sum(db, Fund.amount, Fund.occurred_at < win_start),
        "expenses": _sum(db, Expense.amount, Expense.spent_at < win_start),
        "sales": _sum(db, Sale.total, Sale.created_at < win_dt),
        "profit": _profit(db, Sale.created_at < win_dt),
    }

    # --- monthly series ----------------------------------------------------
    def monthly(col, amount_col, *filters):
        rows = (
            db.query(_month_key(col).label("m"), func.coalesce(func.sum(amount_col), 0))
            .filter(*filters)
            .group_by("m")
            .all()
        )
        return {m: _f(v) for m, v in rows}

    sup_by = monthly(_INV_DATE, SupplierInvoice.amount, _INV_DATE >= win_start)
    fund_by = monthly(Fund.occurred_at, Fund.amount, Fund.occurred_at >= win_start)
    exp_by = monthly(Expense.spent_at, Expense.amount, Expense.spent_at >= win_start)
    sale_by = monthly(Sale.created_at, Sale.total, Sale.created_at >= win_dt)

    profit_by = {
        key: _f(val)
        for key, val in item_query(
            db, [_month_key(Sale.created_at).label("m"), func.coalesce(func.sum(PROFIT), 0)]
        )
        .filter(Sale.created_at >= win_dt)
        .group_by("m")
        .all()
    }

    months = []
    y, m = win_start.year, win_start.month
    for _ in range(MONTHS):
        key = f"{y:04d}-{m:02d}"
        months.append(
            {
                "month": key,
                "supplier": sup_by.get(key, 0.0),
                "funds": fund_by.get(key, 0.0),
                "expenses": exp_by.get(key, 0.0),
                "sales": sale_by.get(key, 0.0),
                "profit": profit_by.get(key, 0.0),
            }
        )
        m += 1
        if m > 12:
            m = 1
            y += 1

    # --- breakdowns --------------------------------------------------------
    sup_rows = (
        db.query(Supplier.name, func.coalesce(func.sum(SupplierInvoice.amount), 0))
        .join(SupplierInvoice, SupplierInvoice.supplier_id == Supplier.id)
        .group_by(Supplier.id, Supplier.name)
        .order_by(func.sum(SupplierInvoice.amount).desc())
        .limit(TOP_SUPPLIERS)
        .all()
    )
    top_suppliers = [{"name": n, "amount": _f(a)} for n, a in sup_rows if _f(a) > 0]

    exp_rows = (
        db.query(Expense.type, Expense.name, func.coalesce(func.sum(Expense.amount), 0))
        .group_by(Expense.type, Expense.name)
        .order_by(func.sum(Expense.amount).desc())
        .all()
    )
    expense_types = [
        {"type": ty, "name": nm, "amount": _f(a)} for ty, nm, a in exp_rows if _f(a) > 0
    ]

    return {
        "currency": get_currency(db),
        "now": datetime.now().isoformat(timespec="seconds"),
        "totals": {
            "supplier_paid": supplier_paid,
            "manual_funds": manual_funds,
            "gross_value": gross_value,
            "expenses": expenses_total,
            "sales": sales_total,
            "gross_profit": gross_profit,
            "revenue": revenue,
            "revenue_month": revenue_month,
            "revenue_year": revenue_year,
            "est_revenue_month": _f(revenue_month + revenue_per_day * days_left_month),
            "est_revenue_year": _f(revenue_year + revenue_per_day * days_left_year),
            "cashflow": _f(cash_per_day * RATE_WINDOW),
            "cash_in": cash_in_win,
            "cash_out": cash_out_win,
            "rate_days": RATE_WINDOW,
            "fund_count": int(db.query(func.count(Fund.id)).scalar() or 0),
        },
        "baseline": baseline,
        "months": months,
        "top_suppliers": top_suppliers,
        "expense_types": expense_types,
    }


@router.get("")
def list_funds(
    db: Session = Depends(get_db),
    _u: User = Depends(require_role("Admin")),
    q: str = Query("", max_length=120),
    page: int = Query(1, ge=1),
    page_size: int = Query(PAGE, ge=1, le=100),
):
    query = db.query(Fund)
    term = q.strip()
    if term:
        query = query.filter(Fund.note.ilike(f"%{term}%"))
    total = query.count()
    rows = (
        query.order_by(Fund.occurred_at.desc(), Fund.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {
        "items": [_serialize(f) for f in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, (total + page_size - 1) // page_size),
        "currency": get_currency(db),
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_fund(
    payload: FundIn,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role("Admin")),
):
    note = _validate(payload)
    f = Fund(
        amount=payload.amount,
        note=note,
        occurred_at=payload.occurred_at,
        created_by_id=actor.id,
    )
    db.add(f)
    db.commit()
    db.refresh(f)
    log_action(
        db, action="fund.create", user_id=actor.id, entity="fund", entity_id=f.id,
        details={"amount": _f(f.amount), "occurred_at": f.occurred_at.isoformat()},
        request=request,
    )
    return _serialize(f)


@router.put("/{fund_id}")
def update_fund(
    fund_id: int,
    payload: FundIn,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role("Admin")),
):
    f = db.get(Fund, fund_id)
    if not f:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fund not found")
    before = _f(f.amount)
    f.note = _validate(payload)
    f.amount = payload.amount
    f.occurred_at = payload.occurred_at
    db.commit()
    db.refresh(f)
    log_action(
        db, action="fund.update", user_id=actor.id, entity="fund", entity_id=f.id,
        details={"before": before, "after": _f(f.amount)}, request=request,
    )
    return _serialize(f)


@router.delete("/{fund_id}")
def delete_fund(
    fund_id: int,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role("Admin")),
):
    f = db.get(Fund, fund_id)
    if not f:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fund not found")
    log_action(
        db, action="fund.delete", user_id=actor.id, entity="fund", entity_id=f.id,
        details={"amount": _f(f.amount), "note": f.note}, request=request,
    )
    db.delete(f)
    db.commit()
    return {"ok": True}
