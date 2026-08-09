from __future__ import annotations

from pydantic import BaseModel


class UserOut(BaseModel):
    id: int
    username: str
    full_name: str | None
    role: str
    role_level: int
    locale: str
    must_reset_password: bool = False
    image_url: str | None = None

    class Config:
        from_attributes = True
