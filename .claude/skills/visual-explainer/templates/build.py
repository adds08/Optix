#!/usr/bin/env python3
"""Inline {{IMG:name}} and {{FONT:name}} placeholders as data URIs.

    python3 build.py src.html out.html --img-dir DIR [--font-dir DIR]
                     [--width 1150] [--quality 76]

{{IMG:name}}  -> name.png/.jpg/.jpeg/.webp in --img-dir, downscaled to --width
                and re-encoded as WebP.
{{FONT:name}} -> name.woff2 in --font-dir, embedded verbatim.

Unresolved placeholders are a hard error -- a silently missing asset is worse
than a failed build. Only embed fonts you have the licence to redistribute
(SIL OFL fonts such as Sora and Manrope are fine).
"""
import argparse
import base64
import io
import re
import sys
from pathlib import Path

from PIL import Image

PLACEHOLDER = re.compile(r"\{\{IMG:([A-Za-z0-9._\-]+)\}\}")
FONT_PLACEHOLDER = re.compile(r"\{\{FONT:([A-Za-z0-9._\-]+)\}\}")
EXTS = (".png", ".jpg", ".jpeg", ".webp")


def encode(path: Path, width: int, quality: int) -> str:
    im = Image.open(path).convert("RGB")
    w, h = im.size
    if w > width:
        im = im.resize((width, round(h * width / w)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=quality, method=6)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--img-dir", required=True)
    ap.add_argument("--font-dir")
    ap.add_argument("--width", type=int, default=1150)
    ap.add_argument("--quality", type=int, default=76)
    args = ap.parse_args()

    img_dir = Path(args.img_dir)
    html = Path(args.src).read_text(encoding="utf-8")
    cache: dict[str, str] = {}
    missing: list[str] = []
    fonts = 0

    def resolve(match: re.Match) -> str:
        name = match.group(1)
        if name in cache:
            return cache[name]
        for ext in EXTS:
            candidate = img_dir / f"{name}{ext}"
            if candidate.exists():
                cache[name] = encode(candidate, args.width, args.quality)
                return cache[name]
        missing.append(name)
        return match.group(0)

    def resolve_font(match: re.Match) -> str:
        nonlocal fonts
        name = match.group(1)
        path = Path(args.font_dir or ".") / f"{name}.woff2"
        if not path.exists():
            missing.append(f"{name}.woff2")
            return match.group(0)
        fonts += 1
        blob = base64.b64encode(path.read_bytes()).decode()
        return f"data:font/woff2;base64,{blob}"

    html = PLACEHOLDER.sub(resolve, html)
    html = FONT_PLACEHOLDER.sub(resolve_font, html)

    if missing:
        print("error: unresolved assets:", file=sys.stderr)
        for name in sorted(set(missing)):
            print(f"  {name}", file=sys.stderr)
        return 1

    Path(args.out).write_text(html, encoding="utf-8")
    size_mb = len(html.encode()) / 1024 / 1024
    print(f"{args.out}  {len(cache)} images + {fonts} fonts inlined  {size_mb:.2f} MB")
    if size_mb > 5:
        print("warning: over 5 MB — drop screenshots or lower --quality", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
