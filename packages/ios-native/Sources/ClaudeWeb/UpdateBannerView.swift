// Banner shown in mainContent when a newer .pkg release is available.
// Mirrors the web frontend's UpdateBanner — taps open the release URL in
// Safari, "稍后" stores the dismissed tag in UserDefaults so the same tag
// won't reappear (but a newer tag will).

import SwiftUI

@MainActor
final class UpdateBannerState: ObservableObject {
    @Published var result: UpdateCheckDTO?
    @Published var hidden: Bool = false

    private let api: VersionAPI
    private static let dismissKey = "com.albertsun6.vessel.update-banner-dismissed-tag"

    init(api: VersionAPI) {
        self.api = api
    }

    func load() async {
        do {
            let r = try await api.latest()
            self.result = r
        } catch {
            // Silent — banner just won't show
        }
    }

    var shouldShow: Bool {
        guard !hidden, let r = result, r.hasUpdate, let latest = r.latest else {
            return false
        }
        return UserDefaults.standard.string(forKey: Self.dismissKey) != latest.tag
    }

    func dismiss() {
        guard let tag = result?.latest?.tag else { return }
        UserDefaults.standard.set(tag, forKey: Self.dismissKey)
        hidden = true
    }
}

struct UpdateBannerView: View {
    @StateObject private var state: UpdateBannerState

    init(api: VersionAPI) {
        _state = StateObject(wrappedValue: UpdateBannerState(api: api))
    }

    var body: some View {
        Group {
            if state.shouldShow, let latest = state.result?.latest, let current = state.result?.current {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "arrow.up.circle.fill")
                        .foregroundStyle(.blue)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("新版本 \(latest.tag) 可用")
                            .font(.caption)
                            .fontWeight(.semibold)
                        if let asset = latest.asset {
                            let sizeMB = asset.sizeBytes / 1024 / 1024
                            Text("你在 v\(current.backend) · \(sizeMB)MB")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    if let url = URL(string: latest.htmlUrl) {
                        Link("下载", destination: url)
                            .font(.caption)
                            .buttonStyle(.borderless)
                    }
                    Button("稍后") {
                        state.dismiss()
                    }
                    .font(.caption)
                }
                .padding(8)
                .background(.blue.opacity(0.12))
            }
        }
        .task {
            await state.load()
        }
    }
}
