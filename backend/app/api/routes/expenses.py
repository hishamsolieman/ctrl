"""Business expenses API.

Regular users can create and view their own expenses. Admins/SuperAdmins can
add on behalf of anyone, see everyone's expenses (with the owner's username),
and modify/remove them. Stats summarise expenses and sales for the viewer's
scope (own for regular users, everyone for admins).
"""
from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_role
from app.core.database import get_db
from app.core.roles import ROLES
from app.models.expense import Expense
from app.models.sale import Sale
from app.models.user import User
from app.services.logging import log_action
from app.services.settings import get_currency

router = APIRouter(prefix="/expenses", tags=["expenses"])

ADMIN_LEVEL = ROLES["Admin"]
PAGE = 10

# Known expense-type keys. `other` (last) means "use the custom `name`".
EXPENSE_TYPES = [
    "rent",
    "utilities",
    "salaries",
    "supplies",
    "inventory",
    "maintenance",
    "marketing",
    "transport",
    "taxes",
    "fees",
    "other",
]


def _is_admin(user: User) -> bool:
    return bool(user.role and user.role.level >= ADMIN_LEVEL)


class ExpenseIn(BaseModel):
    type: str
    name: str | None = Field(default=None, max_length=150)
    amount: float = Field(gt=0)
    spent_at: date
    note: str | None = None
    user_id: int | None = None  # admins only — record on behalf of


def _validate(payload: ExpenseIn) -> str | None:
    if payload.type not in EXPENSE_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "expenses.errors.badType")
    if payload.type == "other":
        nm = (payload.name or "").strip()
        if not nm:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "expenses.errors.nameRequired")
        return nm
    return None


def _serialize(e: Expense, can_manage: bool) -> dict:
    return {
        "id": e.id,
        "user_id": e.user_id,
        "username": e.user.username if e.user else None,
        "full_name": e.user.full_name if e.user else None,
        "created_by": e.creator.username if e.creator else None,
        "type": e.type,
        "name": e.name,
        "amount": float(e.amount or 0),
        "spent_at": e.spent_at.isoformat() if e.spent_at else None,
        "note": e.note,
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "can_manage": can_manage,
    }


@router.get("/meta")
def meta(db: Session = Depends(get_db), actor: User = Depends(get_current_user)):
    """Dropdown data: expense types (+ whether the viewer manages/other users)."""
    admin = _is_admin(actor)
    users = []
    if admin:
        rows = db.query(User).order_by(func.lower(User.username)).all()
        users = [{"id": u.id, "username": u.username, "full_name": u.full_name} for u in rows]
    return {
        "types": EXPENSE_TYPES,
        "users": users,
        "is_admin": admin,
        "currency": get_currency(db),
        "self": {"id": actor.id, "username": actor.username, "full_name": actor.full_name},
    }


@router.get("/stats")
def stats(db: Session = Depends(get_db), actor: User = Depends(get_current_user)):
    admin = _is_admin(actor)
    today = date.today()
    month_start = today.replace(day=1)

    exp_q = db.query(func.coalesce(func.sum(Expense.amount), 0))
    month_q = db.query(func.coalesce(func.sum(Expense.amount), 0)).filter(
        Expense.spent_at >= month_start
    )
    sales_cnt_q = db.query(func.count(Sale.id))
    sales_sum_q = db.query(func.coalesce(func.sum(Sale.total), 0))

    if not admin:
        exp_q = exp_q.filter(Expense.user_id == actor.id)
        month_q = month_q.filter(Expense.user_id == actor.id)
        sales_cnt_q = sales_cnt_q.filter(Sale.user_id == actor.id)
        sales_sum_q = sales_sum_q.filter(Sale.user_id == actor.id)

    return {
        "total_expenses": float(exp_q.scalar() or 0),
        "month_expenses": float(month_q.scalar() or 0),
        "sales_count": int(sales_cnt_q.scalar() or 0),
        "sales_total": float(sales_sum_q.scalar() or 0),
        "currency": get_currency(db),
    }


@router.get("")
def list_expenses(
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
    q: str = Query("", max_length=120),
    user_id: int | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(PAGE, ge=1, le=100),
):
    admin = _is_admin(actor)
    query = db.query(Expense).join(User, Expense.user_id == User.id)

    if admin:
        if user_id is not None:
            query = query.filter(Expense.user_id == user_id)
    else:
        query = query.filter(Expense.user_id == actor.id)

    term = q.strip()
    if term:
        like = f"%{term}%"
        query = query.filter(
            or_(
                Expense.name.ilike(like),
                Expense.note.ilike(like),
                Expense.type.ilike(like),
                User.username.ilike(like),
                User.full_name.ilike(like),
            )
        )

    total = query.count()
    rows = (
        query.order_by(Expense.spent_at.desc(), Expense.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {
        "items": [_serialize(e, admin) for e in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, (total + page_size - 1) // page_size),
        "currency": get_currency(db),
        "is_admin": admin,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_expense(
    payload: ExpenseIn,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    admin = _is_admin(actor)
    name = _validate(payload)

    owner_id = actor.id
    if payload.user_id is not None and payload.user_id != actor.id:
        if not admin:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "expenses.errors.notAllowedOnBehalf")
        if not db.get(User, payload.user_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "expenses.errors.userNotFound")
        owner_id = payload.user_id

    e = Expense(
        user_id=owner_id,
        created_by_id=actor.id,
        type=payload.type,
        name=name,
        amount=payload.amount,
        spent_at=payload.spent_at,
        note=(payload.note or "").strip() or None,
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    log_action(
        db, action="expense.create", user_id=actor.id, entity="expense", entity_id=e.id,
        details={"owner_id": owner_id, "type": e.type, "amount": float(e.amount)},
        request=request,
    )
    return _serialize(e, admin)


@router.put("/{expense_id}")
def update_expense(
    expense_id: int,
    payload: ExpenseIn,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role("Admin")),
):
    e = db.get(Expense, expense_id)
    if not e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Expense not found")
    name = _validate(payload)

    if payload.user_id is not None and payload.user_id != e.user_id:
        if not db.get(User, payload.user_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "expenses.errors.userNotFound")
        e.user_id = payload.user_id
    e.type = payload.type
    e.name = name
    e.amount = payload.amount
    e.spent_at = payload.spent_at
    e.note = (payload.note or "").strip() or None
    db.commit()
    db.refresh(e)
    log_action(
        db, action="expense.update", user_id=actor.id, entity="expense", entity_id=e.id,
        details={"type": e.type, "amount": float(e.amount)}, request=request,
    )
    return _serialize(e, True)


@router.delete("/{expense_id}")
def delete_expense(
    expense_id: int,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role("Admin")),
):
    e = db.get(Expense, expense_id)
    if not e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Expense not found")
    log_action(
        db, action="expense.delete", user_id=actor.id, entity="expense", entity_id=e.id,
        details={"type": e.type, "amount": float(e.amount), "owner_id": e.user_id},
        request=request,
    )
    db.delete(e)
    db.commit()
    return {"ok": True}
