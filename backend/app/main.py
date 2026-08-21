"""CTRL FastAPI application factory."""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import (
    attributes,
    auth,
    catalog,
    categories,
    customers,
    dashboard,
    expenses,
    funds,
    reports,
    images,
    invoices,
    logs,
    meta,
    pos,
    products,
    settings as settings_routes,
    license as license_routes,
    suppliers,
    users,
)
from app.core.config import settings


@asynccontextmanager
async def lifespan(_app: FastAPI):
    from app.services.backup import start_worker, stop_worker

    start_worker()
    yield
    stop_worker()


app = FastAPI(
    title=f"{settings.BRAND_NAME} API",
    description=f"{settings.BRAND_NAME} — {settings.BRAND_MOTTO}",
    version="1.0.0",
    lifespan=lifespan,
)

# Serve uploaded product images.
UPLOAD_DIR = Path(__file__).resolve().parents[1] / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(meta.router)
app.include_router(auth.router)
app.include_router(catalog.router)
app.include_router(suppliers.router)
app.include_router(customers.router)
app.include_router(users.router)
app.include_router(invoices.router)
app.include_router(logs.router)
app.include_router(categories.router)
app.include_router(images.router)
app.include_router(attributes.router)
app.include_router(products.router)
app.include_router(pos.router)
app.include_router(settings_routes.router)
app.include_router(license_routes.router)
app.include_router(expenses.router)
app.include_router(dashboard.router)
app.include_router(funds.router)
app.include_router(reports.router)


@app.get("/")
def root():
    return {"brand": settings.BRAND_NAME, "motto": settings.BRAND_MOTTO, "status": "ok"}
