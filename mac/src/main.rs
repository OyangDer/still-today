// The Mac host: the Tauri counterpart of host/ (C# + WebView2). The page talks to it through one
// command, `bridge`, with the same method names and payloads as host/Bridge.cs, and hears back on
// one event, `host`, carrying the same `{ev, d}` messages.
//
// What the Mac has no counterpart for answers null: the legacy import, and the wallpaper sampling
// that tints Aura (phase 2).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod glass;
mod http;
#[cfg(feature = "probe")]
mod probe;
mod secrets;
mod shell;
mod widget;

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, WindowEvent};
use tauri_plugin_opener::OpenerExt;
use url::Url;

const CHIME: &[u8] = include_bytes!("../../host/Chime.wav");

pub struct Host {
    dir: PathBuf,
    widget: widget::Widget,
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
pub fn write_atomic(path: &Path, content: &str, backup: Option<&Path>) -> std::io::Result<()> {
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

pub fn emit(app: &AppHandle, ev: &str, d: Value) {
    let _ = app.emit_to("main", "host", json!({ "ev": ev, "d": d }));
}

fn boot(app: &AppHandle, host: &Host) -> Result<Value, String> {
    Ok(json!({
        "version": app.package_info().version.to_string(),
        "locale": sys_locale::get_locale().unwrap_or_else(|| "en".into()),
        "data": read_or_null(&host.data()),
        "backup": read_or_null(&host.backup()),
        "legacy": false,
        "autostart": shell::autostart(app, None),
        "canvasHost": secrets::canvas()?.map(|(host, _)| host),
        "canvasAvatar": read_or_null(&host.avatar()),
        "glass": widget::glass(),
        "liquid": glass::available(),
        "platform": std::env::consts::OS,
        "morph": host.widget.morph.load(std::sync::atomic::Ordering::Relaxed),
    }))
}

fn size_of(p: &Value) -> Result<(f64, f64), String> {
    Ok((p["width"].as_f64().ok_or("size")?, p["height"].as_f64().ok_or("size")?))
}

fn str_of<'a>(p: &'a Value, key: &str) -> Result<&'a str, String> {
    p[key].as_str().ok_or_else(|| key.to_string())
}

#[cfg(target_os = "macos")]
fn chime(app: &AppHandle) {
    use objc2::rc::Retained;
    use objc2::AllocAnyThread;
    use objc2_app_kit::NSSound;
    use objc2_foundation::NSData;
    thread_local! {
        // A sound stops when it is released, so the latest is held until the next.
        static PLAYING: std::cell::RefCell<Option<Retained<NSSound>>> = const { std::cell::RefCell::new(None) };
    }
    let _ = app.run_on_main_thread(|| {
        let data = NSData::with_bytes(CHIME);
        if let Some(sound) = NSSound::initWithData(NSSound::alloc(), &data) {
            sound.play();
            PLAYING.with(|p| *p.borrow_mut() = Some(sound));
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn chime(_app: &AppHandle) {
    use std::io::Cursor;
    std::thread::spawn(|| {
        let Ok((_stream, output)) = rodio::OutputStream::try_default() else { return };
        let Ok(sink) = rodio::Sink::try_new(&output) else { return };
        let Ok(source) = rodio::Decoder::new(Cursor::new(CHIME)) else { return };
        sink.append(source);
        sink.sleep_until_end();
    });
}

fn set_alarm(app: &AppHandle, host: &Host, at: Option<i64>, title: Option<String>, body: Option<String>) {
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
        chime(&app);
        let hidden = app.get_webview_window("main").is_some_and(|w| !w.is_visible().unwrap_or(false));
        if let (true, Some(title)) = (hidden, title) {
            shell::notify(&app, title, body.unwrap_or_default(), "focus".into());
        }
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
            let (w, h) = size_of(&p)?;
            widget::reveal(&app, window, w, h);
            Ok(Value::Null)
        }
        "morph" => {
            let (w, h) = size_of(&p)?;
            let start = p["start"].as_f64().ok_or("start")?;
            let ms = p["ms"].as_f64().ok_or("ms")?;
            widget::morph(&app, window, w, h, start, ms);
            Ok(Value::Null)
        }
        "drag" => {
            widget::drag(&app, window);
            Ok(Value::Null)
        }
        "save" => {
            let data = str_of(&p, "data")?;
            let _turn = host.saving.lock().unwrap();
            write_atomic(&host.data(), data, Some(&host.backup())).map_err(|_| "store")?;
            Ok(Value::Null)
        }
        "hide" => {
            let _ = window.hide();
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
            let text = |key: &str| p[key].as_str().map(String::from);
            set_alarm(&app, &host, p["at"].as_f64().map(|at| at as i64), text("title"), text("body"));
            Ok(Value::Null)
        }
        "chime" => {
            chime(&app);
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
        "material" => {
            let (aura, dark) = (p["aura"].as_bool().unwrap_or(true), p["dark"].as_bool().unwrap_or(false));
            let target = window.clone();
            let _ = window.run_on_main_thread(move || widget::material(&target, aura, dark));
            Ok(Value::Null)
        }
        // The tab bar's selection, in Liquid Glass behind the page: {x, ms, show}.
        "pill" => {
            let _ = window.with_webview(move |webview| {
                let _ = glass::pill(webview.inner(), &p);
            });
            Ok(Value::Null)
        }
        "topmost" => {
            widget::set_topmost(&app, window, p["on"].as_bool().unwrap_or(false));
            Ok(Value::Null)
        }
        "autostart" => Ok(Value::Bool(shell::autostart(&app, p["on"].as_bool()))),
        "tray" => {
            shell::labels(&app, &p["labels"]);
            Ok(Value::Null)
        }
        "notify" => {
            shell::notify(&app, str_of(&p, "title")?.into(), str_of(&p, "body")?.into(), str_of(&p, "tag")?.into());
            Ok(Value::Null)
        }
        // The beta's switch between an eased and an instant size change.
        "morph.set" => {
            host.widget.morph.store(p["on"].as_bool().unwrap_or(true), std::sync::atomic::Ordering::Relaxed);
            host.widget.save();
            Ok(Value::Null)
        }
        #[cfg(feature = "probe")]
        "probe.reply" => {
            probe::reply(&app, &p);
            Ok(Value::Null)
        }
        #[cfg(feature = "probe")]
        "probe.pill" => {
            probe::place_pill(&window, p);
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
    let builder = tauri::Builder::default()
        // A second launch brings the running widget forward instead of starting another.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                widget::present(app, &window);
                emit(app, "shown", Value::Null);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri::plugin::Builder::<tauri::Wry>::new("guard").on_navigation(|_, url| own_page(url)).build());
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_plugin_autostart::init(
        tauri_plugin_autostart::MacosLauncher::LaunchAgent,
        Some(vec!["--autostart"]),
    ));
    builder
        .manage(shell::Items::default())
        .setup(|app| {
            // A menu bar app: no Dock icon, no app menu.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let dir = app.path().app_local_data_dir()?;
            fs::create_dir_all(&dir)?;
            let widget = widget::Widget::load(&dir);
            app.manage(Host { dir, widget, alarm: Mutex::new(None), saving: Mutex::new(()) });
            if let Some(window) = app.get_webview_window("main") {
                widget::dress(&window);
            }
            shell::menu_bar(app.handle())?;
            shell::init_notifications(app.handle());
            shell::watch_wake(app.handle());
            #[cfg(feature = "probe")]
            probe::start(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let (WindowEvent::Focused(false), Some(webview)) = (event, window.app_handle().get_webview_window(window.label())) {
                widget::blurred(window.app_handle(), &webview);
            }
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
