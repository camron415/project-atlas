import SwiftUI

@main
struct AtlasApp: App {
    init() { CallAudio.start() }

    var body: some Scene {
        WindowGroup {
            CallView()
                .ignoresSafeArea()
                .background(Color(red: 18 / 255, green: 20 / 255, blue: 16 / 255))
        }
    }
}
