"""Draws the VidStash icon set: a play symbol over a download tray, on a blue gradient."""
# Regenerate with: python3 scripts/make_icon.py assets/images
import sys
from PIL import Image, ImageDraw

OUT = sys.argv[1]
S = 4  # supersampling factor


def gradient(size, top, bottom):
    img = Image.new('RGB', (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        c = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        d.line([(0, y), (size, y)], fill=c)
    return img


def rounded_polygon(d, pts, fill, radius):
    """Polygon with round corners: inset the shape by `radius`, then stroke it with a round brush."""
    cx = sum(x for x, _ in pts) / len(pts)
    cy = sum(y for _, y in pts) / len(pts)
    # Move each vertex toward the centroid; for a triangle the inset distance is radius / sin(angle/2),
    # roughly 2*radius at 60 degrees.
    inset = []
    for x, y in pts:
        dx, dy = cx - x, cy - y
        dist = (dx * dx + dy * dy) ** 0.5
        k = (2 * radius) / dist
        inset.append((x + dx * k, y + dy * k))
    d.polygon(inset, fill=fill)
    d.line(inset + [inset[0]], fill=fill, width=int(radius * 2), joint='curve')
    for x, y in inset:
        d.ellipse([x - radius, y - radius, x + radius, y + radius], fill=fill)


def round_stroke(d, pts, fill, width):
    """A polyline with round joints and round end caps."""
    d.line(pts, fill=fill, width=int(width), joint='curve')
    r = width / 2
    for x, y in (pts[0], pts[-1]):
        d.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def draw_mark(d, size, color, cx=0.5, cy=0.5, scale=1.0):
    u = size * scale
    ox, oy = size * cx, size * cy
    # Play triangle (pointing right), placed so its visual centre (centroid) sits on the vertical axis.
    h = u * 0.36  # height
    w = h * 0.92
    tri_cy = oy - u * 0.075
    left = ox - w / 3  # centroid of a right-pointing triangle is 1/3 of its width from the flat side
    pts = [(left, tri_cy - h / 2), (left, tri_cy + h / 2), (left + w, tri_cy)]
    rounded_polygon(d, pts, color, u * 0.028)
    # Tray under it: one continuous rounded U-stroke.
    t = u * 0.05
    tw, th = u * 0.46, u * 0.085
    top = oy + u * 0.17
    l, r = ox - tw / 2, ox + tw / 2
    round_stroke(d, [(l, top), (l, top + th), (r, top + th), (r, top)], color, t)


def icon(size=1024):
    big = size * S
    img = gradient(big, (92, 140, 255), (58, 52, 214))
    d = ImageDraw.Draw(img)
    draw_mark(d, big, (255, 255, 255))
    return img.resize((size, size), Image.LANCZOS)


def foreground(size=512):
    # Android adaptive icon foreground: transparent, mark within the safe zone (inner ~66%).
    big = size * S
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    draw_mark(d, big, (255, 255, 255, 255), scale=0.72)
    return img.resize((size, size), Image.LANCZOS)


def monochrome(size=432):
    big = size * S
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    draw_mark(d, big, (255, 255, 255, 255), scale=0.8)
    return img.resize((size, size), Image.LANCZOS)


def background(size=512):
    return gradient(size, (92, 140, 255), (58, 52, 214))


def splash(size=1024):
    # Blue mark on transparent; shown centred on the splash background colour.
    big = size * S
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    draw_mark(d, big, (79, 124, 255, 255), scale=0.6)
    return img.resize((size, size), Image.LANCZOS)


icon().save(f'{OUT}/icon.png')
foreground().save(f'{OUT}/android-icon-foreground.png')
background().save(f'{OUT}/android-icon-background.png')
monochrome().save(f'{OUT}/android-icon-monochrome.png')
splash().save(f'{OUT}/splash-icon.png')
icon(48).save(f'{OUT}/favicon.png')
print('ok')
