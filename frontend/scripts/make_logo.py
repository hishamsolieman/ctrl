"""Generate the dummy CTRL wordmark logo PNG.

Produces a transparent-background wordmark: white "CTRL" with a green accent
underscore (echoing the brand's green #8EFF19). Replace the output file to
change the logo everywhere in the app.

Run:  python frontend/scripts/make_logo.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ASSETS = Path(__file__).resolve().parents[1] / "src" / "assets"
OUT = ASSETS / "logo.png"
OUT_BLACK = ASSETS / "logo-black.png"
ACCENT = (142, 255, 25, 255)  # #8EFF19
WHITE = (255, 255, 255, 255)
BLACK = (0, 0, 0, 255)

W, H = 720, 240
img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Pick a bold, techy font available on Windows; fall back gracefully.
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\bahnschrift.ttf",
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\consolab.ttf",
]
font = None
for path in FONT_CANDIDATES:
    if Path(path).exists():
        try:
            font = ImageFont.truetype(path, 150)
            break
        except OSError:
            continue
if font is None:
    font = ImageFont.load_default()

text = "CTRL"
bbox = draw.textbbox((0, 0), text, font=font)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
tx = (W - tw) // 2 - bbox[0]
ty = (H - th) // 2 - bbox[1] - 14
draw.text((tx, ty), text, font=font, fill=WHITE)

# Green accent underscore under the wordmark.
bar_w = int(tw * 0.5)
bar_x = (W - bar_w) // 2
bar_y = ty + th + 26
draw.rounded_rectangle(
    [bar_x, bar_y, bar_x + bar_w, bar_y + 14], radius=7, fill=ACCENT
)

ASSETS.mkdir(parents=True, exist_ok=True)
img.save(OUT)

# Same wordmark with white → black (for light / print backgrounds).
black = img.copy()
px = black.load()
w, h = black.size
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        if a and r >= 230 and g >= 230 and b >= 230:
            px[x, y] = BLACK
black.save(OUT_BLACK)

print(f"Wrote logo -> {OUT} ({img.size[0]}x{img.size[1]})")
print(f"Wrote logo-black -> {OUT_BLACK}")
