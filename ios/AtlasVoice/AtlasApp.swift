import SwiftUI

@main
struct AtlasApp: App {
    @Environment(\.scenePhase) private var scenePhase
    init() {
        CallPrefs.applyPlusDefaultForRoadTest()
        CallAudio.start()
    }

    var body: some Scene {
        WindowGroup {
            CallView()
                .ignoresSafeArea()
                .background(Color(red: 18 / 255, green: 20 / 255, blue: 16 / 255))
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { CallLoop.refreshScreen() }
        }
    }
}
