// Test-only remote control for the Mac CI check, as CDP is for the Windows trial build: WKWebView has
// no debugging port. Built only with `--features probe`; the .dmg testers get never contains it.
// One JSON request per line on 127.0.0.1:9334, one JSON reply per line.
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, LogicalPosition, Manager, WebviewWindow};

use crate::widget;

#[derive(Default)]
pub struct Probe {
    waiting: Mutex<HashMap<u64, mpsc::Sender<Value>>>,
    next: AtomicU64,
}

pub fn start(app: &AppHandle) {
    app.manage(Probe::default());
    let app = app.clone();
    std::thread::spawn(move || {
        let listener = TcpListener::bind("127.0.0.1:9334").expect("probe port");
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            std::thread::spawn(move || serve(&app, stream));
        }
    });
}

fn serve(app: &AppHandle, stream: TcpStream) {
    let Ok(read) = stream.try_clone() else { return };
    let mut write = stream;
    for line in BufReader::new(read).lines().map_while(Result::ok) {
        let request: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
        if writeln!(write, "{}", handle(app, &request)).is_err() {
            return;
        }
    }
}

fn handle(app: &AppHandle, request: &Value) -> Value {
    let Some(window) = app.get_webview_window("main") else { return json!({ "error": "window" }) };
    if let Some(js) = request["js"].as_str() {
        return eval(app, &window, js);
    }
    match request["native"].as_str() {
        Some("state") => state(&window),
        Some("move") => {
            let (x, y) = (request["x"].as_f64().unwrap_or(0.0), request["y"].as_f64().unwrap_or(0.0));
            let target = window.clone();
            let _ = window.run_on_main_thread(move || {
                let _ = target.set_position(LogicalPosition::new(x, y));
            });
            Value::Null
        }
        // What a drop does once the button comes up; a real drag needs a real mouse.
        Some("settle") => {
            widget::settle(app, window);
            Value::Null
        }
        // The menu's Show, as shell::action does it.
        Some("show") => {
            let (app, target) = (app.clone(), window.clone());
            let _ = window.run_on_main_thread(move || {
                widget::show(&app, &target);
                crate::emit(&app, "shown", Value::Null);
            });
            Value::Null
        }
        Some("wake") => {
            wake();
            Value::Null
        }
        // Another material behind the page, for the comparison sheet; the page's next theme change
        // puts its own back.
        Some("material") => {
            let (request, target) = (request.clone(), window.clone());
            let (tx, rx) = mpsc::channel();
            let _ = window.run_on_main_thread(move || {
                let _ = tx.send(material(&target, &request));
            });
            rx.recv_timeout(Duration::from_secs(5)).unwrap_or(json!({ "error": "timeout" }))
        }
        Some("pill") => {
            let (request, (tx, rx)) = (request.clone(), mpsc::channel());
            let _ = window.with_webview(move |webview| {
                let _ = tx.send(pill(webview.inner(), &request));
            });
            rx.recv_timeout(Duration::from_secs(5)).unwrap_or(json!({ "error": "timeout" }))
        }
        _ => json!({ "error": "request" }),
    }
}

// The page's own call, from a script the check puts in it to follow the page's pill.
pub fn place_pill(window: &WebviewWindow, request: Value) {
    let _ = window.with_webview(move |webview| {
        let _ = pill(webview.inner(), &request);
    });
}

// {x, show?, ms?}: a Liquid Glass pill just behind the page, under the tab labels where the page's
// own pill sits (x in points from the page's left edge). It stretches toward the tab it is going
// to, then settles there. A look at Apple's own selection glass, not yet the widget's.
#[cfg(target_os = "macos")]
fn pill(webview: *mut std::ffi::c_void, request: &Value) -> Value {
    use std::cell::{Cell, RefCell};
    use std::ptr::NonNull;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSAnimatablePropertyContainer, NSAnimationContext, NSGlassEffectView, NSGlassEffectViewStyle, NSView, NSWindowOrderingMode};
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    use objc2_quartz_core::CAMediaTimingFunction;

    thread_local! {
        static PILL: RefCell<Option<Retained<NSGlassEffectView>>> = const { RefCell::new(None) };
        static MOVE: Cell<u64> = const { Cell::new(0) };
    }
    const W: f64 = 88.0;
    const H: f64 = 38.0;
    // The page's pill sits 8pt above the bottom edge, with the tab bar's concentric corner.
    const LIFT: f64 = 8.0;
    const RADIUS: f64 = 14.0;

    let Some(mtm) = MainThreadMarker::new() else { return json!({ "error": "thread" }) };
    if objc2::runtime::AnyClass::get(c"NSGlassEffectView").is_none() {
        return json!({ "error": "needs macOS 26" });
    }
    // SAFETY: Tauri hands back the live WKWebView, used here on the main thread.
    let page = unsafe { &*(webview as *const NSView) };
    let Some(parent) = (unsafe { page.superview() }) else { return json!({ "error": "superview" }) };
    let pill = PILL.with_borrow_mut(|slot| {
        slot.get_or_insert_with(|| {
            let view = NSGlassEffectView::initWithFrame(mtm.alloc(), NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(W, H)));
            view.setStyle(NSGlassEffectViewStyle::Regular);
            view.setCornerRadius(RADIUS);
            view
        })
        .clone()
    });
    if unsafe { pill.superview() }.as_deref() != Some(&*parent) {
        pill.removeFromSuperview();
        // Behind the page, so the labels stay sharp on top and clicks still reach the page.
        parent.addSubview_positioned_relativeTo(&pill, NSWindowOrderingMode::Below, Some(page));
    }

    let f = page.frame();
    let y = if parent.isFlipped() { f.origin.y + f.size.height - LIFT - H } else { f.origin.y + LIFT };
    let to = NSRect::new(NSPoint::new(f.origin.x + request["x"].as_f64().unwrap_or(0.0), y), NSSize::new(W, H));
    let ms = request["ms"].as_f64().unwrap_or(0.0);
    pill.setHidden(!request["show"].as_bool().unwrap_or(true));
    let from = pill.frame();
    let run = MOVE.with(|m| {
        m.set(m.get() + 1);
        m.get()
    });
    if ms <= 0.0 || from.origin.x == to.origin.x {
        pill.setFrame(to);
        return json!({ "ok": true });
    }

    // The leading edge runs ahead and the trailing edge lags, the pill a little squashed: the glass
    // reads as liquid. Then it springs into place, just past and back.
    let d = to.origin.x - from.origin.x;
    let (left, right) = if d > 0.0 { (from.origin.x + 0.3 * d, from.origin.x + W + 0.8 * d) } else { (from.origin.x + 0.8 * d, from.origin.x + W + 0.3 * d) };
    let stretched = NSRect::new(NSPoint::new(left, y + 2.0), NSSize::new(right - left, H - 4.0));
    let seconds = ms / 1000.0;
    let (target, settle) = (pill.clone(), pill.clone());
    let changes = RcBlock::new(move |context: NonNull<NSAnimationContext>| {
        let context = unsafe { context.as_ref() };
        context.setDuration(seconds * 0.45);
        context.setTimingFunction(Some(&CAMediaTimingFunction::functionWithControlPoints(0.4, 0.0, 0.6, 1.0)));
        target.animator().setFrame(stretched);
    });
    let done = RcBlock::new(move || {
        // A newer move has taken over.
        if MOVE.with(Cell::get) != run {
            return;
        }
        let settle = settle.clone();
        let changes = RcBlock::new(move |context: NonNull<NSAnimationContext>| {
            let context = unsafe { context.as_ref() };
            context.setDuration(seconds * 0.55);
            context.setTimingFunction(Some(&CAMediaTimingFunction::functionWithControlPoints(0.3, 1.35, 0.5, 1.0)));
            settle.animator().setFrame(to);
        });
        NSAnimationContext::runAnimationGroup(&changes);
    });
    NSAnimationContext::runAnimationGroup_completionHandler(&changes, Some(&done));
    json!({ "ok": true })
}

#[cfg(not(target_os = "macos"))]
fn pill(_webview: *mut std::ffi::c_void, _request: &Value) -> Value {
    json!({ "error": "mac only" })
}

// Runs `js` as the body of an async function in the page and returns {ok, r}.
fn eval(app: &AppHandle, window: &WebviewWindow, js: &str) -> Value {
    let probe = app.state::<Probe>();
    let id = probe.next.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel();
    probe.waiting.lock().unwrap().insert(id, tx);
    let script = format!(
        "(async () => {{ let ok = true, r; try {{ r = await (async () => {{ {js}\n }})(); }} catch (e) {{ ok = false; r = String(e); }} \
         window.__TAURI__.core.invoke('bridge', {{ m: 'probe.reply', p: {{ id: {id}, ok, r: r ?? null }} }}); }})();"
    );
    if window.eval(&script).is_err() {
        return json!({ "ok": false, "r": "eval" });
    }
    let reply = rx.recv_timeout(Duration::from_secs(15)).unwrap_or(json!({ "ok": false, "r": "timeout" }));
    probe.waiting.lock().unwrap().remove(&id);
    reply
}

pub fn reply(app: &AppHandle, p: &Value) {
    let id = p["id"].as_u64().unwrap_or(u64::MAX);
    if let Some(tx) = app.state::<Probe>().waiting.lock().unwrap().remove(&id) {
        let _ = tx.send(json!({ "ok": p["ok"], "r": p["r"] }));
    }
}

// Where the window is, in points, beside the work area it is measured against.
fn state(window: &WebviewWindow) -> Value {
    let s = window.scale_factor().unwrap_or(1.0);
    let p = window.outer_position().map(|p| (p.x as f64 / s, p.y as f64 / s)).unwrap_or_default();
    let z = window.outer_size().map(|z| (z.width as f64 / s, z.height as f64 / s)).unwrap_or_default();
    let work = window.primary_monitor().ok().flatten().map(|m| {
        let (a, s) = (m.work_area(), m.scale_factor());
        json!({ "x": a.position.x as f64 / s, "y": a.position.y as f64 / s, "w": a.size.width as f64 / s, "h": a.size.height as f64 / s })
    });
    let (level, behavior) = level(window);
    json!({
        "x": p.0, "y": p.1, "w": z.0, "h": z.1, "scale": s,
        "visible": window.is_visible().unwrap_or(false),
        "work": work, "level": level, "behavior": behavior,
    })
}

#[cfg(target_os = "macos")]
fn level(window: &WebviewWindow) -> (Value, Value) {
    use objc2_app_kit::NSWindow;
    let Ok(ns) = window.ns_window() else { return (Value::Null, Value::Null) };
    // SAFETY: as in widget::dress; reading two properties.
    let ns = unsafe { &*(ns as *const NSWindow) };
    (json!(ns.level()), json!(ns.collectionBehavior().0))
}

#[cfg(not(target_os = "macos"))]
fn level(_window: &WebviewWindow) -> (Value, Value) {
    (Value::Null, Value::Null)
}

// {name, dark?, radius?, tint?: [r, g, b, a]}: the material, the window's appearance, the corner
// radius it is clipped to, and Liquid Glass's tint.
#[cfg(target_os = "macos")]
fn material(window: &WebviewWindow, request: &Value) -> Value {
    use objc2_app_kit::NSWindow;
    use tauri::window::{Effect, EffectState, EffectsBuilder};
    use window_vibrancy::{apply_liquid_glass, clear_liquid_glass, LiquidGlassOptions, NSGlassEffectViewStyle};
    let name = request["name"].as_str().unwrap_or("");
    let radius = request["radius"].as_f64().unwrap_or(widget::RADIUS);
    let dark = request["dark"].as_bool().unwrap_or(false);
    let _ = window.set_theme(Some(if dark { tauri::Theme::Dark } else { tauri::Theme::Light }));
    if let Ok(ns) = window.ns_window() {
        // SAFETY: as in widget::dress.
        let ns = unsafe { &*(ns as *const NSWindow) };
        if let Some(layer) = ns.contentView().and_then(|v| v.layer()) {
            layer.setCornerRadius(radius);
        }
    }
    let _ = clear_liquid_glass(window);
    let _ = window.set_effects(None);
    let glass = match name {
        "glass" => Some(NSGlassEffectViewStyle::Regular),
        "glass-clear" => Some(NSGlassEffectViewStyle::Clear),
        _ => None,
    };
    if let Some(style) = glass {
        let mut options = LiquidGlassOptions::new(style).radius(radius);
        if let Some(t) = request["tint"].as_array().filter(|t| t.len() == 4) {
            let c = |i: usize| t[i].as_u64().unwrap_or(0).min(255) as u8;
            options = options.tint_color((c(0), c(1), c(2), c(3)));
        }
        return match apply_liquid_glass(window, options) {
            Ok(()) => json!({ "ok": true }),
            Err(e) => json!({ "error": e.to_string() }),
        };
    }
    let effect = match name {
        "popover" => Effect::Popover,
        "sidebar" => Effect::Sidebar,
        "hud" => Effect::HudWindow,
        "under-window" => Effect::UnderWindowBackground,
        "menu" => Effect::Menu,
        "sheet" => Effect::Sheet,
        "fullscreen" => Effect::FullScreenUI,
        _ => return json!({ "error": "material" }),
    };
    match window.set_effects(EffectsBuilder::new().effect(effect).state(EffectState::Active).radius(radius).build()) {
        Ok(()) => json!({ "ok": true }),
        Err(e) => json!({ "error": e.to_string() }),
    }
}

#[cfg(not(target_os = "macos"))]
fn material(_window: &WebviewWindow, _request: &Value) -> Value {
    json!({ "error": "mac only" })
}

// Stands in for the Mac waking: the same notification shell::watch_wake listens for.
#[cfg(target_os = "macos")]
fn wake() {
    use objc2_app_kit::{NSWorkspace, NSWorkspaceDidWakeNotification};
    // SAFETY: AppKit's own constant, no sender.
    unsafe { NSWorkspace::sharedWorkspace().notificationCenter().postNotificationName_object(NSWorkspaceDidWakeNotification, None) };
}

#[cfg(not(target_os = "macos"))]
fn wake() {}
