"""Authentication routes. Login returns ONLY a bearer token (per spec)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.schemas.auth import LoginRequest, TokenResponse
from app.schemas.user import UserOut
from app.services.logging import log_action

router = APIRouter(prefix="/auth", tags=["auth"])

MIN_PASSWORD_LEN = 8


class LocaleUpdate(BaseModel):
    locale: str = Field(min_length=2, max_length=10)


class ChangePasswordRequest(BaseModel):
    password: str = Field(min_length=1, max_length=200)
    confirm_password: str = Field(min_length=1, max_length=200)


class ProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, max_length=150)
    image_url: str | None = Field(default=None, max_length=512)


def _parse_image_id(value: str | None) -> int | None:
    """Accepts '/images/5', '5', etc. -> 5. Returns None when absent/invalid."""
    if not value:
        return None
    tail = str(value).rstrip("/").split("/")[-1]
    return int(tail) if tail.isdigit() else None


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        role=user.role.name if user.role else "",
        role_level=user.role.level if user.role else 0,
        locale=user.locale,
        must_reset_password=bool(user.must_reset_password),
        image_url=f"/images/{user.image_id}" if user.image_id else None,
    )


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == payload.username).first()

    if not user or not verify_password(payload.password, user.password_hash):
        log_action(
            db,
            action="auth.login",
            user_id=user.id if user else None,
            status="failure",
            details={"username": payload.username},
            request=request,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    if not user.is_active:
        log_action(db, action="auth.login", user_id=user.id, status="failure",
                   details={"reason": "inactive"}, request=request)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    token = create_access_token(
        user.id, extra={"role": user.role.name if user.role else None}
    )
    log_action(db, action="auth.login", user_id=user.id, status="success", request=request)

    # Return ONLY the token — nothing else.
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    """Resolve the current user from the token (used by the SPA after login)."""
    return _user_out(user)


@router.put("/me", response_model=UserOut)
def update_my_profile(
    payload: ProfileUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Self-service profile: full name and avatar. Any authenticated role."""
    changes: dict = {}
    if payload.full_name is not None:
        user.full_name = payload.full_name.strip() or None
        changes["full_name"] = user.full_name
    if payload.image_url is not None:
        user.image_id = _parse_image_id(payload.image_url)
        changes["image_id"] = user.image_id
    db.commit()
    db.refresh(user)
    log_action(
        db,
        action="user.profile.update",
        user_id=user.id,
        entity="user",
        entity_id=user.id,
        details=changes,
        request=request,
    )
    return _user_out(user)


@router.put("/me/locale", response_model=UserOut)
def update_my_locale(
    payload: LocaleUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Persist the user's preferred UI language so it follows them across devices."""
    code = payload.locale.strip().lower()[:10]
    user.locale = code
    db.commit()
    db.refresh(user)
    log_action(db, action="user.locale", user_id=user.id,
               details={"locale": code}, request=request)
    return _user_out(user)


@router.post("/change-password", response_model=UserOut)
def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Self-service password change. Clears the forced-reset flag on success."""
    password = (payload.password or "").strip()
    confirm = (payload.confirm_password or "").strip()

    if len(password) < MIN_PASSWORD_LEN:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "auth.reset.errors.passwordShort")
    if password != confirm:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "auth.reset.errors.mismatch")
    if verify_password(password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "auth.reset.errors.samePassword")

    user.password_hash = hash_password(password)
    user.must_reset_password = False
    db.commit()
    db.refresh(user)
    log_action(
        db,
        action="auth.change_password",
        user_id=user.id,
        entity="user",
        entity_id=user.id,
        request=request,
    )
    return _user_out(user)
