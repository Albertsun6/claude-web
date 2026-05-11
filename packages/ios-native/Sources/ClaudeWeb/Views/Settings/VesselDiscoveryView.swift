// VesselDiscoveryView — sheet UI presented from SettingsView's Backend
// section. Shows live NWBrowser results for `_vessel._tcp` on the LAN; per
// row, "测试" button resolves + probes /api/vessel/health and confirms the
// host is a vessel-core. Tapping "选择" writes the resolved URL back to
// the parent's draftURL string.
//
// M2-iOS-β': UI接入只动 SettingsView + 这个新文件，不改 BackendClient /
// BonjourBrowser / VesselDiscovery. operator 装新 build 仍连原 backendURL。

import SwiftUI

struct VesselDiscoveryView: View {
    /// Called with the resolved http URL string when user picks an entry.
    /// Caller (SettingsView) typically writes it to draftURL + backendURL.
    let onSelect: (String) -> Void

    @StateObject private var browser = BonjourBrowser()
    @State private var probes: [String: ProbeState] = [:]
    @Environment(\.dismiss) private var dismiss

    enum ProbeState: Equatable {
        case idle
        case probing
        case ok(VesselHealth, urlString: String)
        case failed(String)
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    statusRow
                } footer: {
                    Text("浏览 `_vessel._tcp` 服务。Mac 端 vessel-core 启动后会自动广播；如果没结果，可能在不同 Wi-Fi 网段，或 Mac 没启动。手动填地址仍可用。")
                }

                if !browser.services.isEmpty {
                    Section("发现的 Vessel") {
                        ForEach(browser.services) { svc in
                            row(for: svc)
                        }
                    }
                }
            }
            .navigationTitle("自动发现")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
            }
            .onAppear { browser.start() }
            .onDisappear { browser.stop() }
        }
    }

    @ViewBuilder
    private var statusRow: some View {
        switch browser.state {
        case .idle:
            Label("等待开始…", systemImage: "wifi.slash")
                .foregroundStyle(.secondary)
        case .browsing:
            Label("正在扫描局域网…", systemImage: "wifi")
                .foregroundStyle(.secondary)
        case .ready:
            Label(browser.services.isEmpty ? "扫描完成，未发现服务" : "扫描中（\(browser.services.count) 个候选）",
                  systemImage: "wifi")
        case .failed(let msg):
            Label("扫描失败：\(msg)", systemImage: "exclamationmark.triangle")
                .foregroundStyle(.red)
        }
    }

    @ViewBuilder
    private func row(for svc: DiscoveredVesselService) -> some View {
        let state = probes[svc.id] ?? .idle
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: stateIcon(state))
                    .foregroundStyle(stateColor(state))
                VStack(alignment: .leading, spacing: 2) {
                    Text(displayName(for: svc, with: state))
                        .font(.headline)
                    Text("\(svc.type)  ·  \(svc.domain)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                actionButton(for: svc, state: state)
            }
            if case .failed(let msg) = state {
                Text(msg).font(.caption).foregroundStyle(.red)
            }
            if case .ok(let h, let url) = state {
                Text("v\(h.version) · uptime \(h.uptimeSec)s · \(url)")
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private func displayName(for svc: DiscoveredVesselService, with state: ProbeState) -> String {
        if case .ok(let h, _) = state { return h.displayName }
        return svc.name
    }

    private func stateIcon(_ s: ProbeState) -> String {
        switch s {
        case .idle: return "circle"
        case .probing: return "arrow.triangle.2.circlepath"
        case .ok: return "checkmark.circle.fill"
        case .failed: return "xmark.circle"
        }
    }

    private func stateColor(_ s: ProbeState) -> Color {
        switch s {
        case .idle: return .secondary
        case .probing: return .blue
        case .ok: return .green
        case .failed: return .orange
        }
    }

    @ViewBuilder
    private func actionButton(for svc: DiscoveredVesselService, state: ProbeState) -> some View {
        switch state {
        case .idle, .failed:
            Button("测试") { Task { await probe(svc) } }
                .buttonStyle(.bordered)
        case .probing:
            ProgressView().controlSize(.small)
        case .ok(_, let url):
            Button("选择") {
                onSelect(url)
                dismiss()
            }
            .buttonStyle(.borderedProminent)
        }
    }

    /// Resolve the Bonjour service to a real host:port, then probe
    /// `/api/vessel/health` and store the result in `probes`.
    private func probe(_ svc: DiscoveredVesselService) async {
        probes[svc.id] = .probing

        guard let resolved = await browser.resolve(svc) else {
            probes[svc.id] = .failed("解析失败（超时或不可达）")
            return
        }

        let urlString = "http://\(resolved.host):\(resolved.port)"
        guard let url = URL(string: urlString) else {
            probes[svc.id] = .failed("无效 URL：\(urlString)")
            return
        }

        do {
            let health = try await VesselDiscovery.probe(url)
            probes[svc.id] = .ok(health, urlString: urlString)
        } catch let err as VesselDiscoveryError {
            probes[svc.id] = .failed(err.errorDescription ?? "\(err)")
        } catch {
            probes[svc.id] = .failed(error.localizedDescription)
        }
    }
}
