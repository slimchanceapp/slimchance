// Draw the iPhone coins widget to pictures on a Mac, the way iOS would show it,
// at each size in light and dark, so the design can be judged before anyone has
// an iPhone (Pact m27). CI: swiftc -parse-as-library \
//   ios/App/CoinsWidget/CoinsViews.swift scripts/ios-widget-render.swift -o widget-render
// then ./widget-render <folder>.
import SwiftUI
import AppKit

@main
struct Render {
    @MainActor static func main() {
        let out = CommandLine.arguments.dropFirst().first ?? "widget-proof"
        try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
        let day = CoinsDay(date: "2026-11-19", title: "Your chance of slimming looks good. Right on track.", weighed: true, unit: "kg",
                           hint: "A week inside your budget keeps it there.", lit: 7, food: "1,580 of 2,100 kcal", protein: "62 of 160 g protein",
                           kcal: 1580, share: 2100, proteinG: 62, proteinTarget: 160, week: [92, 104, 88, 120, 70, -1, -1])
        let early = CoinsDay(date: "2026-11-19", title: "4 more mornings to your first chance.", weighed: false, unit: "kg")
        let sizes: [(CoinsSize, CGSize, String)] = [
            (.small, CGSize(width: 170, height: 170), "small"),
            (.medium, CGSize(width: 364, height: 170), "medium"),
            (.large, CGSize(width: 364, height: 382), "large"),
        ]
        var n = 0
        for scheme in [ColorScheme.light, .dark] {
            for (size, frame, name) in sizes {
                for (d, tag) in [(day, ""), (early, "-first-week")] where tag.isEmpty || size == .small {
                    let p = Palette.of(scheme)
                    let view = CoinsWidgetView(day: d, size: size)
                        .padding(16)
                        .frame(width: frame.width, height: frame.height)
                        .background(p.bg)
                        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                        .environment(\.colorScheme, scheme)
                    let r = ImageRenderer(content: view)
                    r.scale = 3
                    guard let img = r.nsImage, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
                          let png = rep.representation(using: .png, properties: [:]) else {
                        print("render failed: \(name)"); exit(1)
                    }
                    let file = "\(out)/widget-\(name)\(tag)-\(scheme == .dark ? "dark" : "light").png"
                    try! png.write(to: URL(fileURLWithPath: file))
                    n += 1
                }
            }
        }
        print("rendered \(n) widget pictures to \(out)")
    }
}
