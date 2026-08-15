"""Password hashing (bcrypt) and JWT token creation/verification."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import JWTError, jwt

# -----------------------------------------------------------------------------
# Auth configuration is EMBEDDED in the backend (not read from .env), the same
# way the AES key lives in the backend. Rotating the secret invalidates all
# previously issued tokens.
# -----------------------------------------------------------------------------
JWT_SECRET = "9tEG2x9QGdSVjc8xWZshIlK4QsmIuOazUaaP_IOta9KZVO9z7vwu7Q4QjCMARfmE"
JWT_ALGORITHM = "HS256"
# Token lifetime: 1 year (per spec).
JWT_EXPIRE_SECONDS = 365 * 24 * 60 * 60


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(subject: str | int, extra: dict[str, Any] | None = None) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(subject),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=JWT_EXPIRE_SECONDS)).timestamp()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        return None
