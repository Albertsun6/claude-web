import SwiftUI

struct HealthCheckView: View {
    @Environment(AppSettings.self) private var settings
    @State private var report: HealthReport?
    @State private var loadState: HealthLoadState = .idle
    @State private var copied = false

    var body: some View {
        Group {
            switch loadState {
            case .idle, .loading:
                VStack(spacing: 12) {
                    ProgressView()
                    Text("正在检查...").foregroundStyle(.secondary).font(.caption)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed(let msg):
                VStack(spacing: 12) {
                    Image(systemName: "wifi.exclamationmark")
                        .font(.system(size: 36))
                        .foregroundStyle(.orange)
                    Text("无法连接 backend").font(.headline)
                    Text(msg).font(.caption).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                    Button("重试") { Task { await load() } }
                        .buttonStyle(.borderedProminent)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .loaded:
                if let r = report { reportView(r) }
            }
        }
        .navigationTitle("诊断")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { Task { await load() } } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(loadState == .loading)
            }
        }
        .task { await load() }
    }

    @ViewBuilder
    private func reportView(_ r: HealthReport) -> some View {
        List {
            Section {
                HStack(spacing: 10) {
                    statusDot(r.overall, big: true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(overallLabel(r.overall)).font(.headline)
                        Text("\(r.summary.ok) ok · \(r.summary.warn) warn · \(r.summary.error) error")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }

            Section("检查项") {
                ForEach(r.items) { item in
                    HealthItemRow(item: item)
                }
            }

            Section("Backend") {
                LabeledContent("Node") { Text(r.backend.nodeVersion) }
                LabeledContent("平台") { Text("\(r.backend.platform) (\(r.backend.arch))") }
                LabeledContent("已运行") { Text(formatUptime(r.backend.uptimeSec)) }
            }

            Section("App") {
                LabeledContent("Backend URL") {
                    Text(settings.backendURL.host ?? settings.backendURL.absoluteString)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                LabeledContent("App 版本") {
                    Text("\(appVersion) (\(buildNumber))").foregroundStyle(.secondary)
                }
            }

            Section {
                Button {
                    UIPasteboard.general.string = renderReport(r)
                    copied = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copied = false }
                } label: {
                    HStack {
                        Image(systemName: copied ? "checkmark.circle.fill" : "doc.on.clipboard")
                            .foregroundStyle(copied ? .green : .accentColor)
                        Text(copied ? "已复制" : "复制脱敏诊断报告")
                    }
                }
            } footer: {
                Text("含版本、检查项状态、backend 主机名（不含 token）。粘到 issue 或反馈用。")
            }
        }
    }

    // MARK: - Networking

    private func load() async {
        loadState = .loading
        do {
            var url = settings.backendURL
            url.append(path: "/api/health/full")
            var req = URLRequest(url: url)
            req.timeoutInterval = 15
            let t = settings.authToken
            if !t.isEmpty {
                req.setValue("Bearer \(t)", forHTTPHeaderField: "authorization")
            }
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse else {
                loadState = .failed("non-HTTP response")
                return
            }
            if http.statusCode != 200 {
                loadState = .failed("HTTP \(http.statusCode)")
                return
            }
            let decoded = try JSONDecoder().decode(HealthReport.self, from: data)
            report = decoded
            loadState = .loaded
        } catch {
            loadState = .failed(error.localizedDescription)
        }
    }

    // MARK: - Helpers

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
    }
    private var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
    }

    private func overallLabel(_ s: HealthStatus) -> String {
        switch s {
        case .ok: return "全部正常"
        case .warn: return "部分项目需要注意"
        case .error: return "有关键项不可用"
        }
    }

    private func formatUptime(_ sec: Int) -> String {
        let m = sec / 60
        let h = m / 60
        let d = h / 24
        if d > 0 { return "\(d)d \(h % 24)h" }
        if h > 0 { return "\(h)h \(m % 60)m" }
        if m > 0 { return "\(m)m" }
        return "\(sec)s"
    }

    private func renderReport(_ r: HealthReport) -> String {
        var lines: [String] = []
        lines.append("Seaidea 诊断报告")
        lines.append("App: \(appVersion) (\(buildNumber))")
        lines.append("Backend host: \(settings.backendURL.host ?? "?")")
        lines.append("Node: \(r.backend.nodeVersion)  Platform: \(r.backend.platform)/\(r.backend.arch)")
        lines.append("Uptime: \(formatUptime(r.backend.uptimeSec))")
        lines.append("Overall: \(r.overall.rawValue) (ok=\(r.summary.ok) warn=\(r.summary.warn) error=\(r.summary.error))")
        lines.append("")
        for it in r.items {
            var row = "[\(it.status.rawValue.uppercased())] \(it.label)"
            if let d = it.detail { row += " — \(d)" }
            lines.append(row)
            if let h = it.hint { lines.append("    hint: \(h)") }
        }
        return lines.joined(separator: "\n")
    }

    @ViewBuilder
    private func statusDot(_ s: HealthStatus, big: Bool = false) -> some View {
        Circle()
            .fill(statusColor(s))
            .frame(width: big ? 14 : 10, height: big ? 14 : 10)
    }

    private func statusColor(_ s: HealthStatus) -> Color {
        switch s {
        case .ok: return .green
        case .warn: return .yellow
        case .error: return .red
        }
    }
}

// MARK: - Row

private struct HealthItemRow: View {
    let item: HealthItem

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Circle()
                    .fill(color)
                    .frame(width: 10, height: 10)
                Text(item.label).font(.body)
                Spacer()
            }
            if let detail = item.detail {
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                    .truncationMode(.middle)
            }
            if let hint = item.hint {
                Text(hint)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.top, 2)
            }
        }
        .padding(.vertical, 2)
    }

    private var color: Color {
        switch item.status {
        case .ok: return .green
        case .warn: return .yellow
        case .error: return .red
        }
    }
}

// MARK: - Models

enum HealthStatus: String, Decodable {
    case ok, warn, error
}

struct HealthSummary: Decodable {
    let ok: Int
    let warn: Int
    let error: Int
}

struct HealthBackendInfo: Decodable {
    let nodeVersion: String
    let platform: String
    let arch: String
    let pid: Int
    let uptimeSec: Int
}

struct HealthItem: Decodable, Identifiable {
    let id: String
    let label: String
    let status: HealthStatus
    let detail: String?
    let hint: String?
}

struct HealthReport: Decodable {
    let overall: HealthStatus
    let summary: HealthSummary
    let items: [HealthItem]
    let backend: HealthBackendInfo
    let durationMs: Int
}

private enum HealthLoadState: Equatable {
    case idle
    case loading
    case loaded
    case failed(String)
}
