"""Screenshots of the widget in Liquid Glass variants, light and dark, over one of the Mac's own
wallpapers and over a hard-edged one that shows the glass bending what is behind it. Runs after check.py against the same probe build; nothing here is checked.
The shots land in the folder given as the first argument.
"""
import json
import math
import os
import socket
import struct
import subprocess
import sys
import time
import zlib

SHOTS = sys.argv[1] if len(sys.argv) > 1 else "materials"
# (label, material, tint). Each is drawn at the larger corner of the Mac's own widgets, with the
# page's scrim and sheen taken off so the glass is all there is.
VARIANTS = [
    ("popover", "popover", None),
    ("glass", "glass", None),
    ("glass-tint", "glass", [40, 100, 170, 70]),
    ("clear", "glass-clear", None),
    ("clear-dim", "glass-clear", [0, 0, 0, 60]),
]
RADIUS = 22


class Probe:
    def __init__(self):
        self.sock = socket.create_connection(("127.0.0.1", 9334), timeout=20)
        self.lines = self.sock.makefile("r", encoding="utf-8")

    def send(self, request):
        self.sock.sendall((json.dumps(request) + "\n").encode())
        return json.loads(self.lines.readline())

    def js(self, body):
        return self.send({"js": body}).get("r")


def crisp(path, w=1024, h=768):
    """Hard-edged discs and bars on a light ground: whatever the glass bends shows at its edges."""
    shapes = [(260, 260, 150, (255, 69, 58)), (700, 220, 120, (255, 204, 0)), (520, 470, 170, (0, 122, 255)),
              (850, 560, 140, (52, 199, 89)), (180, 620, 110, (175, 82, 222))]
    rows = bytearray()
    for y in range(h):
        rows.append(0)
        for x in range(w):
            colour = (236, 238, 242) if (x // 64 + y // 64) % 2 else (250, 250, 252)
            if (y // 24) % 6 == 0 and x % 512 < 380:
                colour = (28, 28, 30)
            for cx, cy, r, c in shapes:
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                    colour = c
            rows += bytes(colour)
    chunk = lambda kind, data: struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    with open(path, "wb") as f:
        f.write(bytes.fromhex("89504e470d0a1a0a") + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(bytes(rows), 6)) + chunk(b"IEND", b""))


def apple_wallpaper():
    """The first of the Mac's own wallpapers that is a picture rather than a plain colour."""
    found = []
    for folder in ["/System/Library/Desktop Pictures", "/Library/Desktop Pictures"]:
        for root, _, files in os.walk(folder):
            found += [os.path.join(root, f) for f in files if f.lower().endswith((".heic", ".jpg", ".png"))]
    print("system wallpapers", found[:30], flush=True)
    pictures = [f for f in found if "Solid Colors" not in f and "thumbnail" not in f.lower()]
    return pictures[0] if pictures else None


def osascript(script):
    return subprocess.run(["osascript", "-e", script], capture_output=True, text=True)


def shot(probe, name):
    s = probe.send({"native": "state"})
    pad = 40
    region = f"{s['x'] - pad:.0f},{s['y'] - pad:.0f},{s['w'] + 2 * pad:.0f},{s['h'] + 2 * pad:.0f}"
    subprocess.run(["screencapture", "-x", "-R", region, os.path.join(SHOTS, f"{name}.png")], check=False)


os.makedirs(SHOTS, exist_ok=True)
papers = []
apple = apple_wallpaper()
if apple:
    papers.append(("apple", apple))
hard = os.path.abspath(os.path.join(SHOTS, "crisp.png"))
crisp(hard)
papers.append(("crisp", hard))

probe = Probe()
probe.js("document.querySelector('.back')?.click();")
time.sleep(0.6)
probe.js("[...document.querySelectorAll('.theme')].find(b => /Aura/.test(b.textContent))?.click();")
probe.js("document.querySelector('.back')?.click();")
time.sleep(0.6)
probe.js("document.querySelectorAll('[role=tab]')[0].click();")
time.sleep(1)
probe.send({"native": "move", "x": 330, "y": 170})
time.sleep(0.8)

for paper_name, paper in papers:
    result = osascript(f'tell application "System Events" to tell every desktop to set picture to "{paper}"')
    print("wallpaper", paper_name, paper, result.returncode, result.stderr.strip(), flush=True)
    time.sleep(3)
    for look in ["light", "dark"]:
        osascript(f'tell application "System Events" to tell appearance preferences to set dark mode to {str(look == "dark").lower()}')
        time.sleep(2.5)
        ink = "light" if look == "dark" else "dark"
        for label, name, tint in VARIANTS:
            request = {"native": "material", "name": name, "dark": look == "dark", "radius": RADIUS}
            if tint:
                request["tint"] = tint
            print(paper_name, look, label, probe.send(request), flush=True)
            probe.js(f"const r = document.documentElement; r.dataset.ink = '{ink}'; "
                     "r.style.setProperty('--scrim', 'transparent'); r.style.setProperty('--sheen', 'none');")
            time.sleep(1.2)
            shot(probe, f"{paper_name}-{look}-{label}")
        # The Dock and menu bar are the system's own glass, to hold the widget against.
        subprocess.run(["screencapture", "-x", os.path.join(SHOTS, f"{paper_name}-{look}-desktop.png")], check=False)
osascript('tell application "System Events" to tell appearance preferences to set dark mode to false')
