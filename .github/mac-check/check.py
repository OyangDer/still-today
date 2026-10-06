"""The Mac CI check: drives a `--features probe` build through src/probe.rs and checks what the
Windows trial build's m2-check covers, plus what only the Mac has. Screenshots of every view land in
the folder given as the first argument. Exits 1 if any check fails.

Runs against the Windows trial build too (window levels, screenshots and the LaunchAgent are skipped
there), which is how it is debugged without a Mac.
"""
import glob
import json
import os
import socket
import subprocess
import sys
import time

MAC = sys.platform == "darwin"
SHOTS = sys.argv[1] if len(sys.argv) > 1 else "check-shots"
STORE = os.path.expanduser("~/Library/Application Support/app.stilltoday.widget") if MAC else os.environ.get("STORE", "")
# NSWindowLevel: below normal for a desktop widget, floating when kept on top.
BELOW, FLOATING = -1, 3
CAN_JOIN_ALL_SPACES = 1
MARGIN, STEP = 20, 24

results = []


def check(passed, label, detail=""):
    results.append(passed)
    print(f"{'PASS' if passed else 'FAIL'}  {label}  {detail}", flush=True)


def note(label, detail=""):
    print(f"NOTE  {label}  {detail}", flush=True)


class Probe:
    def __init__(self):
        deadline = time.time() + 60
        while True:
            try:
                self.sock = socket.create_connection(("127.0.0.1", 9334), timeout=20)
                break
            except OSError:
                if time.time() > deadline:
                    raise
                time.sleep(0.5)
        self.lines = self.sock.makefile("r", encoding="utf-8")

    def send(self, request):
        self.sock.sendall((json.dumps(request) + "\n").encode())
        return json.loads(self.lines.readline())

    def js(self, body):
        reply = self.send({"js": body})
        if not reply.get("ok"):
            raise RuntimeError(f"page: {reply.get('r')}")
        return reply["r"]

    def native(self, what, **args):
        return self.send({"native": what, **args})

    def call(self, m, p=None):
        return self.js(f"return await window.__TAURI__.core.invoke('bridge', {json.dumps({'m': m, 'p': p or {}})});")


def near(a, b, tolerance=1.0):
    return abs(a - b) <= tolerance


def on_grid(value, start, end, length):
    low, high = start + MARGIN, end - MARGIN - length
    steps = (value - low) / STEP
    return near(value, low) or near(value, high) or near(steps, round(steps), 0.01)


def shot(probe, name):
    if not MAC:
        return
    s = probe.native("state")
    pad = 24
    region = f"{s['x'] - pad:.0f},{s['y'] - pad:.0f},{s['w'] + 2 * pad:.0f},{s['h'] + 2 * pad:.0f}"
    subprocess.run(["screencapture", "-x", "-R", region, os.path.join(SHOTS, f"{name}.png")], check=False)


# Text that runs past the card's edge, and text the card has cut short with an ellipsis.
SPILL = """
const view = [...document.querySelectorAll('section.view.active')].filter(v => !v.inert).pop();
const box = (view ?? document.querySelector('.card')).getBoundingClientRect();
const spill = [], cut = [];
for (const el of document.querySelectorAll('.card *')) {
  if (el.childElementCount || !el.textContent.trim() || el.closest('[inert]')) continue;
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
  if (!r.width || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
  const inView = view && view.contains(el);
  const right = inView ? box.right : innerWidth;
  const text = el.textContent.trim().slice(0, 40);
  if (r.right > right + 1 || r.left < (inView ? box.left : 0) - 1) spill.push(`${text} [${Math.round(r.left)}..${Math.round(r.right)} of ${Math.round(right)}]`);
  if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) cut.push(text);
}
return { spill, cut };
"""

WINDOWS_WORDS = r"""
const text = document.querySelector('.card').innerText;
return (text.match(/[^\n]*(Windows|任务栏|托盘|taskbar|tray)[^\n]*/gi) ?? []);
"""


def views(probe):
    """Every main view, Settings and the menu: no spilled text, no Windows-only words."""
    names = ["overview", "focus", "calendar", "tasks"]
    stray = set()
    for i, name in enumerate(names):
        probe.js(f"document.querySelectorAll('[role=tab]')[{i}].click();")
        time.sleep(0.9)
        found = probe.js(SPILL)
        check(not found["spill"], f"{name}: text stays inside the card", "; ".join(found["spill"]))
        if found["cut"]:
            note(f"{name}: cut short with …", "; ".join(found["cut"]))
        stray.update(probe.js(WINDOWS_WORDS))
        shot(probe, f"{theme_name}-{name}")
    probe.js("document.querySelector('button.more').click();")
    time.sleep(0.5)
    stray.update(probe.js(WINDOWS_WORDS))
    shot(probe, f"{theme_name}-menu")
    probe.js("[...document.querySelectorAll('.menu button')].find(b => /设置|Settings/.test(b.textContent)).click();")
    time.sleep(1.2)
    found = probe.js(SPILL)
    check(not found["spill"], "settings: text stays inside the card", "; ".join(found["spill"]))
    if found["cut"]:
        note("settings: cut short with …", "; ".join(found["cut"]))
    stray.update(probe.js(WINDOWS_WORDS))
    shot(probe, f"{theme_name}-settings")
    probe.js("document.querySelector('.view.page .scroll, .view.page').scrollTop = 99999;")
    time.sleep(0.4)
    stray.update(probe.js(WINDOWS_WORDS))
    shot(probe, f"{theme_name}-settings-end")
    return stray


os.makedirs(SHOTS, exist_ok=True)
probe = Probe()
for _ in range(60):
    if probe.js("return document.querySelectorAll('[role=tab]').length") and probe.native("state")["visible"]:
        break
    time.sleep(0.5)
time.sleep(1.5)
boot = probe.call("boot")
state = probe.native("state")
work = state["work"]
note("system", f"scale {state['scale']}, work area {work}, glass {boot.get('glass')}, platform {boot.get('platform')}")

# First run: the primary display's top-right corner, inside the margin.
check(near(state["x"] + state["w"], work["x"] + work["w"] - MARGIN) and near(state["y"], work["y"] + MARGIN),
      "first run sits in the top-right corner", f"{state['x']:.0f},{state['y']:.0f} {state['w']:.0f}x{state['h']:.0f}")
if MAC:
    check(state["level"] == BELOW, "sits below other windows", f"level {state['level']}")
    check(state["behavior"] & CAN_JOIN_ALL_SPACES != 0, "on every Space", f"behavior {state['behavior']}")
check(boot.get("platform") == ("macos" if MAC else "windows") and boot.get("morph") is True, "boot reports the platform and the morph switch")

# Morph: Calendar is wide; the viewport, which is the window, passes through sizes on the way.
frames = probe.js("""
document.querySelectorAll('[role=tab]')[2].click();
const seen = [], end = performance.now() + 900;
while (performance.now() < end) { seen.push(`${innerWidth}x${innerHeight}`); await new Promise(requestAnimationFrame); }
return [...new Set(seen)];
""")
after = probe.native("state")
check(len(frames) > 5 and frames[-1] == "440x600" and near(after["w"], 440) and near(after["h"], 600),
      "morph to 440x600 in steps", f"{len(frames)} sizes: {' '.join(frames[:4])} … {frames[-1]}")
probe.js("document.querySelectorAll('[role=tab]')[0].click();")
time.sleep(0.9)

# A drop off the grid glides onto it and is remembered.
probe.native("move", x=work["x"] + 333.3, y=work["y"] + 217.7)
time.sleep(0.4)
before = probe.native("state")
probe.native("settle")
time.sleep(0.9)
s = probe.native("state")
saved = json.load(open(os.path.join(STORE, "window.json"))) if STORE else {}
check(on_grid(s["x"], work["x"], work["x"] + work["w"], s["w"]) and on_grid(s["y"], work["y"], work["y"] + work["h"], s["h"])
      and near(saved.get("x", -1), s["x"]) and near(saved.get("y", -1), s["y"]),
      "drop settles on the 24pt grid and is saved", f"{before['x']:.1f},{before['y']:.1f} → {s['x']:.1f},{s['y']:.1f}, window.json {saved}")

# Keep on top, and back under.
probe.call("topmost", {"on": True})
time.sleep(0.4)
top = probe.native("state")["level"]
probe.call("topmost", {"on": False})
time.sleep(0.4)
under = probe.native("state")["level"]
if MAC:
    check(top == FLOATING and under == BELOW, "keep on top and back", f"levels {top} → {under}")

# Waking from sleep reaches the page.
probe.js("window.__wakes = 0; await window.__TAURI__.event.listen('host', e => { if (e.payload.ev === 'wake') window.__wakes++; });")
probe.native("wake")
time.sleep(0.6)
wakes = probe.js("return window.__wakes")
if MAC:
    check(wakes == 1, "a wake reaches the page", f"{wakes} wake event(s)")

# Open at login: a LaunchAgent appears, and goes again.
if MAC:
    agents = lambda: set(glob.glob(os.path.expanduser("~/Library/LaunchAgents/*.plist")))
    had = agents()
    on = probe.call("autostart", {"on": True})
    added = agents() - had
    content = open(next(iter(added))).read() if added else ""
    off = probe.call("autostart", {"on": False})
    check(on is True and off is False and len(added) == 1 and "--autostart" in content and not (agents() - had),
          "open at login adds and removes a LaunchAgent", f"{[os.path.basename(a) for a in added]}")

# The morph switch is kept.
probe.call("morph.set", {"on": False})
kept = probe.call("boot").get("morph")
probe.call("morph.set", {"on": True})
check(kept is False, "morph switch is kept")

# Hide from the page's menu, show again from the menu bar's.
probe.call("hide")
time.sleep(0.4)
hidden = not probe.native("state")["visible"]
probe.native("show")
time.sleep(0.6)
s = probe.native("state")
check(hidden and s["visible"] and (not MAC or s["level"] == BELOW), "hide and show again", f"level {s['level']}")

# Every view in the default theme and in Dark.
theme_name = "aura"
stray = views(probe)
probe.js("[...document.querySelectorAll('.theme')].find(b => /深色|Dark/.test(b.textContent)).click();")
time.sleep(0.8)
probe.js("document.querySelector('.back')?.click();")
time.sleep(0.6)
theme_name = "dark"
stray |= views(probe)
probe.js("[...document.querySelectorAll('.theme')].find(b => /Aura/.test(b.textContent)).click();")
check(not stray, "no Windows-only words on the Mac" if MAC else "Windows words (expected on Windows)", "; ".join(sorted(stray)))

failed = results.count(False)
print(f"\n{len(results) - failed} passed, {failed} failed", flush=True)
sys.exit(1 if failed and MAC else 0)
