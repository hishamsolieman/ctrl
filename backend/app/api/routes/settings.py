"""Application settings — Admin+ only.

Currently exposes the *Printer* settings: CRUD for print profiles (printer +
paper size) and the assignment of a profile to each print target
(barcode / invoice / report). Assignments live in the key/value ``settings``
table so they're trivially extensible. Every mutation is logged.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_role
from app.core.database import get_db
from app.models.print_profile import PrintProfile
from app.models.user import User
from app.services.logging import log_action
from app.services.settings import get_setting, set_setting

router = APIRouter(prefix="/settings", tags=["settings"])

# Print targets and their settings-table keys.
TARGETS = ("barcode", "invoice", "report")
ASSIGN_KEY = {t: f"print.assign.{t}" for t in TARGETS}

UNITS = ("mm", "cm", "in")
SIZE_MODES = ("standard", "custom")


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class ProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    printer_name: str = Field(min_length=1, max_length=255)
    size_mode: str = "standard"
    standard_size: str | None = Field(default=None, max_length=40)
    width: float | None = None
    height: float | None = None
    unit: str = "mm"


class AssignIn(BaseModel):
    target: str
    profile_id: int | None = None


class TestIn(BaseModel):
    target: str
    profile_id: int


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _serialize(p: PrintProfile) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "printer_name": p.printer_name,
        "size_mode": p.size_mode,
        "standard_size": p.standard_size,
        "width": float(p.width) if p.width is not None else None,
        "height": float(p.height) if p.height is not None else None,
        "unit": p.unit,
    }


def _validate(payload: ProfileIn) -> None:
    if payload.size_mode not in SIZE_MODES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "settings.printer.errors.badSize")
    if payload.unit not in UNITS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "settings.printer.errors.badSize")
    if payload.size_mode == "standard":
        if not (payload.standard_size or "").strip():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "settings.printer.errors.sizeRequired")
    else:  # custom
        if not payload.width or not payload.height or payload.width <= 0 or payload.height <= 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "settings.printer.errors.sizeRequired")


def _name_clash(db: Session, name: str, exclude_id: int | None = None) -> bool:
    q = db.query(PrintProfile.id).filter(func.lower(PrintProfile.name) == name.strip().lower())
    if exclude_id is not None:
        q = q.filter(PrintProfile.id != exclude_id)
    return db.query(q.exists()).scalar()


def _assignments(db: Session) -> dict[str, int | None]:
    out: dict[str, int | None] = {}
    for t, key in ASSIGN_KEY.items():
        raw = get_setting(db, key, "")
        out[t] = int(raw) if raw.isdigit() else None
    return out


# --------------------------------------------------------------------------- #
# Profiles
# --------------------------------------------------------------------------- #
@router.get("/print/profiles")
def list_profiles(db: Session = Depends(get_db), _u: User = Depends(require_role("Admin"))):
    rows = db.query(PrintProfile).order_by(func.lower(PrintProfile.name)).all()
    return [_serialize(p) for p in rows]


@router.post("/print/profiles", status_code=status.HTTP_201_CREATED)
def create_profile(
    payload: ProfileIn,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role("Admin")),
):
    _validate(payload)
    if _name_clash(db, payload.name):
        raise HTTPException(status.HTTP_409_CONFLICT, "settings.printer.errors.nameTaken")
    p = PrintProfile(
        name=payload.name.strip(),
        printer_name=payload.printer_name.strip(),
        size_mode=payload.size_mode,
        standard_size=(payload.standard_size or "").strip() or None if payload.size_mode == "standard" else None,
        width=payload.width if payload.size_mode == "custom" else None,
        height=payload.height if payload.size_mode == "custom" else None,
        unit=payload.unit,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    log_action(db, action="settings.print.profile.create", user_id=actor.id,
               entity="print_profile", entity_id=p.id, details=_serialize(p), request=request)
    return _serialize(p)


@router.put("/print/profiles/{profile_id}")
def update_profile(
    profile_id: int,
    payload: ProfileIn,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role("Admin")),
):
    p = db.get(PrintProfile, profile_id)
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    _validate(payload)
    if _name_clash(db, payload.name, exclude_id=profile_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "settings.printer.errors.nameTaken")
    p.name = payload.name.strip()
    p.printer_name = payload.printer_name.strip()
    p.size_mode = payload.size_mode
    p.standard_size = (payload.standard_size or "").strip() or None if payload.size_mode == "standard" else None
    p.width = payload.width if payload.size_mode == "custom" else None
    p.height = payload.height if payload.size_mode == "custom" else None
    p.unit = payload.unit
    db.commit()
    db.refresh(p)
    log_action(db, action="settings.print.profile.update", user_id=actor.id,
               entity="print_profile", entity_id=p.id, details=_serialize(p), request=request)
    return _serialize(p)


@router.delete("/print/profiles/{profile_id}")
def delete_profile(
    profile_id: int,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role("Admin")),
):
    p = db.get(PrintProfile, profile_id)
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    name = p.name
    # Clear any assignment pointing at this profile.
    cleared = []
    for t, key in ASSIGN_KEY.items():
        if get_setting(db, key, "") == str(profile_id):
            set_setting(db, key, "")
            cleared.append(t)
    db.delete(p)
    db.commit()
    log_action(db, action="settings.print.profile.delete", user_id=actor.id,
               entity="print_profile", entity_id=profile_id,
               details={"name": name, "unassigned": cleared}, request=request)
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Assignments
# --------------------------------------------------------------------------- #
@router.get("/print/assignments")
def get_assignments(db: Session = Depends(get_db), _u: User = Depends(require_role("Admin"))):
    return _assignments(db)


@router.get("/print/target/{target}")
def get_target_profile(
    target: str,
    db: Session = Depends(get_db),
    _u: User = Depends(get_current_user),
):
    """Resolve the profile assigned to a print target.

    Available to any authenticated user (e.g. the Barcode page needs the paper
    size + device to render/print labels without exposing full settings).
    """
    if target not in ASSIGN_KEY:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "settings.printer.errors.badTarget")
    raw = get_setting(db, ASSIGN_KEY[target], "")
    profile = db.get(PrintProfile, int(raw)) if raw.isdigit() else None
    return {"target": target, "profile": _serialize(profile) if profile else None}


@router.put("/print/assignments")
def set_assignment(
    payload: AssignIn,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role("Admin")),
):
    if payload.target not in ASSIGN_KEY:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "settings.printer.errors.badTarget")
    if payload.profile_id is not None and not db.get(PrintProfile, payload.profile_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    set_setting(db, ASSIGN_KEY[payload.target], str(payload.profile_id or ""))
    log_action(db, action="settings.print.assign", user_id=actor.id, entity="settings",
               details={"target": payload.target, "profile_id": payload.profile_id}, request=request)
    return _assignments(db)


@router.post("/print/test")
def test_print(
    payload: TestIn,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role("Admin")),
):
    """Record a test-print action. The actual printing is performed client-side."""
    if payload.target not in ASSIGN_KEY:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "settings.printer.errors.badTarget")
    p = db.get(PrintProfile, payload.profile_id)
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    log_action(db, action="settings.print.test", user_id=actor.id, entity="print_profile",
               entity_id=p.id, details={"target": payload.target, "profile": _serialize(p)},
               request=request)
    return {"ok": True}
