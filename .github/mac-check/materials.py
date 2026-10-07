"""Screenshots of the widget over a colourful wallpaper in each Mac material, light and dark, for
choosing the Aura glass. Runs after check.py against the same probe build; nothing here is checked.
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
MATERIALS = ["popover", "sidebar", "hud", "under-window", "glass", "glass-clear"]


class Probe:
    def __init__(self):
        self.sock = socket.create_connection(("127.0.0.1", 9334), timeout=20)
        self.lines = self.sock.makefile("r", encoding="utf-8")

    def send(self, request):
        self.sock.sendall((json.dumps(request) + "\n").encode())
        return json.loads(self.lines.readline())

    def js(self, body):
        return self.send({"js": body}).get("r")


def wallpaper(path, w=1024, h=768):
    """A busy sunset of soft colour blobs, so what each material lets through shows."""
    blobs = [(0.15, 0.2, 0.35, (255, 94, 58)), (0.75, 0.15, 0.4, (255, 196, 0)), (0.5, 0.6, 0.45, (214, 36, 159)),
             (0.9, 0.75, 0.35, (40, 120, 255)), (0.2, 0.9, 0.35, (0, 190, 150)), (0.62, 0.35, 0.18, (255, 255, 255))]
    rows = bytearray()
    for y in range(h):
        rows.append(0)
        for x in range(w):
            u, v = x / w, y / h
            r, g, b, total = 30.0, 20.0, 60.0, 1.0
            for bx, by, size, (cr, cg, cb) in blobs:
                weight = 4 * math.exp(-((u - bx) ** 2 + (v - by) ** 2) / (size * size * 0.18))
                r, g, b, total = r + cr * weight, g + cg * weight, b + cb * weight, total + weight
            stripe = 18 if (x + y) // 40 % 2 else 0
            rows += bytes((min(255, int(r / total) + stripe), min(255, int(g / total) + stripe), min(255, int(b / total) + stripe)))
    chunk = lambda kind, data: struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(bytes(rows), 6)) + chunk(b"IEND", b""))


def osascript(script):
    return subprocess.run(["osascript", "-e", script], capture_output=True, text=True)


def shot(probe, name):
    s = probe.send({"native": "state"})
    pad = 40
    region = f"{s['x'] - pad:.0f},{s['y'] - pad:.0f},{s['w'] + 2 * pad:.0f},{s['h'] + 2 * pad:.0f}"
    subprocess.run(["screencapture", "-x", "-R", region, os.path.join(SHOTS, f"{name}.png")], check=False)


os.makedirs(SHOTS, exist_ok=True)
paper = os.path.abspath(os.path.join(SHOTS, "wallpaper.png"))
wallpaper(paper)
set_paper = osascript(f'tell application "System Events" to tell every desktop to set picture to "{paper}"')
print("wallpaper", set_paper.returncode, set_paper.stderr.strip(), flush=True)
time.sleep(3)

probe = Probe()
probe.js("document.querySelector('.back')?.click();")
time.sleep(0.6)
probe.js("[...document.querySelectorAll('.theme')].find(b => /Aura/.test(b.textContent))?.click();")
probe.js("document.querySelector('.back')?.click();")
time.sleep(0.6)
probe.js("document.querySelectorAll('[role=tab]')[0].click();")
time.sleep(1)
print("boot", probe.js("return await window.__TAURI__.core.invoke('bridge', {m: 'boot', p: {}}).then(b => ({glass: b.glass}))"), flush=True)
probe.send({"native": "move", "x": 330, "y": 170})
time.sleep(0.8)

# The page lays a scrim over the material for contrast. Without a wallpaper sample the Mac build
# assumes black behind it and lays the most ("now"); "thin" is the least the Windows build uses;
# "none" is the material alone.
SCRIMS = {"light": [("now", 0.88), ("thin", 0.34), ("none", 0)], "dark": [("now", 0.88), ("thin", 0.30), ("none", 0)]}
COLOURS = {"light": "245, 249, 252", "dark": "16, 24, 32"}
for look in ["light", "dark"]:
    osascript(f'tell application "System Events" to tell appearance preferences to set dark mode to {str(look == "dark").lower()}')
    time.sleep(2.5)
    subprocess.run(["screencapture", "-x", os.path.join(SHOTS, f"{look}-desktop.png")], check=False)
    ink = "light" if look == "dark" else "dark"
    for name in MATERIALS:
        print(look, name, probe.send({"native": "material", "name": name, "dark": look == "dark"}), flush=True)
        for label, alpha in SCRIMS[look]:
            probe.js(f"const r = document.documentElement; r.dataset.ink = '{ink}'; r.style.setProperty('--scrim', 'rgba({COLOURS[look]}, {alpha})');")
            time.sleep(1)
            shot(probe, f"{look}-{label}-{name}")
osascript('tell application "System Events" to tell appearance preferences to set dark mode to false')
