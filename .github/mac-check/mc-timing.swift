// Which signal sees Mission Control first: the occlusion notification or polling the window list.
// Run: swift mc-timing.swift, then open and close Mission Control a few times.
import AppKit
setvbuf(stdout, nil, _IOLBF, 0)
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1, height: 1), styleMask: .borderless, backing: .buffered, defer: false)
w.isOpaque = false; w.backgroundColor = .clear; w.hasShadow = false; w.ignoresMouseEvents = true
w.level = NSWindow.Level(rawValue: -1)
w.collectionBehavior = [.canJoinAllSpaces, .transient]
w.orderFrontRegardless()
let n = CGWindowID(w.windowNumber)
let t0 = CFAbsoluteTimeGetCurrent()
func ms() -> String { String(format: "%7.0f ms", (CFAbsoluteTimeGetCurrent() - t0) * 1000) }
func onScreen() -> Bool {
    guard let l = CGWindowListCopyWindowInfo([.optionIncludingWindow], n) as? [[String: Any]], let e = l.first else { return true }
    return (e[kCGWindowIsOnscreen as String] as? Bool) ?? false
}
NotificationCenter.default.addObserver(forName: NSWindow.didChangeOcclusionStateNotification, object: w, queue: nil) { _ in
    print(ms(), "notify  visible=\(w.occlusionState.contains(.visible)) onscreen=\(onScreen())")
}
var last = onScreen()
Timer.scheduledTimer(withTimeInterval: 0.005, repeats: true) { _ in
    let now = onScreen()
    if now != last { print(ms(), "poll    onscreen=\(now)"); last = now }
}
print(ms(), "ready, window \(n)")
app.run()
