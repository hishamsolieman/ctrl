"""Attribute definitions (e.g. Color, Size) and their bilingual values.

These define which per-variant parameters exist. If NO attributes are defined,
a product needs no variants (it has a single implicit variant). When attributes
exist, each product variant selects one value per attribute.
"""
from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Attribute(Base):
    __tablename__ = "attributes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Machine slug, e.g. "color" / "size".
    key: Mapped[str] = mapped_column(String(60), unique=True, nullable=False)
    name_en: Mapped[str] = mapped_column(String(120), nullable=False)
    name_ar: Mapped[str] = mapped_column(String(120), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    values: Mapped[list["AttributeValue"]] = relationship(
        back_populates="attribute",
        cascade="all, delete-orphan",
        order_by="AttributeValue.sort_order",
    )


class AttributeValue(Base):
    __tablename__ = "attribute_values"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    attribute_id: Mapped[int] = mapped_column(
        ForeignKey("attributes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    value_en: Mapped[str] = mapped_column(String(120), nullable=False)
    value_ar: Mapped[str] = mapped_column(String(120), nullable=False)
    # Optional extras, e.g. {"hex": "#ff0000"} for a colour swatch.
    extra: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    attribute: Mapped["Attribute"] = relationship(back_populates="values")
