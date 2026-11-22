#!/usr/bin/env python3
"""Generate the ChatVault Open Graph thumbnail (1200x630 PNG).

Dependency-free fallback uses Pillow if installed; the committed PNG is the
source of truth for social embeds. Run: python3 scripts/generate-og-image.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
OUT = Path(__file__).resolve().parents[1] / "site" / "og-image.png"


def font(size, bold=False):
    candidates = [
        "C:/Windows/Fonts/seguisb.ttf" if bold else "C:/Windows/Fonts/seguemi.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def rounded(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def main():
    img = Image.new("RGB", (W, H), "#071a18")
    d = ImageDraw.Draw(img)
    # soft radial-ish glow
    for r in range(420, 0, -12):
        alpha = int(14 * (1 - r / 420))
        d.ellipse([920 - r, 60 - r, 920 + r, 60 + r], fill=(7 + alpha, 34 + alpha, 30 + alpha))
    for r in range(380, 0, -12):
        alpha = int(12 * (1 - r / 380))
        d.ellipse([80 - r, 610 - r, 80 + r, 610 + r], fill=(7 + alpha, 40 + alpha, 36 + alpha))

    # Vault icon
    rounded(d, (76, 168, 336, 428), 54, "#0b2421", "#5fffd0", 5)
    d.line([(124, 246), (250, 246)], fill="#5fffd0", width=8)
    d.line([(124, 292), (232, 292)], fill="#5fffd0", width=8)
    d.line([(124, 338), (206, 338)], fill="#5fffd0", width=8)
    d.ellipse((222, 292, 322, 392), fill="#0b2421", outline="#5fffd0", width=6)
    d.line([(272, 312), (272, 372)], fill="#5fffd0", width=7)
    d.line([(242, 342), (302, 342)], fill="#5fffd0", width=7)

    d.text((388, 150), "Chat", font=font(104, True), fill="#e9f7f2")
    d.text((388 + d.textlength("Chat ", font=font(104, True)), 150), "Vault", font=font(104, True), fill="#5fffd0")
    d.text((392, 282), "Your AI chats. Yours to keep.", font=font(40), fill="#9fffd9")
    d.text((392, 354), "ChatGPT  ·  Claude  ·  Gemini  ·  Grok  ·  DeepSeek", font=font(25), fill="#9fbdb5")

    for x, label in [(392, "MARKDOWN"), (630, "PDF"), (790, "HTML"), (930, "ZIP")]:
        rounded(d, (x, 430, x + 168, 488), 22, "#123b34", "#2f7c68", 2)
        d.text((x + 18, 444), label, font=font(22, True), fill="#5fffd0")

    d.text((392, 540), "chatvault.nyan-anonymous-d45.workers.dev  ·  github.com/Chimthuwu/chatvault", font=font(20), fill="#7fa198")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
