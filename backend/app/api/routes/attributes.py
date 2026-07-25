"""Attribute definitions (Color, Size, ...) with bilingual values."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user, require_role
from app.core.database import get_db
from app.models.attribute import Attribute, AttributeValue
from app.models.user import User
from app.schemas.attribute import AttributeIn, AttributeOut
from app.services.logging import log_action

router = APIRouter(prefix="/attributes", tags=["attributes"])


def _serialize(attr: Attribute) -> dict:
    return {
        "id": attr.id,
        "key": attr.key,
        "name_en": attr.name_en,
        "name_ar": attr.name_ar,
        "values": [
            {"id": v.id, "value_en": v.value_en, "value_ar": v.value_ar, "extra": v.extra}
            for v in attr.values
        ],
    }


@router.get("", response_model=list[AttributeOut])
def list_attributes(db: Session = Depends(get_db), _u: User = Depends(get_current_user)):
    rows = (
        db.query(Attribute)
        .options(selectinload(Attribute.values))
        .filter(Attribute.is_active.is_(True))
        .order_by(Attribute.sort_order, Attribute.id)
        .all()
    )
    return [_serialize(a) for a in rows]


@router.post("", response_model=AttributeOut, status_code=status.HTTP_201_CREATED)
def create_attribute(
    payload: AttributeIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    if db.query(Attribute.id).filter(Attribute.key == payload.key).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Attribute key already exists")
    attr = Attribute(key=payload.key, name_en=payload.name_en, name_ar=payload.name_ar)
    for i, v in enumerate(payload.values):
        attr.values.append(
            AttributeValue(value_en=v.value_en, value_ar=v.value_ar, extra=v.extra, sort_order=i)
        )
    db.add(attr)
    db.commit()
    db.refresh(attr)
    log_action(db, action="attribute.create", user_id=user.id, entity="attribute",
               entity_id=attr.id, request=request)
    return _serialize(attr)


@router.put("/{attribute_id}", response_model=AttributeOut)
def update_attribute(
    attribute_id: int,
    payload: AttributeIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    attr = db.get(Attribute, attribute_id)
    if not attr:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attribute not found")
    attr.name_en = payload.name_en
    attr.name_ar = payload.name_ar
    # Upsert values (update existing by id, append new). Existing values are not
    # deleted here to avoid orphaning variant references.
    existing = {v.id: v for v in attr.values}
    for i, v in enumerate(payload.values):
        if v.id and v.id in existing:
            row = existing[v.id]
            row.value_en, row.value_ar, row.extra, row.sort_order = (
                v.value_en, v.value_ar, v.extra, i,
            )
        else:
            attr.values.append(
                AttributeValue(value_en=v.value_en, value_ar=v.value_ar, extra=v.extra, sort_order=i)
            )
    db.commit()
    db.refresh(attr)
    log_action(db, action="attribute.update", user_id=user.id, entity="attribute",
               entity_id=attr.id, request=request)
    return _serialize(attr)


@router.delete("/{attribute_id}")
def delete_attribute(
    attribute_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Admin")),
):
    attr = db.get(Attribute, attribute_id)
    if not attr:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attribute not found")
    db.delete(attr)
    db.commit()
    log_action(db, action="attribute.delete", user_id=user.id, entity="attribute",
               entity_id=attribute_id, request=request)
    return {"ok": True, "id": attribute_id}
