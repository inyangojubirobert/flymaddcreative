"""Generate launcher, adaptive, and splash assets from the FlyMadd Cloudinary logo.

Android launcher/splash masks are circles (or squircles). The source is a rounded
square on a white page, so white corners are filled with brand blue first, then
the mark is inset into the OS safe zone so it fills the device area without cropping.
"""
from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "images" / "_source-logo.jpg"
IMAGES = ROOT / "assets" / "images"
RES = ROOT / "android" / "app" / "src" / "main" / "res"

WHITE_THRESHOLD = 228
# Smaller mark in the launcher circle: leave more brand-blue padding so the
# logo reads clearly under OEM circular / squircle masks without looking huge.
SAFE_ZONE = 0.68
SPLASH_SAFE_ZONE = 0.72


def is_page_white(pixel: tuple[int, ...]) -> bool:
    r, g, b = pixel[:3]
    return r >= WHITE_THRESHOLD and g >= WHITE_THRESHOLD and b >= WHITE_THRESHOLD


def content_bbox(img: Image.Image) -> tuple[int, int, int, int]:
    pixels = img.load()
    width, height = img.size
    min_x, min_y, max_x, max_y = width, height, 0, 0
    for y in range(height):
        for x in range(width):
            if not is_page_white(pixels[x, y]):
                min_x = min(min_x, x)
                min_y = min(min_y, y)
                max_x = max(max_x, x)
                max_y = max(max_y, y)
    pad = 2
    return (
        max(0, min_x - pad),
        max(0, min_y - pad),
        min(width, max_x + 1 + pad),
        min(height, max_y + 1 + pad),
    )


def flood_white_corners(img: Image.Image, fill: tuple[int, int, int, int]) -> Image.Image:
    pixels = img.load()
    width, height = img.size
    seen = set()
    queue = deque([(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)])

    while queue:
        x, y = queue.popleft()
        if (x, y) in seen or not (0 <= x < width and 0 <= y < height):
            continue
        seen.add((x, y))
        if not is_page_white(pixels[x, y]):
            continue
        pixels[x, y] = fill
        queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    return img


def sample_brand_blue(img: Image.Image) -> tuple[int, int, int]:
    width, height = img.size
    pixels = img.load()
    samples = [
        pixels[width // 2, max(2, height // 12)],
        pixels[max(2, width // 12), height // 2],
        pixels[width - max(3, width // 12), height // 2],
        pixels[width // 2, height - max(3, height // 12)],
    ]
    blues = [px[:3] for px in samples if px[0] < 80 and px[2] > px[1]]
    if not blues:
        return (3, 68, 122)
    return tuple(sum(c) // len(blues) for c in zip(*blues))  # type: ignore[return-value]


def square_on_brand(img: Image.Image, size: int, brand: tuple[int, int, int, int]) -> Image.Image:
    side = max(img.size)
    canvas = Image.new("RGBA", (side, side), brand)
    canvas.paste(img, ((side - img.size[0]) // 2, (side - img.size[1]) // 2), img)
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def inset_on_canvas(src: Image.Image, size: int, scale: float, background: tuple[int, int, int, int]) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), background)
    inner = max(1, int(size * scale))
    logo = src.resize((inner, inner), Image.Resampling.LANCZOS)
    offset = (size - inner) // 2
    canvas.paste(logo, (offset, offset), logo)
    return canvas


def circular_crop(src: Image.Image, size: int) -> Image.Image:
    img = src.resize((size, size), Image.Resampling.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def is_brand_blue(pixel: tuple[int, ...]) -> bool:
    r, g, b, a = pixel
    return a > 128 and b > r + 20 and b > g + 10 and r < 100


def monochrome_chevron(src: Image.Image, size: int) -> Image.Image:
    """Keep only the inner chevron as a white silhouette for Android themed icons."""
    width, height = src.size
    pixels = src.load()
    visited = [[False] * width for _ in range(height)]
    components: list[list[tuple[int, int]]] = []

    for y in range(height):
        for x in range(width):
            if visited[y][x] or not is_brand_blue(pixels[x, y]):
                continue
            stack = [(x, y)]
            visited[y][x] = True
            cells: list[tuple[int, int]] = []
            while stack:
                cx, cy = stack.pop()
                cells.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < width and 0 <= ny < height and not visited[ny][nx] and is_brand_blue(pixels[nx, ny]):
                        visited[ny][nx] = True
                        stack.append((nx, ny))
            components.append(cells)

    if not components:
        return Image.new("RGBA", (size, size), (0, 0, 0, 0))

    components.sort(key=len)
    # Outer rounded square is the largest blue region; the chevron is next.
    chevron = components[-2] if len(components) > 1 else components[-1]
    out = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    dest = out.load()
    for x, y in chevron:
        dest[x, y] = (255, 255, 255, 255)
    out = out.filter(ImageFilter.GaussianBlur(0.4))
    alpha = out.split()[-1].point(lambda v: 255 if v > 80 else 0)
    white = Image.new("RGBA", (width, height), (255, 255, 255, 255))
    white.putalpha(alpha)
    return inset_on_canvas(white, size, SAFE_ZONE, (0, 0, 0, 0))


def save_png(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG", optimize=True)


def save_webp(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "WEBP", quality=95, method=6)


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")
    cropped = source.crop(content_bbox(source))
    brand = sample_brand_blue(cropped)
    brand_rgba = (*brand, 255)
    flood_white_corners(cropped, brand_rgba)
    master = square_on_brand(cropped, 1024, brand_rgba)
    hex_color = "#{:02X}{:02X}{:02X}".format(*brand)
    print(f"source={source.size} cropped={cropped.size} brand={hex_color}")

    icon = inset_on_canvas(master, 1024, 1.0, brand_rgba)
    adaptive_fg = inset_on_canvas(master, 1024, SAFE_ZONE, (0, 0, 0, 0))
    adaptive_bg = Image.new("RGBA", (1024, 1024), brand_rgba)
    splash = inset_on_canvas(master, 1024, SPLASH_SAFE_ZONE, (0, 0, 0, 0))
    mono = monochrome_chevron(master, 1024)
    favicon = inset_on_canvas(master, 48, 1.0, brand_rgba)

    save_png(icon, IMAGES / "icon.png")
    save_png(adaptive_fg, IMAGES / "android-icon-foreground.png")
    save_png(adaptive_bg, IMAGES / "android-icon-background.png")
    save_png(mono, IMAGES / "android-icon-monochrome.png")
    save_png(splash, IMAGES / "splash-icon.png")
    save_png(favicon, IMAGES / "favicon.png")

    densities = {
        "mdpi": 1,
        "hdpi": 1.5,
        "xhdpi": 2,
        "xxhdpi": 3,
        "xxxhdpi": 4,
    }
    for name, factor in densities.items():
        launcher = int(48 * factor)
        adaptive = int(108 * factor)
        splash_px = int(240 * factor)
        mipmap = RES / f"mipmap-{name}"
        drawable = RES / f"drawable-{name}"
        save_webp(icon.resize((launcher, launcher), Image.Resampling.LANCZOS), mipmap / "ic_launcher.webp")
        save_webp(circular_crop(icon, launcher), mipmap / "ic_launcher_round.webp")
        save_webp(inset_on_canvas(master, adaptive, SAFE_ZONE, (0, 0, 0, 0)), mipmap / "ic_launcher_foreground.webp")
        save_webp(Image.new("RGBA", (adaptive, adaptive), brand_rgba), mipmap / "ic_launcher_background.webp")
        save_webp(monochrome_chevron(master, adaptive), mipmap / "ic_launcher_monochrome.webp")
        save_png(inset_on_canvas(master, splash_px, SPLASH_SAFE_ZONE, (0, 0, 0, 0)), drawable / "splashscreen_logo.png")

    print("wrote expo assets and android mipmap/splash resources")


if __name__ == "__main__":
    main()
