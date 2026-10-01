"""Drawn labels for the ASSAY brands. Every mark and every line of type here is
authored as SVG, never generated. The five brands are invented; the marks are
simple geometry (chevron, arch, meridian, leaf, compass) so none can resemble an
existing supplement brand's trade dress.

label_svg(brand, title, category, size, w, h) -> SVG string, w x h px.
Unprinted areas stay transparent: the compositor multiplies the art onto the
plate's blank white label, which is how offset printing behaves (light type on
a dark band is simply paper showing through).
"""
import random
from xml.sax.saxutils import escape

SANS = "Bahnschrift, 'Segoe UI', Arial, sans-serif"
SERIF = "Georgia, 'Times New Roman', serif"

INK = {
    "kestrel-labs": ("#16181a", "#e5482d"),
    "elia": ("#a9544f", "#e7a38b"),
    "meridian-botanicals": ("#24513b", "#b8893b"),
    "vireo": ("#2b6a3d", "#8cc03a"),
    "northbound": ("#14264a", "#4f9be6"),
}


def wrap(text, size, max_w, k=0.56):
    words, lines, cur = text.split(), [], ""
    for wd in words:
        t = (cur + " " + wd).strip()
        if len(t) * size * k <= max_w or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = wd
    if cur:
        lines.append(cur)
    return lines


def fit(text, max_w, start, min_size, k=0.56, max_lines=3, avail_h=None, lh=1.1):
    """Largest size at which the wrapped title fits the width, the line cap and,
    when given, the vertical space available to it."""
    size = start
    while size > min_size:
        lines = wrap(text, size, max_w, k)
        tall_ok = avail_h is None or len(lines) * size * lh <= avail_h
        if len(lines) <= max_lines and tall_ok and all(len(l) * size * k <= max_w for l in lines):
            return round(size, 1), lines
        size -= 0.5
    return min_size, wrap(text, min_size, max_w, k)


def tspans(lines, x, y, size, lh=1.12, anchor="start"):
    return "".join(
        f'<text x="{x:.1f}" y="{y + i * size * lh:.1f}" text-anchor="{anchor}">{escape(l)}</text>'
        for i, l in enumerate(lines)
    )


def barcode(x, y, w, h, seed, color):
    rnd = random.Random(seed)
    bars, cx = [], x
    while cx < x + w - 2:
        bw = rnd.choice([1, 1, 2, 3])
        if rnd.random() < 0.62:
            bars.append(f'<rect x="{cx:.1f}" y="{y:.1f}" width="{bw}" height="{h:.1f}" fill="{color}"/>')
        cx += bw + rnd.choice([1, 2])
    return "".join(bars)


def seal(cx, cy, r, ink):
    sw = max(1, r * 0.07)
    return (
        f'<g fill="none" stroke="{ink}" stroke-width="{sw:.1f}">'
        f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}"/>'
        f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r * 0.82:.1f}" stroke-width="{max(0.6, r * 0.03):.1f}"/>'
        f'<path d="M{cx - r * 0.38:.1f} {cy + r * 0.02:.1f} l{r * 0.26:.1f} {r * 0.3:.1f} l{r * 0.5:.1f} {-r * 0.62:.1f}" '
        f'stroke-width="{r * 0.14:.1f}" stroke-linecap="round" stroke-linejoin="round"/></g>'
        f'<text x="{cx:.1f}" y="{cy + r * 1.52:.1f}" text-anchor="middle" font-family="{SANS}" '
        f'font-size="{r * 0.42:.1f}" letter-spacing="{r * 0.1:.1f}" fill="{ink}">ASSAYED</text>'
    )


def kestrel(title, category, size, w, h):
    u = w * min(1.0, (h / w) / 0.95)  # type scales down on short, wide labels
    ink, acc = INK["kestrel-labs"]
    m = u * 0.09
    fs, lines = fit(title, w - 2 * m, u * 0.13, 12, 0.52)
    mark = (
        f'<path d="M{m:.1f} {m + u * 0.07:.1f} l{u * 0.045:.1f} {-u * 0.07:.1f} l{u * 0.045:.1f} {u * 0.07:.1f} '
        f'm{-u * 0.09:.1f} {u * 0.035:.1f} l{u * 0.045:.1f} {-u * 0.07:.1f} l{u * 0.045:.1f} {u * 0.07:.1f}" '
        f'fill="none" stroke="{acc}" stroke-width="{u * 0.018:.1f}" stroke-linejoin="miter"/>'
    )
    ty = h * 0.34
    end = ty + len(lines) * fs * 1.08
    return (
        mark
        + f'<text x="{m + u * 0.13:.1f}" y="{m + u * 0.075:.1f}" font-family="{SANS}" font-weight="700" '
        f'font-size="{u * 0.052:.1f}" letter-spacing="{u * 0.016:.1f}" fill="{ink}">KESTREL LABS</text>'
        + f'<rect x="{m:.1f}" y="{m + u * 0.15:.1f}" width="{w - 2 * m:.1f}" height="{max(1, u * 0.006):.1f}" fill="{ink}"/>'
        + f'<g font-family="{SANS}" font-weight="700" font-size="{fs}" fill="{ink}">{tspans(lines, m, ty, fs, 1.08)}</g>'
        + f'<rect x="{m:.1f}" y="{end:.1f}" width="{u * 0.16:.1f}" height="{u * 0.022:.1f}" fill="{acc}"/>'
        + f'<text x="{m:.1f}" y="{end + u * 0.095:.1f}" font-family="{SANS}" font-size="{u * 0.052:.1f}" '
        f'letter-spacing="{u * 0.004:.1f}" fill="{ink}">{escape(category.upper())}  /  {escape(size)}</text>'
        + seal(m + u * 0.075, h - m - u * 0.12, u * 0.075, ink)
        + barcode(w - m - u * 0.3, h - m - u * 0.15, u * 0.3, u * 0.15, title, ink)
    )


def elia(title, category, size, w, h):
    u = w * min(1.0, (h / w) / 0.95)  # type scales down on short, wide labels
    ink, acc = INK["elia"]
    cx, m = w / 2, u * 0.1
    fs, lines = fit(title, w - 2 * m, u * 0.105, 12, 0.5, 3)
    top = h * 0.13
    arch = "".join(
        f'<path d="M{cx - r:.1f} {top:.1f} a{r:.1f} {r:.1f} 0 0 1 {2 * r:.1f} 0" fill="none" '
        f'stroke="{acc}" stroke-width="{u * 0.012:.1f}"/>'
        for r in (u * 0.07, u * 0.115, u * 0.16)
    )
    ry = top + u * 0.27
    end = ry + fs * 1.5 + len(lines) * fs * 1.15
    return (
        arch
        + f'<text x="{cx:.1f}" y="{top + u * 0.2:.1f}" text-anchor="middle" font-family="{SERIF}" font-style="italic" '
        f'font-size="{u * 0.24:.1f}" fill="{ink}">elia</text>'
        + f'<rect x="{cx - u * 0.08:.1f}" y="{ry:.1f}" width="{u * 0.16:.1f}" height="{max(1, u * 0.006):.1f}" fill="{ink}"/>'
        + f'<g font-family="{SERIF}" font-size="{fs}" fill="{ink}">{tspans(lines, cx, ry + fs * 1.5, fs, 1.15, "middle")}</g>'
        + f'<text x="{cx:.1f}" y="{end + u * 0.03:.1f}" text-anchor="middle" font-family="{SANS}" '
        f'font-size="{u * 0.045:.1f}" letter-spacing="{u * 0.012:.1f}" fill="{ink}">{escape(size.upper())}</text>'
        + f'<text x="{cx:.1f}" y="{h * 0.93:.1f}" text-anchor="middle" font-family="{SANS}" '
        f'font-size="{u * 0.038:.1f}" letter-spacing="{u * 0.01:.1f}" fill="{acc}">THIRD-PARTY ASSAYED</text>'
    )


def meridian(title, category, size, w, h):
    u = w * min(1.0, (h / w) / 0.95)  # type scales down on short, wide labels
    ink, acc = INK["meridian-botanicals"]
    cx, m = w / 2, u * 0.1
    fs, lines = fit(title, w - 2 * m, u * 0.11, 12, 0.5, 3)
    band = h * 0.17
    r = u * 0.085
    gy = band + h * 0.12
    glyph = (
        f'<g fill="none" stroke="{ink}" stroke-width="{u * 0.01:.1f}"><circle cx="{cx:.1f}" cy="{gy:.1f}" r="{r:.1f}"/>'
        f'<ellipse cx="{cx:.1f}" cy="{gy:.1f}" rx="{r * 0.42:.1f}" ry="{r:.1f}"/>'
        f'<path d="M{cx - r:.1f} {gy:.1f} H{cx + r:.1f}"/></g>'
    )
    ty = gy + r + fs * 1.6
    end = ty + len(lines) * fs * 1.12
    return (
        f'<rect x="0" y="0" width="{w}" height="{band:.1f}" fill="{ink}"/>'
        f'<rect x="0" y="{h * 0.965:.1f}" width="{w}" height="{h * 0.035:.1f}" fill="{ink}"/>'
        f'<text x="{cx:.1f}" y="{band * 0.58:.1f}" text-anchor="middle" font-family="{SERIF}" '
        f'font-size="{u * 0.07:.1f}" letter-spacing="{u * 0.02:.1f}" fill="#fff">MERIDIAN</text>'
        f'<text x="{cx:.1f}" y="{band * 0.58 + u * 0.06:.1f}" text-anchor="middle" font-family="{SANS}" '
        f'font-size="{u * 0.032:.1f}" letter-spacing="{u * 0.018:.1f}" fill="#fff">BOTANICALS</text>'
        + glyph
        + f'<g font-family="{SERIF}" font-weight="700" font-size="{fs}" fill="{ink}">{tspans(lines, cx, ty, fs, 1.12, "middle")}</g>'
        + f'<rect x="{cx - u * 0.1:.1f}" y="{end:.1f}" width="{u * 0.2:.1f}" height="{max(1.5, u * 0.008):.1f}" fill="{acc}"/>'
        + f'<text x="{cx:.1f}" y="{end + u * 0.085:.1f}" text-anchor="middle" font-family="{SANS}" '
        f'font-size="{u * 0.04:.1f}" letter-spacing="{u * 0.009:.1f}" fill="{ink}">{escape(size.upper())}  \u00b7  {escape(category.upper())}</text>'
    )


def vireo(title, category, size, w, h):
    u = w * min(1.0, (h / w) / 0.95)  # type scales down on short, wide labels
    ink, acc = INK["vireo"]
    m = u * 0.1
    bh = h * 0.13
    fs, lines = fit(title, w - 2 * m, u * 0.14, 12, 0.52, 3, avail_h=h * 0.95 - bh - u * 0.2 - h * 0.38, lh=1.08)
    lw = u * 0.07
    leaf = (
        f'<path d="M{m:.1f} {m + lw * 0.4:.1f} q{lw:.1f} {lw * 0.1:.1f} {lw * 1.5:.1f} {lw * 1.4:.1f} '
        f'q{-lw * 1.2:.1f} {lw * 0.3:.1f} {-lw * 1.5:.1f} {-lw * 1.4:.1f}z" fill="{acc}"/>'
        f'<path d="M{m + lw * 1.6:.1f} {m + lw * 0.4:.1f} q{-lw:.1f} {lw * 0.1:.1f} {-lw * 1.5:.1f} {lw * 1.4:.1f} '
        f'q{lw * 1.2:.1f} {lw * 0.3:.1f} {lw * 1.5:.1f} {-lw * 1.4:.1f}z" fill="{ink}" opacity=".92"/>'
    )
    end = h * 0.38 + len(lines) * fs * 1.08
    by = min(max(h * 0.74, end + u * 0.12), h * 0.95 - bh)
    return (
        leaf
        + f'<text x="{m + lw * 2.0:.1f}" y="{m + lw * 1.55:.1f}" font-family="{SANS}" font-weight="700" '
        f'font-size="{u * 0.15:.1f}" fill="{ink}">vireo</text>'
        + f'<g font-family="{SANS}" font-weight="700" font-size="{fs}" fill="{ink}">{tspans(lines, m, h * 0.38, fs, 1.08)}</g>'
        + f'<text x="{m:.1f}" y="{end + u * 0.04:.1f}" font-family="{SANS}" font-size="{u * 0.05:.1f}" '
        f'letter-spacing="{u * 0.008:.1f}" fill="{ink}">{escape(category.upper())}</text>'
        + f'<rect x="{m:.1f}" y="{by:.1f}" width="{w - 2 * m:.1f}" height="{bh:.1f}" rx="{u * 0.02:.1f}" fill="{acc}"/>'
        + f'<text x="{m + u * 0.04:.1f}" y="{by + bh * 0.64:.1f}" font-family="{SANS}" font-weight="700" '
        f'font-size="{u * 0.058:.1f}" fill="{ink}">{escape(size)}</text>'
        + f'<text x="{w - m - u * 0.04:.1f}" y="{by + bh * 0.64:.1f}" text-anchor="end" font-family="{SANS}" '
        f'font-size="{u * 0.036:.1f}" letter-spacing="{u * 0.006:.1f}" fill="{ink}">PLANT-BASED</text>'
    )


def northbound(title, category, size, w, h):
    u = w * min(1.0, (h / w) / 0.95)  # type scales down on short, wide labels
    ink, acc = INK["northbound"]
    m = u * 0.08
    top = h * 0.2
    cy = top + u * 0.14
    fs, lines = fit(title, w - 2 * m, u * 0.12, 12, 0.5, 3, avail_h=h - m - u * 0.2 - cy - u * 0.05, lh=1.06)
    ty = cy + fs * 1.3
    return (
        f'<rect x="0" y="0" width="{w}" height="{top:.1f}" fill="{ink}"/>'
        f'<path d="M{w - m - u * 0.08:.1f} {top * 0.78:.1f} l{u * 0.04:.1f} {-u * 0.075:.1f} l{u * 0.04:.1f} {u * 0.075:.1f} '
        f'l{-u * 0.04:.1f} {-u * 0.02:.1f}z" fill="{acc}"/>'
        f'<text x="{m:.1f}" y="{top * 0.66:.1f}" font-family="{SANS}" font-weight="700" '
        f'font-size="{u * 0.098:.1f}" letter-spacing="{u * 0.012:.1f}" fill="#fff">NORTHBOUND</text>'
        f'<rect x="0" y="{top:.1f}" width="{w}" height="{max(2, u * 0.018):.1f}" fill="{acc}"/>'
        + f'<text x="{m:.1f}" y="{cy:.1f}" font-family="{SANS}" font-size="{u * 0.05:.1f}" '
        f'letter-spacing="{u * 0.01:.1f}" fill="{acc}">{escape(category.upper())}</text>'
        + f'<g font-family="{SANS}" font-weight="700" font-size="{fs}" fill="{ink}">{tspans(lines, m, ty, fs, 1.06)}</g>'
        + f'<text x="{m:.1f}" y="{h - m - u * 0.09:.1f}" font-family="{SANS}" font-size="{u * 0.06:.1f}" fill="{ink}">{escape(size)}</text>'
        + barcode(w - m - u * 0.3, h - m - u * 0.14, u * 0.3, u * 0.14, title, ink)
        + f'<rect x="{m:.1f}" y="{h - m - u * 0.03:.1f}" width="{u * 0.12:.1f}" height="{max(1.5, u * 0.012):.1f}" fill="{ink}"/>'
    )


BRANDS = {
    "kestrel-labs": kestrel,
    "elia": elia,
    "meridian-botanicals": meridian,
    "vireo": vireo,
    "northbound": northbound,
}


def label_svg(brand, title, category, size, w, h):
    body = BRANDS[brand](title, category, size, w, h)
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{body}</svg>'
