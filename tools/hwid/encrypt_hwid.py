"""Encrypt a Hardware ID with the same AES-256-GCM as the backend.

Paste the result into settings.licensed_hwid.

    python encrypt_hwid.py
    python encrypt_hwid.py YOURHWID
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.core.crypto import encrypt  # noqa: E402

ACCENT = "#8EFF19"
BG = "#000000"
SURFACE = "#141414"
TEXT = "#ffffff"
MUTED = "#9a9a9a"


def normalize_hwid(raw: str) -> str:
    return "".join((raw or "").split()).upper()


def encrypt_hwid(raw: str) -> str:
    hwid = normalize_hwid(raw)
    if not hwid:
        raise ValueError("Enter a Hardware ID.")
    return encrypt(hwid)


def run_cli(raw: str) -> None:
    print(encrypt_hwid(raw))


def run_gui() -> None:
    import tkinter as tk

    root = tk.Tk()
    root.title("HWID Encrypt")
    root.configure(bg=BG)
    root.resizable(False, False)
    root.minsize(520, 280)

    status = tk.StringVar(value="Paste a Hardware ID, then encrypt.")
    source = tk.StringVar(value="")
    token = tk.StringVar(value="")

    frame = tk.Frame(root, bg=SURFACE, padx=24, pady=22)
    frame.pack(fill="both", expand=True, padx=16, pady=16)

    tk.Label(frame, text="Hardware ID", bg=SURFACE, fg=MUTED, font=("Segoe UI", 9)).pack(anchor="w")
    tk.Entry(
        frame,
        textvariable=source,
        bg=BG,
        fg=TEXT,
        insertbackground=TEXT,
        relief="flat",
        font=("Consolas", 11),
    ).pack(fill="x", pady=(8, 14), ipady=8)

    tk.Label(frame, text="Encryption", bg=SURFACE, fg=MUTED, font=("Segoe UI", 9)).pack(anchor="w")
    out = tk.Entry(
        frame,
        textvariable=token,
        readonlybackground=BG,
        bg=BG,
        fg=TEXT,
        insertbackground=TEXT,
        relief="flat",
        font=("Consolas", 10),
        state="readonly",
    )
    out.pack(fill="x", pady=(8, 14), ipady=8)

    btn_row = tk.Frame(frame, bg=SURFACE)
    btn_row.pack(fill="x")

    def do_encrypt() -> None:
        try:
            token.set(encrypt_hwid(source.get()))
            status.set("Ready")
        except Exception as exc:
            token.set("")
            status.set(str(exc))

    def copy() -> None:
        value = token.get().strip()
        if not value:
            status.set("Nothing to copy")
            return
        root.clipboard_clear()
        root.clipboard_append(value)
        root.update()
        status.set("Copied")

    tk.Button(
        btn_row,
        text="Encrypt",
        command=do_encrypt,
        bg=ACCENT,
        fg="#000000",
        activebackground="#a6ff4d",
        activeforeground="#000000",
        relief="flat",
        font=("Segoe UI Semibold", 10),
        padx=18,
        pady=6,
        cursor="hand2",
    ).pack(side="left")

    tk.Button(
        btn_row,
        text="Copy",
        command=copy,
        bg=BG,
        fg=TEXT,
        activebackground="#222222",
        activeforeground=TEXT,
        relief="flat",
        font=("Segoe UI", 10),
        padx=16,
        pady=6,
        cursor="hand2",
    ).pack(side="left", padx=(8, 0))

    tk.Label(frame, textvariable=status, bg=SURFACE, fg=MUTED, font=("Segoe UI", 8)).pack(
        anchor="w", pady=(14, 0)
    )
    root.mainloop()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        run_cli(" ".join(sys.argv[1:]))
    else:
        run_gui()
