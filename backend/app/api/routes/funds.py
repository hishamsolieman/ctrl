"""Funds management — clothing-shop financial metrics (T, COGS, R, E, P, M, S, F, C, B).

Admin/SuperAdmin only. Formulas follow the reference guide in ``ref/documents``:

* **T**    — Total sales revenue = Σ (qty sold × selling price)          [period]
* **COGS** — Cost of goods sold  = Σ (qty sold × supplier unit price)     [period]
* **R**    — Gross profit        = T − COGS                               [period]
* **E**    — Operating expenses  = Σ expenses                             [period]
* **P**    — Net profit          = R − E                                  [period]
* **M**    — Net profit margin   = (P ÷ T) × 100                          [period]
* **S**    — Stock value at cost = Σ (on-hand qty × supplier price)       [now]
* **F**    — Funds / reserve      = Σ fund entries (up to period end)      [point]
* **C**    — Current cash flow    = P + F                                  [derived]
* **B**    — Business capital      = F + S + P                             [derived]

Every metric also carries a **month-end estimate** derived from the shop's recent
daily run rate applied to the remainder of the current calendar month.

Charts: period-scoped cashflow, profit path, net-margin trend, business-capital
composition and expenses-by-type. Metric PDFs are served from ``app_documents``.
"""
from __future__ import annotations

import base64
import calendar
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.core.database import get_db
from app.models.document import AppDocument
from app.models.expense import Expense
from app.models.fund import Fund
from app.models.product import Product, ProductVariant, VariantStock
from app.models.sale import Sale
from app.models.user import User
from app.services.analytics import COST, as_dt, f2, item_query
from app.services.logging import log_action
from app.services.settings import get_currency

router = APIRouter(prefix="/funds", tags=["funds"])

PAGE = 10
RATE_WINDOW = 30
DOC_KEY = "funds_metrics"
PERIODS = {
    "all_time",
    "yesterday",
    "last_week",
    "last_month",
    "last_quarter",
    "last_year",
    "custom",
}

_f = f2
_as_dt = as_dt


def _sum(db: Session, col, *filters) -> float:
    q = db.query(func.coalesce(func.sum(col), 0))
    if filters:
        q = q.filter(*filters)
    return _f(q.scalar())


def _cogs(db: Session, *filters) -> float:
    q = item_query(db, [func.coalesce(func.sum(COST), 0)])
    if filters:
        q = q.filter(*filters)
    return _f(q.scalar())


def _stock_value(db: Session) -> float:
    """S = Σ (on-hand qty × supplier price) across live products/variants."""
    return _f(
        db.query(
            func.coalesce(
                func.sum(VariantStock.quantity * func.coalesce(Product.supplier_price, 0)),
                0,
            )
        )
        .select_from(VariantStock)
        .join(ProductVariant, VariantStock.variant_id == ProductVariant.id)
        .join(Product, ProductVariant.product_id == Product.id)
        .filter(Product.is_deleted.is_(False), ProductVariant.is_deleted.is_(False))
        .scalar()
    )


def _resolve_period(
    period: str, date_from: date | None, date_to: date | None
) -> tuple[date | None, date | None]:
    today = date.today()
    p = (period or "all_time").strip().lower()
    if p not in PERIODS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "funds.errors.invalidPeriod")
    if p == "all_time":
        return None, None
    if p == "yesterday":
        d = today - timedelta(days=1)
        return d, d
    if p == "last_week":
        this_monday = today - timedelta(days=today.weekday())
        return this_monday - timedelta(days=7), this_monday - timedelta(days=1)
    if p == "last_month":
        first_this = today.replace(day=1)
        end = first_this - timedelta(days=1)
        return end.replace(day=1), end
    if p == "last_quarter":
        q = (today.month - 1) // 3
        if q == 0:
            y, start_m, end_m = today.year - 1, 10, 12
        else:
            y, start_m, end_m = today.year, (q - 1) * 3 + 1, q * 3
        return date(y, start_m, 1), date(y, end_m, calendar.monthrange(y, end_m)[1])
    if p == "last_year":
        y = today.year - 1
        return date(y, 1, 1), date(y, 12, 31)
    # custom
    if not date_from or not date_to:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "funds.errors.customDatesRequired")
    if date_from > date_to:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "funds.errors.dateRangeInvalid")
    return date_from, date_to


def _sale_filters(start: date | None, end: date | None) -> list:
    filters = []
    if start:
        filters.append(Sale.created_at >= _as_dt(start))
    if end:
        filters.append(Sale.created_at < _as_dt(end + timedelta(days=1)))
    return filters


def _expense_filters(start: date | None, end: date | None) -> list:
    filters = []
    if start:
        filters.append(Expense.spent_at >= start)
    if end:
        filters.append(Expense.spent_at <= end)
    return filters


def _metrics(
    db: Session,
    start: date | None,
    end: date | None,
    *,
    include_point_in_time: bool = True,
) -> dict:
    """Compute the 10 metrics for the window [start, end] (None = open-ended)."""
    sf = _sale_filters(start, end)
    ef = _expense_filters(start, end)
    T = _sum(db, Sale.total, *sf)
    COGS = _cogs(db, *sf)
    R = _f(T - COGS)
    E = _sum(db, Expense.amount, *ef)
    P = _f(R - E)
    M = _f(P / T * 100) if T else 0.0
    S = _stock_value(db) if include_point_in_time else 0.0
    F = 0.0
    if include_point_in_time:
        fund_filters = [Fund.occurred_at <= end] if end else []
        F = _sum(db, Fund.amount, *fund_filters)
    C = _f(P + F)
    B = _f(F + S + P)
    return {"T": T, "COGS": COGS, "R": R, "E": E, "P": P, "M": M, "S": S, "F": F, "C": C, "B": B}


def _month_end_estimates(db: Session, today: date) -> dict:
    """Project current-month metrics to month end using the trailing run rate."""
    month_start = today.replace(day=1)
    rate_start = today - timedelta(days=RATE_WINDOW - 1)
    days_left = calendar.monthrange(today.year, today.month)[1] - today.day

    first_sale = db.query(func.min(Sale.created_at)).scalar()
    active = RATE_WINDOW
    if first_sale:
        since_first = (today - first_sale.date()).days + 1
        active = max(1, min(RATE_WINDOW, since_first))

    mtd = _metrics(db, month_start, today)
    win = _metrics(db, rate_start, today, include_point_in_time=False)

    def project(key: str) -> float:
        return _f(mtd[key] + (win[key] / active) * days_left)

    est: dict[str, float] = {}
    est["T"] = project("T")
    est["COGS"] = project("COGS")
    est["R"] = _f(est["T"] - est["COGS"])
    est["E"] = project("E")
    est["P"] = _f(est["R"] - est["E"])
    est["M"] = _f(est["P"] / est["T"] * 100) if est["T"] else 0.0
    # Point-in-time metrics stay current (no reliable per-day stock reconstruction).
    est["S"] = mtd["S"]
    est["F"] = mtd["F"]
    est["C"] = _f(est["P"] + est["F"])
    est["B"] = _f(est["F"] + est["S"] + est["P"])
    return est


def _series_bounds(db: Session, start: date | None, end: date | None) -> tuple[date, date]:
    today = date.today()
    if start and end:
        return start, end
    first_sale = db.query(func.min(Sale.created_at)).scalar()
    first_exp = db.query(func.min(Expense.spent_at)).scalar()
    candidates = [today]
    if first_sale:
        candidates.append(first_sale.date())
    if first_exp:
        candidates.append(first_exp)
    earliest = min(candidates)
    # Cap the all-time chart to ~24 months for readability.
    floor = today - timedelta(days=730)
    return max(earliest, floor), today


def _buckets(start: date, end: date) -> list[tuple[str, date, date]]:
    """Split [start, end] into daily / weekly / monthly buckets by span."""
    span = (end - start).days + 1
    out: list[tuple[str, date, date]] = []
    if span <= 45:
        d = start
        while d <= end:
            out.append((d.isoformat(), d, d))
            d += timedelta(days=1)
        return out
    if span <= 190:
        d = start
        while d <= end:
            wk_end = min(d + timedelta(days=6), end)
            out.append((d.isoformat(), d, wk_end))
            d = wk_end + timedelta(days=1)
        return out
    y, m = start.year, start.month
    while date(y, m, 1) <= end:
        b_start = max(date(y, m, 1), start)
        b_end = min(date(y, m, calendar.monthrange(y, m)[1]), end)
        if b_start <= b_end:
            out.append((f"{y:04d}-{m:02d}", b_start, b_end))
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return out


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
def overview(
    db: Session = Depends(get_db),
    _u: User = Depends(require_role("Admin")),
    period: str = Query("all_time"),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
):
    start, end = _resolve_period(period, date_from, date_to)
    today = date.today()
    metrics = _metrics(db, start, end)
    estimates = _month_end_estimates(db, today)

    s_start, s_end = _series_bounds(db, start, end)
    cashflow = []
    margin_trend = []
    for key, b_start, b_end in _buckets(s_start, s_end):
        bm = _metrics(db, b_start, b_end, include_point_in_time=False)
        cashflow.append(
            {"key": key, "sales": bm["T"], "expenses": bm["E"], "net": _f(bm["T"] - bm["E"])}
        )
        margin_trend.append({"key": key, "margin": bm["M"]})

    profit_path = [
        {"key": "T", "value": metrics["T"]},
        {"key": "COGS", "value": metrics["COGS"]},
        {"key": "R", "value": metrics["R"]},
        {"key": "E", "value": metrics["E"]},
        {"key": "P", "value": metrics["P"]},
    ]
    capital = [
        {"key": "F", "value": max(metrics["F"], 0.0)},
        {"key": "S", "value": max(metrics["S"], 0.0)},
        {"key": "P", "value": max(metrics["P"], 0.0)},
    ]

    exp_rows = (
        db.query(Expense.type, Expense.name, func.coalesce(func.sum(Expense.amount), 0))
        .filter(*_expense_filters(start, end))
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
        "period": {
            "preset": (period or "all_time").strip().lower(),
            "date_from": start.isoformat() if start else None,
            "date_to": end.isoformat() if end else None,
        },
        "metrics": metrics,
        "estimates": estimates,
        "cashflow": cashflow,
        "margin_trend": margin_trend,
        "profit_path": profit_path,
        "capital": capital,
        "expense_types": expense_types,
        "fund_count": int(db.query(func.count(Fund.id)).scalar() or 0),
    }


@router.get("/docs")
def download_docs(
    db: Session = Depends(get_db),
    _u: User = Depends(require_role("Admin")),
    locale: str = Query("en"),
):
    loc = (locale or "en").strip().lower()
    if loc not in ("en", "ar"):
        loc = "en"
    doc = (
        db.query(AppDocument)
        .filter(AppDocument.doc_key == DOC_KEY, AppDocument.locale == loc)
        .first()
    )
    if not doc:  # fall back to whichever language exists
        doc = db.query(AppDocument).filter(AppDocument.doc_key == DOC_KEY).first()
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "funds.errors.docsMissing")
    try:
        raw = base64.b64decode(doc.data)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Corrupt document") from exc
    return Response(
        content=raw,
        media_type=doc.mime or "application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{doc.filename}"',
            "Cache-Control": "private, no-store",
        },
    )


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
