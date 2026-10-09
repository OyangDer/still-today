// Windows at the levels near the desktop, each with a button that counts its clicks, for trying
// Show Desktop, Mission Control and clicks by hand on a real Mac: swiftc levels.swift && ./levels
import AppKit

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let icons = Int(CGWindowLevelForKey(.desktopIconWindow))
let desk = Int(CGWindowLevelForKey(.desktopWindow))
let levels: [(String, Int)] = [("icons", icons), ("icons+1", icons + 1), ("icons+2", icons + 2), ("desk+1", desk + 1), ("-1", -1)]

final class Counter: NSObject {
    var n = 0, name = ""
    @objc func hit(_ sender: NSButton) { n += 1; sender.title = "\(name): \(n)" }
}

var keep: [AnyObject] = []
for (i, (name, level)) in levels.enumerated() {
    let w = NSWindow(contentRect: NSRect(x: 60 + i * 260, y: 380, width: 240, height: 110), styleMask: [.borderless], backing: .buffered, defer: false)
    w.level = NSWindow.Level(rawValue: level)
    w.collectionBehavior = [.canJoinAllSpaces, .transient]
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
