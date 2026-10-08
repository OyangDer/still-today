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

/// Liquid Glass behind the page, clipped to the widget's corner: clear as the system's widgets are, or
/// frosted. False where there is none.
#[cfg(target_os = "macos")]
pub fn apply(window: &WebviewWindow, radius: f64, clear: bool) -> bool {
    use window_vibrancy::{apply_liquid_glass, clear_liquid_glass, LiquidGlassOptions, NSGlassEffectViewStyle};
    let _ = clear_liquid_glass(window);
    let style = if clear { NSGlassEffectViewStyle::Clear } else { NSGlassEffectViewStyle::Regular };
    available() && apply_liquid_glass(window, LiquidGlassOptions::new(style).radius(radius)).is_ok() && {
        keep_active(window);
        true
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
        let class = (*(ns as *const AnyObject)).class() as *const AnyClass;
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
