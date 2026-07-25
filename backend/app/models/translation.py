"""Translation store — backend-managed i18n strings.

Supports English + Arabic now and any future language by adding rows with a
new ``locale``. Keyed by (namespace, key, locale).
"""
from __future__ import annotations

from sqlalchemy import Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Translation(Base):
    __tablename__ = "translations"
    __table_args__ = (
        UniqueConstraint("namespace", "key", "locale", name="uq_translation"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    namespace: Mapped[str] = mapped_column(String(100), default="common", nullable=False)
    key: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    locale: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
