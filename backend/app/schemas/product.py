from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator


class VariantInput(BaseModel):
    id: int | None = None  # present when editing an existing variant
    code: str | None = None  # blank -> auto-generated
    # {attribute_id: attribute_value_id}
    attributes: dict[str, int] | None = None
    image_urls: list[str] | None = None

    @field_validator("image_urls")
    @classmethod
    def _max_five_images(cls, v):
        if v and len(v) > 5:
            raise ValueError("A variant can have at most 5 images")
        return v


class ProductInput(BaseModel):
    code: str | None = None  # blank -> auto-generated (8-char alphanumeric)
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    category_id: int | None = None
    supplier_id: int | None = None
    supplier_price: float = 0
    min_price: float = 0
    price: float = 0
    note: str | None = None
    tags: list[str] | None = None
    # Global (non-coding) attribute selections: {attribute_id: attribute_value_id}
    attributes: dict[str, int] | None = None
    variants: list[VariantInput] = Field(default_factory=list)

    @field_validator("variants")
    @classmethod
    def _at_least_one(cls, v):
        if not v:
            raise ValueError("At least one variant is required")
        return v


# ---- Output shapes ----
class ImageOut(BaseModel):
    id: int
    url: str


class VariantOut(BaseModel):
    id: int
    code: str
    attributes: dict[str, int] | None
    images: list[ImageOut]


class ProductOut(BaseModel):
    id: int
    code: str
    name: str
    description: str | None
    category_id: int | None
    category_name_en: str | None
    category_name_ar: str | None
    supplier_id: int | None
    supplier_name: str | None
    supplier_price: float
    min_price: float
    price: float
    note: str | None
    tags: list[str] | None
    attributes: dict[str, int] | None
    variants: list[VariantOut]
    images: list[ImageOut]  # aggregated across variants (for the card carousel)
    created_at: datetime
