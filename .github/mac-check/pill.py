"""A screen recording of the tab bar with Apple's Liquid Glass as the selection pill, the widget
itself in Liquid Glass at the larger corner, light and then dark, over one of the Mac's own
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
  const ms = last === undefined ? 0 : 420;
  last = key;
  window.__TAURI__.core.invoke('bridge', { m: 'probe.pill', p: { x, ms, show } });
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
probe.js("[...document.querySelectorAll('.theme')].find(b => /Aura/.test(b.textContent))?.click();")
probe.js("document.querySelector('.back')?.click();")
time.sleep(0.6)
tab(probe, 0)
time.sleep(1)
probe.send({"native": "move", "x": 330, "y": 170})
time.sleep(0.8)
print("follow", probe.js(FOLLOW), flush=True)
print("pill", probe.send({"native": "pill", "x": 0, "ms": 0, "show": True}), flush=True)

for look in ["light", "dark"]:
    osascript(f'tell application "System Events" to tell appearance preferences to set dark mode to {str(look == "dark").lower()}')
    time.sleep(2.5)
    print(look, probe.send({"native": "material", "name": "glass", "dark": look == "dark", "radius": RADIUS}), flush=True)
    ink = "light" if look == "dark" else "dark"
    probe.js(f"const r = document.documentElement; r.dataset.ink = '{ink}'; "
             "r.style.setProperty('--scrim', 'transparent'); r.style.setProperty('--sheen', 'none');")
    tab(probe, 0)
    time.sleep(1.5)
    seconds = 2 + 1.6 * len(ROUTE)
    video = os.path.join(SHOTS, f"tabs-{look}.mov")
    recorder = subprocess.Popen(["screencapture", "-x", "-v", "-V", str(int(seconds) + 1), video])
    time.sleep(1.5)
    for step, i in enumerate(ROUTE):
        tab(probe, i)
        # Mid-move and settled stills of the first few hops.
        if step < 3:
            time.sleep(0.12)
            subprocess.run(["screencapture", "-x", "-R", region(probe), os.path.join(SHOTS, f"{look}-{step}-moving.png")], check=False)
            time.sleep(1.0)
            subprocess.run(["screencapture", "-x", "-R", region(probe), os.path.join(SHOTS, f"{look}-{step}-settled.png")], check=False)
            time.sleep(0.4)
        else:
            time.sleep(1.6)
    recorder.wait(timeout=60)
    print(look, "recorded", os.path.exists(video), flush=True)
osascript('tell application "System Events" to tell appearance preferences to set dark mode to false')
