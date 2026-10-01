"""Build the home page's hero lineup from the finished product masters.

    python scripts/images/hero.py

Five products, one per brand, are blended edge to edge on the shared backdrop
(every master was brought to the same backdrop tone in compose.py, so the seams
disappear) and exported at several widths as AVIF, WebP and JPEG into
public/hero/. This one is served from the site itself rather than from Shopify:
it is page art, not a product photograph, and being same-origin it needs no
extra connection before the largest paint.
"""
import io
import sys
from pathlib import Path
import numpy as np
from PIL import Image

from plates import LAYOUT, PRODUCT_PLATE

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
PUBLIC = HERE.parent.parent / "public" / "hero"
BG = np.array([232, 229, 223], dtype=np.float32)

DESKTOP = ["kestrel-magnesium-glycinate", "elia-prenatal-multi", "meridian-ashwagandha-root",
           "vireo-vitamin-c-acerola", "northbound-whey-isolate"]
MOBILE = ["elia-prenatal-multi", "meridian-ashwagandha-root", "northbound-whey-isolate"]


def product_extent(a, handle):
    """Horizontal centre of the product (from its label panel, which spans the body)
    and the row where it meets the ground."""
    x0, _, x1, _ = LAYOUT[PRODUCT_PLATE[handle]]["bbox"]
    diff = np.abs(a - BG).sum(axis=2) > 40
    ys, _ = np.where(diff)
    return (x0 + x1) / 2, ys.max()


def lineup(handles, w, h, scale):
    num = np.zeros((h, w, 3), dtype=np.float32)
    den = np.zeros((h, w, 1), dtype=np.float32)
    n = len(handles)
    pitch = w / n
    for i, hd in enumerate(handles):
        img = Image.open(HERE / "out" / f"{hd}.jpg").convert("RGB")
        a = np.asarray(img, dtype=np.float32)
        cx0, y1 = product_extent(a, hd)
        # Resize so every product shares one scale, then stand it on one baseline.
        tile = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
        t = np.asarray(tile, dtype=np.float32)
        cx = cx0 * scale
        bottom = (y1 - 8) * scale
        ox = int(round((i + 0.5) * pitch - cx))
        oy = int(round(h * 0.88 - bottom))
        th, tw = t.shape[:2]
        # A window that is flat over the product and fades out inside the gap to its
        # neighbours, so the fades only ever overlap bare backdrop.
        xs = np.arange(tw) + ox
        d = np.abs(xs - (i + 0.5) * pitch) / pitch
        ramp = np.clip((0.60 - d) / 0.14, 0, 1)
        wx = (ramp * ramp * (3 - 2 * ramp))[None, :, None]
        # Fade the tile's own top and bottom edges as well, so no seam shows where it ends.
        ys_ = np.arange(th) + oy
        fy = np.clip(np.minimum(np.arange(th), th - 1 - np.arange(th)) / (0.12 * th), 0, 1)
        wx = wx * (fy * fy * (3 - 2 * fy))[:, None, None]
        sx0, sx1 = max(0, -ox), min(tw, w - ox)
        sy0, sy1 = max(0, -oy), min(th, h - oy)
        if sx1 <= sx0 or sy1 <= sy0:
            continue
        dst = (slice(oy + sy0, oy + sy1), slice(ox + sx0, ox + sx1))
        wt = wx[sy0:sy1, sx0:sx1]
        # Each tile is a delta from the backdrop, weighted by its window; where windows
        # overlap the deltas are averaged, and where one fades out the backdrop returns.
        num[dst] += wt * (t[sy0:sy1, sx0:sx1] - BG)
        den[dst] += wt
    canvas = BG + num / np.maximum(den, 1.0)
    return Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8))


def export(img, stem, widths):
    PUBLIC.mkdir(parents=True, exist_ok=True)
    for w in widths:
        h = round(img.height * w / img.width)
        r = img.resize((w, h), Image.LANCZOS)
        r.save(PUBLIC / f"{stem}-{w}.avif", quality=58, speed=4)
        r.save(PUBLIC / f"{stem}-{w}.webp", quality=80, method=6)
        r.save(PUBLIC / f"{stem}-{w}.jpg", quality=82, progressive=True, optimize=True)
        print(stem, w, f"{(PUBLIC / f'{stem}-{w}.avif').stat().st_size // 1024} KB avif")


if __name__ == "__main__":
    export(lineup(DESKTOP, 1600, 700, 0.58), "lineup", [800, 1200, 1600])
    export(lineup(MOBILE, 960, 768, 0.60), "lineup-m", [480, 720, 960])
