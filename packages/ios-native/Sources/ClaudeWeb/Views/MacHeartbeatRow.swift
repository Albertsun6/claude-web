// Tiny status row showing whether the Mac backend is alive + recent activity.
// Embed in SettingsView's Form. Subscribes to HeartbeatMonitor (already polling
// in background).

import SwiftUI

struct MacHeartbeatRow: View {
    let monitor: HeartbeatMonitor

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(dotColor)
                .frame(width: 10, height: 10)
                .padding(.top, 6)
            VStack(alignment: .leading, spacing: 4) {
                Text(statusText).font(.body)
                if let detail = detailText {
                    Text(detail).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Button {
                monitor.fetchNow()
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 14))
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("刷新心跳")
        }
        .padding(.vertical, 4)
    }

    private var dotColor: Color {
        switch monitor.status {
        case .healthy: return .green
        case .stale: return .yellow
        case .unreachable: return .red
        case .unknown: return .gray
        }
    }

    private var statusText: String {
        switch monitor.status {
        case .healthy: return "Mac 在线"
        case .stale(let s): return "心跳延迟 \(s) 秒"
        case .unreachable(let err): return "无法连接 Mac · \(err)"
        case .unknown: return "等待心跳…"
        }
    }

    private var detailText: String? {
        guard let snap = monitor.snapshot else { return nil }
        var parts: [String] = []
        parts.append("活跃任务 \(snap.activeRunCount)")
        parts.append("通道 \(snap.notificationChannelCount)")
        if let spawn = snap.lastSpawnAt {
            let secs = max(0, (snap.now - spawn) / 1000)
            parts.append("最近 spawn \(formatAgo(seconds: secs))")
        }
        parts.append("正常运行 \(formatUptime(snap.uptimeSec))")
        return parts.joined(separator: " · ")
    }

    private func formatAgo(seconds: Int64) -> String {
        if seconds < 60 { return "\(seconds)s 前" }
        if seconds < 3600 { return "\(seconds / 60)m 前" }
        let h = seconds / 3600
        return "\(h)h 前"
    }

    private func formatUptime(_ seconds: Int) -> String {
        if seconds < 60 { return "\(seconds)s" }
        if seconds < 3600 { return "\(seconds / 60)m" }
        if seconds < 86400 { return "\(seconds / 3600)h" }
        return "\(seconds / 86400)d"
    }
}
