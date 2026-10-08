// A downloaded copy installs itself. Opened from Downloads (or straight from the .dmg) once the Mac has
// let it run, Still Today moves into Applications, drops the download quarantine the user has just
// approved, and starts again from there, so nobody has to drag it anywhere. A newer download opened
// the same way quits the running widget and takes the old one's place.
//
// Only a quarantined copy does this: builds made on this Mac, CI's included, never carry the flag.
use std::path::{Path, PathBuf};
use std::process::Command;

/// Moves this copy into Applications and relaunches it there; returns only if it stays put.
pub fn relocate() {
    let Some(bundle) = std::env::current_exe().ok().and_then(|exe| exe.ancestors().nth(3).map(Path::to_path_buf)) else { return };
    if bundle.extension().is_none_or(|e| e != "app") {
        return;
    }
    // Run from where it was downloaded, macOS starts the app from a hidden read-only copy instead.
    let source = original(&bundle).unwrap_or(bundle);
    if in_applications(&source) || !quarantined(&source) {
        return;
    }
    let Some(folder) = applications() else { return };
    let Some(name) = source.file_name() else { return };
    let target = folder.join(name);
    // Into a hidden name beside the old copy first, so a failed copy never costs the one already there.
    let staged = folder.join(".Still Today.app.new");
    let _ = std::fs::remove_dir_all(&staged);
    // A disk image is read-only: copy from it. Anywhere else, move, so no second copy is left behind.
    let staged_ok = if source.starts_with("/Volumes") {
        ditto(&source, &staged)
    } else {
        std::fs::rename(&source, &staged).is_ok() || (ditto(&source, &staged) && trash(&source))
    };
    if !staged_ok {
        return;
    }
    if target.exists() {
        quit_others();
        if !trash(&target) {
            return;
        }
    }
    if std::fs::rename(&staged, &target).is_err() {
        return;
    }
    let _ = Command::new("/usr/bin/xattr").args(["-dr", "com.apple.quarantine"]).arg(&target).status();
    // -n: this process is still running and would otherwise just be brought forward.
    if Command::new("/usr/bin/open").arg("-n").arg(&target).args(["--args", "--installed"]).spawn().is_ok() {
        std::process::exit(0);
    }
}

fn in_applications(path: &Path) -> bool {
    path.starts_with("/Applications") || home().is_some_and(|home| path.starts_with(home.join("Applications")))
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

// /Applications when this user may write there (admins may), else their own ~/Applications.
fn applications() -> Option<PathBuf> {
    let shared = PathBuf::from("/Applications");
    if writable(&shared) {
        return Some(shared);
    }
    let own = home()?.join("Applications");
    std::fs::create_dir_all(&own).ok()?;
    Some(own)
}

fn writable(path: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    extern "C" {
        fn access(path: *const std::ffi::c_char, mode: std::ffi::c_int) -> std::ffi::c_int;
    }
    const W_OK: std::ffi::c_int = 2;
    let Ok(path) = std::ffi::CString::new(path.as_os_str().as_bytes()) else { return false };
    // SAFETY: a NUL-terminated path, read and not kept.
    unsafe { access(path.as_ptr(), W_OK) == 0 }
}

fn quarantined(path: &Path) -> bool {
    Command::new("/usr/bin/xattr").args(["-p", "com.apple.quarantine"]).arg(path).output().is_ok_and(|out| out.status.success())
}

fn ditto(from: &Path, to: &Path) -> bool {
    Command::new("/usr/bin/ditto").arg(from).arg(to).status().is_ok_and(|s| s.success())
}

// To the Trash, not deleted: an old copy can still be fished back.
fn trash(path: &Path) -> bool {
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    NSFileManager::defaultManager().trashItemAtURL_resultingItemURL_error(&url, None).is_ok()
}

// The widget already running from Applications, asked to quit before its copy is replaced.
fn quit_others() {
    use objc2_app_kit::NSRunningApplication;
    use objc2_foundation::NSString;
    let me = std::process::id() as i32;
    let others: Vec<_> = NSRunningApplication::runningApplicationsWithBundleIdentifier(&NSString::from_str("app.stilltoday.widget"))
        .iter()
        .filter(|app| app.processIdentifier() != me)
        .collect();
    for app in &others {
        let _ = app.terminate();
    }
    for _ in 0..30 {
        if others.iter().all(|app| app.isTerminated()) {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    for app in &others {
        let _ = app.forceTerminate();
    }
}

// Where a translocated app really is (Security's SecTranslocate calls, looked up as LetsMove does,
// since they are not in the SDK's headers). None when it is not translocated.
fn original(bundle: &Path) -> Option<PathBuf> {
    use std::ffi::{c_char, c_int, c_void};

    use objc2::rc::Retained;
    use objc2_foundation::{NSString, NSURL};

    extern "C" {
        fn dlopen(path: *const c_char, mode: c_int) -> *mut c_void;
        fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    }
    type IsTranslocated = unsafe extern "C" fn(*const NSURL, *mut bool, *mut *mut c_void) -> bool;
    type OriginalPath = unsafe extern "C" fn(*const NSURL, *mut *mut c_void) -> *mut NSURL;

    // SAFETY: dlopen/dlsym on a system framework; the two functions are used with the signatures
    // Security declares, taking an NSURL (toll-free bridged to CFURL) and returning a +1 one.
    unsafe {
        let security = dlopen(c"/System/Library/Frameworks/Security.framework/Security".as_ptr(), 1);
        if security.is_null() {
            return None;
        }
        let is = dlsym(security, c"SecTranslocateIsTranslocatedURL".as_ptr());
        let find = dlsym(security, c"SecTranslocateCreateOriginalPathForURL".as_ptr());
        if is.is_null() || find.is_null() {
            return None;
        }
        let is: IsTranslocated = std::mem::transmute(is);
        let find: OriginalPath = std::mem::transmute(find);
        let url = NSURL::fileURLWithPath(&NSString::from_str(&bundle.to_string_lossy()));
        let mut translocated = false;
        if !is(&*url, &mut translocated, std::ptr::null_mut()) || !translocated {
            return None;
        }
        let original = Retained::from_raw(find(&*url, std::ptr::null_mut()))?;
        original.path().map(|path| PathBuf::from(path.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applications_folders() {
        assert!(in_applications(Path::new("/Applications/Still Today.app")));
        assert!(!in_applications(Path::new("/Users/me/Downloads/Still Today.app")));
        assert!(!in_applications(Path::new("/Volumes/Still Today/Still Today.app")));
        if let Some(home) = home() {
            assert!(in_applications(&home.join("Applications/Still Today.app")));
        }
    }
}
