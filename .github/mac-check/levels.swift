// Windows at the levels near the desktop, each with a button that counts its clicks, for trying
// Show Desktop, Mission Control and clicks by hand on a real Mac: swiftc levels.swift && ./levels
import AppKit

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let icons = Int(CGWindowLevelForKey(.desktopIconWindow))
let desk = Int(CGWindowLevelForKey(.desktopWindow))
let transient: NSWindow.CollectionBehavior = [.canJoinAllSpaces, .transient]
let stationary: NSWindow.CollectionBehavior = [.canJoinAllSpaces, .stationary]
let levels: [(String, Int, NSWindow.CollectionBehavior)] = [
    ("icons", icons, transient), ("icons stat", icons, stationary), ("-1 stat", -1, stationary),
    ("-1 both", -1, transient.union(stationary)), ("0 stat", 0, stationary),
]

final class Counter: NSObject {
    var n = 0, name = ""
    @objc func hit(_ sender: NSButton) { n += 1; sender.title = "\(name): \(n)" }
}

var keep: [AnyObject] = []
for (i, (name, level, behavior)) in levels.enumerated() {
    let w = NSWindow(contentRect: NSRect(x: 60 + i * 260, y: 380, width: 240, height: 110), styleMask: [.borderless], backing: .buffered, defer: false)
    w.level = NSWindow.Level(rawValue: level)
    w.collectionBehavior = behavior
    w.backgroundColor = .systemOrange
    let counter = Counter()
    counter.name = name
    let b = NSButton(title: "\(name): 0", target: counter, action: #selector(Counter.hit(_:)))
    b.frame = NSRect(x: 20, y: 30, width: 200, height: 50)
    w.contentView!.addSubview(b)
    w.orderFrontRegardless()
    keep += [w, counter]
}
app.run()
