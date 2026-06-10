import WidgetKit
import ExpoModulesCore

public let atlasAppGroupId = "group.com.camrontrost.atlas"

public struct AtlasWidgetSnapshot {
  public static let connectionKey = "connection"
  public static let statusKey = "status"
  public static let lastLineKey = "lastLine"
  public static let wakeOnKey = "wakeOn"

  public static func load() -> [String: String] {
    guard let defaults = UserDefaults(suiteName: atlasAppGroupId) else { return [:] }
    return [
      connectionKey: defaults.string(forKey: connectionKey) ?? "unknown",
      statusKey: defaults.string(forKey: statusKey) ?? "idle",
      lastLineKey: defaults.string(forKey: lastLineKey) ?? "",
      wakeOnKey: defaults.string(forKey: wakeOnKey) ?? "0",
    ]
  }
}

public class AtlasWidgetStatusModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AtlasWidgetStatus")

    AsyncFunction("updateSnapshot") { (connection: String, status: String, lastLine: String, wakeOn: Bool) in
      guard let defaults = UserDefaults(suiteName: atlasAppGroupId) else { return }
      defaults.set(connection, forKey: AtlasWidgetSnapshot.connectionKey)
      defaults.set(status, forKey: AtlasWidgetSnapshot.statusKey)
      defaults.set(String(lastLine.prefix(120)), forKey: AtlasWidgetSnapshot.lastLineKey)
      defaults.set(wakeOn ? "1" : "0", forKey: AtlasWidgetSnapshot.wakeOnKey)
      if #available(iOS 14.0, *) {
        WidgetCenter.shared.reloadAllTimelines()
      }
    }
  }
}
