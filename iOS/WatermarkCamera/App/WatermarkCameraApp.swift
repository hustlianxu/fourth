import SwiftUI

@main
struct WatermarkCameraApp: App {
    @StateObject private var storage = StorageManager.shared

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environmentObject(storage)
                .preferredColorScheme(.light)
        }
    }
}