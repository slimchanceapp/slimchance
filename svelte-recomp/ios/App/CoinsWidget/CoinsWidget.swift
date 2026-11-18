// The home-screen coins widget (Pact m27; Apple guideline 4.2 wants more than a
// website). It shows what the app last handed over through Moments.setWidget:
// the same lines Android's widget gets. The drawing is in CoinsViews.swift.
import WidgetKit
import SwiftUI

let appGroup = "group.com.toxicminds.recompos"

struct CoinsEntry: TimelineEntry {
    let date: Date
    let day: CoinsDay
}

struct CoinsProvider: TimelineProvider {
    func placeholder(in context: Context) -> CoinsEntry {
        CoinsEntry(date: Date(), day: CoinsDay(date: "", title: "Your chance of slimming looks good.", weighed: true, unit: "kg",
                                               hint: nil, lit: 7, food: "1,580 of 2,100 kcal", protein: "62 of 160 g protein",
                                               kcal: 1580, share: 2100, proteinG: 62, proteinTarget: 160, week: [92, 104, 88, -1, -1, -1, -1]))
    }

    func getSnapshot(in context: Context, completion: @escaping (CoinsEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : CoinsEntry(date: Date(), day: Self.saved()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CoinsEntry>) -> Void) {
        // The app reloads the widget whenever its lines change; past midnight
        // the day's food lines no longer apply, so look again then.
        let midnight = Calendar.current.nextDate(after: Date(), matching: DateComponents(hour: 0, minute: 5), matchingPolicy: .nextTime) ?? Date().addingTimeInterval(3600)
        completion(Timeline(entries: [CoinsEntry(date: Date(), day: Self.saved())], policy: .after(midnight)))
    }

    /** What the app last saved, or the empty day. */
    static func saved() -> CoinsDay {
        guard let data = UserDefaults(suiteName: appGroup)?.data(forKey: "widget"),
              var day = try? JSONDecoder().decode(CoinsDay.self, from: data) else { return .empty }
        let today = ISO8601DateFormatter.ymd.string(from: Date())
        if !day.date.isEmpty && day.date < today {
            // Yesterday's food isn't today's: keep the coins, drop the day.
            day.food = nil; day.protein = nil; day.kcal = nil; day.proteinG = nil; day.week = nil; day.weighed = false
        }
        return day
    }
}

extension ISO8601DateFormatter {
    static let ymd: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withFullDate]
        f.timeZone = .current
        return f
    }()
}

struct CoinsWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme
    let entry: CoinsEntry

    var body: some View {
        let view = CoinsWidgetView(day: entry.day, size: family == .systemSmall ? .small : family == .systemLarge ? .large : .medium)
        if #available(iOS 17.0, *) {
            view.containerBackground(Palette.of(scheme).bg, for: .widget)
        } else {
            view.padding(14).background(Palette.of(scheme).bg)
        }
    }
}

@main
struct CoinsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CoinsWidget", provider: CoinsProvider()) { entry in
            CoinsWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Your slim chance")
        .description("Ten coins: how likely your weight is really going your way, and today's food.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
