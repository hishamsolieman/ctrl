"""Authentication routes. Login returns ONLY a bearer token (per spec)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.security import create_access_token, verify_password
from app.models.user import User
from app.schemas.auth import LoginRequest, TokenResponse
from app.schemas.user import UserOut
from app.services.logging import log_action

router = APIRouter(prefix="/auth", tags=["auth"])


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
    return UserOut(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        role=user.role.name if user.role else "",
        role_level=user.role.level if user.role else 0,
        locale=user.locale,
    )
