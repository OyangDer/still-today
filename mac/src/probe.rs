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
            let (name, target) = (request["name"].as_str().unwrap_or("").to_string(), window.clone());
            let (tx, rx) = mpsc::channel();
            let _ = window.run_on_main_thread(move || {
                let _ = tx.send(material(&target, &name));
            });
            rx.recv_timeout(Duration::from_secs(5)).unwrap_or(json!({ "error": "timeout" }))
        }
        _ => json!({ "error": "request" }),
    }
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

#[cfg(target_os = "macos")]
fn material(window: &WebviewWindow, name: &str) -> Value {
    use tauri::window::{Effect, EffectState, EffectsBuilder};
    use window_vibrancy::{apply_liquid_glass, clear_liquid_glass, LiquidGlassOptions, NSGlassEffectViewStyle};
    let _ = clear_liquid_glass(window);
    let _ = window.set_effects(None);
    let glass = match name {
        "glass" => Some(NSGlassEffectViewStyle::Regular),
        "glass-clear" => Some(NSGlassEffectViewStyle::Clear),
        _ => None,
    };
    if let Some(style) = glass {
        return match apply_liquid_glass(window, LiquidGlassOptions::new(style).radius(widget::RADIUS)) {
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
    match window.set_effects(EffectsBuilder::new().effect(effect).state(EffectState::Active).radius(widget::RADIUS).build()) {
        Ok(()) => json!({ "ok": true }),
        Err(e) => json!({ "error": e.to_string() }),
    }
}

#[cfg(not(target_os = "macos"))]
fn material(_window: &WebviewWindow, _name: &str) -> Value {
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
