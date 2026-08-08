"""Shared analytics building blocks for the dashboard, reports and funds pages.

Keeping the money expressions in one place means every screen agrees on what
"revenue", "cost" and "profit" mean:

* **revenue** — ``sale_items.line_total``, i.e. what the customer actually paid
  for the line (already net of any per-line discount).
* **cost** — quantity × the product's current ``supplier_price``.
* **profit** — revenue − cost.

Sale lines join back to ``products`` with an OUTER join, so a line whose product
row has since disappeared still contributes its revenue (at zero cost) instead of
dropping out of the totals.
"""
from __future__ import annotations

from datetime import date, datetime, time

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.product import Product
from app.models.sale import Sale, SaleItem

CASH_CODE = "cash"
# On-hand at or below this counts as "low stock" (0 is reported separately).
LOW_STOCK_AT = 5

REVENUE = SaleItem.line_total
COST = SaleItem.quantity * func.coalesce(Product.supplier_price, 0)
PROFIT = REVENUE - COST


def f2(v) -> float:
    """Money/rounding helper — every figure leaves the API at 2 decimals."""
    return round(float(v or 0), 2)


def pct(part: float, whole: float) -> float:
    return f2(part / whole * 100) if whole else 0.0


def growth(current: float, previous: float) -> float | None:
    """Percentage change, or None when there is no baseline to compare against."""
    if not previous:
        return None
    return f2((current - previous) / abs(previous) * 100)


def as_dt(d: date) -> datetime:
    return datetime.combine(d, time.min)


def month_key(col):
    return func.date_format(col, "%Y-%m")


def day_key(col):
    return func.date(col)


def item_query(db: Session, selects):
    """Sale lines joined to sale + product, so revenue and cost are both reachable."""
    return (
        db.query(*selects)
        .select_from(SaleItem)
        .join(Sale, SaleItem.sale_id == Sale.id)
        .outerjoin(Product, SaleItem.product_id == Product.id)
    )


def sum_profit(db: Session, *filters) -> float:
    q = item_query(db, [func.coalesce(func.sum(PROFIT), 0)])
    if filters:
        q = q.filter(*filters)
    return f2(q.scalar())


def sum_of(db: Session, col, *filters) -> float:
    q = db.query(func.coalesce(func.sum(col), 0))
    if filters:
        q = q.filter(*filters)
    return f2(q.scalar())


def count_of(db: Session, col, *filters) -> int:
    q = db.query(func.count(col))
    if filters:
        q = q.filter(*filters)
    return int(q.scalar() or 0)
