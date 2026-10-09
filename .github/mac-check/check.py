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
# NSWindowLevel: below normal for a desktop widget, above normal when kept on top (tao sets 5, the
# status level, not floating's 3; anything above 0 keeps it over other windows).
BELOW, NORMAL = -1, 0
CAN_JOIN_ALL_SPACES = 1
TRANSIENT, STATIONARY = 1 << 3, 1 << 4
# The grid a dropped widget settles on: on the Mac the system's own widget grid, 16pt in from the
# desktop's edges in 180pt steps counted from the nearer edge; on Windows 20pt in, in 24pt steps.
MARGIN, STEP = (16, 180) if MAC else (20, 24)

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
    if MAC:
        return any(near(steps, round(steps), 0.01) for steps in ((value - low) / STEP, (high - value) / STEP))
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
    # Opened by hand it comes forward, and goes under other windows once another app is in front.
    subprocess.run(["osascript", "-e", 'tell application "Finder" to activate'], check=False)
    time.sleep(1)
    under = probe.native("state")["level"]
    check(state["level"] == NORMAL and under == BELOW, "comes forward, then sits below other windows",
          f"levels {state['level']} → {under}")
    check(state["behavior"] & CAN_JOIN_ALL_SPACES != 0, "on every Space", f"behavior {state['behavior']}")
    behind = probe.native("state")["behavior"]
    check(all(b & TRANSIENT and not b & STATIONARY for b in (state["behavior"], behind)), "hidden by Mission Control, like the system's widgets",
          f"behavior {state['behavior']} → {behind}")
    # What Mission Control and Show Desktop do to it, recorded: the window as the Window Server
    # lists it, and the screen. Not checks; the runner's Dock may not run them as a Mac at a desk does.
    MC = "/System/Applications/Mission Control.app/Contents/MacOS/Mission Control"
    ONSCREEN = """ObjC.import('CoreGraphics');
JSON.stringify(ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0)))
  .filter(w => /still-today|Still Today/.test(w.kCGWindowOwnerName)).map(w => [w.kCGWindowLayer, w.kCGWindowAlpha, w.kCGWindowBounds]))"""
    def sweep(tag):
        for name, args in (("mission-control", []), ("show-desktop", ["1"])):
            subprocess.run([MC, *args], check=False)
            time.sleep(2)
            listed = subprocess.run(["osascript", "-l", "JavaScript", "-e", ONSCREEN], capture_output=True, text=True).stdout.strip()
            subprocess.run(["screencapture", "-x", os.path.join(SHOTS, f"{tag}{name}.png")], check=False)
            s = probe.native("state")
            note(f"{tag}{name}", f"level {s['level']} behavior {s['behavior']}; listed {listed}")
            subprocess.run([MC, *args], check=False)
            time.sleep(2)
    sweep("")
    # Other ways of being hidden by Mission Control while kept through Show Desktop, tried in turn.
    DESKTOP_ICONS = -2147483648 + 40
    for tag, behave in (("icons-transient-", {"level": DESKTOP_ICONS, "behavior": CAN_JOIN_ALL_SPACES | TRANSIENT}),
                        ("icons-stationary-", {"level": DESKTOP_ICONS, "behavior": CAN_JOIN_ALL_SPACES | STATIONARY}),
                        ("both-", {"level": BELOW, "behavior": CAN_JOIN_ALL_SPACES | TRANSIENT | STATIONARY})):
        probe.native("behave", **behave)
        time.sleep(0.5)
        sweep(tag)
    probe.native("show")
    time.sleep(0.6)
check(boot.get("platform") == ("macos" if MAC else "windows") and boot.get("morph") is True, "boot reports the platform and the morph switch")

# Morph: Calendar is wide; the viewport, which is the window, passes through sizes on the way. With
# Reduce Motion on it jumps there at once, as it should.
reduced = probe.js("return matchMedia('(prefers-reduced-motion: reduce)').matches")
frames = probe.js("""
document.querySelectorAll('[role=tab]')[2].click();
const seen = [], end = performance.now() + 900;
while (performance.now() < end) { seen.push(`${innerWidth}x${innerHeight}`); await new Promise(requestAnimationFrame); }
return [...new Set(seen)];
""")
after = probe.native("state")
check((len(frames) == 2 if reduced else len(frames) > 5) and frames[-1] == "440x600" and near(after["w"], 440) and near(after["h"], 600),
      "morph to 440x600 at once (Reduce Motion)" if reduced else "morph to 440x600 in steps", f"{len(frames)} sizes: {' '.join(frames[:4])} … {frames[-1]}")
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
# The Mac's grid runs down to the display's foot, behind the Dock, as the system's widgets do.
screen = s.get("screen") or work
desk = {"x": screen["x"], "y": work["y"], "w": screen["w"], "h": screen["y"] + screen["h"] - work["y"]} if MAC else work
check(on_grid(s["x"], desk["x"], desk["x"] + desk["w"], s["w"]) and on_grid(s["y"], desk["y"], desk["y"] + desk["h"], s["h"])
      and near(saved.get("x", -1), s["x"]) and near(saved.get("y", -1), s["y"]),
      f"drop settles on the {STEP}pt grid and is saved", f"{before['x']:.1f},{before['y']:.1f} → {s['x']:.1f},{s['y']:.1f}, window.json {saved}")

# Keep on top, and back under.
probe.call("topmost", {"on": True})
time.sleep(0.4)
top = probe.native("state")["level"]
probe.call("topmost", {"on": False})
time.sleep(0.4)
under = probe.native("state")["level"]
if MAC:
    check(top > NORMAL and under == BELOW, "keep on top and back", f"levels {top} → {under}")

# Waking from sleep reaches the page.
probe.js("window.__wakes = 0; await window.__TAURI__.event.listen('host', e => { if (e.payload.ev === 'wake') window.__wakes++; });")
probe.native("wake")
time.sleep(0.6)
wakes = probe.js("return window.__wakes")
if MAC:
    check(wakes == 1, "a wake reaches the page", f"{wakes} wake event(s)")

# Open at login: a first run turns it on (state.svelte.ts), Settings turns it off and on again.
if MAC:
    plist = os.path.expanduser("~/Library/LaunchAgents/Still Today.plist")
    first = os.path.exists(plist)
    off = probe.call("autostart", {"on": False})
    gone = not os.path.exists(plist)
    on = probe.call("autostart", {"on": True})
    content = open(plist).read() if os.path.exists(plist) else ""
    check(first and off is False and gone and on is True and "--autostart" in content and "still-today" in content,
          "open at login: on after first run, off and on again", f"first {first}, off {off}, removed {gone}, on {on}")

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

# Every view in the default look (Aura, following the system) and in solid Dark.
theme_name = "aura"
stray = views(probe)
probe.js("const a = document.querySelector('.toggle.aurora'); if (a.getAttribute('aria-checked') === 'true') a.click(); [...document.querySelectorAll('.theme')].find(b => /深色|Dark/.test(b.textContent)).click();")
time.sleep(0.8)
probe.js("document.querySelector('.back')?.click();")
time.sleep(0.6)
theme_name = "dark"
stray |= views(probe)
probe.js("const a = document.querySelector('.toggle.aurora'); if (a && a.getAttribute('aria-checked') !== 'true') a.click(); [...document.querySelectorAll('.theme')].find(b => /跟随系统|System/.test(b.textContent))?.click();")
check(not stray, "no Windows-only words on the Mac" if MAC else "Windows words (expected on Windows)", "; ".join(sorted(stray)))

failed = results.count(False)
print(f"\n{len(results) - failed} passed, {failed} failed", flush=True)
sys.exit(1 if failed and MAC else 0)
