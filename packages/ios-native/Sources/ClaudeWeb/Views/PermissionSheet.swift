import SwiftUI

struct PermissionSheet: View {
    let request: PermissionRequest
    let client: BackendClient
    let onDecision: (PermissionDecision) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var autoAllowThisTurn = false

    var body: some View {
        NavigationStack {
            Form {
                Section("工具") {
                    Text(request.toolName).font(.title3.bold())
                }
                Section("内容") {
                    Text(request.preview)
                        .font(.body.monospaced())
                        .textSelection(.enabled)
                        .lineLimit(10)
                }
                Section("后续处理") {
                    Toggle(
                        isOn: $autoAllowThisTurn,
                        label: {
                            Text("本轮对话中的 \(request.toolName) 总是允许")
                                .font(.subheadline)
                        }
                    )
                }
                Section {
                    Button(role: .destructive) {
                        onDecision(.deny)
                        dismiss()
                    } label: {
                        Label("拒绝", systemImage: "xmark.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    Button {
                        if autoAllowThisTurn {
                            client.allowToolForRun(request.runId, request.toolName)
                        }
                        onDecision(.allow)
                        dismiss()
                    } label: {
                        Label("允许", systemImage: "checkmark.circle.fill")
                            .frame(maxWidth: .infinity)
                            .fontWeight(.semibold)
                    }
                }
            }
            .navigationTitle("权限请求")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
