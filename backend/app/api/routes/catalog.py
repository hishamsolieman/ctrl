"""Catalog support endpoints: categories, suppliers, currency."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_role
from app.core.database import get_db
from app.models.category import Category
from app.models.supplier import Supplier
from app.models.user import User
from app.services.logging import log_action
from app.services.settings import CURRENCY_KEY, get_currency, set_setting

router = APIRouter(tags=["catalog"])


# ------------------------------ Categories -------------------------------- #
class CategoryIn(BaseModel):
    name_en: str = Field(min_length=1, max_length=120)
    name_ar: str = Field(min_length=1, max_length=120)


@router.get("/categories")
def list_categories(db: Session = Depends(get_db), _u: User = Depends(get_current_user)):
    rows = db.query(Category).filter(Category.is_active.is_(True)).order_by(Category.id).all()
    return [
        {"id": c.id, "name_en": c.name_en, "name_ar": c.name_ar} for c in rows
    ]


@router.post("/categories", status_code=status.HTTP_201_CREATED)
def create_category(
    payload: CategoryIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    cat = Category(name_en=payload.name_en, name_ar=payload.name_ar, is_active=True)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    log_action(db, action="category.create", user_id=user.id, entity="category",
               entity_id=cat.id, request=request)
    return {"id": cat.id, "name_en": cat.name_en, "name_ar": cat.name_ar}


# ------------------------------ Suppliers --------------------------------- #
class SupplierIn(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    phone: str | None = None
    email: str | None = None


@router.get("/suppliers")
def list_suppliers(db: Session = Depends(get_db), _u: User = Depends(get_current_user)):
    rows = db.query(Supplier).filter(Supplier.is_active.is_(True)).order_by(Supplier.name).all()
    return [{"id": s.id, "name": s.name, "phone": s.phone, "email": s.email} for s in rows]


@router.post("/suppliers", status_code=status.HTTP_201_CREATED)
def create_supplier(
    payload: SupplierIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    sup = Supplier(name=payload.name, phone=payload.phone, email=payload.email, is_active=True)
    db.add(sup)
    db.commit()
    db.refresh(sup)
    log_action(db, action="supplier.create", user_id=user.id, entity="supplier",
               entity_id=sup.id, request=request)
    return {"id": sup.id, "name": sup.name, "phone": sup.phone, "email": sup.email}


# ------------------------------- Currency --------------------------------- #
class CurrencyIn(BaseModel):
    currency: str = Field(min_length=1, max_length=10)


@router.get("/currency")
def read_currency(db: Session = Depends(get_db)):
    return {"currency": get_currency(db)}


@router.put("/currency")
def update_currency(
    payload: CurrencyIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Admin")),
):
    set_setting(db, CURRENCY_KEY, payload.currency)
    log_action(db, action="settings.currency.update", user_id=user.id,
               entity="settings", details={"currency": payload.currency}, request=request)
    return {"currency": payload.currency}
