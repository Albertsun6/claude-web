import SwiftUI

/// In-app viewer for the telemetry ring buffer. Newest first; tap a row to
/// see full props. Useful for diagnosing without leaving the device.
struct TelemetryDebugView: View {
    @Environment(Telemetry.self) private var telemetry

    var body: some View {
        List(telemetry.ring) { event in
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(event.event)
                        .font(.caption.monospaced().bold())
                        .foregroundStyle(levelColor(event.level))
                    Spacer()
                    Text(event.timestamp, format: .dateTime.hour().minute().second())
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                }
                if let conv = event.conversationId {
                    Text("conv: \(conv.prefix(8))").font(.caption2.monospaced()).foregroundStyle(.secondary)
                }
                if let runId = event.runId {
                    Text("run: \(runId.prefix(8))").font(.caption2.monospaced()).foregroundStyle(.secondary)
                }
                if let props = event.props, !props.isEmpty {
                    ForEach(props.sorted(by: { $0.key < $1.key }), id: \.key) { kv in
                        Text("  \(kv.key) = \(kv.value)")
                            .font(.caption2.monospaced())
                            .foregroundStyle(.secondary)
                            .lineLimit(3)
                    }
                }
            }
        }
        .navigationTitle("最近事件")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func levelColor(_ level: Telemetry.Level) -> Color {
        switch level {
        case .info: return .secondary
        case .warn: return .orange
        case .error, .crash: return .red
        }
    }
}
