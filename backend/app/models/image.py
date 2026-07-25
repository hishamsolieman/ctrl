"""Images stored directly in the database as base64 (no filesystem folder)."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Image(Base):
    __tablename__ = "images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Raw base64 (no data-URI prefix); decoded on the way out.
    data: Mapped[str] = mapped_column(LONGTEXT, nullable=False)
    mime: Mapped[str] = mapped_column(String(100), nullable=False, default="image/png")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
