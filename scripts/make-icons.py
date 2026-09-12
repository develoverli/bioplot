#!/usr/bin/env python3
"""Render the bioplot mark into the PNG sizes an extension needs.

The mark is a rising bar chart whose tallest bar is a chain, with a sprout on top: what the
tool does (measure and compare), on what it measures (a farm), on the chain it reads from. It
is drawn from primitives here rather than traced from an SVG so the repo needs no rasteriser,
and it is supersampled 4x so the edges stay clean at 16px.

    python scripts/make-icons.py
"""
from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "extension" / "icons"
SIZES = (16, 32, 48, 128)
SUPERSAMPLE = 4

# A filled green tile, so the mark still reads on a light tab strip and on a dark one.
BACKGROUND = (30, 138, 78)
BAR_LOW = (134, 239, 172)
BAR_MID = (190, 246, 214)
BAR_HIGH = (245, 253, 249)
LEAF = (134, 239, 172)
GROUND = (16, 84, 47)
STEM = (110, 226, 156)


def rounded_box(x: float, y: float, size: float, radius: float) -> bool:
    """Inside a rounded square centred on the canvas."""
    dx = max(abs(x) - (size - radius), 0.0)
    dy = max(abs(y) - (size - radius), 0.0)
    return (abs(x) <= size and abs(y) <= size) and (dx * dx + dy * dy <= radius * radius)


# Left to right, each bar taller than the last: x centre, half-width, top edge, colour.
# y runs downward, so a smaller top is a taller bar.
BARS = (
    (-0.46, 0.15, 0.16, BAR_LOW),
    (-0.05, 0.15, -0.12, BAR_MID),
    (0.36, 0.15, -0.40, BAR_HIGH),
)

BASE = 0.60


def bar(x: float, y: float) -> tuple[int, int, int] | None:
    """The three columns, with their corners rounded off."""
    for cx, half, top, colour in BARS:
        if abs(x - cx) > half or y < top or y > BASE:
            continue
        # Round only the top corners: the bars stand on the ground line.
        r = 0.055
        dx = abs(x - cx) - (half - r)
        dy = top + r - y
        if dx > 0 and dy > 0 and dx * dx + dy * dy > r * r:
            continue
        return colour
    return None


def ground(x: float, y: float) -> bool:
    """The line the bars stand on: the thing that makes them a chart, not three sticks."""
    return -0.66 <= x <= 0.62 and BASE <= y <= BASE + 0.10


def leaf(x: float, y: float, flip: bool) -> bool:
    """A teardrop leaf on the tallest bar, mirrored for the left side."""
    px = -(x - 0.36) if flip else (x - 0.36)
    py = y + 0.60

    angle = math.radians(38)
    rx = px * math.cos(angle) - py * math.sin(angle)
    ry = px * math.sin(angle) + py * math.cos(angle)
    rx -= 0.20
    return (rx / 0.20) ** 2 + (ry / 0.11) ** 2 <= 1.0


def stem(x: float, y: float) -> bool:
    """The short neck that joins the sprout to the bar it grows out of."""
    return abs(x - 0.36) <= 0.032 and -0.60 <= y <= -0.38


def link(x: float, y: float, cy: float) -> bool:
    """One ring of the chain running up the tallest bar."""
    d = math.hypot((x - 0.36) / 0.9, y - cy)
    return 0.05 <= d <= 0.095


def sample(x: float, y: float) -> tuple[int, int, int] | None:
    """Colour of the mark at a point in [-1, 1] space, or None for background."""
    if leaf(x, y, flip=False) or leaf(x, y, flip=True):
        return LEAF
    if stem(x, y):
        return STEM
    if ground(x, y):
        return GROUND
    # The chain is cut into the tallest bar, so it reads as texture rather than as clutter.
    if link(x, y, -0.12) or link(x, y, 0.20):
        painted = bar(x, y)
        return GROUND if painted else None
    return bar(x, y)


def pixel(px: int, py: int, size: int) -> bytes:
    """One RGBA pixel, averaged over its supersamples."""
    hi = size * SUPERSAMPLE
    total = SUPERSAMPLE * SUPERSAMPLE
    r = g = b = 0
    hits = 0

    for sy in range(SUPERSAMPLE):
        for sx in range(SUPERSAMPLE):
            fx = (px * SUPERSAMPLE + sx + 0.5) / hi * 2 - 1
            fy = (py * SUPERSAMPLE + sy + 0.5) / hi * 2 - 1

            if not rounded_box(fx, fy, 0.96, 0.46):
                continue

            colour = sample(fx, fy) or BACKGROUND
            r += colour[0]
            g += colour[1]
            b += colour[2]
            hits += 1

    if hits:
        # Averaged over the covered samples only, so an edge pixel keeps its own colour
        # and fades out through alpha rather than fading towards black.
        return bytes((r // hits, g // hits, b // hits, round(255 * hits / total)))
    return b"\x00\x00\x00\x00"


def render(size: int) -> bytes:
    """Returns raw RGBA rows for one icon.

    Outside the rounded square a pixel is fully transparent, not black. An opaque corner shows
    as a dark box on every surface that is not the same colour as the corner, which is most of
    them: a browser tab strip, a launcher, a store listing. The share of samples that landed
    inside the shape doubles as the alpha, so the rounded edge comes out smooth for free.
    """
    rows = bytearray()

    for py in range(size):
        # Each PNG scanline is prefixed with its filter type; 0 means "none".
        row = bytearray(b"\x00")
        for px in range(size):
            row += pixel(px, py, size)

        rows += row

    return bytes(rows)


def write_png(path: Path, size: int, raw: bytes) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    # Colour type 6 is truecolour with alpha, which is what makes the corners transparent.
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main() -> None:
    TARGET.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        path = TARGET / f"icon-{size}.png"
        write_png(path, size, render(size))
        print(f"  wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
