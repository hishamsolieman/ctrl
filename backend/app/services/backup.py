"""Encrypted database backup / restore and the background schedule worker.

Regular backups live in ``<project>/backup`` as ``CTRL_YYYYMMDD_HHMMSS.bak``
(AES-256-GCM of a full SQL dump). Only the last 3 regular files are kept.

A restore first writes a safety copy ``Restore_YYYYMMDD_HHMMSS.bak`` (not part
of the 3-file rotation). If anything after that fails, that safety copy is
applied back.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable

import pymysql
from sqlalchemy import create_engine

from app.core.config import ROOT_DIR, settings
from app.core.crypto import decrypt_bytes, encrypt_bytes
from app.services.logging import log_action
from app.services.settings import (
    BACKUP_LAST_AT_KEY,
    get_backup_duration_hours,
    get_setting,
    set_setting,
)

log = logging.getLogger("ctrl.backup")

BACKUP_DIR = ROOT_DIR / "backup"
REGULAR_PREFIX = "CTRL_"
RESTORE_PREFIX = "Restore_"
KEEP_REGULAR = 3
ROW_BATCH = 200
POLL_SECONDS = 30

_IDENT = re.compile(r"^[A-Za-z0-9_]+$")
_CREATE_TABLE = re.compile(r"CREATE\s+TABLE\s+`([^`]+)`", re.I)
_FK_CLAUSE = re.compile(
    r",\s*(?:CONSTRAINT\s+`[^`]+`\s+)?FOREIGN KEY\s*\([^)]+\)\s*REFERENCES\s+`[^`]+`\s*\([^)]+\)"
    r"(?:\s+ON\s+DELETE\s+(?:SET NULL|CASCADE|RESTRICT|NO ACTION))?"
    r"(?:\s+ON\s+UPDATE\s+(?:SET NULL|CASCADE|RESTRICT|NO ACTION))?",
    re.I,
)
_FK_KEEP = re.compile(
    r"(?:CONSTRAINT\s+(`[^`]+`)\s+)?FOREIGN KEY\s*(\([^)]+\))\s*REFERENCES\s+(`[^`]+`)\s*(\([^)]+\))"
    r"((?:\s+ON\s+DELETE\s+(?:SET NULL|CASCADE|RESTRICT|NO ACTION))?)"
    r"((?:\s+ON\s+UPDATE\s+(?:SET NULL|CASCADE|RESTRICT|NO ACTION))?)",
    re.I,
)

ProgressFn = Callable[[int, str], None]


# --------------------------------------------------------------------------- #
# Job status (polled by the settings UI)
# --------------------------------------------------------------------------- #
class BackupJob:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.kind: str = ""
        self.state: str = "idle"  # idle | running | done | error
        self.progress: int = 0
        self.phase: str = ""
        self.filename: str = ""
        self.error: str | None = None

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "kind": self.kind,
                "state": self.state,
                "progress": self.progress,
                "phase": self.phase,
                "filename": self.filename,
                "error": self.error,
            }

    def begin(self, kind: str, phase: str) -> None:
        with self.lock:
            self.kind = kind
            self.state = "running"
            self.progress = 0
            self.phase = phase
            self.filename = ""
            self.error = None

    def update(self, progress: int | None = None, phase: str | None = None, filename: str | None = None) -> None:
        with self.lock:
            if progress is not None:
                self.progress = max(0, min(100, int(progress)))
            if phase is not None:
                self.phase = phase
            if filename is not None:
                self.filename = filename

    def finish(self, filename: str = "") -> None:
        with self.lock:
            self.state = "done"
            self.progress = 100
            self.phase = "backup.phase.done"
            if filename:
                self.filename = filename
            self.error = None

    def fail(self, error: str) -> None:
        with self.lock:
            self.state = "error"
            self.phase = "backup.phase.error"
            self.error = error


JOB = BackupJob()


# --------------------------------------------------------------------------- #
# Paths / listing
# --------------------------------------------------------------------------- #
def _ensure_dir() -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    return BACKUP_DIR


def _stamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _regular_files() -> list[Path]:
    if not BACKUP_DIR.exists():
        return []
    files = [
        p
        for p in BACKUP_DIR.iterdir()
        if p.is_file() and p.suffix.lower() == ".bak" and p.name.startswith(REGULAR_PREFIX)
    ]
    files.sort(key=lambda p: p.stat().st_mtime)
    return files


def list_regular_backups() -> list[dict]:
    out = []
    for p in reversed(_regular_files()):
        st = p.stat()
        out.append(
            {
                "name": p.name,
                "size": st.st_size,
                "modified_at": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
            }
        )
    return out


def _rotate_regular() -> None:
    files = _regular_files()
    extra = len(files) - KEEP_REGULAR
    if extra <= 0:
        return
    for p in files[:extra]:
        try:
            p.unlink()
        except OSError:
            log.warning("Could not delete old backup %s", p)


# --------------------------------------------------------------------------- #
# MySQL helpers
# --------------------------------------------------------------------------- #
def _connect(database: str | None = settings.DB_NAME, **kwargs):
    return pymysql.connect(
        host=settings.DB_HOST,
        port=int(settings.DB_PORT or 3306),
        user=settings.DB_USER,
        password=settings.DB_PASSWORD,
        database=database,
        charset="utf8mb4",
        autocommit=True,
        max_allowed_packet=256 * 1024 * 1024,
        **kwargs,
    )


def _qid(name: str) -> str:
    if not _IDENT.match(name):
        raise ValueError("backup.errors.badIdent")
    return f"`{name}`"


def _sql_literal(cur, value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, (bytes, bytearray, memoryview)):
        return "_binary 0x" + bytes(value).hex()
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, datetime):
        return cur.connection.escape(value.strftime("%Y-%m-%d %H:%M:%S"))
    if hasattr(value, "isoformat") and not isinstance(value, str):
        return cur.connection.escape(value.isoformat())
    return cur.connection.escape(value)


def _table_names(cur) -> list[str]:
    cur.execute(
        "SELECT TABLE_NAME FROM information_schema.TABLES "
        "WHERE TABLE_SCHEMA = %s AND TABLE_TYPE = 'BASE TABLE' "
        "ORDER BY TABLE_NAME",
        (settings.DB_NAME,),
    )
    return [r[0] for r in cur.fetchall()]


def dump_sql(progress: ProgressFn | None = None) -> str:
    """Full logical dump of the configured database (schema + data)."""
    chunks: list[str] = [
        "SET NAMES utf8mb4",
        "SET FOREIGN_KEY_CHECKS=0",
        "SET UNIQUE_CHECKS=0",
        "SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO'",
    ]
    conn = _connect()
    try:
        cur = conn.cursor()
        tables = _table_names(cur)
        total = max(1, len(tables))
        for i, table in enumerate(tables):
            if progress:
                progress(5 + int(75 * i / total), "backup.phase.dumping")
            qtable = _qid(table)
            cur.execute(f"SHOW CREATE TABLE {qtable}")
            create = cur.fetchone()[1]
            chunks.append(f"DROP TABLE IF EXISTS {qtable}")
            chunks.append(create)

            cur.execute(f"SELECT * FROM {qtable}")
            cols = [d[0] for d in cur.description] if cur.description else []
            col_sql = ", ".join(_qid(c) for c in cols)
            while True:
                rows = cur.fetchmany(ROW_BATCH)
                if not rows:
                    break
                small: list[str] = []
                for row in rows:
                    tup = "(" + ", ".join(_sql_literal(cur, v) for v in row) + ")"
                    # Keep huge cells (images, documents) as their own INSERT so
                    # restore stays under max_allowed_packet.
                    if any(isinstance(v, (bytes, bytearray, str)) and len(v) > 64_000 for v in row):
                        chunks.append(f"INSERT INTO {qtable} ({col_sql}) VALUES {tup}")
                    else:
                        small.append(tup)
                if small:
                    chunks.append(f"INSERT INTO {qtable} ({col_sql}) VALUES\n" + ",\n".join(small))
        if progress:
            progress(82, "backup.phase.dumping")
    finally:
        conn.close()

    chunks.append("SET UNIQUE_CHECKS=1")
    chunks.append("SET FOREIGN_KEY_CHECKS=1")
    return ";\n\n".join(chunks) + ";\n"


def _write_encrypted(sql: str, dest: Path, progress: ProgressFn | None = None) -> None:
    if progress:
        progress(88, "backup.phase.encrypting")
    blob = encrypt_bytes(sql.encode("utf-8"))
    if progress:
        progress(94, "backup.phase.saving")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(blob)


def _read_decrypted(path: Path) -> str:
    raw = path.read_bytes()
    try:
        return decrypt_bytes(raw).decode("utf-8")
    except Exception as exc:
        raise ValueError("backup.errors.badFile") from exc


def split_sql_statements(sql: str) -> list[str]:
    """Split a dump on ``;`` while ignoring semicolons inside quotes/backticks."""
    out: list[str] = []
    buf: list[str] = []
    quote = ""
    escape = False
    for ch in sql:
        if quote:
            buf.append(ch)
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == quote:
                quote = ""
            continue
        if ch in ("'", '"', "`"):
            quote = ch
            buf.append(ch)
            continue
        if ch == ";":
            stmt = "".join(buf).strip()
            if stmt:
                out.append(stmt)
            buf = []
            continue
        buf.append(ch)
    tail = "".join(buf).strip()
    if tail:
        out.append(tail)
    return out


def _split_value_tuples(values_sql: str) -> list[str]:
    """Split ``(row),(row)`` on top-level commas."""
    rows: list[str] = []
    buf: list[str] = []
    depth = 0
    quote = ""
    escape = False
    for ch in values_sql.strip():
        if quote:
            buf.append(ch)
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == quote:
                quote = ""
            continue
        if ch in ("'", '"', "`"):
            quote = ch
            buf.append(ch)
            continue
        if ch == "(":
            depth += 1
            buf.append(ch)
            continue
        if ch == ")":
            depth = max(0, depth - 1)
            buf.append(ch)
            continue
        if ch == "," and depth == 0:
            row = "".join(buf).strip()
            if row:
                rows.append(row)
            buf = []
            continue
        buf.append(ch)
    tail = "".join(buf).strip()
    if tail:
        rows.append(tail)
    return rows


def _defer_foreign_keys(create_sql: str) -> tuple[str, list[str]]:
    """Strip FKs from CREATE TABLE (InnoDB still validates them at CREATE time)
    and return matching ALTER TABLE ... ADD CONSTRAINT statements."""
    m = _CREATE_TABLE.search(create_sql)
    if not m:
        return create_sql, []
    table = m.group(1)
    alters: list[str] = []
    for fk in _FK_KEEP.finditer(create_sql):
        name, cols, ref, refcols, ondel, onupd = fk.groups()
        cname = name or f"`fk_{table}_{len(alters)+1}`"
        alters.append(
            f"ALTER TABLE `{table}` ADD CONSTRAINT {cname} "
            f"FOREIGN KEY {cols} REFERENCES {ref} {refcols}{ondel or ''}{onupd or ''}"
        )
    cleaned = _FK_CLAUSE.sub("", create_sql)
    cleaned = re.sub(r",\s*\)", "\n)", cleaned)
    return cleaned, alters


def explode_insert(stmt: str, max_bytes: int = 512_000) -> list[str]:
    """Break an oversized INSERT into one-row statements the server can accept."""
    if len(stmt) <= max_bytes:
        return [stmt]
    upper = stmt.upper()
    marker = " VALUES"
    idx = upper.find(marker)
    if idx < 0:
        return [stmt]
    head = stmt[: idx + len(marker)]
    rows = _split_value_tuples(stmt[idx + len(marker) :])
    if len(rows) <= 1:
        return [stmt]
    return [f"{head} {row}" for row in rows]


def _exec_dump(sql: str, progress: ProgressFn | None = None, lo: int = 50, hi: int = 95) -> None:
    statements: list[str] = []
    deferred_fks: list[str] = []
    for raw in split_sql_statements(sql):
        if raw.upper().lstrip().startswith("CREATE TABLE"):
            raw, alters = _defer_foreign_keys(raw)
            deferred_fks.extend(alters)
        statements.extend(explode_insert(raw))
    if not statements:
        raise ValueError("backup.errors.badFile")
    total = max(1, len(statements))
    conn = _connect()
    try:
        cur = conn.cursor()
        for cmd in (
            "SET GLOBAL max_allowed_packet=268435456",
            "SET SESSION max_allowed_packet=268435456",
        ):
            try:
                cur.execute(cmd)
            except Exception:
                pass
        for i, stmt in enumerate(statements):
            try:
                cur.execute(stmt)
            except Exception:
                try:
                    conn.ping(reconnect=True)
                    cur = conn.cursor()
                    cur.execute(stmt)
                except Exception:
                    conn.close()
                    conn = _connect()
                    cur = conn.cursor()
                    cur.execute(stmt)
            if progress and i % 5 == 0:
                progress(lo + int((hi - lo) * i / total), "backup.phase.restoring")
        for stmt in deferred_fks:
            try:
                cur.execute(stmt)
            except Exception:
                log.warning("Could not re-apply FK: %s", stmt[:120])
        if progress:
            progress(hi, "backup.phase.restoring")
    finally:
        conn.close()


def reset_engine() -> None:
    """Drop pooled connections and bind a fresh engine after DROP DATABASE."""
    from app.core import database as dbmod

    try:
        dbmod.engine.dispose()
    except Exception:
        pass
    dbmod.engine = create_engine(
        settings.database_url,
        pool_pre_ping=True,
        pool_recycle=1800,
        future=True,
    )
    dbmod.SessionLocal.configure(bind=dbmod.engine)


def _recreate_empty_db() -> None:
    conn = _connect(database=None)
    try:
        cur = conn.cursor()
        name = _qid(settings.DB_NAME)
        cur.execute(f"DROP DATABASE IF EXISTS {name}")
        cur.execute(f"CREATE DATABASE {name} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
    finally:
        conn.close()


# --------------------------------------------------------------------------- #
# Public backup / restore
# --------------------------------------------------------------------------- #
def create_backup(*, prefix: str = REGULAR_PREFIX, rotate: bool = True, progress: ProgressFn | None = None) -> Path:
    _ensure_dir()
    dest = BACKUP_DIR / f"{prefix}{_stamp()}.bak"
    sql = dump_sql(progress)
    _write_encrypted(sql, dest, progress)
    if rotate and prefix == REGULAR_PREFIX:
        _rotate_regular()
    if progress:
        progress(100, "backup.phase.done")
    return dest


def restore_from_file(src: Path, progress: ProgressFn | None = None) -> Path:
    """Safety-backup current DB, replace it with ``src``, roll back on failure."""
    if not src.exists() or src.stat().st_size < 32:
        raise ValueError("backup.errors.badFile")

    if progress:
        progress(2, "backup.phase.decrypting")
    incoming_sql = _read_decrypted(src)
    incoming_stmts = split_sql_statements(incoming_sql)
    if not any("CREATE TABLE" in s.upper() for s in incoming_stmts):
        raise ValueError("backup.errors.badFile")

    if progress:
        progress(8, "backup.phase.safety")
    try:
        safety = create_backup(
            prefix=RESTORE_PREFIX,
            rotate=False,
            progress=lambda p, ph: progress(8 + int(p * 0.22), ph) if progress else None,
        )
    except Exception as exc:
        raise RuntimeError("backup.errors.safetyFailed") from exc

    try:
        if progress:
            progress(32, "backup.phase.dropping")
        from app.core import database as dbmod

        try:
            dbmod.engine.dispose()
        except Exception:
            pass
        _recreate_empty_db()
        if progress:
            progress(40, "backup.phase.restoring")
        _exec_dump(incoming_sql, progress, lo=40, hi=92)
        reset_engine()
        if progress:
            progress(100, "backup.phase.done")
        return safety
    except Exception:
        # Roll back to the safety copy we just wrote.
        if progress:
            progress(10, "backup.phase.rollback")
        try:
            _recreate_empty_db()
            safety_sql = _read_decrypted(safety)
            _exec_dump(safety_sql, progress, lo=15, hi=90)
            reset_engine()
        except Exception:
            try:
                reset_engine()
            except Exception:
                pass
            raise RuntimeError("backup.errors.rollbackFailed")
        raise RuntimeError("backup.errors.restoreFailed")


# --------------------------------------------------------------------------- #
# Schedule worker
# --------------------------------------------------------------------------- #
_wake = threading.Event()
_stop = threading.Event()
_busy = threading.Lock()
_thread: threading.Thread | None = None


def _session():
    from app.core.database import SessionLocal

    return SessionLocal()


def _last_at() -> datetime | None:
    db = _session()
    try:
        raw = get_setting(db, BACKUP_LAST_AT_KEY, "")
    except Exception:
        db.rollback()
        return None
    finally:
        db.close()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


def _set_last_at(when: datetime) -> None:
    db = _session()
    try:
        set_setting(db, BACKUP_LAST_AT_KEY, when.isoformat(timespec="seconds"))
    finally:
        db.close()


def _hours() -> int:
    db = _session()
    try:
        return get_backup_duration_hours(db)
    except Exception:
        db.rollback()
        return 24
    finally:
        db.close()


def next_backup_at() -> datetime:
    last = _last_at()
    hours = _hours()
    # No completed backup yet: due immediately. Do not use ``now + hours`` —
    # that is recalculated on every poll and the first run never becomes due.
    if last is None:
        return datetime.now()
    return last + timedelta(hours=hours)


def schedule_info() -> dict:
    last = _last_at()
    nxt = next_backup_at()
    return {
        "hours": _hours(),
        "last_at": last.isoformat() if last else None,
        "next_at": nxt.isoformat(),
        "files": list_regular_backups(),
        "job": JOB.snapshot(),
    }


def request_backup_now(user_id: int | None = None) -> None:
    """Run a backup immediately and shift the next scheduled run to now + interval."""
    if JOB.snapshot()["state"] == "running":
        raise RuntimeError("backup.errors.busy")
    threading.Thread(
        target=_run_backup,
        args=("manual", user_id),
        name="ctrl-backup-now",
        daemon=True,
    ).start()
    # Give the worker a moment to flip state to running before the client polls.
    time.sleep(0.05)


def _run_backup(trigger: str, user_id: int | None = None) -> Path | None:
    if not _busy.acquire(blocking=False):
        if trigger == "manual":
            raise RuntimeError("backup.errors.busy")
        return None
    try:
        JOB.begin("backup", "backup.phase.dumping")

        def prog(p: int, ph: str) -> None:
            JOB.update(progress=p, phase=ph)

        path = create_backup(progress=prog)
        _set_last_at(datetime.now())
        JOB.finish(path.name)
        db = _session()
        try:
            log_action(
                db,
                action="backup.create",
                user_id=user_id,
                entity="backup",
                details={"filename": path.name, "trigger": trigger},
            )
        finally:
            db.close()
        return path
    except Exception as exc:
        key = str(exc) if str(exc).startswith("backup.") else "backup.errors.failed"
        JOB.fail(key)
        log.exception("Backup failed")
        db = _session()
        try:
            log_action(
                db,
                action="backup.create",
                user_id=user_id,
                entity="backup",
                details={"trigger": trigger, "error": key},
                status="failure",
            )
        finally:
            db.close()
        if trigger == "manual":
            raise
        return None
    finally:
        _busy.release()


def request_restore(src: Path, user_id: int | None = None) -> None:
    if JOB.snapshot()["state"] == "running":
        raise RuntimeError("backup.errors.busy")
    threading.Thread(
        target=run_restore,
        args=(src, user_id),
        name="ctrl-restore",
        daemon=True,
    ).start()
    time.sleep(0.05)


def run_restore(src: Path, user_id: int | None = None) -> None:
    if not _busy.acquire(blocking=False):
        raise RuntimeError("backup.errors.busy")
    try:
        JOB.begin("restore", "backup.phase.safety")

        def prog(p: int, ph: str) -> None:
            JOB.update(progress=p, phase=ph)

        safety = restore_from_file(src, progress=prog)
        JOB.finish(src.name)
        db = _session()
        try:
            log_action(
                db,
                action="backup.restore",
                user_id=user_id,
                entity="backup",
                details={"source": src.name, "safety": safety.name},
            )
        finally:
            db.close()
    except Exception as exc:
        key = str(exc) if str(exc).startswith("backup.") else "backup.errors.restoreFailed"
        JOB.fail(key)
        log.exception("Restore failed")
        try:
            db = _session()
            try:
                log_action(
                    db,
                    action="backup.restore",
                    user_id=user_id,
                    entity="backup",
                    details={"source": src.name, "error": key},
                    status="failure",
                )
            finally:
                db.close()
        except Exception:
            pass
    finally:
        if src.name.startswith("_incoming_"):
            try:
                src.unlink(missing_ok=True)
            except OSError:
                pass
        _busy.release()


def _loop() -> None:
    log.info("Backup worker started")
    while not _stop.is_set():
        try:
            if JOB.snapshot()["state"] == "running":
                _wake.wait(timeout=POLL_SECONDS)
                _wake.clear()
                continue
            nxt = next_backup_at()
            remaining = (nxt - datetime.now()).total_seconds()
            if remaining <= 0:
                _run_backup("scheduled")
                continue
            _wake.wait(timeout=min(max(remaining, 1), POLL_SECONDS))
            _wake.clear()
        except Exception:
            log.exception("Backup worker loop error")
            time.sleep(5)
    log.info("Backup worker stopped")


def start_worker() -> None:
    global _thread
    _ensure_dir()
    _stop.clear()
    if _thread and _thread.is_alive():
        return
    _thread = threading.Thread(target=_loop, name="ctrl-backup", daemon=True)
    _thread.start()


def stop_worker() -> None:
    _stop.set()
    _wake.set()
