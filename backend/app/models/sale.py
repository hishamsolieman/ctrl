"""Completed POS sale (invoice) and its line items.

Line prices/names are snapshotted at checkout so later product edits never
rewrite history. Customer + payment method are referenced by FK (their current
values are shown on the invoice). Stock is reduced from the variant on completion.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, Numeric, String, func
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

    # Customer + payment are read through these FK relationships (no snapshots).
    customer: Mapped["Customer"] = relationship("Customer", lazy="joined")
    payment: Mapped["PaymentMethod"] = relationship("PaymentMethod", lazy="joined")

    item_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    subtotal: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    discount: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    total: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)

    # Cash handling: amount tendered, exact change, and "raw" (rounded-up) change.
    paid_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    change_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    change_raw: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)

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
    # Snapshot of the sold attributes (labels + hex) so later attribute edits
    # never rewrite this invoice's history. Not a foreign key by design.
    attributes: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # unit_price = the price actually charged (may be discounted); list_price =
    # the catalog price at sale time. subtotal on the sale is Σ list·qty (gross),
    # discount is Σ (list−sold)·qty, and total is the net (Σ sold·qty).
    unit_price: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    list_price: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    min_price: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    line_total: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)

    sale: Mapped["Sale"] = relationship(back_populates="items")
