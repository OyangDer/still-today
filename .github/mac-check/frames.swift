// Stills from a recording at a steady rate, for looking at a motion frame by frame.
// Usage: swift frames.swift <movie> <out prefix> <start s> <count> <step s>
import AVFoundation
import AppKit

let args = CommandLine.arguments
let generator = AVAssetImageGenerator(asset: AVURLAsset(url: URL(fileURLWithPath: args[1])))
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero
let (start, count, step) = (Double(args[3])!, Int(args[4])!, Double(args[5])!)
for i in 0..<count {
    let time = CMTime(seconds: max(0, start + Double(i) * step), preferredTimescale: 600)
    guard let image = try? generator.copyCGImage(at: time, actualTime: nil),
          let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { continue }
    try? png.write(to: URL(fileURLWithPath: String(format: "%@-%03d.png", args[2], i)))
}
