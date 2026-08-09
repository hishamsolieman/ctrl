"""Supplier — products reference a supplier via FK."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Supplier(Base):
    __tablename__ = "suppliers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(60), nullable=True)
    email: Mapped[str | None] = mapped_column(String(180), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Soft-delete flag — deleted rows stay in the DB so import can treat them
    # as a different record (new id) rather than reviving them.
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    products: Mapped[list["Product"]] = relationship(back_populates="supplier")  # noqa: F821
    invoices: Mapped[list["SupplierInvoice"]] = relationship(  # noqa: F821
        back_populates="supplier",
        cascade="all, delete-orphan",
        order_by="SupplierInvoice.id.desc()",
    )
