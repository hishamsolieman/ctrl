"""Product categories: CRUD, delete-constraint, bulk edit/delete, export/import."""
from __future__ import annotations

import csv
import io
import re

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_role
from app.core.database import get_db
from app.models.category import Category
from app.models.product import Product
from app.models.user import User
from app.services.logging import log_action

router = APIRouter(prefix="/categories", tags=["categories"])


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class CategoryIn(BaseModel):
    name_en: str = Field(min_length=1, max_length=120)
    name_ar: str = Field(min_length=1, max_length=120)
    description: str | None = None
    image_url: str = Field(min_length=1, max_length=512)  # mandatory image


class CategoryBulkUpdate(BaseModel):
    ids: list[int] = Field(min_length=1)
    name_en: str | None = None
    name_ar: str | None = None
    description: str | None = None
    image_url: str | None = None


class CategoryBulkDelete(BaseModel):
    ids: list[int] = Field(min_length=1)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _parse_image_id(value: str | None) -> int | None:
    """Accepts '/images/5', '5', etc. -> 5. Returns None when absent/invalid."""
    if not value:
        return None
    m = re.search(r"(\d+)\s*$", str(value))
    return int(m.group(1)) if m else None


def _image_url(image_id: int | None) -> str | None:
    return f"/images/{image_id}" if image_id else None


def _name_conflicts(
    db: Session, name_en: str, name_ar: str, exclude_id: int | None = None
) -> tuple[bool, bool]:
    """Return (en_taken, ar_taken) for existing active categories (case-insensitive)."""
    base = db.query(Category.id).filter(Category.is_active.is_(True))
    if exclude_id is not None:
        base = base.filter(Category.id != exclude_id)
    en_taken = db.query(
        base.filter(func.lower(Category.name_en) == name_en.strip().lower()).exists()
    ).scalar()
    ar_taken = db.query(
        base.filter(func.lower(Category.name_ar) == name_ar.strip().lower()).exists()
    ).scalar()
    return bool(en_taken), bool(ar_taken)


def _ensure_unique_names(
    db: Session, name_en: str, name_ar: str, exclude_id: int | None = None
) -> None:
    """Raise a 409 with a specific i18n key when a name is already used."""
    en_taken, ar_taken = _name_conflicts(db, name_en, name_ar, exclude_id)
    if en_taken and ar_taken:
        raise HTTPException(status.HTTP_409_CONFLICT, "categories.errors.bothTaken")
    if en_taken:
        raise HTTPException(status.HTTP_409_CONFLICT, "categories.errors.nameEnTaken")
    if ar_taken:
        raise HTTPException(status.HTTP_409_CONFLICT, "categories.errors.nameArTaken")


def _active_usage(db: Session, category_id: int) -> int:
    """Number of NON-deleted products currently using the category."""
    return (
        db.query(Product.id)
        .filter(Product.category_id == category_id, Product.is_deleted.is_(False))
        .count()
    )


def _serialize(db: Session, c: Category) -> dict:
    return {
        "id": c.id,
        "name_en": c.name_en,
        "name_ar": c.name_ar,
        "description": c.description,
        "image_id": c.image_id,
        "image_url": _image_url(c.image_id),
        "product_count": _active_usage(db, c.id),
    }


def _delete_one(db: Session, category_id: int) -> tuple[bool, int]:
    """Delete a category if no active product uses it.

    Soft-deleted products referencing it are detached (category_id -> NULL) so the
    FK stays valid. Returns (deleted, active_usage_count)."""
    used = _active_usage(db, category_id)
    if used > 0:
        return False, used
    db.query(Product).filter(Product.category_id == category_id).update(
        {Product.category_id: None}, synchronize_session=False
    )
    cat = db.get(Category, category_id)
    if cat:
        db.delete(cat)
    return True, 0


# --------------------------------------------------------------------------- #
# Read
# --------------------------------------------------------------------------- #
@router.get("")
def list_categories(db: Session = Depends(get_db), _u: User = Depends(get_current_user)):
    rows = (
        db.query(Category)
        .filter(Category.is_active.is_(True))
        .order_by(func.lower(Category.name_en))
        .all()
    )
    return [_serialize(db, c) for c in rows]


@router.get("/export/csv")
def export_categories(
    q: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
    request: Request = None,  # type: ignore[assignment]
):
    # Only non-deleted (active) categories, and only those matching the on-screen
    # search so the export mirrors exactly what the user currently sees.
    query = db.query(Category).filter(Category.is_active.is_(True))
    term = (q or "").strip()
    if term:
        like = f"%{term}%"
        query = query.filter(
            or_(
                Category.name_en.ilike(like),
                Category.name_ar.ilike(like),
                Category.description.ilike(like),
            )
        )
    rows = query.order_by(func.lower(Category.name_en)).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    # Image is intentionally omitted; imports default it to image id 1.
    w.writerow(["name_en", "name_ar", "description"])
    for c in rows:
        w.writerow([c.name_en, c.name_ar, c.description or ""])
    log_action(db, action="category.export", user_id=user.id, request=request)
    # Encode with a UTF-8 BOM so Excel reads Arabic correctly.
    return StreamingResponse(
        iter([buf.getvalue().encode("utf-8-sig")]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=categories.csv"},
    )


@router.get("/{category_id}")
def get_category(category_id: int, db: Session = Depends(get_db), _u: User = Depends(get_current_user)):
    cat = db.get(Category, category_id)
    if not cat or not cat.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found")
    return _serialize(db, cat)


# --------------------------------------------------------------------------- #
# Create / Update / Delete
# --------------------------------------------------------------------------- #
@router.post("", status_code=status.HTTP_201_CREATED)
def create_category(
    payload: CategoryIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    image_id = _parse_image_id(payload.image_url)
    if not image_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A category image is required")
    _ensure_unique_names(db, payload.name_en, payload.name_ar)
    cat = Category(
        name_en=payload.name_en,
        name_ar=payload.name_ar,
        description=payload.description,
        image_id=image_id,
        is_active=True,
    )
    db.add(cat)
    db.commit()
    db.refresh(cat)
    log_action(db, action="category.create", user_id=user.id, entity="category",
               entity_id=cat.id, request=request)
    return _serialize(db, cat)


@router.put("/{category_id}")
def update_category(
    category_id: int,
    payload: CategoryIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    cat = db.get(Category, category_id)
    if not cat or not cat.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found")
    image_id = _parse_image_id(payload.image_url)
    if not image_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A category image is required")
    _ensure_unique_names(db, payload.name_en, payload.name_ar, exclude_id=category_id)
    cat.name_en = payload.name_en
    cat.name_ar = payload.name_ar
    cat.description = payload.description
    cat.image_id = image_id
    db.commit()
    db.refresh(cat)
    log_action(db, action="category.update", user_id=user.id, entity="category",
               entity_id=cat.id, request=request)
    return _serialize(db, cat)


@router.delete("/{category_id}")
def delete_category(
    category_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    cat = db.get(Category, category_id)
    if not cat or not cat.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found")
    deleted, used = _delete_one(db, category_id)
    if not deleted:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Category is used by {used} product(s) and cannot be deleted.",
        )
    db.commit()
    log_action(db, action="category.delete", user_id=user.id, entity="category",
               entity_id=category_id, request=request)
    return {"ok": True, "id": category_id}


# --------------------------------------------------------------------------- #
# Bulk
# --------------------------------------------------------------------------- #
@router.post("/bulk-update")
def bulk_update_categories(
    payload: CategoryBulkUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    fields = {
        k: v
        for k, v in {
            "name_en": payload.name_en,
            "name_ar": payload.name_ar,
            "description": payload.description,
        }.items()
        if v is not None
    }
    if payload.image_url is not None:
        fields["image_id"] = _parse_image_id(payload.image_url)
    if not fields:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No fields to update")
    rows = (
        db.query(Category)
        .filter(Category.id.in_(payload.ids), Category.is_active.is_(True))
        .all()
    )
    # Name uniqueness guard.
    changing_en = "name_en" in fields
    changing_ar = "name_ar" in fields
    if changing_en or changing_ar:
        if len(rows) > 1:
            # The same name would be applied to several categories -> duplicates.
            if changing_en and changing_ar:
                raise HTTPException(status.HTTP_409_CONFLICT, "categories.errors.bothTaken")
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "categories.errors.nameEnTaken" if changing_en else "categories.errors.nameArTaken",
            )
        for c in rows:
            _ensure_unique_names(
                db,
                fields.get("name_en", c.name_en),
                fields.get("name_ar", c.name_ar),
                exclude_id=c.id,
            )
    for c in rows:
        for k, v in fields.items():
            setattr(c, k, v)
    db.commit()
    log_action(db, action="category.bulk_update", user_id=user.id, entity="category",
               details={"ids": payload.ids, "fields": list(fields)}, request=request)
    return {"updated": len(rows), "fields": list(fields)}


@router.post("/bulk-delete")
def bulk_delete_categories(
    payload: CategoryBulkDelete,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    deleted: list[int] = []
    blocked: list[dict] = []
    for cid in payload.ids:
        cat = db.get(Category, cid)
        if not cat or not cat.is_active:
            continue
        ok, used = _delete_one(db, cid)
        if ok:
            deleted.append(cid)
        else:
            blocked.append({"id": cid, "name": cat.name_en, "count": used})
    db.commit()
    log_action(db, action="category.bulk_delete", user_id=user.id, entity="category",
               details={"deleted": deleted, "blocked": [b["id"] for b in blocked]}, request=request)
    return {"deleted": deleted, "blocked": blocked}


@router.post("/import/csv")
async def import_categories(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
    request: Request = None,  # type: ignore[assignment]
):
    content = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(content))
    created = 0
    skipped = 0
    # Track names seen within this file (case-insensitive) to avoid in-file duplicates.
    seen_en: set[str] = set()
    seen_ar: set[str] = set()
    for row in reader:
        name_en = (row.get("name_en") or "").strip()
        name_ar = (row.get("name_ar") or "").strip()
        if not name_en or not name_ar:
            continue
        key_en, key_ar = name_en.lower(), name_ar.lower()
        en_taken, ar_taken = _name_conflicts(db, name_en, name_ar)
        if en_taken or ar_taken or key_en in seen_en or key_ar in seen_ar:
            skipped += 1
            continue
        seen_en.add(key_en)
        seen_ar.add(key_ar)
        db.add(Category(
            name_en=name_en,
            name_ar=name_ar,
            description=(row.get("description") or "").strip() or None,
            # No image column in the CSV; default every imported category to image id 1.
            image_id=1,
            is_active=True,
        ))
        created += 1
    db.commit()
    log_action(db, action="category.import", user_id=user.id,
               details={"created": created, "skipped": skipped}, request=request)
    return {"created": created, "skipped": skipped}
