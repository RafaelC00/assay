"""Composite drawn labels onto the blank plates and write one master per product.

    python scripts/images/compose.py --pick runs/<stamp>   # copy chosen plates into plates/
    python scripts/images/compose.py [handle ...]           # build out/<handle>.jpg

Needs: playwright (headless Chrome renders the SVG labels), pillow, numpy.
"""
import hashlib, json, math, sys
from pathlib import Path
import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).parent))
from labels import label_svg
from plates import LAYOUT, PRODUCT_PLATE, PLATE_ALT

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
BG = np.array([232, 229, 223], dtype=np.float32)  # shared backdrop tone for the whole catalogue
SS = 2  # label supersampling


def pick(run):
    (HERE / "plates").mkdir(exist_ok=True)
    for f in sorted((HERE / run).glob("*.png")):
        Image.open(f).convert("RGB").save(HERE / "plates" / f"{f.stem}.jpg", quality=93, subsampling=0)
        print("picked", f.stem)


def normalise_backdrop(img):
    """Bring each plate's backdrop to one shared tone so the grid reads as one set."""
    a = np.asarray(img, dtype=np.float32)
    edge = np.concatenate([a[:40, :].reshape(-1, 3), a[-40:, :].reshape(-1, 3),
                           a[:, :40].reshape(-1, 3), a[:, -40:].reshape(-1, 3)])
    gain = BG / np.median(edge, axis=0)
    return np.clip(a * gain, 0, 255)


def render_labels(jobs):
    """jobs: {key: (svg, w, h)} -> {key: RGBA ndarray at SSx}"""
    out = {}
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=True)
        page = b.new_context(device_scale_factor=SS).new_page()
        for k, (svg, w, h) in jobs.items():
            page.set_viewport_size({"width": w, "height": h})
            page.set_content(f'<body style="margin:0;background:transparent">{svg}</body>')
            page.screenshot(path=str(HERE / "_tmp.png"), omit_background=True,
                            clip={"x": 0, "y": 0, "width": w, "height": h})
            out[k] = np.asarray(Image.open(HERE / "_tmp.png").convert("RGBA"), dtype=np.float32)
        b.close()
    (HERE / "_tmp.png").unlink(missing_ok=True)
    return out


def wrap_columns(art, ws, phi_deg):
    """Map flat label art onto a cylinder seen from the front."""
    ha, wa, _ = art.shape
    if not phi_deg:
        idx = np.linspace(0, wa - 1, ws)
    else:
        phi = math.radians(phi_deg)
        s = (np.arange(ws) + 0.5) / ws * 2 - 1
        u = np.arcsin(np.clip(s * math.sin(phi), -1, 1)) / phi
        idx = (u + 1) / 2 * (wa - 1)
    i0 = np.floor(idx).astype(int)
    i1 = np.minimum(i0 + 1, wa - 1)
    f = (idx - i0)[None, :, None]
    return art[:, i0] * (1 - f) + art[:, i1] * f


def main():
    args = sys.argv[1:]
    if args[:1] == ["--pick"]:
        return pick(args[1])
    cat = json.loads((ROOT / "data/catalog.json").read_text(encoding="utf-8"))
    vendors = {v["handle"]: v for v in cat["vendors"]}
    products = [p for p in cat["products"] if not args or p["handle"] in args]
    jobs, meta = {}, {}
    for p in products:
        plate = PRODUCT_PLATE[p["handle"]]
        if plate not in LAYOUT or not (HERE / "plates" / f"{plate}.jpg").exists():
            print("skip (no plate yet)", p["handle"], plate)
            continue
        x0, y0, x1, y1 = LAYOUT[plate]["bbox"]
        pad = 0.03
        w, h = int((x1 - x0) * (1 - 2 * pad)), int((y1 - y0) * (1 - 2 * pad))
        size = p["variants"][0]["title"].split(" (")[0]
        jobs[p["handle"]] = (label_svg(p["vendor"], p["title"], p["category"], size, w, h), w, h)
        meta[p["handle"]] = (plate, x0 + int((x1 - x0) * pad), y0 + int((y1 - y0) * pad), w, h)
    arts = render_labels(jobs)
    (HERE / "out").mkdir(exist_ok=True)
    manifest_path = HERE / "out" / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    byhandle = {p["handle"]: p for p in cat["products"]}
    for handle, art in arts.items():
        plate, ox, oy, w, h = meta[handle]
        base = normalise_backdrop(Image.open(HERE / "plates" / f"{plate}.jpg").convert("RGB"))
        # Squeeze the supersampled art down to the label size, wrapped round the cylinder.
        warped = wrap_columns(art, w, LAYOUT[plate]["wrap"])
        small = np.asarray(Image.fromarray(warped.astype(np.uint8), "RGBA").resize((w, h), Image.LANCZOS), dtype=np.float32)
        alpha = small[..., 3:4] / 255
        printed = small[..., :3] * alpha + 255 * (1 - alpha)
        region = base[oy:oy + h, ox:ox + w]
        base[oy:oy + h, ox:ox + w] = region * printed / 255
        Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).save(HERE / "out" / f"{handle}.jpg", quality=93, subsampling=0)
        f = HERE / "out" / f"{handle}.jpg"
        p = byhandle[handle]
        vname = vendors[p["vendor"]]["name"]
        manifest[handle] = {
            "file": f.name,
            "sha": hashlib.sha256(f.read_bytes()).hexdigest()[:10],
            "alt": f"{vname} {p['title']}, {p['variants'][0]['title'].split(' (')[0]}: {PLATE_ALT[plate]}, bearing the {vname} label.",
        }
        print("built", handle, "on", plate)
    manifest_path.write_text(json.dumps(manifest, indent=2))

main()
