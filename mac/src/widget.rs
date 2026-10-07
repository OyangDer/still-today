// The widget window, as host/WidgetForm.cs: where it sits, how it morphs, how a dropped widget
// settles onto the desktop grid, and its place in the window stack. Everything here is in logical
// units (points on the Mac), so one grid serves every display.
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
#[cfg(not(target_os = "macos"))]
use tauri::LogicalPosition;
use tauri::{AppHandle, LogicalSize, Manager, WebviewWindow};

// The desktop grid a dropped widget settles onto. Keep in step with host/WidgetForm.cs.
const MARGIN: f64 = 20.0;
const STEP: f64 = 24.0;
const GLIDE_MS: f64 = 300.0;
const MAX: (f64, f64) = (440.0, 600.0);
// The corner the Mac draws on its own widgets' scale, from the mockup.
#[cfg(target_os = "macos")]
pub(crate) const RADIUS: f64 = 11.0;

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
            size: Mutex::new((360.0, 320.0)),
            animation: AtomicU64::new(0),
            dragging: AtomicBool::new(false),
            topmost: AtomicBool::new(false),
            presented: AtomicBool::new(false),
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

fn current(window: &WebviewWindow) -> Option<Rect> {
    let s = window.scale_factor().ok()?;
    let p = window.outer_position().ok()?;
    let z = window.outer_size().ok()?;
    Some(Rect { x: p.x as f64 / s, y: p.y as f64 / s, w: z.width as f64 / s, h: z.height as f64 / s })
}

// Grows from the home corner; a size that would cross the grid margin is pushed back inside it.
fn target(window: &WebviewWindow, home: (f64, f64), (w, h): (f64, f64)) -> Rect {
    let work = area_of(window, home.0, home.1);
    let x = home.0.min(work.right() - MARGIN - w).max(work.x);
    let y = home.1.min(work.bottom() - MARGIN - h).max(work.y);
    Rect { x, y, w, h }
}

// Inside a margin of the work area, on fixed steps from it, and flush with the margin when within a
// step of it.
fn snap(value: f64, start: f64, end: f64, length: f64) -> f64 {
    let min = start + MARGIN;
    let max = end - MARGIN - length;
    if max < min {
        return value.min(end - length).max(start);
    }
    let value = value.clamp(min, max);
    if value - min <= STEP {
        return min;
    }
    if max - value <= STEP {
        return max;
    }
    (min + ((value - min) / STEP).round() * STEP).min(max)
}

// Size and place together, in one frame: set apart, the Mac draws the window once at the new size
// still on its old bottom-left corner, and the morph jitters.
#[cfg(target_os = "macos")]
fn put(window: &WebviewWindow, r: Rect) {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSScreen, NSWindow};
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    let (Ok(ns), Some(mtm)) = (window.ns_window(), MainThreadMarker::new()) else { return };
    // Points from the top of the primary display, as Tauri counts them; Cocoa counts from its bottom.
    let Some(primary) = NSScreen::screens(mtm).firstObject() else { return };
    let top = primary.frame().size.height;
    // SAFETY: as in `dress`.
    let ns = unsafe { &*(ns as *const NSWindow) };
    ns.setFrame_display(NSRect::new(NSPoint::new(r.x, top - r.y - r.h), NSSize::new(r.w, r.h)), true);
}

#[cfg(not(target_os = "macos"))]
fn put(window: &WebviewWindow, r: Rect) {
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
            Some(a) => (a.right() - size.0 - MARGIN, a.y + MARGIN),
            None => (MARGIN, MARGIN),
        },
    };
    *home = Some(start);
    let rect = target(&window, start, size);
    drop(home);
    let app = app.clone();
    let _ = window.clone().run_on_main_thread(move || {
        put(&window, rect);
        show(&app, &window);
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
}

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
        settle(&app, window);
    });
}

pub(crate) fn settle(app: &AppHandle, window: WebviewWindow) {
    let state = widget(app);
    let Some(from) = current(&window) else { return };
    let (w, h) = *state.size.lock().unwrap();
    let work = area_of(&window, from.x + from.w / 2.0, from.y + from.h / 2.0);
    let x = snap(from.x, work.x, work.right(), w);
    let y = snap(from.y, work.y, work.bottom(), h);
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
        // One step in flight at a time: when the main thread falls behind, steps are dropped rather
        // than queued, so the window never plays back a backlog of stale frames.
        let busy = std::sync::Arc::new(AtomicBool::new(false));
        loop {
            if widget(&app).animation.load(Ordering::SeqCst) != generation {
                return;
            }
            let t = ((now_ms() - start) / ms).clamp(0.0, 1.0);
            if t < 1.0 && busy.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(4));
                continue;
            }
            let e = ease(t);
            let lerp = |a: f64, b: f64| a + (b - a) * e;
            let frame = Rect { x: lerp(from.x, to.x), y: lerp(from.y, to.y), w: lerp(from.w, to.w), h: lerp(from.h, to.h) };
            let (app2, win, done) = (app.clone(), window.clone(), busy.clone());
            busy.store(true, Ordering::Release);
            let _ = window.run_on_main_thread(move || {
                if widget(&app2).animation.load(Ordering::SeqCst) == generation {
                    put(&win, frame);
                }
                done.store(false, Ordering::Release);
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
pub fn material(window: &WebviewWindow, aura: bool, dark: bool) {
    use tauri::window::{Effect, EffectState, EffectsBuilder};
    let _ = window.set_theme(Some(if dark { tauri::Theme::Dark } else { tauri::Theme::Light }));
    let effects = aura.then(|| EffectsBuilder::new().effect(Effect::Popover).state(EffectState::Active).radius(RADIUS).build());
    let _ = window.set_effects(effects);
}

#[cfg(not(target_os = "macos"))]
pub fn material(_window: &WebviewWindow, _aura: bool, _dark: bool) {}

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
        // A 1000-wide area, a 360-wide widget: the grid runs from 20 to 620.
        assert_eq!(snap(5.0, 0.0, 1000.0, 360.0), 20.0);
        assert_eq!(snap(40.0, 0.0, 1000.0, 360.0), 20.0);
        assert_eq!(snap(100.0, 0.0, 1000.0, 360.0), 92.0);
        assert_eq!(snap(610.0, 0.0, 1000.0, 360.0), 620.0);
        assert_eq!(snap(900.0, 0.0, 1000.0, 360.0), 620.0);
    }

    #[test]
    fn curve_ends_and_eases_out() {
        assert_eq!(ease(0.0), 0.0);
        assert_eq!(ease(1.0), 1.0);
        assert!(ease(0.3) > 0.6);
    }
}
