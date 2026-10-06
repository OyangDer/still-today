// The Mac host: the Tauri counterpart of host/ (C# + WebView2). The page talks to it through one
// command, `bridge`, with the same method names and payloads as host/Bridge.cs, and hears back on
// one event, `host`, carrying the same `{ev, d}` messages.
//
// M0: enough for the page to boot, save and size itself. Methods not ported yet answer null.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewWindow};

// Keep in step with host/Placement.cs.
const MARGIN: f64 = 20.0;

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|_| "store")?;
    fs::create_dir_all(&dir).map_err(|_| "store")?;
    Ok(dir)
}

fn read_or_null(path: &Path) -> Value {
    fs::read_to_string(path).map(Value::String).unwrap_or(Value::Null)
}

// Write-then-replace, as host/Store.cs: the new bytes reach the disk before the swap, and the
// version replaced stays beside it as the backup.
fn write_atomic(path: &Path, content: &str, backup: &Path) -> std::io::Result<()> {
    let temp = path.with_extension("json.tmp");
    let mut file = fs::File::create(&temp)?;
    file.write_all(content.as_bytes())?;
    file.sync_all()?;
    drop(file);
    if path.exists() {
        fs::copy(path, backup)?;
    }
    fs::rename(&temp, path)
}

fn boot(app: &AppHandle) -> Result<Value, String> {
    let dir = data_dir(app)?;
    Ok(json!({
        "version": app.package_info().version.to_string(),
        "locale": sys_locale::get_locale().unwrap_or_else(|| "en".into()),
        "data": read_or_null(&dir.join("data.json")),
        "backup": read_or_null(&dir.join("data.json.bak")),
        "legacy": false,
        "autostart": false,
        "canvasHost": null,
        "canvasAvatar": null,
        "glass": true,
        "platform": std::env::consts::OS,
    }))
}

fn size_of(p: &Value) -> Result<LogicalSize<f64>, String> {
    let w = p["width"].as_f64().ok_or("size")?;
    let h = p["height"].as_f64().ok_or("size")?;
    Ok(LogicalSize::new(w, h))
}

// First show: the primary monitor's top-right corner, as host/Placement.cs does with no saved spot.
fn place(window: &WebviewWindow, size: LogicalSize<f64>) -> tauri::Result<()> {
    if let Some(monitor) = window.primary_monitor()? {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let left = area.position.x as f64 / scale;
        let top = area.position.y as f64 / scale;
        let width = area.size.width as f64 / scale;
        window.set_position(LogicalPosition::new(left + width - size.width - MARGIN, top + MARGIN))?;
    }
    Ok(())
}

#[tauri::command]
fn bridge(app: AppHandle, window: WebviewWindow, m: String, p: Value) -> Result<Value, String> {
    let fail = |_| String::from("host");
    match m.as_str() {
        "boot" => boot(&app),
        "ready" => {
            let size = size_of(&p)?;
            window.set_size(size).map_err(fail)?;
            place(&window, size).map_err(fail)?;
            window.show().map_err(fail)?;
            Ok(Value::Null)
        }
        // M0 jumps to the new size; the eased morph comes in M2.
        "morph" => {
            window.set_size(size_of(&p)?).map_err(fail)?;
            Ok(Value::Null)
        }
        "drag" => {
            window.start_dragging().map_err(fail)?;
            Ok(Value::Null)
        }
        "save" => {
            let data = p["data"].as_str().ok_or("save")?;
            let dir = data_dir(&app)?;
            write_atomic(&dir.join("data.json"), data, &dir.join("data.json.bak")).map_err(|_| "store")?;
            Ok(Value::Null)
        }
        "hide" => {
            window.hide().map_err(fail)?;
            Ok(Value::Null)
        }
        "quit" => {
            app.exit(0);
            Ok(Value::Null)
        }
        _ => {
            #[cfg(debug_assertions)]
            eprintln!("bridge: {m} not ported yet");
            Ok(Value::Null)
        }
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![bridge])
        .run(tauri::generate_context!())
        .expect("Still Today failed to start");
}
