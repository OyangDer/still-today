// The widget window, as host/WidgetForm.cs: where it sits, how it morphs, how a dropped widget
// settles onto the desktop grid, and its place in the window stack. Everything here is in logical
// units (points on the Mac), so one grid serves every display.
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewWindow};

// The desktop grid a dropped widget settles onto: the system's own, read off macOS 26. Its widgets sit
// 16pt in from the desktop's edges and 16pt apart, in 164pt cells, counted from the nearest edge.
const EDGE: f64 = 16.0;
const GAP: f64 = 16.0;
const PITCH: f64 = 164.0 + GAP;
const GLIDE_MS: f64 = 300.0;
const MAX: (f64, f64) = (440.0, 600.0);
// The corner of the system's own widgets, measured beside them on macOS 26.
#[cfg(target_os = "macos")]
pub(crate) const RADIUS: f64 = 26.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

impl Rect {
    fn right(&self) -> f64 {
        self.x + self.w
    }
    fn bottom(&self) -> f64 {
        self.y + self.h
    }
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.right() && y >= self.y && y < self.bottom()
    }
}

pub struct Widget {
    path: PathBuf,
    // The user's chosen top-left corner. Larger states grow from it and are only pushed back inside
    // the work area when they would not fit; returning to the compact size returns here.
    home: Mutex<Option<(f64, f64)>>,
    size: Mutex<(f64, f64)>,
    animation: AtomicU64,
    dragging: AtomicBool,
    topmost: AtomicBool,
    // Brought over other windows for a notification click or the menu's Settings; it goes back
    // under them once the user moves on.
    presented: AtomicBool,
    // Set by the first reveal; a page reload reveals again without coming forward.
    revealed: AtomicBool,
    /// Whether the window eases between sizes or jumps; a switch for comparing the two in the beta.
    pub morph: AtomicBool,
}

impl Widget {
    pub fn load(dir: &std::path::Path) -> Self {
        let path = dir.join("window.json");
        // A damaged placement file only costs the remembered position.
        let saved: Value = fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
        let home = saved["x"].as_f64().zip(saved["y"].as_f64());
        Widget {
            path,
            home: Mutex::new(home),
            size: Mutex::new((344.0, 320.0)),
            animation: AtomicU64::new(0),
            dragging: AtomicBool::new(false),
            topmost: AtomicBool::new(false),
            presented: AtomicBool::new(false),
            revealed: AtomicBool::new(false),
            morph: AtomicBool::new(saved["morph"].as_bool().unwrap_or(true)),
        }
    }

    pub fn save(&self) {
        let home = *self.home.lock().unwrap();
        let value = json!({
            "x": home.map(|h| h.0),
            "y": home.map(|h| h.1),
            "morph": self.morph.load(Ordering::Relaxed),
        });
        let _ = crate::write_atomic(&self.path, &value.to_string(), None);
    }

    pub fn topmost(&self) -> bool {
        self.topmost.load(Ordering::Relaxed)
    }
}

fn widget(app: &AppHandle) -> &Widget {
    &app.state::<crate::Host>().inner().widget
}

fn now_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0.0, |d| d.as_secs_f64() * 1000.0)
}

fn clamp(w: f64, h: f64) -> (f64, f64) {
    (w.clamp(200.0, MAX.0), h.clamp(120.0, MAX.1))
}

// The work areas of every display, in logical units.
fn work_areas(window: &WebviewWindow) -> Vec<Rect> {
    let monitors = window.available_monitors().unwrap_or_default();
    monitors
        .iter()
        .map(|m| {
            let s = m.scale_factor();
            let a = m.work_area();
            Rect { x: a.position.x as f64 / s, y: a.position.y as f64 / s, w: a.size.width as f64 / s, h: a.size.height as f64 / s }
        })
        .collect()
}

fn primary_area(window: &WebviewWindow) -> Option<Rect> {
    let m = window.primary_monitor().ok()??;
    let s = m.scale_factor();
    let a = m.work_area();
    Some(Rect { x: a.position.x as f64 / s, y: a.position.y as f64 / s, w: a.size.width as f64 / s, h: a.size.height as f64 / s })
}

// The work area a point is on, else the nearest one.
fn area_of(window: &WebviewWindow, x: f64, y: f64) -> Rect {
    let areas = work_areas(window);
    if let Some(a) = areas.iter().find(|a| a.contains(x, y)) {
        return *a;
    }
    let distance = |a: &Rect| {
        let dx = (a.x + a.w / 2.0) - x;
        let dy = (a.y + a.h / 2.0) - y;
        dx * dx + dy * dy
    };
    areas
        .into_iter()
        .min_by(|a, b| distance(a).total_cmp(&distance(b)))
        .or_else(|| primary_area(window))
        .unwrap_or(Rect { x: 0.0, y: 0.0, w: 1440.0, h: 900.0 })
}

// Where the system lays out its widgets on a display: all of it below the menu bar, the Dock's place
// included, as theirs sit behind it.
#[cfg(target_os = "macos")]
fn desktop_of(window: &WebviewWindow, work: Rect) -> Rect {
    let monitors = window.available_monitors().unwrap_or_default();
    monitors
        .iter()
        .find_map(|m| {
            let s = m.scale_factor();
            let a = m.work_area();
            let area = Rect { x: a.position.x as f64 / s, y: a.position.y as f64 / s, w: a.size.width as f64 / s, h: a.size.height as f64 / s };
            (area == work).then(|| {
                let (p, z) = (m.position(), m.size());
                let full = Rect { x: p.x as f64 / s, y: p.y as f64 / s, w: z.width as f64 / s, h: z.height as f64 / s };
                Rect { x: full.x, y: work.y, w: full.w, h: full.bottom() - work.y }
            })
        })
        .unwrap_or(work)
}

#[cfg(not(target_os = "macos"))]
fn desktop_of(_window: &WebviewWindow, work: Rect) -> Rect {
    work
}

/// The cards of the system's desktop widgets. Each sits in a window of its own (Notification Center's,
/// under the desktop icons) with 8pt to spare on every side.
#[cfg(target_os = "macos")]
fn system_widgets() -> Vec<Rect> {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::NSRunningApplication;
    use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString};

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> *mut NSArray<NSDictionary<NSString, AnyObject>>;
    }
    const ON_SCREEN_ONLY: u32 = 1;
    const SPARE: f64 = 8.0;

    // SAFETY: a Copy function hands over its own reference to a CFArray of CFDictionaries, toll-free
    // bridged to their Foundation counterparts. Window bounds need no screen-recording permission.
    let Some(list) = (unsafe { Retained::from_raw(CGWindowListCopyWindowInfo(ON_SCREEN_ONLY, 0)) }) else { return Vec::new() };
    let number = |d: &NSDictionary<NSString, AnyObject>, key: &str| {
        d.objectForKey(&NSString::from_str(key)).and_then(|v| v.downcast::<NSNumber>().ok()).map(|n| n.doubleValue())
    };
    let mut owners = std::collections::HashMap::new();
    let mut found = Vec::new();
    for info in list.iter() {
        if number(&info, "kCGWindowLayer").is_none_or(|layer| layer >= 0.0) {
            continue;
        }
        let Some(pid) = number(&info, "kCGWindowOwnerPID").map(|p| p as i32) else { continue };
        let widgets = *owners.entry(pid).or_insert_with(|| {
            NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
                .and_then(|a| a.bundleIdentifier())
                .is_some_and(|id| id.to_string() == "com.apple.notificationcenterui")
        });
        if !widgets {
            continue;
        }
        let Some(bounds) = info.objectForKey(&NSString::from_str("kCGWindowBounds")).and_then(|b| b.downcast::<NSDictionary>().ok()) else { continue };
        // SAFETY: kCGWindowBounds is a dictionary of numbers keyed by strings.
        let bounds = unsafe { &*(Retained::as_ptr(&bounds) as *const NSDictionary<NSString, AnyObject>) };
        if let (Some(x), Some(y), Some(w), Some(h)) = (number(bounds, "X"), number(bounds, "Y"), number(bounds, "Width"), number(bounds, "Height")) {
            if w > 2.0 * SPARE && h > 2.0 * SPARE {
                found.push(Rect { x: x + SPARE, y: y + SPARE, w: w - 2.0 * SPARE, h: h - 2.0 * SPARE });
            }
        }
    }
    found
}

#[cfg(not(target_os = "macos"))]
fn system_widgets() -> Vec<Rect> {
    Vec::new()
}

fn current(window: &WebviewWindow) -> Option<Rect> {
    let s = window.scale_factor().ok()?;
    let p = window.outer_position().ok()?;
    let z = window.outer_size().ok()?;
    Some(Rect { x: p.x as f64 / s, y: p.y as f64 / s, w: z.width as f64 / s, h: z.height as f64 / s })
}

// Grows from the home corner; a size that would run past the work area's margin, under the Dock for
// one, is pushed back inside it.
fn target(window: &WebviewWindow, home: (f64, f64), (w, h): (f64, f64)) -> Rect {
    let work = area_of(window, home.0, home.1);
    let x = home.0.min(work.right() - EDGE - w).max(work.x);
    let y = home.1.min(work.bottom() - EDGE - h).max(work.y);
    Rect { x, y, w, h }
}

// Where a card `length` long settles along one side of the desktop, from `start` to `end`: the closest
// of the grid's lines, counted in from either edge, and of `lines`, which put it flush with the
// system's widgets.
fn snap(value: f64, start: f64, end: f64, length: f64, lines: &[f64]) -> f64 {
    let min = start + EDGE;
    let max = end - EDGE - length;
    if max < min {
        return value.min(end - length).max(start);
    }
    let steps = ((max - min) / PITCH).floor() as i32;
    (0..=steps)
        .flat_map(|k| [min + k as f64 * PITCH, max - k as f64 * PITCH])
        .chain(lines.iter().copied().filter(|line| (min..=max).contains(line)))
        .min_by(|a, b| (a - value).abs().total_cmp(&(b - value).abs()))
        .unwrap_or(min)
}

// Lines along one side that put a card `length` long flush with a system widget there: in line with
// either of its edges, or a gap past one.
fn lines(widgets: &[(f64, f64)], length: f64) -> Vec<f64> {
    widgets.iter().flat_map(|&(start, end)| [start, end - length, end + GAP, start - GAP - length]).collect()
}

fn put(window: &WebviewWindow, r: Rect) {
    // Size, then the top-left: the Mac keeps a window's bottom-left corner through a resize.
    let _ = window.set_size(LogicalSize::new(r.w, r.h));
    let _ = window.set_position(LogicalPosition::new(r.x, r.y));
}

/// The page calls this once it has laid out its first view.
pub fn reveal(app: &AppHandle, window: WebviewWindow, w: f64, h: f64) {
    let size = clamp(w, h);
    let state = widget(app);
    *state.size.lock().unwrap() = size;
    let mut home = state.home.lock().unwrap();
    let start = match *home {
        // A saved corner is kept on whichever display it is on, pulled inside if it hangs off.
        Some((x, y)) => {
            let a = area_of(&window, x, y);
            (x.min(a.right() - size.0).max(a.x), y.min(a.bottom() - size.1).max(a.y))
        }
        // First run: the primary display's top-right corner.
        None => match primary_area(&window) {
            Some(a) => (a.right() - size.0 - EDGE, a.y + EDGE),
            None => (EDGE, EDGE),
        },
    };
    *home = Some(start);
    let rect = target(&window, start, size);
    drop(home);
    // Opened by hand, the widget comes forward, or it would start under whatever is open; at login
    // it goes straight onto the desktop.
    let forward = !state.revealed.swap(true, Ordering::Relaxed) && !std::env::args().any(|a| a == "--autostart");
    let app = app.clone();
    let _ = window.clone().run_on_main_thread(move || {
        put(&window, rect);
        show(&app, &window);
        if forward {
            present(&app, &window);
        }
    });
}

pub fn show(app: &AppHandle, window: &WebviewWindow) {
    let _ = window.show();
    stack(window, widget(app).topmost());
}

// A desktop widget sits under other windows unless it is kept on top; on the Mac it is on every
// Space, like the desktop itself.
fn stack(window: &WebviewWindow, topmost: bool) {
    // Clearing either level drops the window to the normal one, so the level it keeps is set last.
    if topmost {
        let _ = window.set_always_on_bottom(false);
        let _ = window.set_always_on_top(true);
    } else {
        let _ = window.set_always_on_top(false);
        let _ = window.set_always_on_bottom(true);
    }
    let _ = window.set_visible_on_all_workspaces(true);
    transient(window);
}

// Mission Control hides the system's widgets along with the desktop; the widget goes with them
// rather than staying on top of the window thumbnails. Set after the Space setting, which rewrites
// the window's collection behaviour.
#[cfg(target_os = "macos")]
fn transient(window: &WebviewWindow) {
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
    let Ok(ns) = window.ns_window() else { return };
    // SAFETY: as in dress; stack runs on the main thread.
    let ns = unsafe { &*(ns as *const NSWindow) };
    let behavior = ns.collectionBehavior() & !NSWindowCollectionBehavior::Stationary;
    ns.setCollectionBehavior(behavior | NSWindowCollectionBehavior::Transient);
}

#[cfg(not(target_os = "macos"))]
fn transient(_window: &WebviewWindow) {}

pub fn set_topmost(app: &AppHandle, window: WebviewWindow, on: bool) {
    widget(app).topmost.store(on, Ordering::Relaxed);
    let _ = window.clone().run_on_main_thread(move || stack(&window, on));
}

/// Shows the widget over other windows, for a notification click, a second launch or the menu's
/// Settings. A desktop widget goes back under them once the user moves on.
pub fn present(app: &AppHandle, window: &WebviewWindow) {
    let state = widget(app);
    state.presented.store(!state.topmost(), Ordering::Relaxed);
    let _ = window.show();
    let _ = window.set_always_on_bottom(false);
    let _ = window.set_focus();
}

pub fn blurred(app: &AppHandle, window: &WebviewWindow) {
    let state = widget(app);
    if state.presented.swap(false, Ordering::Relaxed) && !state.topmost() {
        stack(window, false);
    }
}

pub fn morph(app: &AppHandle, window: WebviewWindow, w: f64, h: f64, start: f64, ms: f64) {
    let state = widget(app);
    let size = clamp(w, h);
    *state.size.lock().unwrap() = size;
    // Mid-drag the drag owns the position, and the home corner is stale until the drop.
    if state.dragging.load(Ordering::Relaxed) {
        let _ = window.clone().run_on_main_thread(move || {
            let _ = window.set_size(LogicalSize::new(size.0, size.1));
        });
        return;
    }
    let Some(home) = *state.home.lock().unwrap() else { return };
    let Some(from) = current(&window) else { return };
    let ms = if state.morph.load(Ordering::Relaxed) { ms } else { 0.0 };
    animate(app, window.clone(), from, target(&window, home, size), start, ms);
}

/// The page asks for this when a press lands on anything that is not a control. Once the button
/// comes up, the widget glides onto the grid.
pub fn drag(app: &AppHandle, window: WebviewWindow) {
    widget(app).dragging.store(true, Ordering::Relaxed);
    let moving = window.clone();
    let _ = window.run_on_main_thread(move || {
        let _ = moving.start_dragging();
    });
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(80));
        while mouse_down() {
            std::thread::sleep(Duration::from_millis(30));
        }
        widget(&app).dragging.store(false, Ordering::Relaxed);
        // The move loop kept the release from the page, which may have gone on selecting meanwhile.
        crate::emit(&app, "moved", Value::Null);
        settle(&app, window);
    });
}

pub(crate) fn settle(app: &AppHandle, window: WebviewWindow) {
    let state = widget(app);
    let Some(from) = current(&window) else { return };
    let (w, h) = *state.size.lock().unwrap();
    let desk = desktop_of(&window, area_of(&window, from.x + from.w / 2.0, from.y + from.h / 2.0));
    let widgets = system_widgets();
    let across: Vec<_> = widgets.iter().map(|r| (r.x, r.right())).collect();
    let down: Vec<_> = widgets.iter().map(|r| (r.y, r.bottom())).collect();
    let x = snap(from.x, desk.x, desk.right(), w, &lines(&across, w));
    let y = snap(from.y, desk.y, desk.bottom(), h, &lines(&down, h));
    *state.home.lock().unwrap() = Some((x, y));
    state.save();
    animate(app, window, from, Rect { x, y, w, h }, now_ms(), GLIDE_MS);
}

// The window morph and the page share one curve and one start instant, so the native edge and the
// CSS chrome land on the same frame. Keep in step with MORPH in ui/src/lib/motion.ts.
fn ease(t: f64) -> f64 {
    const X1: f64 = 0.22;
    const Y1: f64 = 0.8;
    const X2: f64 = 0.22;
    const Y2: f64 = 1.0;
    let bezier = |s: f64, p1: f64, p2: f64| 3.0 * p1 * s * (1.0 - s).powi(2) + 3.0 * p2 * s * s * (1.0 - s) + s.powi(3);
    let slope = |s: f64, p1: f64, p2: f64| 3.0 * p1 * (1.0 - s).powi(2) + 6.0 * (p2 - p1) * s * (1.0 - s) + 3.0 * (1.0 - p2) * s * s;
    if t <= 0.0 {
        return 0.0;
    }
    if t >= 1.0 {
        return 1.0;
    }
    let mut s = t;
    for _ in 0..8 {
        let x = bezier(s, X1, X2) - t;
        let dx = slope(s, X1, X2);
        if x.abs() < 1e-5 || dx.abs() < 1e-6 {
            break;
        }
        s -= x / dx;
    }
    bezier(s.clamp(0.0, 1.0), Y1, Y2)
}

/// A background thread samples the curve from the shared wall clock and hands each frame to the main
/// thread, so page and window agree on every frame without talking to each other.
fn animate(app: &AppHandle, window: WebviewWindow, from: Rect, to: Rect, start: f64, ms: f64) {
    let state = widget(app);
    let generation = state.animation.fetch_add(1, Ordering::SeqCst) + 1;
    if ms <= 0.0 || !window.is_visible().unwrap_or(false) {
        let _ = window.clone().run_on_main_thread(move || {
            put(&window, to);
            refresh_shadow(&window);
        });
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let wait = start - now_ms();
        if wait > 0.0 {
            std::thread::sleep(Duration::from_secs_f64(wait / 1000.0));
        }
        loop {
            if widget(&app).animation.load(Ordering::SeqCst) != generation {
                return;
            }
            let t = ((now_ms() - start) / ms).clamp(0.0, 1.0);
            let e = ease(t);
            let lerp = |a: f64, b: f64| a + (b - a) * e;
            let frame = Rect { x: lerp(from.x, to.x), y: lerp(from.y, to.y), w: lerp(from.w, to.w), h: lerp(from.h, to.h) };
            let (app2, win) = (app.clone(), window.clone());
            let _ = window.run_on_main_thread(move || {
                if widget(&app2).animation.load(Ordering::SeqCst) == generation {
                    put(&win, frame);
                }
            });
            if t >= 1.0 {
                let win = window.clone();
                let _ = window.run_on_main_thread(move || refresh_shadow(&win));
                return;
            }
            std::thread::sleep(Duration::from_millis(8));
        }
    });
}

#[cfg(target_os = "macos")]
fn mouse_down() -> bool {
    objc2_app_kit::NSEvent::pressedMouseButtons() & 1 != 0
}

#[cfg(windows)]
fn mouse_down() -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    unsafe { GetAsyncKeyState(VK_LBUTTON as i32) as u16 & 0x8000 != 0 }
}

#[cfg(not(any(target_os = "macos", windows)))]
fn mouse_down() -> bool {
    false
}

/// The Mac look: rounded corners that clip the page, the system shadow around them, and the
/// translucent material behind the page's own tint.
#[cfg(target_os = "macos")]
pub fn dress(window: &WebviewWindow) {
    use objc2_app_kit::NSWindow;
    if let Ok(ns) = window.ns_window() {
        // SAFETY: Tauri hands back the window's live NSWindow, used here on the main thread.
        let ns = unsafe { &*(ns as *const NSWindow) };
        if let Some(view) = ns.contentView() {
            view.setWantsLayer(true);
            if let Some(layer) = view.layer() {
                layer.setCornerRadius(RADIUS);
                layer.setMasksToBounds(true);
            }
        }
    }
    let _ = window.set_shadow(true);
}

#[cfg(not(target_os = "macos"))]
pub fn dress(_window: &WebviewWindow) {}

/// The material behind the page: the Mac's translucent glass for Aura, nothing for the solid
/// themes, which paint an opaque card. The window's appearance picks its light or dark variant.
#[cfg(target_os = "macos")]
pub fn material(window: &WebviewWindow, aura: bool, clear: bool, dark: bool, theme: Option<tauri::Theme>) {
    use tauri::window::{Effect, EffectState, EffectsBuilder};
    // The window's appearance is the one chosen, or the system's; Liquid Glass and the page's ink follow it.
    let _ = window.set_theme(theme);
    if aura && crate::glass::available() {
        let _ = window.set_effects(None);
        crate::glass::apply(window, RADIUS, clear, dark);
        return;
    }
    crate::glass::clear(window);
    let effects = aura.then(|| EffectsBuilder::new().effect(Effect::Popover).state(EffectState::Active).radius(RADIUS).build());
    let _ = window.set_effects(effects);
}

#[cfg(not(target_os = "macos"))]
pub fn material(_window: &WebviewWindow, _aura: bool, _clear: bool, _dark: bool, _theme: Option<tauri::Theme>) {}

// The Mac draws a window's shadow from its shape, worked out again only when asked.
#[cfg(target_os = "macos")]
fn refresh_shadow(window: &WebviewWindow) {
    use objc2_app_kit::NSWindow;
    if let Ok(ns) = window.ns_window() {
        // SAFETY: as in `dress`.
        let ns = unsafe { &*(ns as *const NSWindow) };
        ns.invalidateShadow();
    }
}

#[cfg(not(target_os = "macos"))]
fn refresh_shadow(_window: &WebviewWindow) {}

/// Whether the system draws translucency at all: off under Reduce Transparency.
#[cfg(target_os = "macos")]
pub fn glass() -> bool {
    !objc2_app_kit::NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceTransparency()
}

// The Windows trial build has no material behind the page, so the page paints its solid fallback.
#[cfg(not(target_os = "macos"))]
pub fn glass() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snaps_to_the_grid() {
        // The 1680pt-wide desktop the system's widgets were measured on: a 344pt card two cells wide.
        assert_eq!(snap(5.0, 0.0, 1680.0, 344.0, &[]), 16.0);
        assert_eq!(snap(150.0, 0.0, 1680.0, 344.0, &[]), 196.0);
        assert_eq!(snap(1400.0, 0.0, 1680.0, 344.0, &[]), 1320.0);
        assert_eq!(snap(1150.0, 0.0, 1680.0, 344.0, &[]), 1140.0);
        // Below a 30pt menu bar, the bottom row counted up from the display's foot.
        assert_eq!(snap(40.0, 30.0, 1050.0, 320.0, &[]), 46.0);
        assert_eq!(snap(700.0, 30.0, 1050.0, 320.0, &[]), 714.0);
    }

    #[test]
    fn snaps_beside_system_widgets() {
        // A small widget whose card runs from 500 to 664: a gap past its right edge.
        let near = lines(&[(500.0, 664.0)], 344.0);
        assert_eq!(snap(690.0, 0.0, 1680.0, 344.0, &near), 680.0);
        // In line with its left edge.
        assert_eq!(snap(505.0, 0.0, 1680.0, 344.0, &near), 500.0);
    }

    #[test]
    fn curve_ends_and_eases_out() {
        assert_eq!(ease(0.0), 0.0);
        assert_eq!(ease(1.0), 1.0);
        assert!(ease(0.3) > 0.6);
    }
}
