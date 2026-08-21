"""Read motherboard serial + processor id and show it for copy."""
from __future__ import annotations

import subprocess
import tkinter as tk

ACCENT = "#8EFF19"
BG = "#000000"
SURFACE = "#141414"
TEXT = "#ffffff"
MUTED = "#9a9a9a"


def read_hwid() -> str:
    script = (
        "$board = [string](Get-CimInstance -ClassName Win32_BaseBoard).SerialNumber; "
        "$cpu = [string](@(Get-CimInstance -ClassName Win32_Processor)[0].ProcessorId); "
        "Write-Output (($board.Trim() + $cpu.Trim()) -replace '\\s','')"
    )
    out = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ],
        capture_output=True,
        text=True,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        timeout=30,
        check=False,
    )
    raw = (out.stdout or "").strip()
    if not raw:
        err = (out.stderr or "").strip() or "Could not read hardware ID."
        raise RuntimeError(err)
    return "".join(raw.split()).upper()


def main() -> None:
    root = tk.Tk()
    root.title("HWID Tool")
    root.configure(bg=BG)
    root.resizable(False, False)
    root.minsize(460, 220)

    status = tk.StringVar(value="Reading…")
    value = tk.StringVar(value="")

    frame = tk.Frame(root, bg=SURFACE, padx=24, pady=22)
    frame.pack(fill="both", expand=True, padx=16, pady=16)

    tk.Label(
        frame,
        text="Hardware ID",
        bg=SURFACE,
        fg=MUTED,
        font=("Segoe UI", 9),
    ).pack(anchor="w")

    entry = tk.Entry(
        frame,
        textvariable=value,
        readonlybackground=BG,
        bg=BG,
        fg=TEXT,
        insertbackground=TEXT,
        relief="flat",
        font=("Consolas", 11),
        state="readonly",
    )
    entry.pack(fill="x", pady=(8, 14), ipady=8)

    btn_row = tk.Frame(frame, bg=SURFACE)
    btn_row.pack(fill="x")

    def set_status(text: str) -> None:
        status.set(text)

    def load() -> None:
        set_status("Reading…")
        root.update_idletasks()
        try:
            hwid = read_hwid()
        except Exception as exc:
            value.set("")
            set_status(str(exc))
            return
        value.set(hwid)
        set_status("Ready")

    def copy() -> None:
        hwid = value.get().strip()
        if not hwid:
            set_status("Nothing to copy")
            return
        root.clipboard_clear()
        root.clipboard_append(hwid)
        root.update()
        set_status("Copied")

    copy_btn = tk.Button(
        btn_row,
        text="Copy",
        command=copy,
        bg=ACCENT,
        fg="#000000",
        activebackground="#a6ff4d",
        activeforeground="#000000",
        relief="flat",
        font=("Segoe UI Semibold", 10),
        padx=18,
        pady=6,
        cursor="hand2",
    )
    copy_btn.pack(side="left")

    refresh_btn = tk.Button(
        btn_row,
        text="Refresh",
        command=load,
        bg=BG,
        fg=TEXT,
        activebackground="#222222",
        activeforeground=TEXT,
        relief="flat",
        font=("Segoe UI", 10),
        padx=16,
        pady=6,
        cursor="hand2",
    )
    refresh_btn.pack(side="left", padx=(8, 0))

    tk.Label(
        frame,
        textvariable=status,
        bg=SURFACE,
        fg=MUTED,
        font=("Segoe UI", 8),
    ).pack(anchor="w", pady=(14, 0))

    root.after(50, load)
    root.mainloop()


if __name__ == "__main__":
    main()
