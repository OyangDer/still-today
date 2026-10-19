"""Screenshots of the card in each look: Aura and the solid themes, with the system light and dark. On
macOS 26 Aura is Liquid Glass, airy or Mist; on 13 to 15 it is the Popover material under Aura's
Windows look, with the page's own tab pill. Runs after check.py against the same probe build; nothing
here is checked. The shots, and what the page said about each look and how smoothly it morphed in
looks.json, land in the folder given as the first argument.
"""
import json
import os
import socket
import struct
import subprocess
import sys
import time
import zlib

SHOTS = sys.argv[1] if len(sys.argv) > 1 else "looks"

# What the page draws by, for each look.
PAGE = """
const root = document.documentElement, cs = getComputedStyle(root);
const vars = Object.fromEntries(['--scrim', '--aura-fill', '--sheen', '--edge', '--muted'].map(v => [v, cs.getPropertyValue(v).trim()]));
const card = document.querySelector('.card');
return { ...root.dataset, ...vars, card: card && getComputedStyle(card).backgroundColor,
         pill: getComputedStyle(document.querySelector('.band .pill')).visibility };
"""

# How smoothly the page draws in this look: frames a second while still, then the morph to Calendar,
# its frames, the sizes the window passed through and how long it took to get there.
MORPH = """
const still = performance.now() + 1000;
let idle = 0;
while (performance.now() < still) { await new Promise(requestAnimationFrame); idle++; }
document.querySelectorAll('[role=tab]')[2].click();
const start = performance.now(), sizes = [];
let frames = 0, ms = null;
while (performance.now() - start < 3000 && (ms === null || performance.now() - start < ms + 300)) {
  await new Promise(requestAnimationFrame);
  frames++;
  const size = `${innerWidth}x${innerHeight}`;
  if (sizes.at(-1) !== size) sizes.push(size);
  if (size === '440x600' && ms === null) ms = Math.round(performance.now() - start);
}
return { idle, frames, sizes: sizes.length, ms };
"""


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
    """Bands of colour, and black and white stripes between them, the same on every system: a runner's
    desktop is plain black, behind which no material shows what it does."""
    palette = [(255, 69, 58), (255, 204, 0), (0, 122, 255), (52, 199, 89), (175, 82, 222), (250, 250, 252)]
    rows = bytearray()
    for y in range(h):
        rows.append(0)
        stripes = (y // 96) % 3 == 2
        for x in range(w):
            rows += bytes(((0, 0, 0) if x // 16 % 2 else (255, 255, 255)) if stripes else palette[(x + y) // 80 % len(palette)])
    chunk = lambda kind, data: struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    with open(path, "wb") as f:
        f.write(bytes.fromhex("89504e470d0a1a0a") + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(bytes(rows), 6)) + chunk(b"IEND", b""))


def system_dark(on):
    subprocess.run(["osascript", "-e", f'tell application "System Events" to tell appearance preferences to set dark mode to {str(on).lower()}'],
                   check=False)


def look(probe, aura, mode, glass=None):
    """Aura on or off, the theme by its name, and with Liquid Glass airy or Mist, all from Settings."""
    probe.js("document.querySelector('.back')?.click();")
    time.sleep(0.6)
    probe.js("document.querySelector('button.more').click();")
    time.sleep(0.5)
    probe.js("[...document.querySelectorAll('.menu button')].find(b => /设置|Settings/.test(b.textContent)).click();")
    time.sleep(1.2)
    probe.js(f"const a = document.querySelector('.toggle.aurora'); if ((a.getAttribute('aria-checked') === 'true') !== {str(aura).lower()}) a.click();")
    time.sleep(0.3)
    probe.js(f"[...document.querySelectorAll('.theme')].find(b => {mode}.test(b.querySelector('.theme-name').textContent.trim())).click();")
    if glass:
        time.sleep(0.3)
        probe.js(f"[...document.querySelectorAll('.seg [role=radio]')].find(b => {glass}.test(b.textContent.trim()))?.click();")
    time.sleep(0.8)
    shown = probe.js("return [...document.querySelectorAll('.settings .line > span')].map(s => s.textContent.trim())")
    probe.js("document.querySelector('.back')?.click();")
    time.sleep(0.8)
    return shown


def shot(probe, name, pad=24):
    s = probe.send({"native": "state"})
    region = f"{s['x'] - pad:.0f},{s['y'] - pad:.0f},{s['w'] + 2 * pad:.0f},{s['h'] + 2 * pad:.0f}"
    subprocess.run(["screencapture", "-x", "-R", region, os.path.join(SHOTS, f"{name}.png")], check=False)


os.makedirs(SHOTS, exist_ok=True)
paper = os.path.abspath(os.path.join(SHOTS, "wallpaper.png"))
wallpaper(paper)
subprocess.run(["osascript", "-e", f'tell application "System Events" to tell every desktop to set picture to "{paper}"'], check=False)
time.sleep(3)
probe = Probe()
liquid = probe.js("return await window.__TAURI__.core.invoke('bridge', { m: 'boot', p: {} })").get("liquid")
LIGHT, DARK, SYSTEM = "/^(浅色|Light)$/", "/^(深色|Dark)$/", "/^(跟随系统|System)$/"
LOOKS = [
    # (name, system dark, Aura, theme, glass)
    ("aura-light", False, True, SYSTEM, "/^(通透|Airy)$/" if liquid else None),
    ("aura-dark", True, True, SYSTEM, "/^(通透|Airy)$/" if liquid else None),
    ("light", False, False, LIGHT, None),
    ("dark", True, False, DARK, None),
]
if liquid:
    LOOKS += [("mist-light", False, True, SYSTEM, "/^(柔雾|Mist)$/"), ("mist-dark", True, True, SYSTEM, "/^(柔雾|Mist)$/")]
report = {"liquid": liquid}
for name, dark, aura, mode, glass in LOOKS:
    system_dark(dark)
    time.sleep(2)
    settings = look(probe, aura, mode, glass)
    probe.js("document.querySelectorAll('[role=tab]')[0].click();")
    time.sleep(1.2)
    shot(probe, f"{name}-overview")
    morph = probe.js(MORPH)
    time.sleep(0.6)
    shot(probe, f"{name}-calendar")
    report[name] = {"settings": settings, "page": probe.js(PAGE), "morph": morph, "window": probe.send({"native": "state"})}
    print(name, json.dumps(report[name]["page"]), flush=True)
    print(name, "morph", json.dumps(morph), flush=True)
    probe.js("document.querySelectorAll('[role=tab]')[0].click();")
    time.sleep(0.9)

# Back to the default: Aura, following the system, which is light, airy where there is Liquid Glass.
system_dark(False)
time.sleep(1)
look(probe, True, SYSTEM, "/^(通透|Airy)$/" if liquid else None)
json.dump(report, open(os.path.join(SHOTS, "looks.json"), "w"), ensure_ascii=False, indent=1)
