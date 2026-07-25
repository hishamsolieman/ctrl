"""Supplier — products reference a supplier via FK."""
from __future__ import annotations

from sqlalchemy import Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Supplier(Base):
    __tablename__ = "suppliers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(60), nullable=True)
    email: Mapped[str | None] = mapped_column(String(180), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    products: Mapped[list["Product"]] = relationship(back_populates="supplier")  # noqa: F821
