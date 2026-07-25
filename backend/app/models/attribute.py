"""Attribute definitions (e.g. Color, Size) and their bilingual values.

These define which per-variant parameters exist. If NO attributes are defined,
a product needs no variants (it has a single implicit variant). When attributes
exist, each product variant selects one value per attribute.

Each attribute has a ``type`` (text | number | color), can be marked required
(mandatory when adding a product) and can opt into ``coding`` (its values help
compose the product-variant code). Attributes and values are never
hard-deleted — they are soft-deleted (``is_deleted``).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

# Allowed attribute types.
ATTR_TYPES = ("text", "number", "color")


class Attribute(Base):
    __tablename__ = "attributes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Machine slug, e.g. "color" / "size" (auto-derived from name_en).
    key: Mapped[str] = mapped_column(String(60), unique=True, nullable=False)
    type: Mapped[str] = mapped_column(String(20), default="text", nullable=False)
    name_en: Mapped[str] = mapped_column(String(120), nullable=False)
    name_ar: Mapped[str] = mapped_column(String(120), nullable=False)
    # Mandatory when adding a product (a value must be selected).
    is_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Advanced: this attribute's values contribute to the variant code.
    coding: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

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
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    attribute: Mapped["Attribute"] = relationship(back_populates="values")
