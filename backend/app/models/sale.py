"""Completed POS sale (invoice) and its line items.

A sale snapshots the sold price/name at the moment of checkout so later product
edits never rewrite history. Stock is reduced from the variant on completion."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Sale(Base):
    __tablename__ = "sales"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    invoice_no: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)

    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    customer_id: Mapped[int | None] = mapped_column(
        ForeignKey("customers.id"), nullable=True, index=True
    )
    payment_method_id: Mapped[int | None] = mapped_column(
        ForeignKey("payment_methods.id"), nullable=True
    )

    # Snapshots of customer + payment for the printed invoice.
    customer_name: Mapped[str | None] = mapped_column(String(180), nullable=True)
    customer_phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    payment_method: Mapped[str | None] = mapped_column(String(80), nullable=True)

    item_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    subtotal: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    discount: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    total: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    items: Mapped[list["SaleItem"]] = relationship(
        back_populates="sale", cascade="all, delete-orphan", order_by="SaleItem.id"
    )


class SaleItem(Base):
    __tablename__ = "sale_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sale_id: Mapped[int] = mapped_column(
        ForeignKey("sales.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"), nullable=True)
    variant_id: Mapped[int | None] = mapped_column(
        ForeignKey("product_variants.id"), nullable=True, index=True
    )
    stock_id: Mapped[int | None] = mapped_column(
        ForeignKey("product_variant_stocks.id"), nullable=True, index=True
    )

    code: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    unit_price: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    min_price: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    line_total: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)

    sale: Mapped["Sale"] = relationship(back_populates="items")
