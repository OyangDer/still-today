// The menu bar icon and notifications, as host/Tray.cs is the tray icon and its balloons.
use std::sync::Mutex;

use serde_json::Value;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};

use crate::{emit, widget};

// Everything else lives in Settings. Keep in step with host/Tray.cs.
const LAYOUT: [&str; 4] = ["toggle", "settings", "-", "quit"];

#[derive(Default)]
pub struct Items(Mutex<Vec<(&'static str, MenuItem<Wry>)>>);

pub fn menu_bar(app: &AppHandle) -> tauri::Result<()> {
    let menu = Menu::new(app)?;
    let mut items = Vec::new();
    for key in LAYOUT {
        if key == "-" {
            menu.append(&PredefinedMenuItem::separator(app)?)?;
            continue;
        }
        // Labels arrive from the page in its language straight after boot.
        let item = MenuItem::with_id(app, key, key, true, None::<&str>)?;
        menu.append(&item)?;
        items.push((key, item));
    }
    *app.state::<Items>().0.lock().unwrap() = items;
    // A template image: the Mac tints it to suit the menu bar.
    TrayIconBuilder::with_id("main")
        .icon(Image::from_bytes(include_bytes!("../icons/menubar.png"))?)
        .icon_as_template(true)
        .tooltip("Still Today")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| action(app, event.id().as_ref()))
        .build(app)?;
    Ok(())
}

pub fn labels(app: &AppHandle, labels: &Value) {
    for (key, item) in app.state::<Items>().0.lock().unwrap().iter() {
        if let Some(text) = labels[*key].as_str() {
            let _ = item.set_text(text);
        }
    }
}

fn action(app: &AppHandle, action: &str) {
    let Some(window) = app.get_webview_window("main") else { return };
    match action {
        "toggle" => {
            if window.is_visible().unwrap_or(false) {
                let _ = window.hide();
                emit(app, "hidden", Value::Null);
            } else {
                widget::show(app, &window);
                emit(app, "shown", Value::Null);
            }
        }
        "quit" => app.exit(0),
        _ => {
            if action == "settings" {
                widget::present(app, &window);
                emit(app, "shown", Value::Null);
            }
            emit(app, "tray", Value::String(action.into()));
        }
    }
}

/// A click brings the widget forward and opens what the notification was about.
#[cfg(target_os = "macos")]
pub fn notify(app: &AppHandle, title: String, body: String, tag: String) {
    use mac_notification_sys::{Notification, NotificationResponse};
    let app = app.clone();
    // Waiting for the click holds this thread, not the app.
    std::thread::spawn(move || {
        let response = Notification::new().title(&title).message(&body).wait_for_click(true).send();
        if let Ok(NotificationResponse::Click) = response {
            let main = app.clone();
            let _ = app.run_on_main_thread(move || {
                let Some(window) = main.get_webview_window("main") else { return };
                widget::present(&main, &window);
                emit(&main, "shown", Value::Null);
                emit(&main, "notice", Value::String(tag));
            });
        }
    });
}

// The Windows trial build has the WebView2 host's toasts to compare against; it shows none itself.
#[cfg(not(target_os = "macos"))]
pub fn notify(_app: &AppHandle, title: String, _body: String, tag: String) {
    #[cfg(debug_assertions)]
    eprintln!("notify [{tag}]: {title}");
    let _ = (title, tag);
}

/// Notifications carry the app's name and icon once it says which bundle it is.
#[cfg(target_os = "macos")]
pub fn init_notifications(app: &AppHandle) {
    let _ = mac_notification_sys::set_application(&app.config().identifier);
}

#[cfg(not(target_os = "macos"))]
pub fn init_notifications(_app: &AppHandle) {}

#[cfg(target_os = "macos")]
pub fn autostart(app: &AppHandle, on: Option<bool>) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    match on {
        Some(true) => {
            let _ = launcher.enable();
        }
        Some(false) => {
            let _ = launcher.disable();
        }
        None => {}
    }
    launcher.is_enabled().unwrap_or(false)
}

// Not on the Windows trial build: it would register the debug build to start with Windows.
#[cfg(not(target_os = "macos"))]
pub fn autostart(_app: &AppHandle, _on: Option<bool>) -> bool {
    false
}

