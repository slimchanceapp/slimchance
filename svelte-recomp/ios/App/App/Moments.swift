import Capacitor
import UserNotifications

/// The morning briefing and the evening hold on the iPhone, with the same calls
/// as MomentsPlugin.java on Android. An iPhone doesn't tell apps when it's
/// unlocked, so each moment is delivered at the start of its window as a
/// passive notification: no sound, the screen stays dark, and it waits on the
/// lock screen for the first look. The words come from the app
/// (src/lib/stores/moments.ts), rewritten whenever it's open.
@objc(MomentsPlugin)
public class MomentsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MomentsPlugin"
    public let jsName = "Moments"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "arm", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disarm", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pending", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ack", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setWidget", returnType: CAPPluginReturnPromise),
    ]

    private let center = UNUserNotificationCenter.current()
    private let defaults = UserDefaults.standard
    private static let prefix = "moment-"
    private static func ours(_ id: String) -> Bool { id.hasPrefix(prefix) }

    /// { moments: [{ date, key, after, until, title, body }] }, minutes from midnight.
    @objc func arm(_ call: CAPPluginCall) {
        guard let given = call.getArray("moments", JSObject.self) else { return call.reject("No moments") }
        let moments = given.compactMap(plain)
        defaults.set(true, forKey: "moments.on")
        defaults.set(moments, forKey: "moments.armed")
        // Asks once; after that it answers at once with what the person chose.
        center.requestAuthorization(options: [.alert]) { _, _ in
            self.center.getPendingNotificationRequests { pending in
                self.center.getDeliveredNotifications { delivered in
                    let now = Date()
                    self.center.removePendingNotificationRequests(withIdentifiers: pending.map(\.identifier).filter(Self.ours))
                    // A delivered one stays on the lock screen only while its window lasts.
                    self.center.removeDeliveredNotifications(withIdentifiers: delivered.filter {
                        Self.ours($0.request.identifier) && ($0.request.content.userInfo["until"] as? Double ?? 0) < now.timeIntervalSince1970
                    }.map(\.request.identifier))
                    // One whose window has begun isn't sent: the app is open, and Today says the same.
                    for m in moments { if let fire = self.at(m, "after"), fire > now { self.add(m, at: fire) } }
                    self.state { call.resolve($0) }
                }
            }
        }
    }

    @objc func disarm(_ call: CAPPluginCall) {
        defaults.set(false, forKey: "moments.on")
        defaults.removeObject(forKey: "moments.armed")
        center.getPendingNotificationRequests { pending in
            self.center.getDeliveredNotifications { delivered in
                self.center.removePendingNotificationRequests(withIdentifiers: pending.map(\.identifier).filter(Self.ours))
                self.center.removeDeliveredNotifications(withIdentifiers: delivered.map(\.request.identifier).filter(Self.ours))
                self.state { call.resolve($0) }
            }
        }
    }

    /// { date, key }: deliver that armed moment now (the card's "Show it now").
    /// Resolves { buttons: [] }: the iPhone's carry none yet.
    @objc func show(_ call: CAPPluginCall) {
        let date = call.getString("date") ?? "", key = call.getString("key") ?? ""
        let armed = defaults.array(forKey: "moments.armed") as? [[String: Any]] ?? []
        guard let m = armed.first(where: { $0["date"] as? String == date && $0["key"] as? String == key }) else {
            return call.reject("Not shown: there is nothing to show yet.")
        }
        center.getNotificationSettings { s in
            guard s.authorizationStatus == .authorized else {
                return call.reject("Not shown: notifications are off for Slim Chance in the iPhone's Settings.")
            }
            self.add(m, at: nil) { call.resolve(["buttons": [String]()]) }
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        state { call.resolve($0) }
    }

    // The home-screen widget is Android's for now (a WidgetKit extension waits
    // for the App Store): taken and set aside.
    @objc func setWidget(_ call: CAPPluginCall) {
        call.resolve()
    }

    // Nothing is typed into an iPhone moment yet, so there is nothing to hand over.
    @objc func pending(_ call: CAPPluginCall) {
        call.resolve(["items": [Any]()])
    }

    @objc func ack(_ call: CAPPluginCall) {
        call.resolve()
    }

    /// { on, allowed, morning: { shown, postedAt }, evening: { … } }, as Android
    /// reports it, plus whether the person let the app notify at all.
    private func state(_ done: @escaping ([String: Any]) -> Void) {
        center.getNotificationSettings { s in
            self.center.getDeliveredNotifications { delivered in
                var o: [String: Any] = ["on": self.defaults.bool(forKey: "moments.on")]
                // Left out until the person has been asked, so the card never says "off" before then.
                if s.authorizationStatus != .notDetermined { o["allowed"] = s.authorizationStatus == .authorized }
                for key in ["morning", "evening"] {
                    var k: [String: Any] = [:]
                    let mine = delivered.filter { Self.ours($0.request.identifier) && $0.request.content.threadIdentifier == key }
                    if let n = mine.max(by: { $0.date < $1.date }) {
                        k["shown"] = n.request.content.userInfo["date"] as? String
                        k["postedAt"] = Int(n.date.timeIntervalSince1970 * 1000)
                    }
                    o[key] = k
                }
                done(o)
            }
        }
    }

    private func plain(_ m: JSObject) -> [String: Any]? {
        guard let date = m["date"] as? String, let key = m["key"] as? String,
              let after = (m["after"] as? NSNumber)?.intValue, let until = (m["until"] as? NSNumber)?.intValue else { return nil }
        return ["date": date, "key": key, "after": after, "until": until,
                "title": m["title"] as? String ?? "Slim Chance", "body": m["body"] as? String ?? ""]
    }

    /// That moment's day at its `after` or `until` minute, in the phone's own time zone.
    private func at(_ m: [String: Any], _ field: String) -> Date? {
        guard let ymd = m["date"] as? String, let minutes = m[field] as? Int else { return nil }
        let p = ymd.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: p[0], month: p[1], day: p[2], hour: minutes / 60, minute: minutes % 60))
    }

    /// Delivered at `fire`, or now when nil. Never with a sound.
    private func add(_ m: [String: Any], at fire: Date?, done: (() -> Void)? = nil) {
        // ponytail: iOS 14 has no passive level, so a moment there would light the screen; it gets none.
        guard #available(iOS 15.0, *) else { done?(); return }
        let date = m["date"] as? String ?? "", key = m["key"] as? String ?? ""
        let c = UNMutableNotificationContent()
        c.title = m["title"] as? String ?? "Slim Chance"
        c.body = m["body"] as? String ?? ""
        c.threadIdentifier = key
        c.interruptionLevel = .passive
        c.userInfo = ["date": date, "until": at(m, "until")?.timeIntervalSince1970 ?? 0]
        let trigger = fire.map {
            UNCalendarNotificationTrigger(dateMatching: Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: $0), repeats: false)
        }
        center.add(UNNotificationRequest(identifier: Self.prefix + date + "-" + key, content: c, trigger: trigger)) { _ in done?() }
    }
}

/// Capacitor's own screen, with the app's plugins registered on it.
class ViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(MomentsPlugin())
        bridge?.registerPluginInstance(AppleHealthPlugin())
    }
}
