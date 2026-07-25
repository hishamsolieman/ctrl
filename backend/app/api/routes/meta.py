"""Public metadata: brand config (DB-backed) + i18n translations from the DB."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.core.config import settings
from app.core.database import get_db
from app.models.setting import Setting
from app.models.translation import Translation
from app.models.user import User
from app.services.logging import log_action

router = APIRouter(tags=["meta"])

BRAND_NAME_KEY = "brand_name"
BRAND_MOTTO_KEY = "brand_motto"


def _get_setting(db: Session, key: str, default: str) -> str:
    row = db.get(Setting, key)
    return row.value if row and row.value else default


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/brand")
def get_brand(db: Session = Depends(get_db)):
    """Brand name & motto — authoritative source is the DB `settings` table."""
    return {
        "name": _get_setting(db, BRAND_NAME_KEY, settings.BRAND_NAME),
        "motto": _get_setting(db, BRAND_MOTTO_KEY, settings.BRAND_MOTTO),
    }


class BrandUpdate(BaseModel):
    name: str | None = None
    motto: str | None = None


@router.put("/brand")
def update_brand(
    payload: BrandUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Admin")),
):
    """Update brand name/motto (Admin+). Stored in the DB `settings` table."""
    changed: dict[str, str] = {}
    if payload.name is not None:
        db.merge(Setting(key=BRAND_NAME_KEY, value=payload.name))
        changed["name"] = payload.name
    if payload.motto is not None:
        db.merge(Setting(key=BRAND_MOTTO_KEY, value=payload.motto))
        changed["motto"] = payload.motto
    db.commit()
    log_action(
        db, action="settings.brand.update", user_id=user.id,
        entity="settings", details=changed, request=request,
    )
    return get_brand(db)


@router.get("/i18n/{locale}")
def translations(locale: str, db: Session = Depends(get_db)):
    """Return backend-managed translations for a locale (extensible per spec)."""
    rows = db.query(Translation).filter(Translation.locale == locale).all()
    data: dict[str, dict[str, str]] = {}
    for r in rows:
        data.setdefault(r.namespace, {})[r.key] = r.value
    return {"locale": locale, "translations": data}
