"""A screen recording of the tab bar with Apple's Liquid Glass as the selection pill, the widget
itself in Liquid Glass at the larger corner, in light mode, over one of the Mac's own
wallpapers. Runs after check.py against the same probe build; nothing here is checked.
The recordings and stills land in the folder given as the first argument.
"""
import json
import os
import socket
import subprocess
import sys
import time

SHOTS = sys.argv[1] if len(sys.argv) > 1 else "pill"
RADIUS = 22
# Tabs to visit, one hop and long jumps both ways.
ROUTE = [1, 2, 3, 0, 3, 1, 0, 2, 0]
# Follows the page's own pill, which lands at its target at once (motion.follow sets the end
# transform first), and hands each move to the native glass. The page's pill and the bar's ground
# are hidden so the glass is all there is.
FOLLOW = """
const style = document.createElement('style');
style.textContent = '.band { background: transparent !important; border-top-color: transparent !important; } .band .pill { visibility: hidden; }';
document.head.append(style);
const pill = document.querySelector('.band .pill'), band = pill.parentElement;
let last;
const send = () => {
  const m = /translate3d\\(([-\\d.]+)px/.exec(pill.style.transform);
  const x = m ? +m[1] : 0, show = !band.classList.contains('away'), key = x + '|' + show;
  if (key === last) return;
  const ms = last === undefined ? 0 : 420, look = window.__pill ?? { native: true, style: 'plain' };
  last = key;
  window.__TAURI__.core.invoke('bridge', { m: 'probe.pill', p: { x, ms, show: show && look.native, style: look.style } });
};
new MutationObserver(send).observe(pill, { attributes: true, attributeFilter: ['style'] });
new MutationObserver(send).observe(band, { attributes: true, attributeFilter: ['class'] });
send();
return pill.style.transform;
"""


class Probe:
    def __init__(self):
        self.sock = socket.create_connection(("127.0.0.1", 9334), timeout=20)
        self.lines = self.sock.makefile("r", encoding="utf-8")

    def send(self, request):
        self.sock.sendall((json.dumps(request) + "\n").encode())
        return json.loads(self.lines.readline())

    def js(self, body):
        return self.send({"js": body})


def osascript(script):
    return subprocess.run(["osascript", "-e", script], capture_output=True, text=True)


def apple_wallpaper():
    found = []
    for folder in ["/System/Library/Desktop Pictures", "/Library/Desktop Pictures"]:
        for root, _, files in os.walk(folder):
            found += [os.path.join(root, f) for f in files if f.lower().endswith((".heic", ".jpg", ".png"))]
    pictures = [f for f in found if "Solid Colors" not in f and "thumbnail" not in f.lower()]
    return pictures[0] if pictures else None


def region(probe, pad=40):
    s = probe.send({"native": "state"})
    return f"{s['x'] - pad:.0f},{s['y'] - pad:.0f},{s['w'] + 2 * pad:.0f},{s['h'] + 2 * pad:.0f}"


def tab(probe, i):
    probe.js(f"document.querySelectorAll('[role=tab]')[{i}].click();")


os.makedirs(SHOTS, exist_ok=True)
probe = Probe()
paper = apple_wallpaper()
if paper:
    print("wallpaper", paper, osascript(f'tell application "System Events" to tell every desktop to set picture to "{paper}"').returncode, flush=True)
    time.sleep(3)
probe.js("document.querySelector('.back')?.click();")
time.sleep(0.6)
probe.js("const a = document.querySelector('.toggle.aurora'); if (a && a.getAttribute('aria-checked') !== 'true') a.click(); [...document.querySelectorAll('.theme')].find(b => /跟随系统|System/.test(b.textContent))?.click();")
probe.js("document.querySelector('.back')?.click();")
time.sleep(0.6)
tab(probe, 0)
time.sleep(1)
probe.send({"native": "move", "x": 330, "y": 170})
time.sleep(0.8)
print("follow", probe.js(FOLLOW), flush=True)
print("pill", probe.send({"native": "pill", "x": 0, "ms": 0, "show": True}), flush=True)

# (label, native glass?, its motion, window morph?). The page's CSS pill is the baseline: if it
# stutters too, the runner is the cause and not the glass.
VARIANTS = [
    ("glass", True, "plain", True, "glass", RADIUS),
    ("css", False, "plain", True, "glass", RADIUS),
    ("glass-nomorph", True, "plain", False, "glass", RADIUS),
    # What testers have now: the Popover material at the smaller corner, the page's own pill.
    ("shipped", False, "plain", True, "popover", 11),
]
FRAMES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frames.swift")
for label, native, style, morph, material, radius in VARIANTS:
    print(label, probe.send({"native": "material", "name": material, "dark": False, "radius": radius}), flush=True)
    probe.js("const r = document.documentElement; r.dataset.ink = 'dark'; "
             "r.style.setProperty('--scrim', 'transparent'); r.style.setProperty('--sheen', 'none');")
    probe.js(f"window.__pill = {{ native: {str(native).lower()}, style: '{style}' }}; "
             f"document.querySelector('.band .pill').style.visibility = '{'hidden' if native else 'visible'}'; "
             f"await window.__TAURI__.core.invoke('bridge', {{ m: 'morph.set', p: {{ on: {str(morph).lower()} }} }});")
    tab(probe, 0)
    time.sleep(1.5)
    video = os.path.join(SHOTS, f"tabs-{label}.mov")
    began = time.time()
    recorder = subprocess.Popen(["screencapture", "-x", "-v", "-V", str(int(2 + 1.6 * len(ROUTE)) + 1), video])
    time.sleep(1.5)
    clicks = []
    for i in ROUTE:
        clicks.append(time.time() - began)
        tab(probe, i)
        time.sleep(1.6)
    recorder.wait(timeout=60)
    print(label, "recorded", os.path.exists(video), "clicks", [round(c, 2) for c in clicks], flush=True)
    # Frame by frame at 60 a second across the hops where the window changes size: Focus to
    # Calendar, which grows it, and Calendar to Tasks.
    for hop in (1, 2):
        strip = os.path.join(SHOTS, "frames", f"{label}-{hop}")
        os.makedirs(strip, exist_ok=True)
        result = subprocess.run(["swift", FRAMES, video, os.path.join(strip, "f"), str(clicks[hop] - 0.3), "60", str(1 / 60)],
                                capture_output=True, text=True)
        print(label, hop, "frames", result.returncode, len(os.listdir(strip)), flush=True)
probe.js("await window.__TAURI__.core.invoke('bridge', { m: 'morph.set', p: { on: true } });")
