"""The Mac CI check: drives a `--features probe` build through src/probe.rs and checks what the
Windows trial build's m2-check covers, plus what only the Mac has. Screenshots of every view land in
the folder given as the first argument. Exits 1 if any check fails.

Runs against the Windows trial build too (window levels, screenshots and the LaunchAgent are skipped
there), which is how it is debugged without a Mac.
"""
import glob
import json
import os
import platform
import re
import socket
import subprocess
import sys
import time

MAC = sys.platform == "darwin"
SHOTS = sys.argv[1] if len(sys.argv) > 1 else "check-shots"
STORE = os.path.expanduser("~/Library/Application Support/app.stilltoday.widget") if MAC else os.environ.get("STORE", "")
# NSWindowLevel: just under other windows for a desktop widget, above normal when kept on top (tao
# sets 5, the status level, not floating's 3; anything above 0 keeps it over other windows).
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
    # Airy or Mist is a choice of Liquid Glass, under Aura.
    picker = probe.js("return [...document.querySelectorAll('.settings .line > span')].some(s => /^(玻璃|Glass)$/.test(s.textContent.trim()))")
    want = bool(boot.get("liquid")) and theme_name == "aura"
    check(picker == want, f"settings: the glass choice {'shows' if want else 'stays hidden'}", f"shown {picker}")
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
version = platform.mac_ver()[0]
note("system", f"macOS {version or '-'}, scale {state['scale']}, work area {work}, glass {boot.get('glass')}, "
     f"Liquid Glass {boot.get('liquid')}, platform {boot.get('platform')}")
# Liquid Glass came with macOS 26; on 13 to 15 the widget takes the Popover material and Aura's own look.
if MAC:
    check(boot.get("liquid") == (int(version.split(".")[0]) >= 26), "Liquid Glass where the system has it",
          f"macOS {version}, liquid {boot.get('liquid')}")

# First run: the primary display's top-right corner, inside the margin.
check(near(state["x"] + state["w"], work["x"] + work["w"] - MARGIN) and near(state["y"], work["y"] + MARGIN),
      "first run sits in the top-right corner", f"{state['x']:.0f},{state['y']:.0f} {state['w']:.0f}x{state['h']:.0f}")
check(boot.get("platform") == ("macos" if MAC else "windows") and boot.get("morph") is True, "boot reports the platform and the morph switch")

# Morph: Calendar is wide; the viewport, which is the window, passes through sizes on the way. With
# Reduce Motion on it jumps there at once, as it should.
# The longest wait between the page's frames on the way says whether the page kept up.
MORPH = """
document.querySelectorAll('[role=tab]')[TAB].click();
const seen = [], end = performance.now() + 900;
let last = performance.now(), gap = 0;
while (performance.now() < end) {
  seen.push(`${innerWidth}x${innerHeight}`);
  await new Promise(requestAnimationFrame);
  gap = Math.max(gap, performance.now() - last);
  last = performance.now();
}
return { sizes: [...new Set(seen)], gap: Math.round(gap) };
"""
reduced = probe.js("return matchMedia('(prefers-reduced-motion: reduce)').matches")
morph = probe.js(MORPH.replace("TAB", "2"))
frames = morph["sizes"]
after = probe.native("state")
check((len(frames) == 2 if reduced else len(frames) > 5) and frames[-1] == "440x600" and near(after["w"], 440) and near(after["h"], 600),
      "morph to 440x600 at once (Reduce Motion)" if reduced else "morph to 440x600 in steps",
      f"{len(frames)} sizes: {' '.join(frames[:4])} … {frames[-1]}, longest frame {morph['gap']}ms")
probe.js("document.querySelectorAll('[role=tab]')[0].click();")
time.sleep(0.9)
# The same again, now that Calendar has been drawn once, and to Tasks, the same size, drawn for the
# first time: whether a first morph or a view's first drawing costs the frames.
for label, tab in (("morph to Calendar again", 2), ("morph to Tasks, first time", 3)):
    again = probe.js(MORPH.replace("TAB", str(tab)))
    note(label, f"{len(again['sizes'])} sizes, ends {again['sizes'][-1]}, longest frame {again['gap']}ms")
    probe.js("document.querySelectorAll('[role=tab]')[0].click();")
    time.sleep(0.9)

if MAC:
    # Opened by hand it comes forward, and goes under other windows once another app is in front.
    subprocess.run(["osascript", "-e", 'tell application "Finder" to activate'], check=False)
    time.sleep(1)
    under = probe.native("state")["level"]
    check(state["level"] == NORMAL and under == BELOW, "comes forward, then sits below other windows",
          f"levels {state['level']} → {under}")
    check(state["behavior"] & CAN_JOIN_ALL_SPACES != 0, "on every Space", f"behavior {state['behavior']}")
    behind = probe.native("state")["behavior"]
    check(all(b & STATIONARY and not b & TRANSIENT for b in (state["behavior"], behind)), "stays put through Show Desktop, like the system's widgets",
          f"behavior {state['behavior']} → {behind}")
    # What Mission Control and Show Desktop do to it: Mission Control hides it (the widget clears
    # itself), Show Desktop leaves it where it is, as the Window Server lists it, and it is back after.
    MC = "/System/Applications/Mission Control.app/Contents/MacOS/Mission Control"
    WINDOWS = """ObjC.import('CoreGraphics');
JSON.stringify(ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0)))
  .map(w => ({ owner: w.kCGWindowOwnerName, layer: w.kCGWindowLayer, ...w.kCGWindowBounds })))"""

    def windows():
        return json.loads(subprocess.run(["osascript", "-l", "JavaScript", "-e", WINDOWS], capture_output=True, text=True).stdout or "[]")

    def ours(listed):
        return [{k: w[k] for k in ("X", "Y", "Width", "Height")} for w in listed if re.search("still-today|Still Today", w["owner"] or "")]

    def covers(listed):
        """The Dock's windows over the whole screen, which Mission Control and Show Desktop add."""
        screen = probe.native("state")["screen"]
        return sum(1 for w in listed if w["owner"] == "Dock" and w.get("Width", 0) >= screen["w"] and w.get("Height", 0) >= screen["h"])

    def alpha_until(want, limit=3.0):
        """The widget's alpha once it is `want`, or after `limit` seconds, and how long that took."""
        began = time.time()
        while True:
            alpha = probe.native("state")["alpha"]
            if abs(alpha - want) < 0.01 or time.time() - began > limit:
                return alpha, round(time.time() - began, 1)
            time.sleep(0.1)

    here = probe.native("state")
    before = covers(windows())
    subprocess.run([MC], check=False)
    hidden, hide_s = alpha_until(0)
    listed = windows()
    during = covers(listed)
    opened = during > before
    subprocess.run(["screencapture", "-x", os.path.join(SHOTS, "mission-control.png")], check=False)
    subprocess.run([MC], check=False)
    back, back_s = alpha_until(1)
    detail = f"alpha {hidden} in {hide_s}s, back to {back} in {back_s}s, Dock over the screen {before} → {during}, ours {json.dumps(ours(listed))}"
    # Where Mission Control cannot open (a runner without a display for it) this stays a note.
    if opened:
        check(near(hidden, 0, 0.01) and near(back, 1, 0.01), "hidden in Mission Control, and back after", detail)
    else:
        note("Mission Control did not open here (not counted; check on a real Mac)", detail)
    time.sleep(1)
    subprocess.run([MC, "1"], check=False)
    time.sleep(2)
    shown = probe.native("state")["alpha"]
    kept = [b for b in ours(windows()) if near(b["X"], here["x"]) and near(b["Y"], here["y"])]
    subprocess.run(["screencapture", "-x", os.path.join(SHOTS, "show-desktop.png")], check=False)
    subprocess.run([MC, "1"], check=False)
    time.sleep(2)
    passed = shown == 1 and probe.native("state")["alpha"] == 1 and bool(kept)
    note(f"Show Desktop leaves it in place: {'PASS' if passed else 'FAIL'} (not counted; check on a real Mac)", f"alpha {shown}, kept {kept}")

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

# A display unplugged: the home corner was on it, up and to the left of this one, and the window is
# where the system put it. The card grew onto this display over the system's widgets, then went back to
# the home corner on no display at all and was gone.
if MAC:
    probe.native("strand", x=desk["x"] - 500, y=desk["y"] - 100)
    probe.js("document.querySelectorAll('[role=tab]')[3].click();")
    time.sleep(0.9)
    large = probe.native("state")
    probe.js("document.querySelectorAll('[role=tab]')[0].click();")
    time.sleep(0.9)
    small = probe.native("state")
    saved = json.load(open(os.path.join(STORE, "window.json")))
    seen = lambda x, y, w, h: screen["x"] <= x + w / 2 <= screen["x"] + screen["w"] and screen["y"] <= y + h / 2 <= screen["y"] + screen["h"]
    check(seen(large["x"], large["y"], large["w"], large["h"]) and seen(small["x"], small["y"], small["w"], small["h"])
          and seen(saved.get("x", -9999), saved.get("y", -9999), small["w"], small["h"]),
          "a home on a display that went comes back on screen",
          f"large {large['x']:.0f},{large['y']:.0f}, compact {small['x']:.0f},{small['y']:.0f}, window.json {saved}")

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
