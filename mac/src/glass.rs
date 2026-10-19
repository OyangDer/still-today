// Liquid Glass, macOS 26's own material: behind the whole widget, and as the tab bar's selection pill.
use serde_json::{json, Value};
#[cfg(target_os = "macos")]
use tauri::WebviewWindow;

/// Whether this Mac has Liquid Glass (macOS 26 and later) and draws translucency at all.
#[cfg(target_os = "macos")]
pub fn available() -> bool {
    objc2::runtime::AnyClass::get(c"NSGlassEffectView").is_some() && crate::widget::glass()
}

#[cfg(not(target_os = "macos"))]
pub fn available() -> bool {
    false
}

/// Liquid Glass behind the page, clipped to the widget's corner, airy as the system's widgets are.
/// False where there is none.
#[cfg(target_os = "macos")]
pub fn apply(window: &WebviewWindow, radius: f64, dark: bool) -> bool {
    use window_vibrancy::{apply_liquid_glass, clear_liquid_glass, LiquidGlassOptions, NSGlassEffectViewStyle};
    let _ = clear_liquid_glass(window);
    let options = LiquidGlassOptions::new(NSGlassEffectViewStyle::Regular).radius(radius);
    available() && apply_liquid_glass(window, options).is_ok() && {
        if system_glass() {
            widget_glass_27(window);
            window_blur(window, 0);
            follow_desktop(window);
        } else {
            widget_glass(window, dark);
            window_blur(window, WIDGET_BLUR);
        }
        keep_active(window);
        true
    }
}

/// Whether the system's widgets wear glass the widget can wear as is (macOS 27 on). There its blur,
/// colour and rim match theirs with nothing laid over it, and it follows the Liquid Glass slider in
/// System Settings as theirs does; macOS 26 needs the tint and blur below.
#[cfg(target_os = "macos")]
pub fn system_glass() -> bool {
    objc2_foundation::NSProcessInfo::processInfo().operatingSystemVersion().majorVersion >= 27
}

#[cfg(not(target_os = "macos"))]
pub fn system_glass() -> bool {
    false
}

/// The variant the system's widgets wear on macOS 27, matched beside them on 27.0.1 over plain and
/// striped wallpapers: the same colour over nine plain ones, the same blur, and the same bend at the
/// rim, at the slider's ends and middle alike.
#[cfg(target_os = "macos")]
const WIDGET_VARIANT_27: isize = 5;

#[cfg(target_os = "macos")]
fn widget_glass_27(window: &WebviewWindow) {
    use objc2::runtime::Bool;
    use objc2::{msg_send, sel};
    let Some(glass) = glass_view(window) else { return };
    // SAFETY: the glass view window-vibrancy just added; the setter is only sent where AppKit has it.
    unsafe {
        let known: Bool = msg_send![glass, respondsToSelector: sel!(set_variant:)];
        if known.as_bool() {
            let _: () = msg_send![glass, set_variant: WIDGET_VARIANT_27];
        }
    }
    subdue(window, SUBDUED.load(std::sync::atomic::Ordering::Relaxed));
}

/// The glass view window-vibrancy added to the window, found by its tag.
#[cfg(target_os = "macos")]
fn glass_view(window: &WebviewWindow) -> Option<*mut objc2::runtime::AnyObject> {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    let ns = window.ns_window().ok()?;
    // SAFETY: Tauri hands back the window's live NSWindow, used on the main thread.
    unsafe {
        let content: *mut AnyObject = msg_send![ns as *mut AnyObject, contentView];
        if content.is_null() {
            return None;
        }
        let glass: *mut AnyObject = msg_send![content, viewWithTag: GLASS_VIEW_TAG];
        (!glass.is_null()).then_some(glass)
    }
}

/// Whether the widget's glass wears the subdued look, as the system's widgets do while the desktop is
/// not what the user is in: dimmer and a little more blurred.
#[cfg(target_os = "macos")]
static SUBDUED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

#[cfg(target_os = "macos")]
fn subdue(window: &WebviewWindow, on: bool) {
    use objc2::runtime::Bool;
    use objc2::{msg_send, sel};
    let Some(glass) = glass_view(window) else { return };
    // SAFETY: the live glass view on the main thread. Key-value coding converts the number to whatever
    // the private setter takes; it is only used where AppKit has the setter.
    unsafe {
        let known: Bool = msg_send![glass, respondsToSelector: sel!(set_subduedState:)];
        if known.as_bool() {
            let value = objc2_foundation::NSNumber::new_isize(on as isize);
            let key = objc2_foundation::NSString::from_str("_subduedState");
            let _: () = msg_send![glass, setValue: &*value, forKey: &*key];
        }
    }
}

/// The system's widgets wear full colour while the user is on the desktop itself, and the subdued look
/// while they are in an app: the widget's glass follows, checked twice a second. On the desktop is
/// Finder in front with none of its windows over the others, or the widget itself in use.
#[cfg(target_os = "macos")]
fn follow_desktop(window: &WebviewWindow) {
    use std::sync::atomic::Ordering;
    use std::sync::{Mutex, Once};
    static WINDOW: Mutex<Option<WebviewWindow>> = Mutex::new(None);
    static START: Once = Once::new();
    *WINDOW.lock().unwrap_or_else(|e| e.into_inner()) = Some(window.clone());
    START.call_once(|| {
        std::thread::spawn(|| loop {
            std::thread::sleep(std::time::Duration::from_millis(500));
            let Some(window) = WINDOW.lock().unwrap_or_else(|e| e.into_inner()).clone() else { continue };
            let target = window.clone();
            let _ = window.run_on_main_thread(move || {
                let on = !on_desktop();
                if SUBDUED.swap(on, Ordering::Relaxed) != on {
                    subdue(&target, on);
                }
            });
        });
    });
}

/// Finder in front with no window of its own over the others' (the user clicked the wallpaper), or
/// this app in front (the widget in use).
#[cfg(target_os = "macos")]
fn on_desktop() -> bool {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString};

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> *mut NSArray<NSDictionary<NSString, AnyObject>>;
    }
    // On screen only, without the desktop's own windows, front to back.
    const ON_SCREEN_ONLY: u32 = 1;
    const NO_DESKTOP: u32 = 1 << 4;

    let Some(front) = objc2_app_kit::NSWorkspace::sharedWorkspace().frontmostApplication() else { return false };
    let pid = front.processIdentifier();
    if pid == std::process::id() as i32 {
        return true;
    }
    if front.bundleIdentifier().is_none_or(|id| id.to_string() != "com.apple.finder") {
        return false;
    }
    objc2::rc::autoreleasepool(|_| {
        // SAFETY: as in widget::system_widgets.
        let Some(list) = (unsafe { Retained::from_raw(CGWindowListCopyWindowInfo(ON_SCREEN_ONLY | NO_DESKTOP, 0)) }) else { return false };
        let number = |d: &NSDictionary<NSString, AnyObject>, key: &str| {
            d.objectForKey(&NSString::from_str(key)).and_then(|v| v.downcast::<NSNumber>().ok()).map(|n| n.doubleValue())
        };
        // The first ordinary window from the top: Finder's own means one of its windows is in use.
        list.iter().find(|info| number(info, "kCGWindowLayer") == Some(0.0)).is_none_or(|info| number(&info, "kCGWindowOwnerPID") != Some(pid as f64))
    })
}

/// Mist, the Windows widget's Aura: no glass, only the window server's blur behind the page, which
/// lays Aura's scrim over it (ui/src/lib/aura.ts).
#[cfg(target_os = "macos")]
pub fn mist(window: &WebviewWindow) {
    let _ = window_vibrancy::clear_liquid_glass(window);
    window_blur(window, MIST_BLUR);
}

/// How far Aura's blur spreads on Windows 11, matched the same way as airy glass below: over the same
/// stripes, a stripe's first harmonic keeps 0.655 of itself under DWM's blur, and as much under the
/// window server's at this radius in points.
#[cfg(target_os = "macos")]
const MIST_BLUR: i32 = 54;

/// The tag window-vibrancy gives the glass view it adds, so it can be found again.
#[cfg(target_os = "macos")]
const GLASS_VIEW_TAG: isize = 96945937;

/// The variant of Liquid Glass the system's light widgets wear: blurred like frosted glass, but tinted
/// by the wallpaper rather than whitened. AppKit keeps the variants private; matched beside the
/// widgets, in the same spot, on macOS 26.6. An AppKit without the setter keeps plain frosted glass.
#[cfg(target_os = "macos")]
const WIDGET_VARIANT: isize = 3;

// Airy glass is matched to the system's widgets by measurement on macOS 26.6: glass and widget side by
// side, the same size, over wallpapers made for it. Four plain greys and a blue give the colour each
// maps the wallpaper to; black and white stripes give how far it blurs and how much shows through.

/// Black over the variant, light look: the system's light widgets map every plain wallpaper to the
/// same colour as this, within 3 of 255.
#[cfg(target_os = "macos")]
const WIDGET_DIM: f64 = 0.18;

/// The dark look: this much black, and the page's grey veil over it (ui/src/lib/state.svelte.ts), let
/// as much of the wallpaper through as the system's dark widgets and give the same colours.
#[cfg(target_os = "macos")]
const WIDGET_DIM_DARK: f64 = 0.60;

/// Without the variant, plain glass tinted this much matches the dark widgets' colours, if not their
/// clarity.
#[cfg(target_os = "macos")]
const PLAIN_DIM_DARK: f64 = 0.15;

/// The system's widgets blur the wallpaper more than the variant does on its own. The window server's
/// blur behind the window, at this radius in points, makes up the rest: the stripes' edges then
/// spread as far as under the widgets, in either look.
#[cfg(target_os = "macos")]
const WIDGET_BLUR: i32 = 19;

#[cfg(target_os = "macos")]
fn widget_glass(window: &WebviewWindow, dark: bool) {
    use objc2::runtime::{AnyObject, Bool};
    use objc2::{msg_send, sel};
    let Ok(ns) = window.ns_window() else { return };
    // SAFETY: Tauri hands back the window's live NSWindow, and the glass view found by its tag is the
    // NSGlassEffectView window-vibrancy just added. The setter is only sent where AppKit has it.
    unsafe {
        let content: *mut AnyObject = msg_send![ns as *mut AnyObject, contentView];
        if content.is_null() {
            return;
        }
        let glass: *mut AnyObject = msg_send![content, viewWithTag: GLASS_VIEW_TAG];
        if glass.is_null() {
            return;
        }
        let known: Bool = msg_send![glass, respondsToSelector: sel!(set_variant:)];
        let dim = if known.as_bool() {
            let _: () = msg_send![glass, set_variant: WIDGET_VARIANT];
            if dark {
                WIDGET_DIM_DARK
            } else {
                WIDGET_DIM
            }
        } else if dark {
            PLAIN_DIM_DARK
        } else {
            return;
        };
        // Tinted after the variant, as it was matched.
        let tint = objc2_app_kit::NSColor::colorWithSRGBRed_green_blue_alpha(0.0, 0.0, 0.0, dim);
        let _: () = msg_send![glass, setTintColor: &*tint];
    }
}

/// The window server's blur behind the whole window, 0 for none. Private, as iTerm2 uses it; a Mac
/// without it keeps the glass's own blur.
#[cfg(target_os = "macos")]
fn window_blur(window: &WebviewWindow, radius: i32) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use std::ffi::{c_char, c_void};
    extern "C" {
        fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    }
    // RTLD_DEFAULT: look in every image already loaded.
    let everywhere = -2isize as *mut c_void;
    let Ok(ns) = window.ns_window() else { return };
    // SAFETY: both symbols are looked up by name and only called when found, with the signatures
    // SkyLight has kept since 10.x; the window number is the live NSWindow's own.
    unsafe {
        let connection = dlsym(everywhere, c"CGSMainConnectionID".as_ptr());
        let set = dlsym(everywhere, c"CGSSetWindowBackgroundBlurRadius".as_ptr());
        if connection.is_null() || set.is_null() {
            return;
        }
        let connection: unsafe extern "C" fn() -> u32 = std::mem::transmute(connection);
        let set: unsafe extern "C" fn(u32, u32, i32) -> i32 = std::mem::transmute(set);
        let number: isize = msg_send![ns as *mut AnyObject, windowNumber];
        set(connection(), number as u32, radius);
    }
}

/// The window server blurs and shadows a borderless window as a rectangle. This mask gives the window
/// the card's rounded corners there too, so its blur ends where the card does.
#[cfg(target_os = "macos")]
pub fn round_window(window: &WebviewWindow, radius: f64) {
    use block2::RcBlock;
    use objc2::ffi::{class_getInstanceMethod, class_replaceMethod, method_getTypeEncoding};
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
    use objc2::{msg_send, sel};
    use objc2_app_kit::{NSBezierPath, NSColor, NSImage};
    use objc2_foundation::{NSEdgeInsets, NSRect, NSSize};
    use std::panic::AssertUnwindSafe;
    use std::sync::atomic::{AtomicPtr, Ordering};

    static MASK: AtomicPtr<AnyObject> = AtomicPtr::new(std::ptr::null_mut());
    extern "C-unwind" fn mask(_: &AnyObject, _: Sel) -> *mut AnyObject {
        MASK.load(Ordering::Relaxed)
    }
    let Ok(ns) = window.ns_window() else { return };
    let ns = ns as *mut AnyObject;
    // This runs while the app finishes launching, where an Objective-C exception would end it: one
    // from these private corners only costs the window its rounded blur.
    let rounded = objc2::exception::catch(AssertUnwindSafe(|| {
        if MASK.load(Ordering::Relaxed).is_null() {
            let draw = RcBlock::new(move |rect: NSRect| -> Bool {
                NSColor::blackColor().set();
                NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(rect, radius, radius).fill();
                Bool::YES
            });
            let side = radius * 2.0 + 1.0;
            let image = NSImage::imageWithSize_flipped_drawingHandler(NSSize::new(side, side), false, &draw);
            image.setCapInsets(NSEdgeInsets { top: radius, left: radius, bottom: radius, right: radius });
            // AppKit insists the mask stretches, as a new image already does. Left alone: objc2-app-kit
            // 0.3.2's Stretch is Tile's value on Apple silicon.
            // Kept for the life of the app: the window asks for it again whenever its shape changes.
            MASK.store(Retained::into_raw(image).cast(), Ordering::Relaxed);
        }
        // SAFETY: as in keep_active, the override reaches only Tauri's own NSWindow subclass. The mask
        // is retained above and never released.
        unsafe {
            let class = crate::widget::own_class(&*ns) as *const AnyClass;
            let name = sel!(_cornerMask);
            let method = class_getInstanceMethod(class, name);
            if method.is_null() {
                return;
            }
            let imp: Imp = std::mem::transmute(mask as extern "C-unwind" fn(&AnyObject, Sel) -> *mut AnyObject);
            class_replaceMethod(class as *mut AnyClass, name, imp, method_getTypeEncoding(method));
            let _: () = msg_send![ns, invalidateShadow];
        }
    }));
    if let Err(exception) = rounded {
        eprintln!("glass: no rounded corners: {exception:?}");
    }
}

/// AppKit dulls the glass of a window that is not key, the clear variant to near frosted, and a desktop
/// widget is key only while clicked. Its window keeps the active look, as the system's widgets do.
#[cfg(target_os = "macos")]
fn keep_active(window: &WebviewWindow) {
    use objc2::ffi::{class_getInstanceMethod, class_replaceMethod, method_getTypeEncoding};
    use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
    use objc2::sel;

    extern "C-unwind" fn yes(_: &AnyObject, _: Sel) -> Bool {
        Bool::YES
    }
    let Ok(ns) = window.ns_window() else { return };
    // SAFETY: Tauri hands back the window's live NSWindow; its class is Tauri's own NSWindow subclass, so
    // the override reaches only its windows. A selector this AppKit lacks is left alone.
    unsafe {
        let class = crate::widget::own_class(&*(ns as *const AnyObject)) as *const AnyClass;
        for name in [sel!(_hasActiveAppearance), sel!(_hasActiveAppearanceIgnoringKeyFocus)] {
            let method = class_getInstanceMethod(class, name);
            if !method.is_null() {
                let imp: Imp = std::mem::transmute(yes as extern "C-unwind" fn(&AnyObject, Sel) -> Bool);
                class_replaceMethod(class as *mut AnyClass, name, imp, method_getTypeEncoding(method));
            }
        }
    }
}

#[cfg(target_os = "macos")]
pub fn clear(window: &WebviewWindow) {
    let _ = window_vibrancy::clear_liquid_glass(window);
    window_blur(window, 0);
}

// {x, show?, ms?, style?}: a Liquid Glass pill just behind the page, under the tab labels where the page's
// own pill sits (x in points from the page's left edge). It stretches toward the tab it is going
// to, then settles there. A look at Apple's own selection glass, not yet the widget's.
#[cfg(target_os = "macos")]
pub fn pill(webview: *mut std::ffi::c_void, request: &Value) -> Value {
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
    const RADIUS: f64 = 18.0;

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
            // Clear glass held to the light look. Left to choose its own look, the glass flips between light
            // and dark with whatever is behind the card, and flickers as the pill moves; held, it stays a
            // clear lens with a bright rim, as tried beside the other looks on macOS 26.6.
            view.setStyle(NSGlassEffectViewStyle::Clear);
            view.setCornerRadius(RADIUS);
            // SAFETY: a live view on the main thread; the private setter is only sent where AppKit has it.
            unsafe {
                use objc2::runtime::{AnyClass, AnyObject, Bool};
                use objc2::{msg_send, sel};
                if let Some(appearance) = AnyClass::get(c"NSAppearance") {
                    let name = objc2_foundation::NSString::from_str("NSAppearanceNameAqua");
                    let light: *mut AnyObject = msg_send![appearance, appearanceNamed: &*name];
                    let _: () = msg_send![&*view, setAppearance: light];
                }
                let known: Bool = msg_send![&*view, respondsToSelector: sel!(set_adaptiveAppearance:)];
                if known.as_bool() {
                    let _: () = msg_send![&*view, set_adaptiveAppearance: 1isize];
                }
            }
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
    let seconds = ms / 1000.0;
    // In step with the page: its curve (MORPH_CURVE in ui/src/lib/motion.ts), its duration, and
    // what is left of it once the call arrives, so the glass moves with the labels and the window.
    if request["style"].as_str() != Some("stretch") {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0);
        let left = request["start"].as_f64().map_or(ms, |start| ms - (now - start).max(0.0));
        if left <= 16.0 {
            pill.setFrame(to);
            return json!({ "ok": true });
        }
        let seconds = left / 1000.0;
        let target = pill.clone();
        let changes = RcBlock::new(move |context: NonNull<NSAnimationContext>| {
            let context = unsafe { context.as_ref() };
            context.setDuration(seconds);
            context.setTimingFunction(Some(&CAMediaTimingFunction::functionWithControlPoints(0.22, 0.8, 0.22, 1.0)));
            target.animator().setFrame(to);
        });
        NSAnimationContext::runAnimationGroup(&changes);
        return json!({ "ok": true });
    }

    // The leading edge runs ahead and the trailing edge lags, the pill a little squashed: the glass
    // reads as liquid. Then it springs into place, just past and back.
    let d = to.origin.x - from.origin.x;
    let (left, right) = if d > 0.0 { (from.origin.x + 0.3 * d, from.origin.x + W + 0.8 * d) } else { (from.origin.x + 0.8 * d, from.origin.x + W + 0.3 * d) };
    let stretched = NSRect::new(NSPoint::new(left, y + 2.0), NSSize::new(right - left, H - 4.0));
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
pub fn pill(_webview: *mut std::ffi::c_void, _request: &Value) -> Value {
    json!({ "error": "mac only" })
}
