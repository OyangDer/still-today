import AppKit
// Prints what changes when Mission Control opens: Dock-owned windows and a hidden Transient sentinel window.
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
setvbuf(stdout, nil, _IOLBF, 0)
let dockPid = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.dock").first?.processIdentifier ?? -1
let sentinel = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1, height: 1), styleMask: [.borderless], backing: .buffered, defer: false)
sentinel.level = NSWindow.Level(rawValue: -1)
sentinel.collectionBehavior = [.canJoinAllSpaces, .transient]
sentinel.backgroundColor = .clear
sentinel.isOpaque = false
sentinel.ignoresMouseEvents = true
sentinel.orderFrontRegardless()
NotificationCenter.default.addObserver(forName: NSWindow.didChangeOcclusionStateNotification, object: sentinel, queue: nil) { _ in
    print("occlusion visible:", sentinel.occlusionState.contains(.visible))
}
print("start dock pid", dockPid, "sentinel", sentinel.windowNumber)
var last = "-"
Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
    let dock = list.filter { ($0[kCGWindowOwnerPID as String] as? Int32) == dockPid }
    let d = dock.map { w -> String in
        let b = w[kCGWindowBounds as String] as! [String: Any]
        return "L\(w[kCGWindowLayer as String]!) \(b["Width"]!)x\(b["Height"]!)"
    }.joined(separator: ", ")
    let me = (CGWindowListCopyWindowInfo([.optionIncludingWindow], CGWindowID(sentinel.windowNumber)) as! [[String: Any]]).first
    let on = me?[kCGWindowIsOnscreen as String] as? Bool ?? false
    let b = me?[kCGWindowBounds as String] as? [String: Any] ?? [:]
    let s = "sentinel on=\(on) \(b["X"] ?? "?"),\(b["Y"] ?? "?") \(b["Width"] ?? "?")x\(b["Height"] ?? "?") | dock \(dock.count): \(d)"
    if s != last { print(s); last = s }
}
app.run()
