import ActivityKit
import ExpoModulesCore

// Must match ios/AtlasShared/AtlasVoiceAttributes.swift and widget extension.
struct AtlasVoiceAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var status: String
    var detail: String
    var listening: Bool
  }

  var sessionLabel: String
}

public class AtlasLiveActivityModule: Module {
  private var activity: Any?

  public func definition() -> ModuleDefinition {
    Name("AtlasLiveActivity")

    AsyncFunction("sync") { (status: String, detail: String, listening: Bool, active: Bool) in
      if #available(iOS 16.2, *) {
        try await self.syncActivity(status: status, detail: detail, listening: listening, active: active)
      }
    }
  }

  @available(iOS 16.2, *)
  private func allActivities() -> [Activity<AtlasVoiceAttributes>] {
    Activity<AtlasVoiceAttributes>.activities
  }

  @available(iOS 16.2, *)
  private func endActivity(_ activity: Activity<AtlasVoiceAttributes>) async {
    let state = activity.content.state
    await activity.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: .immediate)
  }

  @available(iOS 16.2, *)
  private func endAllActivities() async {
    for existing in allActivities() {
      await endActivity(existing)
    }
    activity = nil
  }

  @available(iOS 16.2, *)
  private func syncActivity(status: String, detail: String, listening: Bool, active: Bool) async throws {
    let state = AtlasVoiceAttributes.ContentState(status: status, detail: detail, listening: listening)
    let content = ActivityContent(state: state, staleDate: nil)
    let existing = allActivities()

    if active {
      if let primary = existing.first {
        for duplicate in existing.dropFirst() {
          await endActivity(duplicate)
        }
        await primary.update(content)
        activity = primary
        return
      }

      if let current = activity as? Activity<AtlasVoiceAttributes> {
        await current.update(content)
        return
      }

      let attributes = AtlasVoiceAttributes(sessionLabel: "Atlas Voice")
      let requested = try Activity.request(attributes: attributes, content: content)
      activity = requested
      return
    }

    if !existing.isEmpty {
      await endAllActivities()
      return
    }

    if let current = activity as? Activity<AtlasVoiceAttributes> {
      await endActivity(current)
    }
    activity = nil
  }
}
