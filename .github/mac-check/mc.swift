import AppKit
// Prints what changes when Mission Control opens: Dock-owned windows and distributed notifications.
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
var last = ""
Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { _ in
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
    let dock = list.filter { ($0[kCGWindowOwnerName as String] as? String) == "Dock" }
    let s = dock.map { w -> String in
        let b = w[kCGWindowBounds as String] as! [String: Any]
        return "L\(w[kCGWindowLayer as String]!) \(b["Width"]!)x\(b["Height"]!)"
    }.joined(separator: ", ")
    if s != last { print("dock:", dock.count, s); last = s }
}
DistributedNotificationCenter.default().addObserver(forName: nil, object: nil, queue: nil) { n in
    if !n.name.rawValue.contains("Keyboard") { print("note:", n.name.rawValue) }
}
app.run()
