from __future__ import annotations

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=255)


class TokenResponse(BaseModel):
    # Per spec: login returns ONLY the token.
    access_token: str
    token_type: str = "bearer"
