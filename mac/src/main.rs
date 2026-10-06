// The Mac host: the Tauri counterpart of host/ (C# + WebView2). The page talks to it through one
// command, `bridge`, with the same method names and payloads as host/Bridge.cs, and hears back on
// one event, `host`, carrying the same `{ev, d}` messages.
//
// M1: the store, secrets, Canvas, feeds, the focus timer, the chime and outside links. The Mac shell
// (material, topmost, menu bar, notifications, autostart) comes in M2; until then those answer null.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod http;
mod secrets;

use std::fs;
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, WebviewWindow};
use tauri_plugin_opener::OpenerExt;
use url::Url;

// Keep in step with host/Placement.cs.
const MARGIN: f64 = 20.0;
const CHIME: &[u8] = include_bytes!("../../host/Chime.wav");

struct Host {
    dir: PathBuf,
    // The focus timer's end is kept here, not in the page: a hidden page throttles its timers, and
    // the chime has to land on the second.
    alarm: Mutex<Option<JoinHandle<()>>>,
    // Saves go to the disk one at a time.
    saving: Mutex<()>,
}

impl Host {
    fn data(&self) -> PathBuf {
        self.dir.join("data.json")
    }
    // The version each save replaced: what the page opens on should the latest be unreadable.
    fn backup(&self) -> PathBuf {
        self.dir.join("data.json.bak")
    }
    // The Canvas profile picture as a data: URL, kept so Settings shows it offline.
    fn avatar(&self) -> PathBuf {
        self.dir.join("avatar.txt")
    }
}

fn read_or_null(path: &Path) -> Value {
    fs::read_to_string(path).map(Value::String).unwrap_or(Value::Null)
}

// Write-then-replace, as host/Store.cs: the new bytes reach the disk before the swap, and with a
// `backup` path the version replaced stays there.
fn write_atomic(path: &Path, content: &str, backup: Option<&Path>) -> std::io::Result<()> {
    let mut temp = path.as_os_str().to_owned();
    temp.push(".tmp");
    let temp = PathBuf::from(temp);
    let mut file = fs::File::create(&temp)?;
    file.write_all(content.as_bytes())?;
    file.sync_all()?;
    drop(file);
    if let (Some(backup), true) = (backup, path.exists()) {
        fs::copy(path, backup)?;
    }
    fs::rename(&temp, path)
}

fn emit(app: &AppHandle, ev: &str, d: Value) {
    let _ = app.emit_to("main", "host", json!({ "ev": ev, "d": d }));
}

fn boot(app: &AppHandle, host: &Host) -> Result<Value, String> {
    Ok(json!({
        "version": app.package_info().version.to_string(),
        "locale": sys_locale::get_locale().unwrap_or_else(|| "en".into()),
        "data": read_or_null(&host.data()),
        "backup": read_or_null(&host.backup()),
        "legacy": false,
        "autostart": false,
        "canvasHost": secrets::canvas()?.map(|(host, _)| host),
        "canvasAvatar": read_or_null(&host.avatar()),
        "glass": true,
        "platform": std::env::consts::OS,
    }))
}

fn size_of(p: &Value) -> Result<LogicalSize<f64>, String> {
    let w = p["width"].as_f64().ok_or("size")?;
    let h = p["height"].as_f64().ok_or("size")?;
    Ok(LogicalSize::new(w, h))
}

fn str_of<'a>(p: &'a Value, key: &str) -> Result<&'a str, String> {
    p[key].as_str().ok_or_else(|| key.to_string())
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

// Window calls go through the main thread, where the windowing system expects them.
fn on_main(app: &AppHandle, f: impl FnOnce() + Send + 'static) -> Result<(), String> {
    app.run_on_main_thread(f).map_err(|_| "host".into())
}

fn chime() {
    std::thread::spawn(|| {
        let Ok((_stream, output)) = rodio::OutputStream::try_default() else { return };
        let Ok(sink) = rodio::Sink::try_new(&output) else { return };
        let Ok(source) = rodio::Decoder::new(Cursor::new(CHIME)) else { return };
        sink.append(source);
        sink.sleep_until_end();
    });
}

fn set_alarm(app: &AppHandle, host: &Host, at: Option<i64>) {
    let mut alarm = host.alarm.lock().unwrap();
    if let Some(old) = alarm.take() {
        old.abort();
    }
    let Some(at) = at else { return };
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64);
    let due = Duration::from_millis((at - now).max(0) as u64);
    let app = app.clone();
    *alarm = Some(tauri::async_runtime::spawn(async move {
        tokio::time::sleep(due).await;
        chime();
        // M2: a notification when the widget is hidden, as host/Bridge.cs does.
        emit(&app, "alarm", Value::Null);
    }));
}

// Web pages, and email addresses for the mail app. A mail link goes out as the bare address: some
// mail apps act on fields such as attach= in the rest of it.
fn external(url: &str) -> Option<String> {
    let url = Url::parse(url).ok()?;
    match url.scheme() {
        "https" => Some(url.to_string()),
        "mailto" => {
            let (local, domain) = url.path().split_once('@')?;
            let plain = |s: &str, extra: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || extra.contains(c));
            (plain(local, "._+-") && plain(domain, ".-")).then(|| format!("mailto:{local}@{domain}"))
        }
        _ => None,
    }
}

fn valid_host(host: &str) -> Option<Url> {
    let url = Url::parse(&format!("https://{}", host.trim())).ok()?;
    let bare = url.path() == "/" && url.query().is_none() && url.fragment().is_none() && url.port().is_none()
        && url.username().is_empty() && url.password().is_none() && url.host_str().is_some();
    bare.then_some(url)
}

// The token is verified against /users/self before it is stored, and afterwards every Canvas
// request goes to the host saved beside it: the page can choose the path, never the host.
async fn canvas_connect(host: &str, token: &str) -> Result<Value, String> {
    let Some(root) = valid_host(host) else { return Ok(json!({ "status": -3 })) };
    let token = token.trim();
    let reply = http::canvas_get(root.join("/api/v1/users/self").map_err(|_| "url")?, token).await;
    if reply.status == 200 {
        secrets::set_canvas(root.host_str().unwrap_or_default(), token)?;
    }
    Ok(reply.json())
}

async fn canvas_get(path: &str) -> Result<Value, String> {
    let Some((host, token)) = secrets::canvas()? else { return Ok(json!({ "status": 401 })) };
    if !path.starts_with("/api/v1/") {
        return Err("path".into());
    }
    let url = Url::parse(&format!("https://{host}{path}")).map_err(|_| "path")?;
    if url.host_str() != Some(host.as_str()) {
        return Err("path".into());
    }
    Ok(http::canvas_get(url, &token).await.json())
}

// The picture is fetched without the token: Canvas redirects it to its file store with a signed
// link. No picture clears the cache; a failed download keeps the last one.
async fn canvas_avatar(host: &Host, url: Option<&str>) -> Result<Value, String> {
    let Some(url) = url else {
        let _ = fs::remove_file(host.avatar());
        return Ok(Value::Null);
    };
    let canvas = secrets::canvas()?.map(|(h, _)| h);
    let url = Url::parse(url).map_err(|_| "url")?;
    let same = canvas.as_deref().zip(url.host_str()).is_some_and(|(a, b)| a.eq_ignore_ascii_case(b));
    if url.scheme() != "https" || !same {
        return Err("url".into());
    }
    match http::image_get(url).await {
        Some(avatar) => {
            write_atomic(&host.avatar(), &avatar, None).map_err(|_| "store")?;
            Ok(Value::String(avatar))
        }
        None => Ok(read_or_null(&host.avatar())),
    }
}

async fn feed_add(raw: &str) -> Result<Value, String> {
    let raw = raw.trim();
    let webcal = raw.get(..7).is_some_and(|s| s.eq_ignore_ascii_case("webcal:"));
    let text = if webcal { format!("https:{}", &raw[7..]) } else { raw.to_string() };
    let Ok(mut url) = Url::parse(&text) else { return Ok(json!({ "status": -3 })) };
    if webcal {
        let _ = url.set_port(None);
    }
    if url.scheme() != "https" {
        return Ok(json!({ "status": -4 }));
    }
    // Credential Manager keeps at most 2,560 bytes of secret: 1,280 characters of link. The
    // Keychain has no such limit.
    #[cfg(windows)]
    if url.as_str().len() > 1280 {
        return Ok(json!({ "status": -6 }));
    }
    let reply = http::feed_get(url.clone()).await;
    let mut value = reply.json();
    let calendar = reply.body.as_deref().is_some_and(|b| b.to_ascii_uppercase().contains("BEGIN:VCALENDAR"));
    if reply.status == 200 && calendar {
        let id = uuid::Uuid::new_v4().simple().to_string();
        secrets::write(&secrets::feed(&id), url.as_str())?;
        value["id"] = json!(id);
        value["host"] = json!(url.host_str());
    }
    Ok(value)
}

async fn feed_get(id: &str) -> Result<Value, String> {
    let Some(url) = secrets::read(&secrets::feed(id))? else { return Ok(json!({ "status": -5 })) };
    Ok(http::feed_get(Url::parse(&url).map_err(|_| "secret")?).await.json())
}

#[tauri::command]
async fn bridge(app: AppHandle, window: WebviewWindow, host: State<'_, Host>, m: String, p: Value) -> Result<Value, String> {
    match m.as_str() {
        "boot" => boot(&app, &host),
        "ready" => {
            let size = size_of(&p)?;
            on_main(&app, move || {
                let _ = window.set_size(size);
                let _ = place(&window, size);
                let _ = window.show();
            })?;
            Ok(Value::Null)
        }
        // M1 jumps to the new size; the eased morph comes in M2.
        "morph" => {
            let size = size_of(&p)?;
            on_main(&app, move || {
                let _ = window.set_size(size);
            })?;
            Ok(Value::Null)
        }
        "drag" => {
            on_main(&app, move || {
                let _ = window.start_dragging();
            })?;
            Ok(Value::Null)
        }
        "save" => {
            let data = str_of(&p, "data")?;
            let _turn = host.saving.lock().unwrap();
            write_atomic(&host.data(), data, Some(&host.backup())).map_err(|_| "store")?;
            Ok(Value::Null)
        }
        "hide" => {
            on_main(&app, move || {
                let _ = window.hide();
            })?;
            emit(&app, "hidden", Value::Null);
            Ok(Value::Null)
        }
        "quit" => {
            app.exit(0);
            Ok(Value::Null)
        }
        "open" => {
            if let Some(target) = external(str_of(&p, "url")?) {
                let _ = app.opener().open_url(target, None::<&str>);
            }
            Ok(Value::Null)
        }
        "legacy" => Ok(Value::Null),
        "alarm" => {
            set_alarm(&app, &host, p["at"].as_f64().map(|at| at as i64));
            Ok(Value::Null)
        }
        "chime" => {
            chime();
            Ok(Value::Null)
        }
        "canvas.connect" => canvas_connect(str_of(&p, "host")?, str_of(&p, "token")?).await,
        "canvas.get" => canvas_get(str_of(&p, "path")?).await,
        "canvas.schools" => Ok(http::school_search(str_of(&p, "name")?).await.json()),
        "canvas.avatar" => canvas_avatar(&host, p["url"].as_str()).await,
        "canvas.disconnect" => {
            secrets::delete(secrets::CANVAS);
            let _ = fs::remove_file(host.avatar());
            Ok(Value::Null)
        }
        "feed.add" => feed_add(str_of(&p, "url")?).await,
        "feed.get" => feed_get(str_of(&p, "id")?).await,
        "feed.remove" => {
            secrets::delete(&secrets::feed(str_of(&p, "id")?));
            Ok(Value::Null)
        }
        // The Mac shell, M2.
        "autostart" => Ok(Value::Bool(false)),
        "material" | "topmost" | "tray" | "notify" => {
            #[cfg(debug_assertions)]
            eprintln!("bridge: {m} comes in M2");
            Ok(Value::Null)
        }
        _ => Err("method".into()),
    }
}

// The page never leaves its own origin: links go out through `open`, to the browser.
fn own_page(url: &Url) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" | "https" => url.host_str() == Some("tauri.localhost") || (cfg!(debug_assertions) && url.host_str() == Some("localhost")),
        _ => false,
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri::plugin::Builder::<tauri::Wry>::new("guard").on_navigation(|_, url| own_page(url)).build())
        .setup(|app| {
            let dir = app.path().app_local_data_dir()?;
            fs::create_dir_all(&dir)?;
            app.manage(Host { dir, alarm: Mutex::new(None), saving: Mutex::new(()) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![bridge])
        .run(tauri::generate_context!())
        .expect("Still Today failed to start");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_links() {
        assert_eq!(external("https://canvas.example.edu/courses/1").as_deref(), Some("https://canvas.example.edu/courses/1"));
        assert_eq!(external("mailto:tutor@uni.edu?attach=/etc/passwd").as_deref(), Some("mailto:tutor@uni.edu"));
        assert_eq!(external("http://example.com"), None);
        assert_eq!(external("javascript:alert(1)"), None);
        assert_eq!(external("file:///C:/Windows"), None);
        assert_eq!(external("mailto:nobody"), None);
    }

    #[test]
    fn canvas_hosts() {
        assert!(valid_host(" canvas.sydney.edu.au ").is_some());
        assert!(valid_host("canvas.sydney.edu.au/x").is_none());
        assert!(valid_host("canvas.sydney.edu.au:8443").is_none());
        assert!(valid_host("evil@canvas.sydney.edu.au").is_none());
        assert!(valid_host("").is_none());
    }

    #[test]
    fn own_origin_only() {
        assert!(own_page(&Url::parse("http://tauri.localhost/").unwrap()));
        assert!(own_page(&Url::parse("tauri://localhost/").unwrap()));
        assert!(!own_page(&Url::parse("https://example.com/").unwrap()));
    }
}
