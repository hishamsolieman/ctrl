"""One-off: verify every t("...") key in the new dashboard/report code exists in EN+AR."""
import re
from pathlib import Path

from sqlalchemy import text

from app.core.database import engine

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    "frontend/src/pages/Dashboard.jsx",
    "frontend/src/components/dashboard/ReportModal.jsx",
    "frontend/src/lib/reportPrint.js",
]

KEY_RE = re.compile(r"""t\(\s*["']([A-Za-z0-9_.]+)["']""")

wanted = set()
for rel in FILES:
    src = (ROOT / rel).read_text(encoding="utf-8")
    wanted |= set(KEY_RE.findall(src))

with engine.begin() as conn:
    rows = conn.execute(
        text("SELECT `key`, `locale` FROM translations WHERE namespace='ui'")
    ).all()
have = {}
for k, loc in rows:
    have.setdefault(k, set()).add(loc)

missing_en = sorted(k for k in wanted if "en" not in have.get(k, ()))
missing_ar = sorted(k for k in wanted if "ar" not in have.get(k, ()))

print(f"keys referenced: {len(wanted)}")
print(f"missing EN: {len(missing_en)}")
for k in missing_en:
    print("   ", k)
print(f"missing AR: {len(missing_ar)}")
for k in missing_ar:
    print("   ", k)

# Also flag report.*/dashboard.* rows in the DB that nothing references any more.
prefixes = ("report.", "dashboard.")
referenced = wanted | {"dashboard.welcome", "dashboard.overview"}
orphans = sorted(
    k for k in have if k.startswith(prefixes) and k not in referenced
)
print(f"\nunreferenced dashboard./report. keys: {len(orphans)}")
for k in orphans:
    print("   ", k)
