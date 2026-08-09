"""User management: role-scoped directory, privilege control and password resets.

Visibility & privilege rules (enforced server-side):
- SuperAdmin sees every account and may assign any role (incl. SuperAdmin).
- Admin / Moderator see only accounts *below* their own level and may create /
  assign only roles strictly below their own level.
- Cashier has no access (guarded by ``require_role("Moderator")``).
- Nobody may manage (edit / reset / deactivate) their own account here.
Every mutation is written to the action log.
"""
from __future__ import annotations

import secrets
import string
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_role
from app.core.database import get_db
from app.core.roles import ROLES
from app.core.security import hash_password
from app.models.role import Role
from app.models.sale import Sale
from app.models.user import User
from app.services.logging import log_action
from app.services.settings import get_currency

router = APIRouter(prefix="/users", tags=["users"])

SUPERADMIN_LEVEL = ROLES["SuperAdmin"]
ADMIN_LEVEL = ROLES["Admin"]
MIN_PASSWORD_LEN = 8


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    full_name: str | None = Field(default=None, max_length=150)
    role: str
    password: str | None = Field(default=None, max_length=128)
    image_url: str | None = Field(default=None, max_length=512)


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, max_length=150)
    role: str | None = None
    is_active: bool | None = None
    image_url: str | None = Field(default=None, max_length=512)


class PasswordReset(BaseModel):
    password: str | None = Field(default=None, max_length=128)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _is_super(user: User) -> bool:
    return bool(user.role and user.role.level >= SUPERADMIN_LEVEL)


def _actor_level(user: User) -> int:
    return user.role.level if user.role else 0


def _parse_image_id(value: str | None) -> int | None:
    """Accepts '/images/5', '5', etc. -> 5. Returns None when absent/invalid."""
    if not value:
        return None
    tail = str(value).rstrip("/").split("/")[-1]
    return int(tail) if tail.isdigit() else None


def _image_url(image_id: int | None) -> str | None:
    return f"/images/{image_id}" if image_id else None


def _root_super_id(db: Session) -> int | None:
    """The lowest-id SuperAdmin — the only account allowed to manage other
    SuperAdmins."""
    return (
        db.query(func.min(User.id))
        .join(Role)
        .filter(Role.level >= SUPERADMIN_LEVEL)
        .scalar()
    )


def _gen_password(length: int = 12) -> str:
    """Strong readable password with at least one lower/upper/digit/symbol."""
    lowers, uppers, digits = string.ascii_lowercase, string.ascii_uppercase, string.digits
    symbols = "!@#$%^&*?"
    alphabet = lowers + uppers + digits + symbols
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(length))
        if (any(c in lowers for c in pw) and any(c in uppers for c in pw)
                and any(c in digits for c in pw) and any(c in symbols for c in pw)):
            return pw


def _assignable_roles(db: Session, actor: User) -> list[Role]:
    """Roles the actor may assign: any (SuperAdmin) or strictly below their level."""
    q = db.query(Role)
    if not _is_super(actor):
        q = q.filter(Role.level < _actor_level(actor))
    return q.order_by(Role.level.desc()).all()


def _can_manage(actor: User, target: User, root_super_id: int | None) -> bool:
    """Whether ``actor`` may manage ``target``:
    - The root (lowest-id) SuperAdmin may manage anyone, including themselves and
      other SuperAdmins.
    - Any other account may never manage itself here, and another SuperAdmin can
      only be touched by the root SuperAdmin.
    - Otherwise a SuperAdmin manages anyone, and Admin/Moderator manage accounts
      strictly below their own level.
    """
    is_root = _is_super(actor) and actor.id == root_super_id
    if target.id == actor.id:
        return is_root
    if _is_super(target):
        return is_root
    if _is_super(actor):
        return True
    return _actor_level(target) < _actor_level(actor)


def _visible_query(db: Session, actor: User):
    q = db.query(User).join(Role)
    if not _is_super(actor):
        q = q.filter(Role.level < _actor_level(actor))
    return q


def _sales_aggregates(db: Session, user_ids: list[int]) -> dict[int, dict]:
    """{user_id: {sales, revenue}} across all of that user's sales."""
    if not user_ids:
        return {}
    rows = (
        db.query(Sale.user_id, func.count(Sale.id), func.coalesce(func.sum(Sale.total), 0))
        .filter(Sale.user_id.in_(user_ids))
        .group_by(Sale.user_id)
        .all()
    )
    return {uid: {"sales": int(c or 0), "revenue": round(float(r or 0), 2)} for uid, c, r in rows}


def _month_start(now: datetime | None = None) -> datetime:
    now = now or datetime.now()
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _serialize(u: User, agg: dict[int, dict], actor: User, root_super_id: int | None) -> dict:
    a = agg.get(u.id, {})
    return {
        "id": u.id,
        "username": u.username,
        "full_name": u.full_name,
        "role": u.role.name if u.role else "",
        "role_level": u.role.level if u.role else 0,
        "is_active": u.is_active,
        "locale": u.locale,
        "image_id": u.image_id,
        "image_url": _image_url(u.image_id),
        "created_at": u.created_at.isoformat() if u.created_at else None,
        "sales": a.get("sales", 0),
        "revenue": a.get("revenue", 0.0),
        "manageable": _can_manage(actor, u, root_super_id),
        "is_self": u.id == actor.id,
    }


# --------------------------------------------------------------------------- #
# Read
# --------------------------------------------------------------------------- #
@router.get("")
def list_users(
    db: Session = Depends(get_db),
    actor: User = Depends(require_role("Moderator")),
):
    users = _visible_query(db, actor).order_by(func.lower(User.username)).all()
    agg = _sales_aggregates(db, [u.id for u in users])
    root_id = _root_super_id(db)
    return [_serialize(u, agg, actor, root_id) for u in users]


@router.get("/roles")
def assignable_roles(
    db: Session = Depends(get_db),
    actor: User = Depends(require_role("Moderator")),
):
    return [
        {"name": r.name, "level": r.level, "description": r.description}
        for r in _assignable_roles(db, actor)
    ]


@router.get("/stats")
def user_stats(
    db: Session = Depends(get_db),
    actor: User = Depends(require_role("Moderator")),
):
    users = _visible_query(db, actor).all()
    ids = [u.id for u in users]
    total = len(users)
    active = sum(1 for u in users if u.is_active)

    start_this = _month_start()
    new_month = sum(1 for u in users if u.created_at and u.created_at >= start_this)

    # Role distribution among visible users.
    by_role: dict[str, int] = {}
    for u in users:
        name = u.role.name if u.role else "—"
        by_role[name] = by_role.get(name, 0) + 1

    # Top seller (all-time) and this-month, restricted to the visible team.
    name_of = {u.id: (u.full_name or u.username) for u in users}
    top_all = _top_seller(db, ids, None, name_of)
    top_month = _top_seller(db, ids, start_this, name_of)

    return {
        "total": total,
        "active": active,
        "newThisMonth": new_month,
        "byRole": by_role,
        "topSeller": top_all,
        "topSellerMonth": top_month,
        "currency": get_currency(db),
    }


def _top_seller(db: Session, ids: list[int], since: datetime | None, names: dict[int, str]) -> dict | None:
    if not ids:
        return None
    q = (
        db.query(Sale.user_id, func.count(Sale.id), func.coalesce(func.sum(Sale.total), 0))
        .filter(Sale.user_id.in_(ids))
    )
    if since is not None:
        q = q.filter(Sale.created_at >= since)
    rows = q.group_by(Sale.user_id).all()
    best = None
    for uid, cnt, rev in rows:
        rev = round(float(rev or 0), 2)
        if best is None or rev > best["revenue"]:
            best = {"user_id": uid, "name": names.get(uid, "—"), "sales": int(cnt or 0), "revenue": rev}
    return best


# --------------------------------------------------------------------------- #
# Create
# --------------------------------------------------------------------------- #
def _resolve_assignable_role(db: Session, actor: User, role_name: str) -> Role:
    role = db.query(Role).filter(Role.name == role_name).first()
    if not role:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "users.errors.badRole")
    allowed = {r.id for r in _assignable_roles(db, actor)}
    if role.id not in allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "users.errors.roleTooHigh")
    return role


@router.post("", status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role("Moderator")),
):
    username = payload.username.strip()
    if db.query(User.id).filter(func.lower(User.username) == username.lower()).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "users.errors.usernameTaken")

    role = _resolve_assignable_role(db, actor, payload.role)

    password = (payload.password or "").strip() or _gen_password()
    if len(password) < MIN_PASSWORD_LEN:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "users.errors.passwordShort")

    # Only Admin+ may attach an avatar.
    image_id = None
    if payload.image_url is not None:
        if _actor_level(actor) < ADMIN_LEVEL:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "users.errors.cannotChangeImage")
        image_id = _parse_image_id(payload.image_url)

    user = User(
        username=username,
        full_name=(payload.full_name or "").strip() or None,
        password_hash=hash_password(password),
        role_id=role.id,
        is_active=True,
        must_reset_password=True,
        image_id=image_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    log_action(db, action="user.create", user_id=actor.id, entity="user",
               entity_id=user.id, details={"username": username, "role": role.name},
               request=request)
    agg = _sales_aggregates(db, [user.id])
    out = _serialize(user, agg, actor, _root_super_id(db))
    out["password"] = password  # shown once
    return out


# --------------------------------------------------------------------------- #
# Update (name / role / active)
# --------------------------------------------------------------------------- #
@router.patch("/{user_id}")
def update_user(
    user_id: int,
    payload: UserUpdate,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role("Moderator")),
):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if not _can_manage(actor, target, _root_super_id(db)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "users.errors.cannotManage")

    changes: dict = {}
    if payload.full_name is not None:
        target.full_name = payload.full_name.strip() or None
        changes["full_name"] = target.full_name
    if payload.role is not None and (not target.role or payload.role != target.role.name):
        role = _resolve_assignable_role(db, actor, payload.role)
        target.role_id = role.id
        changes["role"] = role.name
    if payload.is_active is not None:
        # Guard against locking yourself out.
        if target.id == actor.id and not payload.is_active:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "users.errors.cannotDeactivateSelf")
        target.is_active = payload.is_active
        changes["is_active"] = payload.is_active
    if payload.image_url is not None:
        if _actor_level(actor) < ADMIN_LEVEL:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "users.errors.cannotChangeImage")
        target.image_id = _parse_image_id(payload.image_url)
        changes["image_id"] = target.image_id

    db.commit()
    db.refresh(target)
    log_action(db, action="user.update", user_id=actor.id, entity="user",
               entity_id=target.id, details=changes, request=request)
    agg = _sales_aggregates(db, [target.id])
    return _serialize(target, agg, actor, _root_super_id(db))


# --------------------------------------------------------------------------- #
# Reset / generate password
# --------------------------------------------------------------------------- #
@router.post("/{user_id}/reset-password")
def reset_password(
    user_id: int,
    payload: PasswordReset,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role("Moderator")),
):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if not _can_manage(actor, target, _root_super_id(db)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "users.errors.cannotManage")

    password = (payload.password or "").strip() or _gen_password()
    if len(password) < MIN_PASSWORD_LEN:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "users.errors.passwordShort")

    target.password_hash = hash_password(password)
    target.must_reset_password = True
    db.commit()
    log_action(db, action="user.reset_password", user_id=actor.id, entity="user",
               entity_id=target.id, request=request)
    return {"id": target.id, "username": target.username, "password": password}
