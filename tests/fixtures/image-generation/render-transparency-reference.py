#!/usr/bin/env python3
"""Render the deterministic plate fixture with Pillow; no API calls."""
import argparse
from pathlib import Path
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument("--transparent-out", type=Path)
args = parser.parse_args()
scale = 4
image = Image.new("RGBA", (640 * scale, 640 * scale))
draw = ImageDraw.Draw(image)
ink = "#253744"
def points(coords):
    return [(x * scale, y * scale) for x, y in coords]

def polygon(coords, fill):
    draw.polygon(points(coords), fill=fill)
    draw.line(points(coords + [coords[0]]), fill=ink, width=5 * scale, joint="curve")

draw.line(points([(315, 105), (315, 429)]), fill=ink, width=5 * scale)
polygon([(301, 131), (143, 381), (301, 381)], "white")
polygon([(330, 151), (470, 381), (330, 381)], "white")
polygon([(166, 410), (502, 410), (455, 491), (218, 491)], "#58A59D")
polygon([(219, 491), (455, 491), (443, 510), (233, 510)], "#E8B25B")
draw.line(points([(135, 407), (315, 105), (501, 407)]), fill=ink, width=3 * scale)
for x in (260, 337, 414):
    draw.ellipse(((x - 14) * scale, 435 * scale, (x + 14) * scale, 463 * scale), fill=(0, 0, 0, 0))
image = image.resize((640, 640), Image.Resampling.LANCZOS)
assert image.getpixel((263, 302)) == image.getpixel((370, 320)) == (255, 255, 255, 255)
assert image.getpixel((315, 200))[3] >= 250
assert all(image.getpixel((x, 449))[3] == 0 for x in (260, 337, 414))
if args.transparent_out:
    image.save(args.transparent_out)
opaque = Image.new("RGBA", image.size, "#F3EFE5")
opaque.alpha_composite(image)
opaque.convert("RGB").save(Path(__file__).with_name("transparency-reference-opaque.png"))
print("Rendered and checked white sails, dark rigging, and three transparent holes.")
