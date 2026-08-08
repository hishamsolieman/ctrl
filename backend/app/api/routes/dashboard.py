"""Dashboard analytics.

``/dashboard/today`` — the signed-in user's own day (midnight → now). Drawer = the
day's CASH invoice total for this user − that user's expenses for the day; card
payments never land in the drawer.

``/dashboard/overview`` — the whole-business command centre. Admin/SuperAdmin see
every user's figures plus cost, profit and capital blocks; everyone below that
sees the same layout scoped to their own sales, with the money-sensitive blocks
omitted from the payload entirely rather than merely hidden in the UI.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
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
from app.services.settings import get_currency

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

CASH_CODE = "cash"
TOP_PRODUCTS = 7

# Whole-business visibility (cost, profit, other users' figures) starts here.
BUSINESS_LEVEL = 30
TOP_N = 8
DAYS_WINDOW = 30
WEEK_WINDOW = 90
MONTHS_WINDOW = 12


def _f(v) -> float:
    return round(float(v or 0), 2)


def _totals(db: Session, user_id: int, start: datetime, end: datetime, cash_only: bool = False):
    """(count, amount, items, discount) for one window, optionally cash-only."""
    q = db.query(
        func.count(Sale.id),
        func.coalesce(func.sum(Sale.total), 0),
        func.coalesce(func.sum(Sale.item_count), 0),
        func.coalesce(func.sum(Sale.discount), 0),
    ).filter(Sale.user_id == user_id, Sale.created_at >= start, Sale.created_at < end)
    if cash_only:
        q = q.join(PaymentMethod, Sale.payment_method_id == PaymentMethod.id).filter(
            PaymentMethod.code == CASH_CODE
        )
    count, amount, items, discount = q.one()
    return int(count or 0), _f(amount), int(items or 0), _f(discount)


def _hourly(db: Session, user_id: int, start: datetime, end: datetime) -> list[dict]:
    """Per-hour buckets (0–23) of sale count + revenue for one day."""
    rows = (
        db.query(
            func.hour(Sale.created_at).label("h"),
            func.count(Sale.id),
            func.coalesce(func.sum(Sale.total), 0),
        )
        .filter(Sale.user_id == user_id, Sale.created_at >= start, Sale.created_at < end)
        .group_by("h")
        .all()
    )
    by_hour = {int(h): (int(c or 0), _f(a)) for h, c, a in rows}
    out = []
    for h in range(24):
        count, amount = by_hour.get(h, (0, 0.0))
        out.append({"hour": h, "count": count, "amount": amount})
    return out


@router.get("/today")
def today_sales(db: Session = Depends(get_db), actor: User = Depends(get_current_user)):
    uid = actor.id
    now = datetime.now()
    day_start = datetime.combine(date.today(), time.min)
    day_end = day_start + timedelta(days=1)
    prev_start = day_start - timedelta(days=1)

    # --- cards ------------------------------------------------------------
    count, amount, items, discount = _totals(db, uid, day_start, day_end)
    _, cash_amount, _, _ = _totals(db, uid, day_start, day_end, cash_only=True)

    expense_count, today_expenses = db.query(
        func.count(Expense.id), func.coalesce(func.sum(Expense.amount), 0)
    ).filter(
        Expense.user_id == uid,
        Expense.created_at >= day_start,
        Expense.created_at < day_end,
    ).one()
    expense_count, today_expenses = int(expense_count or 0), _f(today_expenses)

    # --- payment mix (today) ----------------------------------------------
    pay_rows = (
        db.query(
            PaymentMethod.code,
            PaymentMethod.name_en,
            PaymentMethod.name_ar,
            func.count(Sale.id),
            func.coalesce(func.sum(Sale.total), 0),
        )
        .join(Sale, Sale.payment_method_id == PaymentMethod.id)
        .filter(Sale.user_id == uid, Sale.created_at >= day_start, Sale.created_at < day_end)
        .group_by(PaymentMethod.id, PaymentMethod.code, PaymentMethod.name_en, PaymentMethod.name_ar)
        .all()
    )
    payments = [
        {"code": c, "name_en": en, "name_ar": ar, "count": int(n or 0), "amount": _f(a)}
        for c, en, ar, n, a in pay_rows
    ]

    # --- top products (today, by revenue) ---------------------------------
    prod_rows = (
        db.query(
            SaleItem.name,
            func.coalesce(func.sum(SaleItem.quantity), 0),
            func.coalesce(func.sum(SaleItem.line_total), 0),
        )
        .join(Sale, SaleItem.sale_id == Sale.id)
        .filter(Sale.user_id == uid, Sale.created_at >= day_start, Sale.created_at < day_end)
        .group_by(SaleItem.name)
        .order_by(func.sum(SaleItem.line_total).desc())
        .limit(TOP_PRODUCTS)
        .all()
    )
    top_products = [
        {"name": nm, "quantity": int(q or 0), "amount": _f(a)} for nm, q, a in prod_rows
    ]

    # --- revenue by category (today) --------------------------------------
    cat_rows = (
        db.query(
            Category.name_en,
            Category.name_ar,
            func.coalesce(func.sum(SaleItem.line_total), 0),
        )
        .select_from(SaleItem)
        .join(Sale, SaleItem.sale_id == Sale.id)
        .join(Product, SaleItem.product_id == Product.id)
        .join(Category, Product.category_id == Category.id)
        .filter(Sale.user_id == uid, Sale.created_at >= day_start, Sale.created_at < day_end)
        .group_by(Category.id, Category.name_en, Category.name_ar)
        .order_by(func.sum(SaleItem.line_total).desc())
        .all()
    )
    categories = [
        {"name_en": en, "name_ar": ar, "amount": _f(a)} for en, ar, a in cat_rows if _f(a) > 0
    ]

    # --- expenses by type (reconciles with the drawer) ---------------------
    exp_rows = (
        db.query(
            Expense.type,
            Expense.name,
            func.coalesce(func.sum(Expense.amount), 0),
        )
        .filter(
            Expense.user_id == uid,
            Expense.created_at >= day_start,
            Expense.created_at < day_end,
        )
        .group_by(Expense.type, Expense.name)
        .order_by(func.sum(Expense.amount).desc())
        .all()
    )
    expense_types = [
        {"type": ty, "name": nm, "amount": _f(a)} for ty, nm, a in exp_rows if _f(a) > 0
    ]

    return {
        "currency": get_currency(db),
        "now": now.isoformat(timespec="seconds"),
        "user": {"id": uid, "username": actor.username, "full_name": actor.full_name},
        "today": {
            "count": count,
            "amount": amount,
            "cash": cash_amount,
            "other": _f(amount - cash_amount),
            "items": items,
            "discount": discount,
            "expenses": today_expenses,
            "expense_count": expense_count,
            "avg_ticket": _f(amount / count) if count else 0.0,
            # Drawer: the day's cash takings (card payments excluded) less the
            # expenses paid out of it.
            "drawer": _f(cash_amount - today_expenses),
        },
        "hourly": _hourly(db, uid, day_start, day_end),
        "hourly_prev": _hourly(db, uid, prev_start, day_start),
        "payments": payments,
        "top_products": top_products,
        "categories": categories,
        "expense_types": expense_types,
    }


# ---------------------------------------------------------------------------
# Business overview
# ---------------------------------------------------------------------------
def _months_back(n: int) -> date:
    """First day of the month n-1 months ago (start of an n-month window)."""
    today = date.today()
    y, m = today.year, today.month - (n - 1)
    while m <= 0:
        m += 12
        y -= 1
    return date(y, m, 1)


def _stock_base(db: Session, selects):
    """On-hand stock joined up to its product, live rows only."""
    return (
        db.query(*selects)
        .select_from(VariantStock)
        .join(ProductVariant, VariantStock.variant_id == ProductVariant.id)
        .join(Product, ProductVariant.product_id == Product.id)
        .filter(Product.is_deleted.is_(False), ProductVariant.is_deleted.is_(False))
    )


@router.get("/overview")
def overview(db: Session = Depends(get_db), actor: User = Depends(get_current_user)):
    level = actor.role.level if actor.role else 0
    business = level >= BUSINESS_LEVEL
    # Below Admin every figure is narrowed to the caller's own activity.
    sale_scope = [] if business else [Sale.user_id == actor.id]
    exp_scope = [] if business else [Expense.user_id == actor.id]

    now = datetime.now()
    today = date.today()
    day_start = as_dt(today)
    month_start = as_dt(today.replace(day=1))
    prev_month_start = as_dt((today.replace(day=1) - timedelta(days=1)).replace(day=1))
    win_start = as_dt(today - timedelta(days=DAYS_WINDOW - 1))
    prev_win_start = as_dt(today - timedelta(days=2 * DAYS_WINDOW - 1))
    week_start = as_dt(today - timedelta(days=WEEK_WINDOW - 1))
    months_start = as_dt(_months_back(MONTHS_WINDOW))

    def sales_agg(*filters):
        count, amount, items, discount = (
            db.query(
                func.count(Sale.id),
                func.coalesce(func.sum(Sale.total), 0),
                func.coalesce(func.sum(Sale.item_count), 0),
                func.coalesce(func.sum(Sale.discount), 0),
            )
            .filter(*sale_scope, *filters)
            .one()
        )
        return int(count or 0), f2(amount), int(items or 0), f2(discount)

    # --- headline numbers --------------------------------------------------
    all_count, all_amount, all_items, all_discount = sales_agg()
    d_count, d_amount, _, _ = sales_agg(Sale.created_at >= day_start)
    m_count, m_amount, m_items, m_discount = sales_agg(Sale.created_at >= month_start)
    pm_count, pm_amount, _, _ = sales_agg(
        Sale.created_at >= prev_month_start, Sale.created_at < month_start
    )
    w_count, w_amount, _, _ = sales_agg(Sale.created_at >= win_start)
    pw_count, pw_amount, _, _ = sales_agg(
        Sale.created_at >= prev_win_start, Sale.created_at < win_start
    )

    cash_amount = f2(
        db.query(func.coalesce(func.sum(Sale.total), 0))
        .join(PaymentMethod, Sale.payment_method_id == PaymentMethod.id)
        .filter(*sale_scope, PaymentMethod.code == CASH_CODE)
        .scalar()
    )

    expenses_total = sum_of(db, Expense.amount, *exp_scope)
    expenses_month = sum_of(db, Expense.amount, *exp_scope, Expense.spent_at >= today.replace(day=1))
    expenses_prev_month = sum_of(
        db,
        Expense.amount,
        *exp_scope,
        Expense.spent_at >= prev_month_start.date(),
        Expense.spent_at < today.replace(day=1),
    )

    kpi = {
        "sales_count": all_count,
        "sales_amount": all_amount,
        "items_sold": all_items,
        "discount": all_discount,
        "avg_ticket": f2(all_amount / all_count) if all_count else 0.0,
        "today_amount": d_amount,
        "today_count": d_count,
        "month_amount": m_amount,
        "month_count": m_count,
        "month_items": m_items,
        "month_discount": m_discount,
        "cash_amount": cash_amount,
        "card_amount": f2(all_amount - cash_amount),
        "expenses_total": expenses_total,
        "expenses_month": expenses_month,
    }

    trends = {
        "sales_amount": growth(m_amount, pm_amount),
        "sales_count": growth(float(m_count), float(pm_count)),
        "expenses": growth(expenses_month, expenses_prev_month),
        "window_amount": growth(w_amount, pw_amount),
        "window_count": growth(float(w_count), float(pw_count)),
    }

    # --- customers ---------------------------------------------------------
    cust_total = count_of(db, Customer.id)
    cust_month = count_of(db, Customer.id, Customer.created_at >= month_start)
    cust_prev_month = count_of(
        db, Customer.id, Customer.created_at >= prev_month_start, Customer.created_at < month_start
    )
    served = int(
        db.query(func.count(func.distinct(Sale.customer_id)))
        .filter(*sale_scope, Sale.customer_id.isnot(None))
        .scalar()
        or 0
    )
    kpi |= {"customers_total": cust_total, "customers_month": cust_month, "customers_served": served}
    trends["customers"] = growth(float(cust_month), float(cust_prev_month))

    # --- catalogue + stock -------------------------------------------------
    kpi["products"] = count_of(db, Product.id, Product.is_deleted.is_(False))
    kpi["variants"] = count_of(db, ProductVariant.id, ProductVariant.is_deleted.is_(False))
    stock_qty, stock_units = _stock_base(
        db, [func.coalesce(func.sum(VariantStock.quantity), 0), func.count(VariantStock.id)]
    ).one()
    kpi["stock_qty"] = int(stock_qty or 0)
    kpi["stock_units"] = int(stock_units or 0)
    kpi["out_of_stock"] = int(
        _stock_base(db, [func.count(VariantStock.id)]).filter(VariantStock.quantity <= 0).scalar() or 0
    )
    kpi["low_stock"] = int(
        _stock_base(db, [func.count(VariantStock.id)])
        .filter(VariantStock.quantity > 0, VariantStock.quantity <= LOW_STOCK_AT)
        .scalar()
        or 0
    )

    # --- profit + capital (Admin and above only) ---------------------------
    if business:
        gross_profit = sum_profit(db)
        profit_month = sum_profit(db, Sale.created_at >= month_start)
        profit_prev_month = sum_profit(
            db, Sale.created_at >= prev_month_start, Sale.created_at < month_start
        )
        supplier_paid = sum_of(db, SupplierInvoice.amount)
        manual_funds = sum_of(db, Fund.amount)
        cost_value, retail_value = _stock_base(
            db,
            [
                func.coalesce(func.sum(VariantStock.quantity * Product.supplier_price), 0),
                func.coalesce(func.sum(VariantStock.quantity * Product.price), 0),
            ],
        ).one()
        kpi |= {
            "gross_profit": gross_profit,
            "profit_month": profit_month,
            "net_profit": f2(gross_profit - expenses_total),
            "margin_pct": pct(gross_profit, all_amount),
            "inventory_cost": f2(cost_value),
            "inventory_retail": f2(retail_value),
            "inventory_potential": f2(float(retail_value or 0) - float(cost_value or 0)),
            "supplier_paid": supplier_paid,
            "manual_funds": manual_funds,
            "gross_value": f2(supplier_paid + manual_funds),
            "suppliers": count_of(db, Supplier.id),
        }
        trends["profit"] = growth(profit_month, profit_prev_month)

    # --- series ------------------------------------------------------------
    day_rows = (
        db.query(
            func.date(Sale.created_at).label("d"),
            func.count(Sale.id),
            func.coalesce(func.sum(Sale.total), 0),
        )
        .filter(*sale_scope, Sale.created_at >= win_start)
        .group_by("d")
        .all()
    )
    by_day = {str(d): (int(c or 0), f2(a)) for d, c, a in day_rows}
    day_profit = {}
    if business:
        day_profit = {
            str(d): f2(p)
            for d, p in item_query(
                db, [func.date(Sale.created_at).label("d"), func.coalesce(func.sum(PROFIT), 0)]
            )
            .filter(Sale.created_at >= win_start)
            .group_by("d")
            .all()
        }
    daily = []
    for i in range(DAYS_WINDOW):
        d = today - timedelta(days=DAYS_WINDOW - 1 - i)
        key = d.isoformat()
        count, amount = by_day.get(key, (0, 0.0))
        row = {"date": key, "count": count, "amount": amount}
        if business:
            row["profit"] = day_profit.get(key, 0.0)
        daily.append(row)

    month_sales = {
        m: (int(c or 0), f2(a))
        for m, c, a in db.query(
            func.date_format(Sale.created_at, "%Y-%m").label("m"),
            func.count(Sale.id),
            func.coalesce(func.sum(Sale.total), 0),
        )
        .filter(*sale_scope, Sale.created_at >= months_start)
        .group_by("m")
        .all()
    }
    month_exp = {
        m: f2(a)
        for m, a in db.query(
            func.date_format(Expense.spent_at, "%Y-%m").label("m"),
            func.coalesce(func.sum(Expense.amount), 0),
        )
        .filter(*exp_scope, Expense.spent_at >= months_start.date())
        .group_by("m")
        .all()
    }
    month_profit = {}
    if business:
        month_profit = {
            m: f2(p)
            for m, p in item_query(
                db,
                [
                    func.date_format(Sale.created_at, "%Y-%m").label("m"),
                    func.coalesce(func.sum(PROFIT), 0),
                ],
            )
            .filter(Sale.created_at >= months_start)
            .group_by("m")
            .all()
        }
    monthly = []
    y, m = months_start.year, months_start.month
    for _ in range(MONTHS_WINDOW):
        key = f"{y:04d}-{m:02d}"
        count, amount = month_sales.get(key, (0, 0.0))
        row = {"month": key, "count": count, "sales": amount, "expenses": month_exp.get(key, 0.0)}
        if business:
            row["profit"] = month_profit.get(key, 0.0)
        monthly.append(row)
        m += 1
        if m > 12:
            m, y = 1, y + 1

    hour_rows = (
        db.query(
            func.hour(Sale.created_at).label("h"),
            func.count(Sale.id),
            func.coalesce(func.sum(Sale.total), 0),
        )
        .filter(*sale_scope, Sale.created_at >= win_start)
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
        .filter(*sale_scope, Sale.created_at >= week_start)
        .group_by("w")
        .all()
    )
    # MySQL DAYOFWEEK: 1 = Sunday … 7 = Saturday.
    by_dow = {int(w): (int(c or 0), f2(a)) for w, c, a in dow_rows}
    weekday = [
        {"dow": i, "count": by_dow.get(i + 1, (0, 0.0))[0], "amount": by_dow.get(i + 1, (0, 0.0))[1]}
        for i in range(7)
    ]

    # --- breakdowns (rolling window) --------------------------------------
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
        .filter(*sale_scope, Sale.created_at >= win_start)
        .group_by(PaymentMethod.id, PaymentMethod.code, PaymentMethod.name_en, PaymentMethod.name_ar)
        .all()
        if f2(a) > 0
    ]

    cat_selects = [
        Category.name_en,
        Category.name_ar,
        func.coalesce(func.sum(SaleItem.quantity), 0),
        func.coalesce(func.sum(REVENUE), 0),
    ]
    if business:
        cat_selects.append(func.coalesce(func.sum(PROFIT), 0))
    cat_rows = (
        item_query(db, cat_selects)
        .join(Category, Product.category_id == Category.id)
        .filter(*sale_scope, Sale.created_at >= win_start)
        .group_by(Category.id, Category.name_en, Category.name_ar)
        .order_by(func.sum(REVENUE).desc())
        .all()
    )
    categories = []
    for row in cat_rows:
        if f2(row[3]) <= 0:
            continue
        item = {
            "name_en": row[0],
            "name_ar": row[1],
            "quantity": int(row[2] or 0),
            "amount": f2(row[3]),
        }
        if business:
            item["profit"] = f2(row[4])
        categories.append(item)

    prod_selects = [
        SaleItem.name,
        func.coalesce(func.sum(SaleItem.quantity), 0),
        func.coalesce(func.sum(REVENUE), 0),
    ]
    if business:
        prod_selects.append(func.coalesce(func.sum(PROFIT), 0))
    prod_rows = (
        item_query(db, prod_selects)
        .filter(*sale_scope, Sale.created_at >= win_start)
        .group_by(SaleItem.name)
        .order_by(func.sum(REVENUE).desc())
        .limit(TOP_N)
        .all()
    )
    top_products = []
    for row in prod_rows:
        item = {"name": row[0], "quantity": int(row[1] or 0), "amount": f2(row[2])}
        if business:
            item["profit"] = f2(row[3])
        top_products.append(item)

    top_customers = [
        {"name": nm, "phone": ph, "orders": int(n or 0), "amount": f2(a)}
        for nm, ph, n, a in db.query(
            Customer.name,
            Customer.phone,
            func.count(Sale.id),
            func.coalesce(func.sum(Sale.total), 0),
        )
        .join(Sale, Sale.customer_id == Customer.id)
        .filter(*sale_scope)
        .group_by(Customer.id, Customer.name, Customer.phone)
        .order_by(func.sum(Sale.total).desc())
        .limit(TOP_N)
        .all()
    ]

    expense_types = [
        {"type": ty, "name": nm, "amount": f2(a)}
        for ty, nm, a in db.query(
            Expense.type, Expense.name, func.coalesce(func.sum(Expense.amount), 0)
        )
        .filter(*exp_scope)
        .group_by(Expense.type, Expense.name)
        .order_by(func.sum(Expense.amount).desc())
        .all()
        if f2(a) > 0
    ]

    low_stock_items = [
        {"name": nm, "code": code, "quantity": int(q or 0)}
        for nm, code, q in _stock_base(db, [Product.name, ProductVariant.code, VariantStock.quantity])
        .filter(VariantStock.quantity <= LOW_STOCK_AT)
        .order_by(VariantStock.quantity.asc())
        .limit(TOP_N)
        .all()
    ]

    stock_selects = [
        Category.name_en,
        Category.name_ar,
        func.coalesce(func.sum(VariantStock.quantity), 0),
    ]
    if business:
        stock_selects.append(
            func.coalesce(func.sum(VariantStock.quantity * Product.supplier_price), 0)
        )
    stock_by_category = [
        (
            {"name_en": r[0], "name_ar": r[1], "quantity": int(r[2] or 0)}
            | ({"cost": f2(r[3])} if business else {})
        )
        for r in _stock_base(db, stock_selects)
        .join(Category, Product.category_id == Category.id)
        .group_by(Category.id, Category.name_en, Category.name_ar)
        .order_by(func.sum(VariantStock.quantity).desc())
        .limit(TOP_N)
        .all()
        if int(r[2] or 0) > 0
    ]

    staff = []
    if business:
        staff = [
            {
                "username": un,
                "full_name": fn,
                "orders": int(n or 0),
                "amount": f2(a),
                "discount": f2(d),
            }
            for un, fn, n, a, d in db.query(
                User.username,
                User.full_name,
                func.count(Sale.id),
                func.coalesce(func.sum(Sale.total), 0),
                func.coalesce(func.sum(Sale.discount), 0),
            )
            .join(Sale, Sale.user_id == User.id)
            .filter(Sale.created_at >= win_start)
            .group_by(User.id, User.username, User.full_name)
            .order_by(func.sum(Sale.total).desc())
            .limit(TOP_N)
            .all()
        ]

    recent = [
        {
            "invoice_no": no,
            "created_at": ts.isoformat(timespec="seconds") if ts else None,
            "customer": cname,
            "total": f2(total),
            "items": int(items or 0),
        }
        for no, ts, cname, total, items in db.query(
            Sale.invoice_no, Sale.created_at, Customer.name, Sale.total, Sale.item_count
        )
        .outerjoin(Customer, Sale.customer_id == Customer.id)
        .filter(*sale_scope)
        .order_by(Sale.created_at.desc())
        .limit(TOP_N)
        .all()
    ]

    return {
        "currency": get_currency(db),
        "now": now.isoformat(timespec="seconds"),
        "scope": "business" if business else "self",
        "can_export": business,
        "window_days": DAYS_WINDOW,
        "user": {"id": actor.id, "username": actor.username, "full_name": actor.full_name},
        "kpi": kpi,
        "trends": trends,
        "daily": daily,
        "monthly": monthly,
        "hourly": hourly,
        "weekday": weekday,
        "payments": payments,
        "categories": categories,
        "top_products": top_products,
        "top_customers": top_customers,
        "expense_types": expense_types,
        "low_stock_items": low_stock_items,
        "stock_by_category": stock_by_category,
        "staff": staff,
        "recent_sales": recent,
    }
