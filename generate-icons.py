"""Build the static PNG home-screen icons from simple vector-like shapes.

This is a development-only helper. The PWA does not require Python or Pillow.
"""

from pathlib import Path
from PIL import Image, ImageDraw


HERE = Path(__file__).resolve().parent / "icons"
SIZE = 1024


def rect(draw, box, radius, fill):
    scale = SIZE / 512
    draw.rounded_rectangle(tuple(round(value * scale) for value in box),
                           radius=round(radius * scale), fill=fill)


image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
rect(draw, (0, 0, 512, 512), 116, "#050705")
rect(draw, (86, 226, 132, 286), 12, "#2dc45b")
rect(draw, (138, 182, 198, 330), 15, "#39f56b")
rect(draw, (204, 244, 308, 268), 12, "#f6fff7")
rect(draw, (314, 182, 374, 330), 15, "#39f56b")
rect(draw, (380, 226, 426, 286), 12, "#2dc45b")

for name, size in [("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)]:
    image.resize((size, size), Image.Resampling.LANCZOS).save(HERE / name)
