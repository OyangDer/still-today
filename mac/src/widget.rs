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
// The glide onto the grid after a drop: short, and on a curve that arrives rather than creeps, 95% of
// the way in 100ms. The morph's curve spent its last 5% over a further 140ms, and the drop read as slow.
const GLIDE_MS: f64 = 220.0;
const GLIDE: Curve = (0.2, 0.9, 0.2, 1.0);
// A drag whose pointer has rested this long is over, though the button may still be down.
const REST_MS: f64 = 150.0;
// The window morph shares the page's curve, so the two land on the same frame. Keep in step with MORPH in
// ui/src/lib/motion.ts.
const MORPH: Curve = (0.22, 0.8, 0.22, 1.0);
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
    // The user's chosen top-left corner for the compact card. Larger states grow from it (see `grow`);
    // returning to the compact size returns here.
    home: Mutex<Option<(f64, f64)>>,
    size: Mutex<(f64, f64)>,
    // The size the page last asked for short of its largest: the card at rest, which keeps clear of the
    // system's widgets.
    compact: Mutex<(f64, f64)>,
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
            compact: Mutex::new((344.0, 320.0)),
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

    /// Takes a size the page asks for, and gives the compact one: this, unless it is the largest.
    fn compact_for(&self, size: (f64, f64)) -> (f64, f64) {
        let mut compact = self.compact.lock().unwrap();
        if size.0 < MAX.0 {
            *compact = size;
        }
        *compact
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

    // Run on long-lived worker threads, which have no pool of their own to let go of what AppKit hands
    // back autoreleased.
    objc2::rc::autoreleasepool(|_| {
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
            // Notification Center also keeps a clear window around a widget, 52pt past it all round (seen on
            // macOS 27), which is not one.
            if !widgets || number(&info, "kCGWindowAlpha").is_some_and(|alpha| alpha <= 0.0) {
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
    })
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

// Whether the compact card at `home` has its middle on no display's desktop: the display it was on has
// gone. A card half off an edge is still where the user put it.
fn lost(window: &WebviewWindow, (x, y): (f64, f64), (w, h): (f64, f64)) -> bool {
    !work_areas(window).into_iter().any(|a| desktop_of(window, a).contains(x + w / 2.0, y + h / 2.0))
}

// Where the card shows at `size`, from the home corner: the compact card's top left.
fn target(window: &WebviewWindow, home: (f64, f64), size: (f64, f64), compact: (f64, f64)) -> Rect {
    let work = area_of(window, home.0, home.1);
    let widgets = if size == compact { Vec::new() } else { system_widgets() };
    grow(home, size, compact, work, &widgets)
}

// The compact card sits just at its home, the Dock's place included, as the system's widgets do: pushed
// above the Dock after a larger state or a restart, it stood 49pt higher than where it was dropped.
// A card larger than the compact one grows from the home corner to the right and down. Where that would
// cover one of the system's widgets, it grows from whichever other corner of the compact card keeps clear
// of them, to the left, then up, then both, as a menu opens away from a screen's edge; where none does, to
// the right and down, over them for as long as it is large. Each way is pushed back inside the work
// area's margin, under the Dock for one.
fn grow((x, y): (f64, f64), (w, h): (f64, f64), (cw, ch): (f64, f64), work: Rect, widgets: &[Rect]) -> Rect {
    if (w, h) == (cw, ch) {
        return Rect { x, y, w, h };
    }
    let inside = |x: f64, y: f64| Rect { x: x.min(work.right() - EDGE - w).max(work.x), y: y.min(work.bottom() - EDGE - h).max(work.y), w, h };
    let ways = [inside(x, y), inside(x + cw - w, y), inside(x, y + ch - h), inside(x + cw - w, y + ch - h)];
    ways.into_iter().find(|way| clear(way, widgets)).unwrap_or(ways[0])
}

// Whether a card keeps the grid's gap from each of the system's widgets, give or take a point.
fn clear(r: &Rect, widgets: &[Rect]) -> bool {
    let apart = |start: f64, end: f64, from: f64, to: f64| end + GAP - 1.0 <= from || to + GAP - 1.0 <= start;
    widgets.iter().all(|w| apart(r.x, r.right(), w.x, w.right()) || apart(r.y, r.bottom(), w.y, w.bottom()))
}

// Where a card `size` big dropped at `from` makes its home on `desk`: the grid's place for the compact
// card that is clear of the system's widgets and nearest the drop, measured both from where the card
// then shows at `size` and from the home itself. A large card is pushed above the Dock from any home low
// enough, and by the first alone the home went to the lowest of those, so the compact card came back
// far below where the large one had been. Where no place is clear, the grid's place nearest the card as
// dropped, over them.
fn place(from: Rect, size: (f64, f64), compact: (f64, f64), desk: Rect, work: Rect, widgets: &[Rect]) -> (f64, f64) {
    let across: Vec<_> = widgets.iter().map(|r| (r.x, r.right())).collect();
    let down: Vec<_> = widgets.iter().map(|r| (r.y, r.bottom())).collect();
    let (cw, ch) = compact;
    let xs = stops(desk.x, desk.right(), cw, &lines(&across, cw));
    let ys = stops(desk.y, desk.bottom(), ch, &lines(&down, ch));
    let nearest = xs
        .iter()
        .flat_map(|&x| ys.iter().map(move |&y| (x, y)))
        .filter(|&(x, y)| clear(&Rect { x, y, w: cw, h: ch }, widgets))
        .map(|home| {
            let shown = grow(home, size, compact, work, widgets);
            (home, (shown.x - from.x).hypot(shown.y - from.y) + (home.0 - from.x).hypot(home.1 - from.y))
        })
        .min_by(|a, b| a.1.total_cmp(&b.1));
    if let Some((home, _)) = nearest {
        return home;
    }
    let (w, h) = size;
    (snap(from.x, desk.x, desk.right(), w, &lines(&across, w)), snap(from.y, desk.y, desk.bottom(), h, &lines(&down, h)))
}

// The lines a card `length` long may settle on along one side of the desktop, from `start` to `end`: the
// grid's, counted in from either edge, and `lines`, which put it flush with the system's widgets. None
// where it is longer than the side.
fn stops(start: f64, end: f64, length: f64, lines: &[f64]) -> Vec<f64> {
    let min = start + EDGE;
    let max = end - EDGE - length;
    if max < min {
        return Vec::new();
    }
    let steps = ((max - min) / PITCH).floor() as i32;
    (0..=steps)
        .flat_map(|k| [min + k as f64 * PITCH, max - k as f64 * PITCH])
        .chain(lines.iter().copied().filter(|line| (min..=max).contains(line)))
        .collect()
}

// Where a card `length` long settles along one side of the desktop: the closest of its stops.
fn snap(value: f64, start: f64, end: f64, length: f64, lines: &[f64]) -> f64 {
    stops(start, end, length, lines)
        .into_iter()
        .min_by(|a, b| (a - value).abs().total_cmp(&(b - value).abs()))
        .unwrap_or_else(|| value.min(end - length).max(start))
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
    let compact = state.compact_for(size);
    let mut home = state.home.lock().unwrap();
    let start = match *home {
        // A saved corner is kept on whichever display it is on, pulled onto its desktop if it hangs off.
        Some((x, y)) => {
            let d = desktop_of(&window, area_of(&window, x, y));
            (x.min(d.right() - size.0).max(d.x), y.min(d.bottom() - size.1).max(d.y))
        }
        // First run: the primary display's top-right corner, or the place nearest it clear of the
        // system's widgets.
        None => match primary_area(&window) {
            Some(a) => {
                let corner = Rect { x: a.right() - size.0 - EDGE, y: a.y + EDGE, w: size.0, h: size.1 };
                place(corner, size, compact, desktop_of(&window, a), a, &system_widgets())
            }
            None => (EDGE, EDGE),
        },
    };
    *home = Some(start);
    let rect = target(&window, start, size, compact);
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
    let _ = window.set_visible_on_all_workspaces(true);
    level(window, topmost);
}

// Show Desktop leaves the system's widgets where they are and they still take clicks there, so the
// widget sits just under other windows and is stationary: lower, with the desktop's icons, a click
// in Show Desktop goes to Finder and ends it; not stationary, Show Desktop sweeps it off to the
// screen's edge. Mission Control hides the system's widgets, which a stationary window can't ask
// for, so `watch_mission_control` hides it there. The level is set here rather than through tao,
// whose setters land later, from the main queue. Set after the Space setting, which rewrites the
// window's collection behaviour.
#[cfg(target_os = "macos")]
fn level(window: &WebviewWindow, topmost: bool) {
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
    // Just under the normal level, and the level tao gives an always-on-top window.
    const UNDER: isize = -1;
    const ON_TOP: isize = 5;
    let Ok(ns) = window.ns_window() else { return };
    // SAFETY: as in dress; stack runs on the main thread.
    let ns = unsafe { &*(ns as *const NSWindow) };
    let behavior = (ns.collectionBehavior() - NSWindowCollectionBehavior::Transient) | NSWindowCollectionBehavior::Stationary;
    ns.setCollectionBehavior(behavior);
    ns.setLevel(if topmost { ON_TOP } else { UNDER });
}

/// Hides the widget while Mission Control is open, as the system's widgets are. Mission Control
/// tells no one it is open, but it hides transient windows, so a 1pt transparent one watches for it:
/// it drops off screen then and only then (Show Desktop and other windows covering it leave it on
/// screen; macOS 14 and 15 keep it listed but shrink it to nothing), and its occlusion changes as it
/// does. A slow check backs the notification up, so the widget can't stay hidden on a missed one.
#[cfg(target_os = "macos")]
pub fn watch_mission_control(window: &WebviewWindow) {
    use block2::RcBlock;
    use objc2::runtime::AnyObject;
    use objc2::{MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSBackingStoreType, NSColor, NSWindow, NSWindowCollectionBehavior, NSWindowDidChangeOcclusionStateNotification, NSWindowStyleMask};
    use objc2_foundation::{NSNotificationCenter, NSPoint, NSRect, NSSize};

    let Some(mtm) = MainThreadMarker::new() else { return };
    let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1.0, 1.0));
    // SAFETY: a plain borderless window, made on the main thread and kept for the app's life.
    let sentinel = unsafe { NSWindow::initWithContentRect_styleMask_backing_defer(NSWindow::alloc(mtm), frame, NSWindowStyleMask::Borderless, NSBackingStoreType::Buffered, false) };
    unsafe { sentinel.setReleasedWhenClosed(false) };
    sentinel.setOpaque(false);
    sentinel.setBackgroundColor(Some(&NSColor::clearColor()));
    sentinel.setHasShadow(false);
    sentinel.setIgnoresMouseEvents(true);
    sentinel.setLevel(-1);
    sentinel.setCollectionBehavior(NSWindowCollectionBehavior::CanJoinAllSpaces | NSWindowCollectionBehavior::Transient);
    sentinel.orderFrontRegardless();
    let number = sentinel.windowNumber();

    let watched = window.clone();
    let changed = RcBlock::new(move |_: std::ptr::NonNull<objc2_foundation::NSNotification>| conceal(&watched, !on_screen(number)));
    let object: &AnyObject = &sentinel;
    // SAFETY: the block only touches the main thread's windows, and the notification comes on the
    // posting thread, AppKit's main one. The observer and the window stay for the app's life.
    let observer = unsafe {
        NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(Some(NSWindowDidChangeOcclusionStateNotification), Some(object), None, &changed)
    };
    std::mem::forget(observer);
    std::mem::forget(sentinel);

    // The backup reads the window list here, off the main thread, where it can't hold up a frame of the
    // window's glide or morph; the main thread hears of it only when the widget is wrong, and looks again.
    let window = window.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(2));
        // A worker thread has no pool of its own for what AppKit hands back autoreleased.
        let hidden = objc2::rc::autoreleasepool(|_| !on_screen(number));
        if hidden != CONCEALED.load(Ordering::Relaxed) {
            let target = window.clone();
            let _ = window.run_on_main_thread(move || conceal(&target, !on_screen(number)));
        }
    });
}

/// Whether `conceal` has the widget hidden, for the backup check off the main thread.
#[cfg(target_os = "macos")]
static CONCEALED: AtomicBool = AtomicBool::new(false);

#[cfg(not(target_os = "macos"))]
pub fn watch_mission_control(_window: &WebviewWindow) {}

// Whether the Window Server shows a window of ours: on screen, and not shrunk to nothing, as Mission
// Control leaves the watcher on macOS 14 and 15.
#[cfg(target_os = "macos")]
fn on_screen(number: isize) -> bool {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString};

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> *mut NSArray<NSDictionary<NSString, AnyObject>>;
    }
    const INCLUDING_WINDOW: u32 = 1 << 3;
    // SAFETY: as in system_widgets.
    let Some(list) = (unsafe { Retained::from_raw(CGWindowListCopyWindowInfo(INCLUDING_WINDOW, number as u32)) }) else { return true };
    let Some(info) = list.firstObject() else { return true };
    let value = |d: &NSDictionary<NSString, AnyObject>, key: &str| d.objectForKey(&NSString::from_str(key)).and_then(|v| v.downcast::<NSNumber>().ok());
    let listed = value(&info, "kCGWindowIsOnscreen").is_some_and(|on| on.boolValue());
    let shrunk = info.objectForKey(&NSString::from_str("kCGWindowBounds")).and_then(|b| b.downcast::<NSDictionary>().ok()).is_some_and(|bounds| {
        // SAFETY: as in system_widgets.
        let bounds = unsafe { &*(Retained::as_ptr(&bounds) as *const NSDictionary<NSString, AnyObject>) };
        ["Width", "Height"].iter().any(|key| value(bounds, key).is_some_and(|n| n.doubleValue() < 1.0))
    });
    listed && !shrunk
}

// Hidden, the widget is clear and lets clicks through, and keeps its place and level. Mission Control
// is only seen once its zoom has begun (the window list says so no sooner than the notification), so
// the widget fades out with the zoom rather than vanishing a beat behind it, and fades back with it.
#[cfg(target_os = "macos")]
fn conceal(window: &WebviewWindow, hidden: bool) {
    use block2::RcBlock;
    use objc2::Message;
    use objc2_app_kit::{NSAnimatablePropertyContainer, NSAnimationContext, NSWindow};
    use objc2_quartz_core::CAMediaTimingFunction;
    let Ok(ns) = window.ns_window() else { return };
    // SAFETY: as in dress; on the main thread.
    let ns = unsafe { &*(ns as *const NSWindow) };
    if ns.ignoresMouseEvents() == hidden {
        return;
    }
    ns.setIgnoresMouseEvents(hidden);
    CONCEALED.store(hidden, Ordering::Relaxed);
    let target = ns.retain();
    let changes = RcBlock::new(move |context: std::ptr::NonNull<NSAnimationContext>| {
        let context = unsafe { context.as_ref() };
        context.setDuration(if hidden { 0.15 } else { 0.25 });
        context.setTimingFunction(Some(&CAMediaTimingFunction::functionWithControlPoints(0.0, 0.0, 0.2, 1.0)));
        target.animator().setAlphaValue(if hidden { 0.0 } else { 1.0 });
    });
    NSAnimationContext::runAnimationGroup(&changes);
}

// Clearing either level drops the window to the normal one, so the level it keeps is set last.
#[cfg(not(target_os = "macos"))]
fn level(window: &WebviewWindow, topmost: bool) {
    if topmost {
        let _ = window.set_always_on_bottom(false);
        let _ = window.set_always_on_top(true);
    } else {
        let _ = window.set_always_on_top(false);
        let _ = window.set_always_on_bottom(true);
    }
}

pub fn set_topmost(app: &AppHandle, window: WebviewWindow, on: bool) {
    widget(app).topmost.store(on, Ordering::Relaxed);
    let _ = window.clone().run_on_main_thread(move || stack(&window, on));
}

/// Shows the widget over other windows, for a notification click, a second launch or the menu's
/// Settings. A desktop widget goes back under them once the user moves on.
pub fn present(app: &AppHandle, window: &WebviewWindow) {
    let state = widget(app);
    let topmost = state.topmost();
    state.presented.store(!topmost, Ordering::Relaxed);
    let _ = window.show();
    // Kept on top, it is over other windows already: brought to the normal level here, it stayed
    // there, under the next window opened, though Settings still said it was kept on top.
    if !topmost {
        let _ = window.set_always_on_bottom(false);
    }
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
    let compact = state.compact_for(size);
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
    // A home whose display has gone is made again from where the window is now. Kept, the card grew onto
    // the display left, over the system's widgets, then went back to the home and off every screen.
    let to = if lost(&window, home, compact) { rehome(app, &window, from, size) } else { target(&window, home, size, compact) };
    animate(app, window.clone(), from, to, start, ms, MORPH);
}

/// The page asks for this when a press lands on anything that is not a control. Once the pointer
/// comes to rest, or the button comes up, the widget glides onto the grid.
pub fn drag(app: &AppHandle, window: WebviewWindow) {
    let state = widget(app);
    state.dragging.store(true, Ordering::Relaxed);
    // A glide or morph still under way stops, at the size it was heading for: left running, it went on
    // moving the window under the drag.
    state.animation.fetch_add(1, Ordering::SeqCst);
    let size = *state.size.lock().unwrap();
    let moving = window.clone();
    let _ = window.run_on_main_thread(move || {
        if let Some(r) = current(&moving).filter(|r| (r.w, r.h) != size) {
            put(&moving, Rect { w: size.0, h: size.1, ..r });
        }
        let _ = moving.start_dragging();
    });
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(80));
        // Where the pointer came to rest and when, and whether the widget has gone onto the grid from
        // there. Waiting for the button alone, the widget sat off the grid for most of a second after
        // a three-finger drag: the system holds the button down that long after the fingers lift.
        let (mut rest, mut since, mut placed) = (cursor(), now_ms(), false);
        // Watched closely, so the glide starts as the button comes up rather than up to 30ms after.
        while mouse_down() {
            std::thread::sleep(Duration::from_millis(8));
            let at = cursor();
            if apart(at, rest) {
                // Dragged on: the drag has the window again.
                if placed {
                    widget(&app).animation.fetch_add(1, Ordering::SeqCst);
                }
                (rest, since, placed) = (at, now_ms(), false);
            } else if !placed && rest.is_some() && now_ms() - since >= REST_MS {
                placed = true;
                settle(&app, window.clone());
            }
        }
        widget(&app).dragging.store(false, Ordering::Relaxed);
        // The move loop kept the release from the page, which may have gone on selecting meanwhile.
        crate::emit(&app, "moved", Value::Null);
        if !placed {
            settle(&app, window);
        }
    });
}

/// Whether the pointer has left where it rested, by more than the twitch of fingers lifting.
fn apart(a: Option<(f64, f64)>, b: Option<(f64, f64)>) -> bool {
    matches!((a, b), (Some(a), Some(b)) if (a.0 - b.0).hypot(a.1 - b.1) > 2.0)
}

pub(crate) fn settle(app: &AppHandle, window: WebviewWindow) {
    let Some(from) = current(&window) else { return };
    let size = *widget(app).size.lock().unwrap();
    let to = rehome(app, &window, from, size);
    animate(app, window, from, to, now_ms(), GLIDE_MS, GLIDE);
}

// Makes the home the grid's place for a card at `from` shown at `size`, remembers it, and gives where the
// card shows from there. Off every display, `from` is on the nearest one's grid.
fn rehome(app: &AppHandle, window: &WebviewWindow, from: Rect, size: (f64, f64)) -> Rect {
    let state = widget(app);
    let compact = *state.compact.lock().unwrap();
    let work = area_of(window, from.x + from.w / 2.0, from.y + from.h / 2.0);
    let widgets = system_widgets();
    let home = place(from, size, compact, desktop_of(window, work), work, &widgets);
    *state.home.lock().unwrap() = Some(home);
    state.save();
    grow(home, size, compact, work, &widgets)
}

/// When a display goes, the window may already be on another, the system having moved it, while the home
/// is still on the one that went; the widget settles from wherever it is. It waits a moment for the
/// system to move it. A home still on a display stays.
#[cfg(target_os = "macos")]
pub fn watch_displays(app: &AppHandle, window: &WebviewWindow) {
    use block2::RcBlock;
    use objc2_app_kit::NSApplicationDidChangeScreenParametersNotification;
    use objc2_foundation::NSNotificationCenter;

    let (app, window) = (app.clone(), window.clone());
    let changed = RcBlock::new(move |_: std::ptr::NonNull<objc2_foundation::NSNotification>| {
        let (app, window) = (app.clone(), window.clone());
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(500));
            let state = widget(&app);
            let home = *state.home.lock().unwrap();
            let compact = *state.compact.lock().unwrap();
            if !state.dragging.load(Ordering::Relaxed) && home.is_some_and(|home| lost(&window, home, compact)) {
                settle(&app, window);
            }
        });
    });
    // SAFETY: the block only hands the work to a thread of its own. The observer stays for the app's life.
    let observer = unsafe {
        NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(Some(NSApplicationDidChangeScreenParametersNotification), None, None, &changed)
    };
    std::mem::forget(observer);
}

#[cfg(not(target_os = "macos"))]
pub fn watch_displays(_app: &AppHandle, _window: &WebviewWindow) {}

/// For the CI check: the home corner moves to a point the window stays away from, as when its display goes.
#[cfg(feature = "probe")]
pub(crate) fn strand(app: &AppHandle, x: f64, y: f64) {
    *widget(app).home.lock().unwrap() = Some((x, y));
}

/// A cubic Bézier easing, as CSS writes one: (x1, y1, x2, y2).
type Curve = (f64, f64, f64, f64);

fn ease(t: f64, (x1, y1, x2, y2): Curve) -> f64 {
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
        let x = bezier(s, x1, x2) - t;
        let dx = slope(s, x1, x2);
        if x.abs() < 1e-5 || dx.abs() < 1e-6 {
            break;
        }
        s -= x / dx;
    }
    bezier(s.clamp(0.0, 1.0), y1, y2)
}

/// A background thread samples the curve from the shared wall clock and hands each frame to the main
/// thread, so page and window agree on every frame without talking to each other. It takes one frame
/// per refresh of the screen, as Windows paces its own on DwmFlush: on a timer of its own, 10ms apart
/// against the screen's 16.7, the window moved one step on some refreshes and two on others, and a
/// glide stuttered.
fn animate(app: &AppHandle, window: WebviewWindow, from: Rect, to: Rect, start: f64, ms: f64, curve: Curve) {
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
        let refresh = Refresh::new();
        loop {
            if widget(&app).animation.load(Ordering::SeqCst) != generation {
                return;
            }
            let t = ((now_ms() - start) / ms).clamp(0.0, 1.0);
            let e = ease(t, curve);
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
            refresh.wait();
        }
    });
}

/// Wakes a thread at each refresh of the main screen; every 8ms without a display link. CVDisplayLink
/// is deprecated from macOS 15, but its replacement, the window's display link, is 14's.
struct Refresh {
    #[cfg(target_os = "macos")]
    link: Option<Link>,
}

#[cfg(target_os = "macos")]
type Tick = dyn Fn(
    std::ptr::NonNull<objc2_core_video::CVDisplayLink>,
    std::ptr::NonNull<objc2_core_video::CVTimeStamp>,
    std::ptr::NonNull<objc2_core_video::CVTimeStamp>,
    objc2_core_video::CVOptionFlags,
    std::ptr::NonNull<objc2_core_video::CVOptionFlags>,
) -> objc2_core_video::CVReturn;

#[cfg(target_os = "macos")]
struct Link {
    link: objc2_core_foundation::CFRetained<objc2_core_video::CVDisplayLink>,
    ticks: std::sync::mpsc::Receiver<()>,
    // Kept for as long as the link may call it.
    _tick: block2::RcBlock<Tick>,
}

impl Refresh {
    #[cfg(target_os = "macos")]
    #[allow(deprecated)]
    fn new() -> Self {
        use objc2_core_video::{kCVReturnSuccess, CVDisplayLink};
        use std::ptr::NonNull;
        let mut raw: *mut CVDisplayLink = std::ptr::null_mut();
        // SAFETY: `raw` is a valid out-pointer, and on success holds a link this side now owns.
        let link = unsafe {
            if CVDisplayLink::create_with_active_cg_displays(NonNull::from(&mut raw)) != kCVReturnSuccess {
                return Self { link: None };
            }
            let Some(raw) = NonNull::new(raw) else { return Self { link: None } };
            objc2_core_foundation::CFRetained::from_raw(raw)
        };
        let (tick, ticks) = std::sync::mpsc::channel();
        let handler: block2::RcBlock<Tick> = block2::RcBlock::new(move |_, _, _, _, _| {
            let _ = tick.send(());
            kCVReturnSuccess
        });
        // SAFETY: the block outlives the link's use of it: the link is stopped before either goes.
        if unsafe { link.set_output_handler(&*handler as *const _ as *mut _) } != kCVReturnSuccess || link.start() != kCVReturnSuccess {
            return Self { link: None };
        }
        Self { link: Some(Link { link, ticks, _tick: handler }) }
    }

    #[cfg(not(target_os = "macos"))]
    fn new() -> Self {
        Self {}
    }

    /// Until the next refresh; at once if one went by while the last frame was being made.
    fn wait(&self) {
        #[cfg(target_os = "macos")]
        if let Some(Link { ticks, .. }) = &self.link {
            let _ = ticks.recv_timeout(Duration::from_millis(50));
            while ticks.try_recv().is_ok() {}
            return;
        }
        std::thread::sleep(Duration::from_millis(8));
    }
}

#[cfg(target_os = "macos")]
impl Drop for Refresh {
    #[allow(deprecated)]
    fn drop(&mut self) {
        if let Some(Link { link, .. }) = &self.link {
            link.stop();
        }
    }
}

/// Where the pointer is, in points on the desktop.
#[cfg(target_os = "macos")]
fn cursor() -> Option<(f64, f64)> {
    let at = objc2_app_kit::NSEvent::mouseLocation();
    Some((at.x, at.y))
}

#[cfg(not(target_os = "macos"))]
fn cursor() -> Option<(f64, f64)> {
    None
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
        untile(ns);
    }
    crate::glass::round_window(window, RADIUS);
    let _ = window.set_shadow(true);
}

/// The window's own class, tao's, for overriding its methods: not the subclass key-value observing puts
/// over it, which goes again once nothing observes the window, and the overrides with it.
#[cfg(target_os = "macos")]
pub(crate) fn own_class(ns: &objc2::runtime::AnyObject) -> &'static objc2::runtime::AnyClass {
    let mut class = ns.class();
    while class.name().to_bytes().starts_with(b"NSKVONotifying_") {
        match class.superclass() {
            Some(parent) => class = parent,
            None => break,
        }
    }
    class
}

/// The system's window tiling (macOS 15 on) moves a window dropped with the pointer at a screen edge
/// into that half of the screen: once the button is up, it asks the window to go there. The widget
/// declines, as its place is the grid's. Taken, the request carried the widget off the grid just after it landed there,
/// while the place it saved stayed where it had landed.
#[cfg(target_os = "macos")]
fn untile(ns: &objc2_app_kit::NSWindow) {
    use objc2::runtime::{AnyObject, Bool, Imp, Sel};
    extern "C-unwind" fn decline(_: &AnyObject, _: Sel, _geometry: *mut AnyObject, _springs: *mut AnyObject, done: *mut block2::Block<dyn Fn(Bool)>) {
        // SAFETY: the window manager's completion block, which takes whether the window resized.
        if let Some(done) = unsafe { done.as_ref() } {
            done.call((Bool::NO,));
        }
    }
    let class = own_class(ns);
    let sel = objc2::sel!(_resizeFromWindowManagerWithTargetGeometry:springSettings:completion:);
    // SAFETY: the method takes (id, id, block) and returns nothing, as `decline` does; a system without
    // tiling never sends it.
    unsafe {
        let imp = std::mem::transmute::<extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject, *mut AnyObject, *mut block2::Block<dyn Fn(Bool)>), Imp>(decline);
        objc2::ffi::class_replaceMethod(class as *const _ as *mut _, sel, imp, c"v40@0:8@16@24@?32".as_ptr());
    }
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
        // The system's widgets cast no shadow. Neither does airy glass, which is theirs, nor Mist, which
        // sits among them: the Windows widget's shadow read as a blurred rim beside them.
        let shadow = if clear {
            !crate::glass::apply(window, RADIUS, dark)
        } else {
            crate::glass::mist(window);
            false
        };
        let _ = window.set_shadow(shadow);
        return;
    }
    crate::glass::clear(window);
    let _ = window.set_shadow(true);
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

    // The desktop the user measured on 2026-10-17: 1470 by 956, a 33pt menu bar, the Dock below 880,
    // and three of the system's widgets down the left: two small ones and a medium one under them.
    const DESK: Rect = Rect { x: 0.0, y: 33.0, w: 1470.0, h: 923.0 };
    const WORK: Rect = Rect { x: 0.0, y: 33.0, w: 1470.0, h: 847.0 };
    const THEIRS: [Rect; 3] = [
        Rect { x: 16.0, y: 49.0, w: 164.0, h: 164.0 },
        Rect { x: 196.0, y: 49.0, w: 164.0, h: 164.0 },
        Rect { x: 16.0, y: 229.0, w: 344.0, h: 164.0 },
    ];
    const COMPACT: (f64, f64) = (344.0, 324.0);

    #[test]
    fn keeps_a_gap_from_system_widgets() {
        let card = |x: f64, y: f64| Rect { x, y, w: 344.0, h: 324.0 };
        // A gap past the medium widget's right edge, and a gap under it.
        assert!(clear(&card(376.0, 229.0), &THEIRS));
        assert!(clear(&card(16.0, 409.0), &THEIRS));
        // Over it, and closer than a gap.
        assert!(!clear(&card(16.0, 229.0), &THEIRS));
        assert!(!clear(&card(370.0, 229.0), &THEIRS));
    }

    #[test]
    fn rests_clear_of_system_widgets() {
        let at = |x: f64, y: f64| Rect { x, y, w: 344.0, h: 324.0 };
        // Dropped on the medium widget: under it, the nearest place clear of it.
        assert_eq!(place(at(16.0, 229.0), COMPACT, COMPACT, DESK, WORK, &THEIRS), (16.0, 409.0));
        // Dropped on the small ones: beside them, a step to the right.
        assert_eq!(place(at(150.0, 50.0), COMPACT, COMPACT, DESK, WORK, &THEIRS), (376.0, 49.0));
        // Where nothing is in the way, the grid's nearest place, as before.
        assert_eq!(place(at(700.0, 300.0), COMPACT, COMPACT, DESK, WORK, &THEIRS), (736.0, 256.0));
        assert_eq!(place(at(150.0, 40.0), COMPACT, COMPACT, DESK, WORK, &[]), (196.0, 49.0));
    }

    #[test]
    fn grows_away_from_system_widgets() {
        let room = Rect { x: 0.0, y: 0.0, w: 2000.0, h: 2000.0 };
        let small = |x: f64, y: f64| Rect { x, y, w: 164.0, h: 164.0 };
        let large = (440.0, 600.0);
        let home = (500.0, 700.0);
        let grown = |widgets: &[Rect]| {
            let r = grow(home, large, COMPACT, room, widgets);
            (r.x, r.y)
        };
        // Nothing in the way: to the right and down.
        assert_eq!(grown(&[]), (500.0, 700.0));
        // A widget to the right: to the left, the compact card's right edge kept.
        assert_eq!(grown(&[small(900.0, 700.0)]), (404.0, 700.0));
        // A widget below as well: up and to the left, its bottom right corner kept.
        assert_eq!(grown(&[small(900.0, 700.0), small(500.0, 1200.0)]), (404.0, 424.0));
        // Hemmed in all round: to the right and down, over them while large.
        assert_eq!(grown(&[small(900.0, 700.0), small(500.0, 1200.0), small(300.0, 450.0), small(700.0, 450.0)]), (500.0, 700.0));
    }

    #[test]
    fn a_large_card_dropped_rests_where_it_shows_near_the_drop() {
        // Dropped large just right of the small widgets, where growing to the right and down is clear.
        let dropped = Rect { x: 380.0, y: 55.0, w: 440.0, h: 600.0 };
        assert_eq!(place(dropped, (440.0, 600.0), COMPACT, DESK, WORK, &THEIRS), (376.0, 49.0));
        // Dropped large as low as it goes, where the Dock pushes it up from any home below: the home
        // is the nearest place to it, not the lowest of those.
        let low = Rect { x: 736.0, y: 264.0, w: 440.0, h: 600.0 };
        assert_eq!(place(low, (440.0, 600.0), COMPACT, DESK, WORK, &THEIRS), (736.0, 256.0));
    }

    #[test]
    fn the_compact_card_stays_where_it_rests() {
        // On the bottom row, partly over the Dock's place: there, not pushed above the Dock.
        assert_eq!(grow((736.0, 616.0), COMPACT, COMPACT, WORK, &THEIRS), Rect { x: 736.0, y: 616.0, w: 344.0, h: 324.0 });
        // Large from there, it is pushed above the Dock.
        assert_eq!(grow((736.0, 616.0), (440.0, 600.0), COMPACT, WORK, &[]).y, 264.0);
    }

    // Random desktops, displays to the left too, short work areas and up to eight of the system's widgets:
    // never a number that isn't one, the compact card on the desktop and clear of them wherever the grid
    // has room, and a large card inside the work area's margin wherever that is tall and wide enough.
    #[test]
    fn places_sensibly_on_any_desktop() {
        let mut seed: u64 = 42;
        let mut rnd = move || { seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407); (seed >> 11) as f64 / (1u64 << 53) as f64 };
        let mut fails = 0;
        for case in 0..5000 {
            let w = 800.0 + rnd() * 2400.0; let h = 600.0 + rnd() * 1300.0; let bar = 24.0 + rnd() * 20.0; let dock = if rnd() < 0.5 { 0.0 } else { 50.0 + rnd() * 60.0 };
            let x0 = if rnd() < 0.3 { -w } else { 0.0 };
            let desk = Rect { x: x0, y: bar, w, h: h - bar };
            let work = Rect { x: x0, y: bar, w, h: h - bar - dock };
            let n = (rnd() * 8.0) as usize;
            let widgets: Vec<Rect> = (0..n).map(|_| { let s = if rnd() < 0.5 { (164.0, 164.0) } else if rnd() < 0.5 { (344.0, 164.0) } else { (344.0, 344.0) }; Rect { x: x0 + 16.0 + (rnd() * (w - 200.0)).floor(), y: bar + 16.0 + (rnd() * (h - 300.0)).floor(), w: s.0, h: s.1 } }).collect();
            let compact = (344.0, 320.0 + (rnd() * 60.0).floor());
            let size = if rnd() < 0.5 { compact } else { (440.0, 600.0) };
            let from = Rect { x: x0 - 400.0 + rnd() * (w + 800.0), y: rnd() * h, w: size.0, h: size.1 };
            let home = place(from, size, compact, desk, work, &widgets);
            let shown = grow(home, size, compact, work, &widgets);
            let finite = [home.0, home.1, shown.x, shown.y].iter().all(|v| v.is_finite());
            let rest = Rect { x: home.0, y: home.1, w: compact.0, h: compact.1 };
            // Some clear place exists on the grid?
            let any = stops(desk.x, desk.right(), compact.0, &[]).iter().any(|&x| stops(desk.y, desk.bottom(), compact.1, &[]).iter().any(|&y| clear(&Rect { x, y, w: compact.0, h: compact.1 }, &widgets)));
            let on_desk = rest.x >= desk.x - 0.01 && rest.right() <= desk.right() + 0.01 && rest.y >= desk.y - 0.01 && rest.bottom() <= desk.bottom() + 0.01;
            let large_inside = size == compact || (shown.x >= work.x - 0.01 && shown.y >= work.y - 0.01 && (shown.right() <= work.right() - EDGE + 0.01 || shown.w + EDGE > work.w) && (shown.bottom() <= work.bottom() - EDGE + 0.01 || shown.h + EDGE > work.h));
            if !finite || (any && !clear(&rest, &widgets)) || !on_desk || !large_inside {
                fails += 1;
                if fails < 6 { eprintln!("case {case}: finite {finite} any {any} clear {} on_desk {on_desk} large_inside {large_inside} desk {desk:?} work {work:?} from {from:?} size {size:?} home {home:?} shown {shown:?} widgets {widgets:?}", clear(&rest, &widgets)); }
            }
        }
        assert_eq!(fails, 0);
    }

    #[test]
    fn curve_ends_and_eases_out() {
        assert_eq!(ease(0.0, MORPH), 0.0);
        assert_eq!(ease(1.0, MORPH), 1.0);
        assert!(ease(0.3, MORPH) > 0.6);
        // The glide onto the grid is nearly there (about 95%) 100ms into its 220.
        assert!(ease(100.0 / GLIDE_MS, GLIDE) > 0.94);
    }
}
