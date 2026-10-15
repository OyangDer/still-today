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

/// A click brings the widget forward and opens what the notification was about: the tag rides in the
/// notification's userInfo, and the widget's own delegate hears the click (`Notices`).
#[cfg(target_os = "macos")]
pub fn notify(app: &AppHandle, title: String, body: String, tag: String) {
    #![allow(deprecated)]
    use objc2::runtime::AnyObject;
    use objc2_foundation::{ns_string, NSDictionary, NSString, NSUserNotification};
    let _ = app.run_on_main_thread(move || {
        let Some(center) = notices::center() else { return };
        let notice = NSUserNotification::new();
        notice.setTitle(Some(&NSString::from_str(&title)));
        notice.setInformativeText(Some(&NSString::from_str(&body)));
        let tag = NSString::from_str(&tag);
        let info = NSDictionary::<NSString, AnyObject>::from_slices(&[ns_string!("tag")], &[&*tag as &AnyObject]);
        // SAFETY: a dictionary of property-list objects, as userInfo must be.
        unsafe { notice.setUserInfo(Some(&info)) };
        center.deliverNotification(&notice);
    });
}

/// The delegate that hears a click on one of the widget's notifications. mac-notification-sys waited for
/// the click itself, holding a thread and checking twice a second on the main thread for as long as the
/// notification stayed in Notification Center, which is until the user clears it: every notification
/// left there added one more of each.
#[cfg(target_os = "macos")]
mod notices {
    #![allow(deprecated)]
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, NSObject};
    use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass};
    use objc2_foundation::{ns_string, NSObjectProtocol, NSString, NSUserNotification, NSUserNotificationCenter, NSUserNotificationCenterDelegate};
    use serde_json::Value;
    use tauri::{AppHandle, Manager};

    pub struct Ivars {
        app: AppHandle,
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "StillTodayNotices"]
        #[ivars = Ivars]
        pub struct Notices;

        unsafe impl NSObjectProtocol for Notices {}

        unsafe impl NSUserNotificationCenterDelegate for Notices {
            #[unsafe(method(userNotificationCenter:didActivateNotification:))]
            fn activated(&self, _center: &NSUserNotificationCenter, notification: &NSUserNotification) {
                let tag = notification
                    .userInfo()
                    .and_then(|info| info.objectForKey(ns_string!("tag")))
                    .and_then(|tag| tag.downcast::<NSString>().ok())
                    .map(|tag| tag.to_string())
                    .unwrap_or_default();
                let app = &self.ivars().app;
                let Some(window) = app.get_webview_window("main") else { return };
                crate::widget::present(app, &window);
                crate::emit(app, "shown", Value::Null);
                crate::emit(app, "notice", Value::String(tag));
            }
        }
    );

    impl Notices {
        pub fn new(app: AppHandle) -> Retained<Self> {
            let this = Self::alloc().set_ivars(Ivars { app });
            // SAFETY: NSObject's plain init.
            unsafe { msg_send![super(this), init] }
        }
    }

    /// The shared notification center, or none where the app has no bundle to send as (a build run
    /// outside an .app before its identity is lent, or with no copy of the app installed).
    pub fn center() -> Option<Retained<NSUserNotificationCenter>> {
        let class = AnyClass::get(c"NSUserNotificationCenter")?;
        // SAFETY: a class method taking nothing, returning the shared center or nil.
        unsafe { msg_send![class, defaultUserNotificationCenter] }
    }
}

// The Windows trial build has the WebView2 host's toasts to compare against; it shows none itself.
#[cfg(not(target_os = "macos"))]
pub fn notify(_app: &AppHandle, title: String, _body: String, tag: String) {
    #[cfg(debug_assertions)]
    eprintln!("notify [{tag}]: {title}");
    let _ = (title, tag);
}

/// Notifications carry the app's name and icon once it says which bundle it is: mac-notification-sys
/// lends that identity to a build run outside an .app. The center keeps its delegate weakly, so this one
/// is kept for the app's life.
#[cfg(target_os = "macos")]
pub fn init_notifications(app: &AppHandle) {
    #![allow(deprecated)]
    use objc2::runtime::ProtocolObject;
    let _ = mac_notification_sys::set_application(&app.config().identifier);
    let Some(center) = notices::center() else { return };
    let delegate = notices::Notices::new(app.clone());
    // SAFETY: the delegate outlives the center's use of it: it is never released.
    unsafe { center.setDelegate(Some(ProtocolObject::from_ref(&*delegate))) };
    std::mem::forget(delegate);
}

#[cfg(not(target_os = "macos"))]
pub fn init_notifications(_app: &AppHandle) {}

/// After sleep the page refreshes what went stale, as on Windows after a resume.
#[cfg(target_os = "macos")]
pub fn watch_wake(app: &AppHandle) {
    use block2::RcBlock;
    use objc2_app_kit::{NSWorkspace, NSWorkspaceDidWakeNotification};
    use objc2_foundation::{NSNotification, NSOperationQueue};
    let app = app.clone();
    let block = RcBlock::new(move |_: std::ptr::NonNull<NSNotification>| {
        crate::rearm_alarm(&app);
        emit(&app, "wake", Value::Null);
    });
    // SAFETY: the name is AppKit's constant, there is no sender to match, and the block runs on the
    // main queue.
    let observer = unsafe {
        NSWorkspace::sharedWorkspace().notificationCenter().addObserverForName_object_queue_usingBlock(
            Some(NSWorkspaceDidWakeNotification),
            None,
            Some(&NSOperationQueue::mainQueue()),
            &block,
        )
    };
    // Kept for the life of the app.
    std::mem::forget(observer);
}

// The Windows trial build is checked against the WebView2 host, which has its own resume event.
#[cfg(not(target_os = "macos"))]
pub fn watch_wake(_app: &AppHandle) {}

#[cfg(target_os = "macos")]
pub fn autostart(app: &AppHandle, on: Option<bool>) -> bool {
    use std::sync::atomic::{AtomicBool, Ordering};
    use tauri_plugin_autostart::ManagerExt;
    // The demo shares the login item with the real widget, and its first run turns the switch on: its
    // switch moves, and the login item stays as the real widget left it.
    static DEMO: AtomicBool = AtomicBool::new(false);
    if crate::demo() {
        if let Some(on) = on {
            DEMO.store(on, Ordering::Relaxed);
        }
        return DEMO.load(Ordering::Relaxed);
    }
    let launcher = app.autolaunch();
    let result = match on {
        Some(true) => launcher.enable(),
        Some(false) => launcher.disable(),
        None => Ok(()),
    };
    // The Settings switch shows where it ended up; why it did not move goes to the log.
    if let Err(e) = result {
        eprintln!("autostart {on:?}: {e}");
    }
    launcher.is_enabled().unwrap_or_else(|e| {
        eprintln!("autostart state: {e}");
        false
    })
}

// Not on the Windows trial build: it would register the debug build to start with Windows.
#[cfg(not(target_os = "macos"))]
pub fn autostart(_app: &AppHandle, _on: Option<bool>) -> bool {
    false
}

