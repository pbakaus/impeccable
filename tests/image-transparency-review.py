#!/usr/bin/env python3
"""Inspect real alpha and render review sheets. Requires Pillow; no API calls.

python3 tests/image-transparency-review.py tmp/image-transparency-2.5
"""
import json
import statistics
import argparse
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

parser = argparse.ArgumentParser()
parser.add_argument("run_dir", type=Path)
parser.add_argument("--reference-alpha", type=Path)
args = parser.parse_args()
root = args.run_dir
out = root / "review"
out.mkdir(exist_ok=True)
models = ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]
font_path = "/System/Library/Fonts/Helvetica.ttc"
try:
    font = ImageFont.truetype(font_path, 18)
except OSError:
    font = ImageFont.load_default()
records = (json.loads((root / "results.json").read_text()) if (root / "results.json").exists()
           else [json.loads(p.read_text()) for p in sorted(root.glob("*-gpt-image-*.json"))])
metrics = []

for record in records:
    if record["status"] != "ok":
        continue
    source = Image.open(root / record["filename"])
    rgba = source.convert("RGBA")
    alpha = rgba.getchannel("A")
    hist = alpha.histogram()
    count = rgba.width * rgba.height
    border = [alpha.getpixel((x, y)) for x in range(rgba.width) for y in (0, rgba.height - 1)]
    border += [alpha.getpixel((x, y)) for y in range(1, rgba.height - 1) for x in (0, rgba.width - 1)]
    item = {
        "id": record["id"], "mode": source.mode, "size": list(source.size),
        "alphaMin": alpha.getextrema()[0], "alphaMax": alpha.getextrema()[1],
        "alphaLevels": sum(n > 0 for n in hist),
        "transparentPercent": round(100 * hist[0] / count, 3),
        "partialPercent": round(100 * sum(hist[1:255]) / count, 3),
        "substantialPartialPercent": round(100 * sum(hist[1:250]) / count, 3),
        "nearOpaquePercent": round(100 * sum(hist[250:]) / count, 3),
        "opaquePercent": round(100 * hist[255] / count, 3),
        "borderAlphaMax": max(border), "alphaHistogram": hist,
    }
    # A fixed central window tests broad body translucency, not edge antialiasing.
    # Visually confirm this window is inside the generated bottle before interpreting.
    if record["case"] == "glass":
        box = tuple(round(v * rgba.width) for v in (0.45, 0.50, 0.55, 0.65))
        values = list(alpha.crop(box).getdata())
        item["glassBodyProbe"] = {
            "box": box, "min": min(values), "median": statistics.median(values),
            "max": max(values),
            "substantialPartialPercent": round(100 * sum(0 < v < 250 for v in values) / len(values), 3),
        }
    # Probes follow the 640px reference; shifts are fidelity failures, not evidence
    # that alpha cannot represent white sails or holes. Review geometry separately.
    if record["case"] == "plate":
        probes = {"leftSail": (263, 302), "rightSail": (370, 320),
                  "hole1": (260, 449), "hole2": (337, 449), "hole3": (414, 449)}
        item["referenceProbes"] = {
            name: list(rgba.getpixel((round(x * rgba.width / 640), round(y * rgba.height / 640))))
            for name, (x, y) in probes.items()
        }
        if args.reference_alpha:
            truth = Image.open(args.reference_alpha).convert("RGBA").resize(rgba.size, Image.Resampling.LANCZOS)
            expected = truth.getchannel("A").point(lambda v: 255 if v >= 128 else 0)
            actual = alpha.point(lambda v: 255 if v >= 128 else 0)
            intersection = ImageChops.darker(expected, actual).histogram()[255]
            union = ImageChops.lighter(expected, actual).histogram()[255]
            item["referenceAlphaIoU"] = round(intersection / union, 5) if union else 1.0
    metrics.append(item)

    # Show alpha explicitly and correctly composite straight-alpha PNGs; some
    # image viewers expose RGB under alpha=0, which is not the visible output.
    cell = 384
    sheet = Image.new("RGB", (cell * 4, cell + 36), "#e5e5e5")
    draw = ImageDraw.Draw(sheet)
    for index, (label, color) in enumerate((("White", "white"), ("Dark", "#202532"), ("Coral", "#e98469"), ("Alpha mask", None))):
        if color:
            composite = Image.new("RGBA", rgba.size, color)
            composite.alpha_composite(rgba)
            rendered = composite.convert("RGB")
        else:
            rendered = alpha.convert("RGB")
        sheet.paste(rendered.resize((cell, cell), Image.Resampling.LANCZOS), (cell * index, 36))
        draw.text((cell * index + 10, 8), label, fill="#222222", font=font)
    sheet.save(out / f'{record["id"]}.webp', quality=88)

(out / "alpha-results.json").write_text(json.dumps(metrics, indent=2) + "\n")
for case in ("botanical", "glass", "plate"):
    selected = sorted((r for r in records if r["case"] == case), key=lambda r: (models.index(r["model"]), r["repeat"]))
    if not selected:
        continue
    sheet = Image.new("RGB", (1536, len(selected) * 458), "#eeeeee")
    draw = ImageDraw.Draw(sheet)
    for index, record in enumerate(selected):
        y = index * 458
        draw.text((12, y + 8), f'{record["model"]} / sample {record["repeat"]} / {record["seconds"]}s', fill="#222222", font=font)
        if record["status"] == "ok":
            sheet.paste(Image.open(out / f'{record["id"]}.webp'), (0, y + 38))
        else:
            draw.text((12, y + 70), record.get("error", "No image")[:130], fill="#922222", font=font)
    sheet.save(out / f"{case}.webp", quality=86)
print(f"Measured {len(metrics)} images; alpha results and compositing sheets: {out}")
