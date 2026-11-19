// The coins widget's drawing: pure SwiftUI, no WidgetKit, so CI can also
// render it to pictures on a Mac (scripts/ios-widget-render.swift). The coin is
// the app's coin (scripts/widget-coins.mjs, src/app.css .coin): a milled edge,
// a face, a raised rim, and on a lit coin a gold face with a glint. An unlit
// coin is the same coin in quiet colours, never an empty ring.
import SwiftUI

/** What the app hands over (src/lib/moments/nativeAlarms.ts WidgetLines). */
public struct CoinsDay: Codable, Equatable {
    public var date: String
    public var title: String
    public var weighed: Bool
    public var unit: String
    public var hint: String?
    public var lit: Int?
    public var food: String?
    public var protein: String?
    public var kcal: Double?
    public var share: Double?
    public var proteinG: Double?
    public var proteinTarget: Double?
    public var week: [Double]?

    public static let empty = CoinsDay(date: "", title: "Open Slim Chance to start.", weighed: false, unit: "kg")
}

struct Palette {
    let bg, text, muted, brass, tonal, bar, over: Color
    let offEdge, offMill, offFace, offRing: Color

    static func of(_ scheme: ColorScheme) -> Palette {
        scheme == .dark
            ? Palette(bg: Color(hex: 0x1A1838), text: Color(hex: 0xF4F2FF), muted: Color(hex: 0xA9A5CF), brass: Color(hex: 0xFCC419),
                      tonal: Color(hex: 0x2C2858), bar: Color(hex: 0xFCC419), over: Color(hex: 0xF08C00),
                      offEdge: Color(hex: 0x3A3670), offMill: Color(hex: 0x4E4A88), offFace: Color(hex: 0x26224E), offRing: Color(hex: 0x4E4A88))
            : Palette(bg: Color(hex: 0xFFFFFF), text: Color(hex: 0x141A33), muted: Color(hex: 0x5B6380), brass: Color(hex: 0xB7861F),
                      tonal: Color(hex: 0xEEF0F8), bar: Color(hex: 0x4263EB), over: Color(hex: 0xF08C00),
                      offEdge: Color(hex: 0xD3D8E8), offMill: Color(hex: 0xE4E7F2), offFace: Color(hex: 0xEEF0F8), offRing: Color(hex: 0xC2C8DC))
    }
}

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255, opacity: alpha)
    }
}

/** One coin, in a 24-unit box like the Android drawable, scaled to `size`. */
struct Coin: View {
    let lit: Bool
    let size: CGFloat
    let p: Palette

    // The lit coin's colours, the same in the app and on Android's widget.
    private static let edge = Color(hex: 0xC27C0E), mill = Color(hex: 0xE8A317), light = Color(hex: 0xFFF3BF)
    private static let face = Color(hex: 0xFCC419), deep = Color(hex: 0xF08C00), ring = Color(hex: 0xD08A0A)

    var body: some View {
        let u = size / 24
        ZStack {
            Circle().fill(lit ? Self.edge : p.offEdge).frame(width: 23 * u, height: 23 * u)
            MillTicks(inner: 9.9 * u, outer: 11.3 * u)
                .stroke(lit ? Self.mill : p.offMill, lineWidth: 0.8 * u)
            if lit {
                Circle()
                    .fill(RadialGradient(gradient: Gradient(colors: [Self.light, Self.face, Self.deep]), center: UnitPoint(x: 0.35, y: 0.3),
                                         startRadius: 0, endRadius: 11 * u))
                    .frame(width: 19.2 * u, height: 19.2 * u)
                Circle().stroke(Self.ring.opacity(0.75), lineWidth: 1.1 * u).frame(width: 14.8 * u, height: 14.8 * u)
                Ellipse().fill(Color.white.opacity(0.55)).frame(width: 4.2 * u, height: 2.4 * u)
                    .rotationEffect(.degrees(-35)).offset(x: -3.4 * u, y: -4.2 * u)
            } else {
                Circle().fill(p.offFace).frame(width: 19.2 * u, height: 19.2 * u)
                Circle().stroke(p.offRing, lineWidth: 1.1 * u).frame(width: 14.8 * u, height: 14.8 * u)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/** The 28 short marks around a coin's edge. */
struct MillTicks: Shape {
    let inner: CGFloat, outer: CGFloat
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let c = CGPoint(x: rect.midX, y: rect.midY)
        for i in 0..<28 {
            let a = Double(i) * .pi * 2 / 28
            path.move(to: CGPoint(x: c.x + CGFloat(cos(a)) * inner, y: c.y + CGFloat(sin(a)) * inner))
            path.addLine(to: CGPoint(x: c.x + CGFloat(cos(a)) * outer, y: c.y + CGFloat(sin(a)) * outer))
        }
        return path
    }
}

/** Ten coins, the first `lit` gold; in `rows` rows. */
struct CoinRow: View {
    let lit: Int
    let size: CGFloat
    let rows: Int
    let p: Palette
    var body: some View {
        let perRow = 10 / rows
        VStack(alignment: .leading, spacing: size * 0.2) {
            ForEach(0..<rows, id: \.self) { r in
                HStack(spacing: size * 0.18) {
                    ForEach(0..<perRow, id: \.self) { i in Coin(lit: r * perRow + i < lit, size: size, p: p) }
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(lit) in 10")
    }
}

/** A thin bar: `value` of `of`, amber past the end. */
struct Meter: View {
    let value: Double, of: Double
    let p: Palette
    var body: some View {
        GeometryReader { g in
            let f = of > 0 ? min(value / of, 1) : 0
            ZStack(alignment: .leading) {
                Capsule().fill(p.tonal)
                Capsule().fill(value > of && of > 0 ? p.over : p.bar).frame(width: max(4, g.size.width * f))
            }
        }
        .frame(height: 5)
    }
}

/** Monday to Sunday: each day's food against its target; empty where nothing was logged yet. */
struct WeekBars: View {
    let week: [Double]
    let p: Palette
    private let days = ["M", "T", "W", "T", "F", "S", "S"]
    var body: some View {
        HStack(alignment: .bottom, spacing: 6) {
            ForEach(0..<min(7, week.count), id: \.self) { i in
                let v = week[i]
                VStack(spacing: 3) {
                    ZStack(alignment: .bottom) {
                        RoundedRectangle(cornerRadius: 3).fill(p.tonal).frame(height: 34)
                        if v >= 0 {
                            RoundedRectangle(cornerRadius: 3).fill(v > 100 ? p.over : p.bar)
                                .frame(height: max(3, 34 * min(v, 150) / 150))
                        }
                    }
                    Text(days[i]).font(.system(size: 9, weight: .semibold)).foregroundColor(p.muted)
                }
            }
        }
    }
}

public enum CoinsSize { case small, medium, large }

/** The whole widget, for any size. */
public struct CoinsWidgetView: View {
    let day: CoinsDay
    let size: CoinsSize
    @Environment(\.colorScheme) private var scheme

    public init(day: CoinsDay, size: CoinsSize) { self.day = day; self.size = size }

    public var body: some View {
        let p = Palette.of(scheme)
        let lit = max(0, min(10, day.lit ?? 0))
        VStack(alignment: .leading, spacing: size == .small ? 6 : 8) {
            HStack(spacing: 6) {
                Text("Slim Chance").font(.system(size: 12, weight: .semibold)).foregroundColor(p.muted)
                Spacer(minLength: 0)
                // Small has room for the tick only; the words would wrap the name.
                if day.weighed { Text(size == .small ? "✓" : "✓ Weighed in").font(.system(size: 11, weight: .semibold)).foregroundColor(p.brass) }
            }
            if size == .small {
                if day.lit != nil {
                    HStack(alignment: .firstTextBaseline, spacing: 3) {
                        Text("\(lit)").font(.system(size: 34, weight: .heavy, design: .rounded)).foregroundColor(p.brass)
                        Text("in 10").font(.system(size: 13, weight: .semibold)).foregroundColor(p.muted)
                    }
                }
                CoinRow(lit: lit, size: 20, rows: 2, p: p)
                if day.lit == nil {
                    Text(day.title).font(.system(size: 12, weight: .medium)).foregroundColor(p.text).lineLimit(3)
                }
            } else {
                CoinRow(lit: lit, size: size == .large ? 26 : 22, rows: 1, p: p)
                Text(day.title).font(.system(size: 15, weight: .bold)).foregroundColor(p.text).lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                // Medium gives the title its two lines; the hint shows on large.
                if size == .large, let hint = day.hint, !hint.isEmpty {
                    Text(hint).font(.system(size: 13)).foregroundColor(p.muted).lineLimit(2)
                }
                if size == .medium, let food = day.food {
                    Text([food, day.protein].compactMap { $0 }.joined(separator: " · "))
                        .font(.system(size: 12, weight: .medium)).foregroundColor(p.muted).lineLimit(1)
                }
                if size == .large {
                    if let food = day.food {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(food).font(.system(size: 12, weight: .medium)).foregroundColor(p.text)
                            Meter(value: day.kcal ?? 0, of: day.share ?? 0, p: p)
                        }
                    }
                    if let protein = day.protein {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(protein).font(.system(size: 12, weight: .medium)).foregroundColor(p.text)
                            Meter(value: day.proteinG ?? 0, of: day.proteinTarget ?? 0, p: p)
                        }
                    }
                    if let week = day.week, week.count == 7 {
                        Text("This week").font(.system(size: 11, weight: .semibold)).foregroundColor(p.muted)
                        WeekBars(week: week, p: p)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
