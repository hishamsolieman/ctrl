"""Stock holds — cross-cashier reservations.

While a stock unit sits in a cashier tab's cart it is *held*, so other cashier
tabs (even in other sessions) can only sell the remaining, un-held stock. Each
cashier tab owns a ``hold_key``; a row reserves ``quantity`` of a stock unit for
that key. Holds are released when the line is removed, the tab is cleared, or the
sale is completed (converted into an actual stock deduction). Stale holds (older
than a threshold) are ignored so an abandoned tab never locks stock forever."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SaleHold(Base):
    __tablename__ = "sale_holds"
    __table_args__ = (UniqueConstraint("hold_key", "stock_id", name="uq_hold_key_stock"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    hold_key: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    stock_id: Mapped[int] = mapped_column(
        ForeignKey("product_variant_stocks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
