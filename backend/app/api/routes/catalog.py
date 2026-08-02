"""Catalog support endpoints: currency. (Suppliers live in suppliers.py.)"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.core.database import get_db
from app.models.user import User
from app.services.logging import log_action
from app.services.settings import CURRENCY_KEY, get_currency, set_setting

router = APIRouter(tags=["catalog"])


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
