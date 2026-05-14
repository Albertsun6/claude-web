// PimCaptureView — v2.1 PIM 统一捕获入口 (M0-PIM Day 4).
//
// Day 4 MVP 范围 (per plan §Day 4 + cursor-agent Round 1 finding #8):
// - **只 text + send button**（砍 commitment picker 到 Week 3 Web 端先做）
// - 用 PimAPI.capture(content:) — backend 默认 commitmentState='inbox'
// - 错误用 inline alert; 成功 dismiss sheet
//
// 后续 (Week 2+):
// - 加 commitment picker (从 server-driven config pim.commitmentStates 拉)
// - 加 domain tags autocomplete (受控词表)
// - 加 AI 建议 pending 状态 UI
// - 加 audit log 显示

import SwiftUI

struct PimCaptureView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var content: String = ""
    @State private var isSubmitting: Bool = false
    @State private var errorMessage: String?

    let pimAPI: PimAPI

    /// Optional callback after successful capture (parent can refresh list).
    var onCaptured: ((PimItemDto) -> Void)?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextEditor(text: $content)
                        .frame(minHeight: 120)
                        .accessibilityLabel("Pim capture content")
                } header: {
                    Text("Capture")
                } footer: {
                    Text("默认进 Inbox。Commitment picker 等 Web 端先做完再来 (Week 3+)。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("PIM 捕获")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                        .disabled(isSubmitting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await submit() }
                    } label: {
                        if isSubmitting {
                            ProgressView()
                        } else {
                            Text("Send")
                                .fontWeight(.semibold)
                        }
                    }
                    .disabled(content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSubmitting)
                }
            }
            .alert("捕获失败", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            ), actions: {
                Button("OK", role: .cancel) { errorMessage = nil }
            }, message: {
                Text(errorMessage ?? "")
            })
        }
    }

    private func submit() async {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let item = try await pimAPI.capture(content: trimmed)
            onCaptured?(item)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
