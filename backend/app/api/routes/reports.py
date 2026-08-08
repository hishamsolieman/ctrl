"""Business report — one dense dataset behind the printable A4 report.

Admin/SuperAdmin only. Everything is bounded by an inclusive ``date_from`` →
``date_to`` range and compared against the immediately preceding window of the
same length, so the printed report can show period-over-period movement. Detail
tables are capped (see the ``LIMIT_*`` constants) to keep both the response and
the printed document sane.

Inventory figures are a *snapshot at generation time* — stock has no history to
replay — while every money figure is scoped to the requested range.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.core.database import get_db
from app.models.category import Category
from app.models.customer import Customer
from app.models.expense import Expense
from app.models.fund import Fund
from app.models.payment_method import PaymentMethod
from app.models.product import Product, ProductVariant, VariantStock
from app.models.sale import Sale, SaleItem
from app.models.supplier import Supplier
from app.models.supplier_invoice import SupplierInvoice
from app.models.user import User
from app.services.analytics import (
    CASH_CODE,
    LOW_STOCK_AT,
    PROFIT,
    REVENUE,
    as_dt,
    count_of,
    f2,
    growth,
    item_query,
    pct,
    sum_of,
    sum_profit,
)
from app.services.logging import log_action
from app.services.settings import get_currency

router = APIRouter(prefix="/reports", tags=["reports"])

MAX_RANGE_DAYS = 1830  # ~5 years
LIMIT_PRODUCTS = 40
LIMIT_CUSTOMERS = 25
LIMIT_STAFF = 25
LIMIT_EXPENSES = 60
LIMIT_SUPPLIER_INVOICES = 40
LIMIT_FUNDS = 40
LIMIT_LOW_STOCK = 25
LIMIT_INVOICES = 150

_INV_DATE = func.coalesce(SupplierInvoice.invoice_date, func.date(SupplierInvoice.created_at))


def _stock_base(db: Session, selects):
    return (
        db.query(*selects)
        .select_from(VariantStock)
        .join(ProductVariant, VariantStock.variant_id == ProductVariant.id)
        .join(Product, ProductVariant.product_id == Product.id)
        .filter(Product.is_deleted.is_(False), ProductVariant.is_deleted.is_(False))
    )


def _period(db: Session, start: datetime, end: datetime) -> dict:
    """Core money figures for one window (used for the range and its predecessor)."""
    count, amount, items, discount, subtotal = (
        db.query(
            func.count(Sale.id),
            func.coalesce(func.sum(Sale.total), 0),
            func.coalesce(func.sum(Sale.item_count), 0),
            func.coalesce(func.sum(Sale.discount), 0),
            func.coalesce(func.sum(Sale.subtotal), 0),
        )
        .filter(Sale.created_at >= start, Sale.created_at < end)
        .one()
    )
    count, amount = int(count or 0), f2(amount)
    profit = sum_profit(db, Sale.created_at >= start, Sale.created_at < end)
    expenses = sum_of(db, Expense.amount, Expense.spent_at >= start.date(), Expense.spent_at < end.date())
    cash = f2(
        db.query(func.coalesce(func.sum(Sale.total), 0))
        .join(PaymentMethod, Sale.payment_method_id == PaymentMethod.id)
        .filter(Sale.created_at >= start, Sale.created_at < end, PaymentMethod.code == CASH_CODE)
        .scalar()
    )
    return {
        "sales_count": count,
        "sales_amount": amount,
        "subtotal": f2(subtotal),
        "discount": f2(discount),
        "items": int(items or 0),
        "avg_ticket": f2(amount / count) if count else 0.0,
        "gross_profit": profit,
        "margin_pct": pct(profit, amount),
        "expenses": expenses,
        "net_profit": f2(profit - expenses),
        "cash": cash,
        "card": f2(amount - cash),
        "cost": f2(amount - profit),
    }


@router.get("/business")
def business_report(
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role("Admin")),
    date_from: date = Query(...),
    date_to: date = Query(...),
):
    if date_from > date_to:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "report.errors.range")
    span = (date_to - date_from).days + 1
    if span > MAX_RANGE_DAYS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "report.errors.tooLong")

    start = as_dt(date_from)
    end = as_dt(date_to + timedelta(days=1))
    prev_start = as_dt(date_from - timedelta(days=span))
    prev_end = start
    in_range = [Sale.created_at >= start, Sale.created_at < end]

    current = _period(db, start, end)
    previous = _period(db, prev_start, prev_end)
    deltas = {k: growth(current[k], previous[k]) for k in current if isinstance(current[k], (int, float))}

    # --- customers ---------------------------------------------------------
    served = int(
        db.query(func.count(func.distinct(Sale.customer_id)))
        .filter(*in_range, Sale.customer_id.isnot(None))
        .scalar()
        or 0
    )
    new_customers = count_of(db, Customer.id, Customer.created_at >= start, Customer.created_at < end)

    # --- series ------------------------------------------------------------
    day_rows = (
        db.query(
            func.date(Sale.created_at).label("d"),
            func.count(Sale.id),
            func.coalesce(func.sum(Sale.total), 0),
        )
        .filter(*in_range)
        .group_by("d")
        .all()
    )
    by_day = {str(d): (int(c or 0), f2(a)) for d, c, a in day_rows}
    profit_day = {
        str(d): f2(p)
        for d, p in item_query(
            db, [func.date(Sale.created_at).label("d"), func.coalesce(func.sum(PROFIT), 0)]
        )
        .filter(*in_range)
        .group_by("d")
        .all()
    }
    daily = []
    for i in range(span):
        d = (date_from + timedelta(days=i)).isoformat()
        count, amount = by_day.get(d, (0, 0.0))
        daily.append(
            {"date": d, "count": count, "amount": amount, "profit": profit_day.get(d, 0.0)}
        )

    month_rows = (
        db.query(
            func.date_format(Sale.created_at, "%Y-%m").label("m"),
            func.count(Sale.id),
            func.coalesce(func.sum(Sale.total), 0),
        )
        .filter(*in_range)
        .group_by("m")
        .all()
    )
    month_profit = {
        m: f2(p)
        for m, p in item_query(
            db,
            [func.date_format(Sale.created_at, "%Y-%m").label("m"), func.coalesce(func.sum(PROFIT), 0)],
        )
        .filter(*in_range)
        .group_by("m")
        .all()
    }
    month_exp = {
        m: f2(a)
        for m, a in db.query(
            func.date_format(Expense.spent_at, "%Y-%m").label("m"),
            func.coalesce(func.sum(Expense.amount), 0),
        )
        .filter(Expense.spent_at >= date_from, Expense.spent_at <= date_to)
        .group_by("m")
        .all()
    }
    monthly = sorted(
        (
            {
                "month": m,
                "count": int(c or 0),
                "sales": f2(a),
                "profit": month_profit.get(m, 0.0),
                "expenses": month_exp.get(m, 0.0),
            }
            for m, c, a in month_rows
        ),
        key=lambda r: r["month"],
    )

    hour_rows = (
        db.query(
            func.hour(Sale.created_at).label("h"),
            func.count(Sale.id),
            func.coalesce(func.sum(Sale.total), 0),
        )
        .filter(*in_range)
        .group_by("h")
        .all()
    )
    by_hour = {int(h): (int(c or 0), f2(a)) for h, c, a in hour_rows}
    hourly = [
        {"hour": h, "count": by_hour.get(h, (0, 0.0))[0], "amount": by_hour.get(h, (0, 0.0))[1]}
        for h in range(24)
    ]

    dow_rows = (
        db.query(
            func.dayofweek(Sale.created_at).label("w"),
            func.count(Sale.id),
            func.coalesce(func.sum(Sale.total), 0),
        )
        .filter(*in_range)
        .group_by("w")
        .all()
    )
    by_dow = {int(w): (int(c or 0), f2(a)) for w, c, a in dow_rows}
    weekday = [
        {"dow": i, "count": by_dow.get(i + 1, (0, 0.0))[0], "amount": by_dow.get(i + 1, (0, 0.0))[1]}
        for i in range(7)
    ]

    # --- breakdowns --------------------------------------------------------
    payments = [
        {"code": c, "name_en": en, "name_ar": ar, "count": int(n or 0), "amount": f2(a)}
        for c, en, ar, n, a in db.query(
            PaymentMethod.code,
            PaymentMethod.name_en,
            PaymentMethod.name_ar,
            func.count(Sale.id),
            func.coalesce(func.sum(Sale.total), 0),
        )
        .join(Sale, Sale.payment_method_id == PaymentMethod.id)
        .filter(*in_range)
        .group_by(PaymentMethod.id, PaymentMethod.code, PaymentMethod.name_en, PaymentMethod.name_ar)
        .order_by(func.sum(Sale.total).desc())
        .all()
    ]

    categories = [
        {
            "name_en": en,
            "name_ar": ar,
            "quantity": int(q or 0),
            "amount": f2(a),
            "profit": f2(p),
            "margin_pct": pct(f2(p), f2(a)),
        }
        for en, ar, q, a, p in item_query(
            db,
            [
                Category.name_en,
                Category.name_ar,
                func.coalesce(func.sum(SaleItem.quantity), 0),
                func.coalesce(func.sum(REVENUE), 0),
                func.coalesce(func.sum(PROFIT), 0),
            ],
        )
        .join(Category, Product.category_id == Category.id)
        .filter(*in_range)
        .group_by(Category.id, Category.name_en, Category.name_ar)
        .order_by(func.sum(REVENUE).desc())
        .all()
    ]

    products = [
        {
            "code": code,
            "name": nm,
            "quantity": int(q or 0),
            "amount": f2(a),
            "profit": f2(p),
            "margin_pct": pct(f2(p), f2(a)),
        }
        for code, nm, q, a, p in item_query(
            db,
            [
                SaleItem.code,
                SaleItem.name,
                func.coalesce(func.sum(SaleItem.quantity), 0),
                func.coalesce(func.sum(REVENUE), 0),
                func.coalesce(func.sum(PROFIT), 0),
            ],
        )
        .filter(*in_range)
        .group_by(SaleItem.code, SaleItem.name)
        .order_by(func.sum(REVENUE).desc())
        .limit(LIMIT_PRODUCTS)
        .all()
    ]

    customers = [
        {"name": nm, "phone": ph, "orders": int(n or 0), "amount": f2(a), "items": int(it or 0)}
        for nm, ph, n, a, it in db.query(
            Customer.name,
            Customer.phone,
            func.count(Sale.id),
            func.coalesce(func.sum(Sale.total), 0),
            func.coalesce(func.sum(Sale.item_count), 0),
        )
        .join(Sale, Sale.customer_id == Customer.id)
        .filter(*in_range)
        .group_by(Customer.id, Customer.name, Customer.phone)
        .order_by(func.sum(Sale.total).desc())
        .limit(LIMIT_CUSTOMERS)
        .all()
    ]

    staff = [
        {
            "username": un,
            "full_name": fn,
            "orders": int(n or 0),
            "amount": f2(a),
            "discount": f2(d),
            "items": int(it or 0),
            "avg_ticket": f2(f2(a) / int(n)) if n else 0.0,
        }
        for un, fn, n, a, d, it in db.query(
            User.username,
            User.full_name,
            func.count(Sale.id),
            func.coalesce(func.sum(Sale.total), 0),
            func.coalesce(func.sum(Sale.discount), 0),
            func.coalesce(func.sum(Sale.item_count), 0),
        )
        .join(Sale, Sale.user_id == User.id)
        .filter(*in_range)
        .group_by(User.id, User.username, User.full_name)
        .order_by(func.sum(Sale.total).desc())
        .limit(LIMIT_STAFF)
        .all()
    ]

    # --- money out ---------------------------------------------------------
    expenses_by_type = [
        {"type": ty, "name": nm, "count": int(n or 0), "amount": f2(a)}
        for ty, nm, n, a in db.query(
            Expense.type,
            Expense.name,
            func.count(Expense.id),
            func.coalesce(func.sum(Expense.amount), 0),
        )
        .filter(Expense.spent_at >= date_from, Expense.spent_at <= date_to)
        .group_by(Expense.type, Expense.name)
        .order_by(func.sum(Expense.amount).desc())
        .all()
    ]
    expenses_list = [
        {
            "date": sp.isoformat() if sp else None,
            "user": un,
            "type": ty,
            "name": nm,
            "amount": f2(a),
            "note": note,
        }
        for sp, un, ty, nm, a, note in db.query(
            Expense.spent_at, User.username, Expense.type, Expense.name, Expense.amount, Expense.note
        )
        .outerjoin(User, Expense.user_id == User.id)
        .filter(Expense.spent_at >= date_from, Expense.spent_at <= date_to)
        .order_by(Expense.spent_at.desc(), Expense.id.desc())
        .limit(LIMIT_EXPENSES)
        .all()
    ]

    suppliers = [
        {"name": nm, "invoices": int(n or 0), "amount": f2(a)}
        for nm, n, a in db.query(
            Supplier.name, func.count(SupplierInvoice.id), func.coalesce(func.sum(SupplierInvoice.amount), 0)
        )
        .join(SupplierInvoice, SupplierInvoice.supplier_id == Supplier.id)
        .filter(_INV_DATE >= date_from, _INV_DATE <= date_to)
        .group_by(Supplier.id, Supplier.name)
        .order_by(func.sum(SupplierInvoice.amount).desc())
        .all()
    ]
    supplier_invoices = [
        {
            "date": (d.isoformat() if hasattr(d, "isoformat") else str(d)) if d else None,
            "supplier": sup,
            "name": nm,
            "quantity": int(q or 0),
            "amount": f2(a),
        }
        for d, sup, nm, q, a in db.query(
            _INV_DATE, Supplier.name, SupplierInvoice.name, SupplierInvoice.quantity, SupplierInvoice.amount
        )
        .join(Supplier, SupplierInvoice.supplier_id == Supplier.id)
        .filter(_INV_DATE >= date_from, _INV_DATE <= date_to)
        .order_by(_INV_DATE.desc(), SupplierInvoice.id.desc())
        .limit(LIMIT_SUPPLIER_INVOICES)
        .all()
    ]

    funds = [
        {
            "date": d.isoformat() if d else None,
            "amount": f2(a),
            "note": note,
            "created_by": un,
        }
        for d, a, note, un in db.query(Fund.occurred_at, Fund.amount, Fund.note, User.username)
        .outerjoin(User, Fund.created_by_id == User.id)
        .filter(Fund.occurred_at >= date_from, Fund.occurred_at <= date_to)
        .order_by(Fund.occurred_at.desc(), Fund.id.desc())
        .limit(LIMIT_FUNDS)
        .all()
    ]

    # --- inventory snapshot (current, not historical) ----------------------
    stock_qty, stock_units, cost_value, retail_value = _stock_base(
        db,
        [
            func.coalesce(func.sum(VariantStock.quantity), 0),
            func.count(VariantStock.id),
            func.coalesce(func.sum(VariantStock.quantity * Product.supplier_price), 0),
            func.coalesce(func.sum(VariantStock.quantity * Product.price), 0),
        ],
    ).one()
    inventory = {
        "products": count_of(db, Product.id, Product.is_deleted.is_(False)),
        "variants": count_of(db, ProductVariant.id, ProductVariant.is_deleted.is_(False)),
        "stock_qty": int(stock_qty or 0),
        "stock_units": int(stock_units or 0),
        "cost_value": f2(cost_value),
        "retail_value": f2(retail_value),
        "potential_profit": f2(float(retail_value or 0) - float(cost_value or 0)),
        "out_of_stock": int(
            _stock_base(db, [func.count(VariantStock.id)]).filter(VariantStock.quantity <= 0).scalar() or 0
        ),
        "low_stock": int(
            _stock_base(db, [func.count(VariantStock.id)])
            .filter(VariantStock.quantity > 0, VariantStock.quantity <= LOW_STOCK_AT)
            .scalar()
            or 0
        ),
        "by_category": [
            {
                "name_en": en,
                "name_ar": ar,
                "quantity": int(q or 0),
                "cost": f2(c),
                "retail": f2(r),
            }
            for en, ar, q, c, r in _stock_base(
                db,
                [
                    Category.name_en,
                    Category.name_ar,
                    func.coalesce(func.sum(VariantStock.quantity), 0),
                    func.coalesce(func.sum(VariantStock.quantity * Product.supplier_price), 0),
                    func.coalesce(func.sum(VariantStock.quantity * Product.price), 0),
                ],
            )
            .join(Category, Product.category_id == Category.id)
            .group_by(Category.id, Category.name_en, Category.name_ar)
            .order_by(func.sum(VariantStock.quantity * Product.supplier_price).desc())
            .all()
        ],
        "low_stock_items": [
            {"name": nm, "code": code, "quantity": int(q or 0), "price": f2(pr)}
            for nm, code, q, pr in _stock_base(
                db, [Product.name, ProductVariant.code, VariantStock.quantity, Product.price]
            )
            .filter(VariantStock.quantity <= LOW_STOCK_AT)
            .order_by(VariantStock.quantity.asc())
            .limit(LIMIT_LOW_STOCK)
            .all()
        ],
    }

    # --- capital position (all-time, as of now) ----------------------------
    supplier_paid_total = sum_of(db, SupplierInvoice.amount)
    funds_total = sum_of(db, Fund.amount)
    business = {
        "supplier_paid_total": supplier_paid_total,
        "funds_total": funds_total,
        "gross_value": f2(supplier_paid_total + funds_total),
        "supplier_paid_range": sum_of(
            db, SupplierInvoice.amount, _INV_DATE >= date_from, _INV_DATE <= date_to
        ),
        "funds_range": sum_of(db, Fund.amount, Fund.occurred_at >= date_from, Fund.occurred_at <= date_to),
        "suppliers": count_of(db, Supplier.id),
        "customers_total": count_of(db, Customer.id),
    }

    invoices = [
        {
            "invoice_no": no,
            "created_at": ts.isoformat(timespec="seconds") if ts else None,
            "customer": cname,
            "payment": pname,
            "user": un,
            "items": int(items or 0),
            "subtotal": f2(sub),
            "discount": f2(disc),
            "total": f2(total),
            "is_backtrack": bool(bt),
        }
        for no, ts, cname, pname, un, items, sub, disc, total, bt in db.query(
            Sale.invoice_no,
            Sale.created_at,
            Customer.name,
            PaymentMethod.name_en,
            User.username,
            Sale.item_count,
            Sale.subtotal,
            Sale.discount,
            Sale.total,
            Sale.is_backtrack,
        )
        .outerjoin(Customer, Sale.customer_id == Customer.id)
        .outerjoin(PaymentMethod, Sale.payment_method_id == PaymentMethod.id)
        .outerjoin(User, Sale.user_id == User.id)
        .filter(*in_range)
        .order_by(Sale.created_at.desc())
        .limit(LIMIT_INVOICES)
        .all()
    ]
    invoice_total = count_of(db, Sale.id, *in_range)

    log_action(
        db,
        action="report.generate",
        user_id=actor.id,
        entity="report",
        details={
            "from": date_from.isoformat(),
            "to": date_to.isoformat(),
            "days": span,
            "sales": current["sales_count"],
            "amount": current["sales_amount"],
        },
        request=request,
    )

    return {
        "currency": get_currency(db),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "generated_by": {"username": actor.username, "full_name": actor.full_name},
        "range": {"from": date_from.isoformat(), "to": date_to.isoformat(), "days": span},
        "previous_range": {
            "from": prev_start.date().isoformat(),
            "to": (date_from - timedelta(days=1)).isoformat(),
        },
        "summary": current,
        "previous": previous,
        "deltas": deltas,
        "customers_served": served,
        "new_customers": new_customers,
        "daily": daily,
        "monthly": monthly,
        "hourly": hourly,
        "weekday": weekday,
        "payments": payments,
        "categories": categories,
        "products": products,
        "customers": customers,
        "staff": staff,
        "expenses_by_type": expenses_by_type,
        "expenses": expenses_list,
        "suppliers": suppliers,
        "supplier_invoices": supplier_invoices,
        "funds": funds,
        "inventory": inventory,
        "business": business,
        "invoices": invoices,
        "invoice_total": invoice_total,
        "limits": {"invoices": LIMIT_INVOICES, "products": LIMIT_PRODUCTS},
    }
