"""Suppliers: CRUD, soft-delete, CSV import/export, and headline stats."""
from __future__ import annotations

import base64
import csv
import io
import json
import re
import sys
from datetime import date, datetime

# Invoice images travel as base64 inside a single CSV cell — far above the
# default 128KiB field cap.
try:
    csv.field_size_limit(sys.maxsize)
except OverflowError:  # Windows
    csv.field_size_limit(1024 * 1024 * 1024)

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.api.deps import require_role
from app.core.database import get_db
from app.models.image import Image
from app.models.product import Product, ProductVariant, VariantStock
from app.models.supplier import Supplier
from app.models.supplier_invoice import SupplierInvoice
from app.models.user import User
from app.services.logging import log_action
from app.services.settings import get_currency

_IMAGE_ID_RE = re.compile(r"/images/(\d+)", re.IGNORECASE)
_DATA_URI_RE = re.compile(
    r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", re.DOTALL
)

router = APIRouter(prefix="/suppliers", tags=["suppliers"])


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class SupplierIn(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    phone: str | None = None
    email: str | None = None
    address: str = Field(min_length=1)


class InvoiceIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    quantity: int = Field(ge=0)
    amount: float = Field(ge=0)
    invoice_date: date
    image_url: str | None = None


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _live(q):
    """Restrict a Supplier query to non-deleted rows."""
    return q.filter(Supplier.is_deleted.is_(False))


def _stock_base(db: Session, *extra_filters):
    """On-hand stock joined to live products that have a supplier."""
    q = (
        db.query(
            Product.supplier_id,
            func.coalesce(func.sum(VariantStock.quantity), 0),
            func.coalesce(func.sum(VariantStock.quantity * Product.supplier_price), 0),
        )
        .select_from(VariantStock)
        .join(ProductVariant, VariantStock.variant_id == ProductVariant.id)
        .join(Product, ProductVariant.product_id == Product.id)
        .filter(
            Product.is_deleted.is_(False),
            ProductVariant.is_deleted.is_(False),
            Product.supplier_id.isnot(None),
            *extra_filters,
        )
        .group_by(Product.supplier_id)
    )
    return q


def _units_and_spend(db: Session, *extra_filters) -> tuple[dict[int, int], dict[int, float]]:
    """Per supplier: total units (Σ stock qty) and Σ(qty × supplier_price)."""
    units: dict[int, int] = {}
    spend: dict[int, float] = {}
    for sid, qty, cost in _stock_base(db, *extra_filters).all():
        units[sid] = int(qty or 0)
        spend[sid] = round(float(cost or 0), 2)
    return units, spend


def _active_usage(db: Session, supplier_id: int) -> int:
    """How many live product rows still reference this supplier (delete guard)."""
    return (
        db.query(Product.id)
        .filter(Product.supplier_id == supplier_id, Product.is_deleted.is_(False))
        .count()
    )


def _snapshot(s: Supplier) -> dict:
    return {
        "name": s.name,
        "phone": s.phone,
        "email": s.email,
        "address": s.address,
    }


def _serialize(s: Supplier, units: dict[int, int]) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "phone": s.phone,
        "email": s.email,
        "address": s.address,
        # Units on hand across every variant/stock — not the product-row count.
        "product_count": units.get(s.id, 0),
    }


def _month_bounds(now: datetime | None = None) -> tuple[datetime, datetime]:
    """(start_of_this_month, start_of_last_month) at 00:00."""
    now = now or datetime.now()
    start_this = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if start_this.month == 1:
        start_last = start_this.replace(year=start_this.year - 1, month=12)
    else:
        start_last = start_this.replace(month=start_this.month - 1)
    return start_this, start_last


def _trend(month: float, prev: float) -> dict:
    if month > prev:
        direction = "up"
    elif month < prev:
        direction = "down"
    else:
        direction = "flat"
    return {"month": round(month, 2), "prev": round(prev, 2), "dir": direction}


def _find_live_by_name(db: Session, name: str, exclude_id: int | None = None) -> Supplier | None:
    q = _live(db.query(Supplier)).filter(func.lower(Supplier.name) == name.strip().lower())
    if exclude_id is not None:
        q = q.filter(Supplier.id != exclude_id)
    return q.first()


def _name_taken(db: Session, name: str, exclude_id: int | None = None) -> bool:
    return _find_live_by_name(db, name, exclude_id) is not None


def _get_live_or_404(db: Session, supplier_id: int) -> Supplier:
    s = db.get(Supplier, supplier_id)
    if not s or s.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Supplier not found")
    return s


def _parse_image_id(url: str | None) -> int | None:
    if not url:
        return None
    m = _IMAGE_ID_RE.search(str(url).strip())
    if m:
        return int(m.group(1))
    raw = str(url).strip()
    if raw.isdigit():
        return int(raw)
    return None


def _invoice_image_payload(db: Session, image_url: str | None) -> dict:
    """Resolve an invoice image_url to {image_mime, image_base64} for CSV export."""
    image_id = _parse_image_id(image_url)
    if not image_id:
        return {"image_mime": "", "image_base64": ""}
    img = db.get(Image, image_id)
    if not img or not img.data:
        return {"image_mime": "", "image_base64": ""}
    return {"image_mime": img.mime or "image/png", "image_base64": img.data}


def _serialize_invoices_for_export(db: Session, invoices: list[SupplierInvoice]) -> str:
    payload = []
    for inv in invoices:
        img = _invoice_image_payload(db, inv.image_url)
        payload.append(
            {
                "name": inv.name,
                "quantity": int(inv.quantity or 0),
                "amount": float(inv.amount or 0),
                "invoice_date": inv.invoice_date.isoformat() if inv.invoice_date else "",
                "image_mime": img["image_mime"],
                "image_base64": img["image_base64"],
            }
        )
    return json.dumps(payload, ensure_ascii=False)


def _store_import_image(db: Session, mime: str | None, b64: str | None) -> str | None:
    """Persist a base64 image from CSV and return ``/images/{id}`` (or None)."""
    raw_b64 = (b64 or "").strip()
    if not raw_b64:
        return None
    mime_type = (mime or "").strip() or "image/png"
    m = _DATA_URI_RE.match(raw_b64)
    if m:
        mime_type = m.group(1)
        raw_b64 = m.group(2).strip()
    # Validate base64; reject garbage rather than writing corrupt rows.
    try:
        base64.b64decode(raw_b64, validate=False)
    except Exception:  # noqa: BLE001
        return None
    if not mime_type.startswith("image/"):
        mime_type = "image/png"
    img = Image(data=raw_b64, mime=mime_type)
    db.add(img)
    db.flush()
    return f"/images/{img.id}"


def _parse_invoice_date(value: str | None) -> date | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _parse_invoices_cell(raw: str | None) -> list[dict]:
    text = (raw or "").strip()
    if not text:
        return []
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    out: list[dict] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        try:
            quantity = int(item.get("quantity") or 0)
        except (TypeError, ValueError):
            quantity = 0
        try:
            amount = float(item.get("amount") or 0)
        except (TypeError, ValueError):
            amount = 0.0
        if quantity < 0:
            quantity = 0
        if amount < 0:
            amount = 0.0
        out.append(
            {
                "name": name[:255],
                "quantity": quantity,
                "amount": round(amount, 2),
                "invoice_date": _parse_invoice_date(str(item.get("invoice_date") or "")),
                "image_mime": str(item.get("image_mime") or "").strip() or None,
                "image_base64": str(item.get("image_base64") or "").strip() or None,
            }
        )
    return out


def _replace_invoices(db: Session, supplier: Supplier, invoices: list[dict]) -> None:
    """Replace a supplier's invoices with the imported set (images re-stored)."""
    db.query(SupplierInvoice).filter(SupplierInvoice.supplier_id == supplier.id).delete(
        synchronize_session=False
    )
    for item in invoices:
        image_url = _store_import_image(db, item.get("image_mime"), item.get("image_base64"))
        db.add(
            SupplierInvoice(
                supplier_id=supplier.id,
                name=item["name"],
                quantity=item["quantity"],
                amount=item["amount"],
                invoice_date=item["invoice_date"],
                image_url=image_url,
            )
        )


# --------------------------------------------------------------------------- #
# Read
# --------------------------------------------------------------------------- #
@router.get("")
def list_suppliers(db: Session = Depends(get_db), _u: User = Depends(require_role("Moderator"))):
    units, _ = _units_and_spend(db)
    rows = _live(db.query(Supplier)).order_by(func.lower(Supplier.name)).all()
    return [_serialize(s, units) for s in rows]


@router.get("/stats")
def supplier_stats(db: Session = Depends(get_db), _u: User = Depends(require_role("Moderator"))):
    """Headline numbers + month-over-month trends for the page's stat cards.

    Paid / products use on-hand stock: every live variant's stock quantity, valued
    at the product's ``supplier_price``. "This month" scopes those same formulas
    to products whose ``created_at`` falls in the month (no purchase ledger).
    """
    start_this, start_last = _month_bounds()
    units, spend = _units_and_spend(db)
    suppliers = _live(db.query(Supplier)).all()
    total = len(suppliers)
    products = sum(units.get(s.id, 0) for s in suppliers)
    total_spend = round(sum(spend.get(s.id, 0.0) for s in suppliers), 2)

    top = None
    if suppliers:
        best = max(suppliers, key=lambda s: spend.get(s.id, 0.0))
        if spend.get(best.id, 0.0) > 0:
            top = {"name": best.name, "spend": round(spend.get(best.id, 0.0), 2)}

    # New suppliers this month vs last month.
    sup_month = sum(1 for s in suppliers if s.created_at and s.created_at >= start_this)
    sup_prev = sum(
        1 for s in suppliers
        if s.created_at and start_last <= s.created_at < start_this
    )

    # Units & spend for products created this / last month (same qty × price math).
    units_month, spend_month_map = _units_and_spend(db, Product.created_at >= start_this)
    units_prev, spend_prev_map = _units_and_spend(
        db, Product.created_at >= start_last, Product.created_at < start_this
    )
    prod_month = sum(units_month.values())
    prod_prev = sum(units_prev.values())
    spend_month = round(sum(spend_month_map.values()), 2)
    spend_prev = round(sum(spend_prev_map.values()), 2)

    return {
        "total": total,
        "totalTrend": _trend(sup_month, float(sup_prev)),
        "products": products,
        "productsTrend": _trend(float(prod_month), float(prod_prev)),
        "spend": total_spend,
        "spendTrend": _trend(spend_month, spend_prev),
        "currency": get_currency(db),
        "top": top,
    }


@router.get("/export/csv")
def export_suppliers(
    q: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
    request: Request = None,  # type: ignore[assignment]
):
    """CSV of live suppliers only, including invoices (images as base64).

    Optional ``q`` mirrors the on-screen search. Pagination is ignored — every
    matching live row is exported (all pages of the current filter).
    """
    query = _live(db.query(Supplier)).options(joinedload(Supplier.invoices))
    term = (q or "").strip()
    if term:
        like = f"%{term}%"
        query = query.filter(
            or_(
                Supplier.name.ilike(like),
                Supplier.phone.ilike(like),
                Supplier.email.ilike(like),
                Supplier.address.ilike(like),
            )
        )
    rows = query.order_by(func.lower(Supplier.name)).all()

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["name", "phone", "email", "address", "invoices"])
    for s in rows:
        w.writerow(
            [
                s.name,
                s.phone or "",
                s.email or "",
                s.address or "",
                _serialize_invoices_for_export(db, list(s.invoices or [])),
            ]
        )
    log_action(
        db,
        action="supplier.export",
        user_id=user.id,
        details={"count": len(rows), "q": term or None},
        request=request,
    )
    return StreamingResponse(
        iter([buf.getvalue().encode("utf-8-sig")]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=suppliers.csv"},
    )


@router.post("/import/csv")
async def import_suppliers(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
    request: Request = None,  # type: ignore[assignment]
):
    """Import suppliers from CSV.

    Rules (case-insensitive name match):
    * live duplicate → override contact fields + replace invoices
    * deleted-only duplicate → insert a brand-new live row (new id); never revive
    * no match → insert
    """
    content = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(content))
    has_invoices_col = "invoices" in (reader.fieldnames or [])
    created = 0
    updated = 0
    # Within the file, keep the last occurrence of each name (later rows override).
    pending: dict[str, dict] = {}
    for row in reader:
        name = (row.get("name") or "").strip()
        if not name:
            continue
        address = (row.get("address") or "").strip()
        if not address:
            # Address is required on create/update elsewhere — skip incomplete rows.
            continue
        pending[name.lower()] = {
            "name": name,
            "phone": (row.get("phone") or "").strip() or None,
            "email": (row.get("email") or "").strip() or None,
            "address": address,
            # None = legacy CSV without invoices column → leave existing invoices alone.
            "invoices": _parse_invoices_cell(row.get("invoices")) if has_invoices_col else None,
        }

    for payload in pending.values():
        # Only live rows are override targets. Soft-deleted namesakes are ignored
        # so import always inserts a fresh id instead of reviving or conflicting.
        live = _find_live_by_name(db, payload["name"])
        if live:
            live.phone = payload["phone"]
            live.email = payload["email"]
            live.address = payload["address"]
            live.name = payload["name"]
            if payload["invoices"] is not None:
                _replace_invoices(db, live, payload["invoices"])
            updated += 1
        else:
            sup = Supplier(
                name=payload["name"],
                phone=payload["phone"],
                email=payload["email"],
                address=payload["address"],
                is_deleted=False,
            )
            db.add(sup)
            db.flush()  # need id before attaching invoices; also makes name live for later rows
            if payload["invoices"]:
                _replace_invoices(db, sup, payload["invoices"])
            created += 1

    db.commit()
    log_action(
        db,
        action="supplier.import",
        user_id=user.id,
        details={"created": created, "updated": updated},
        request=request,
    )
    return {"created": created, "updated": updated}


@router.get("/{supplier_id}")
def get_supplier(
    supplier_id: int,
    db: Session = Depends(get_db),
    _u: User = Depends(require_role("Moderator")),
):
    s = _get_live_or_404(db, supplier_id)
    units, _ = _units_and_spend(db)
    return _serialize(s, units)


# --------------------------------------------------------------------------- #
# Create / Update / Delete
# --------------------------------------------------------------------------- #
@router.post("", status_code=status.HTTP_201_CREATED)
def create_supplier(
    payload: SupplierIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    if _name_taken(db, payload.name):
        raise HTTPException(status.HTTP_409_CONFLICT, "suppliers.errors.nameTaken")
    sup = Supplier(
        name=payload.name.strip(),
        phone=(payload.phone or "").strip() or None,
        email=(payload.email or "").strip() or None,
        address=payload.address.strip(),
        is_deleted=False,
    )
    db.add(sup)
    db.commit()
    db.refresh(sup)
    log_action(
        db,
        action="supplier.create",
        user_id=user.id,
        entity="supplier",
        entity_id=sup.id,
        details=_snapshot(sup),
        request=request,
    )
    units, _ = _units_and_spend(db)
    return _serialize(sup, units)


@router.put("/{supplier_id}")
def update_supplier(
    supplier_id: int,
    payload: SupplierIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    sup = _get_live_or_404(db, supplier_id)
    if _name_taken(db, payload.name, exclude_id=supplier_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "suppliers.errors.nameTaken")
    before = _snapshot(sup)
    sup.name = payload.name.strip()
    sup.phone = (payload.phone or "").strip() or None
    sup.email = (payload.email or "").strip() or None
    sup.address = payload.address.strip()
    db.commit()
    db.refresh(sup)
    after = _snapshot(sup)
    log_action(
        db,
        action="supplier.update",
        user_id=user.id,
        entity="supplier",
        entity_id=sup.id,
        details={"before": before, "after": after},
        request=request,
    )
    units, _ = _units_and_spend(db)
    return _serialize(sup, units)


@router.delete("/{supplier_id}")
def delete_supplier(
    supplier_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    """Soft-delete a supplier. Blocked while active products still reference it."""
    sup = _get_live_or_404(db, supplier_id)
    used = _active_usage(db, supplier_id)
    if used > 0:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Supplier is used by {used} product(s) and cannot be deleted.",
        )
    details = _snapshot(sup)
    # Detach any soft-deleted products that still point here, then mark deleted.
    db.query(Product).filter(Product.supplier_id == supplier_id).update(
        {Product.supplier_id: None}, synchronize_session=False
    )
    sup.is_deleted = True
    db.commit()
    log_action(
        db,
        action="supplier.delete",
        user_id=user.id,
        entity="supplier",
        entity_id=supplier_id,
        details=details,
        request=request,
    )
    return {"ok": True, "id": supplier_id}


# --------------------------------------------------------------------------- #
# Invoices
# --------------------------------------------------------------------------- #
def _serialize_invoice(inv: SupplierInvoice) -> dict:
    return {
        "id": inv.id,
        "supplier_id": inv.supplier_id,
        "name": inv.name,
        "quantity": inv.quantity,
        "amount": float(inv.amount or 0),
        "invoice_date": inv.invoice_date.isoformat() if inv.invoice_date else None,
        "image_url": inv.image_url,
        "created_at": inv.created_at.isoformat() if inv.created_at else None,
    }


@router.get("/{supplier_id}/invoices")
def list_invoices(
    supplier_id: int,
    db: Session = Depends(get_db),
    _u: User = Depends(require_role("Moderator")),
):
    _get_live_or_404(db, supplier_id)
    rows = (
        db.query(SupplierInvoice)
        .filter(SupplierInvoice.supplier_id == supplier_id)
        .order_by(SupplierInvoice.id.desc())
        .all()
    )
    return [_serialize_invoice(i) for i in rows]


@router.post("/{supplier_id}/invoices", status_code=status.HTTP_201_CREATED)
def create_invoice(
    supplier_id: int,
    payload: InvoiceIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    _get_live_or_404(db, supplier_id)
    inv = SupplierInvoice(
        supplier_id=supplier_id,
        name=payload.name.strip(),
        quantity=payload.quantity,
        amount=round(payload.amount, 2),
        invoice_date=payload.invoice_date,
        image_url=(payload.image_url or "").strip() or None,
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)
    log_action(
        db,
        action="supplier.invoice.create",
        user_id=user.id,
        entity="supplier_invoice",
        entity_id=inv.id,
        details={
            "supplier_id": supplier_id,
            "name": inv.name,
            "quantity": inv.quantity,
            "amount": float(inv.amount or 0),
            "invoice_date": inv.invoice_date.isoformat() if inv.invoice_date else None,
        },
        request=request,
    )
    return _serialize_invoice(inv)


@router.delete("/{supplier_id}/invoices/{invoice_id}")
def delete_invoice(
    supplier_id: int,
    invoice_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("Moderator")),
):
    _get_live_or_404(db, supplier_id)
    inv = db.get(SupplierInvoice, invoice_id)
    if not inv or inv.supplier_id != supplier_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invoice not found")
    details = {
        "supplier_id": supplier_id,
        "name": inv.name,
        "quantity": inv.quantity,
        "amount": float(inv.amount or 0),
        "invoice_date": inv.invoice_date.isoformat() if inv.invoice_date else None,
    }
    db.delete(inv)
    db.commit()
    log_action(
        db,
        action="supplier.invoice.delete",
        user_id=user.id,
        entity="supplier_invoice",
        entity_id=invoice_id,
        details=details,
        request=request,
    )
    return {"ok": True, "id": invoice_id}
