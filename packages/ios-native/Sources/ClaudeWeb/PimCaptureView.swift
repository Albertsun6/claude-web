// PimCaptureView — v2.1 PIM 统一捕获入口 (M0-PIM Week 2 Day 11 — UI 精雕)
//
// Week 1 Day 4 MVP (砍 picker — cursor-agent finding #8) → Week 2 Day 11 加回:
// - Commitment picker (server-driven; HarnessStore.config.pim.commitmentStates)
// - Domain multi-select (server-driven; HarnessStore.config.pim.domainVocabulary)
// - 客户端不写死 enum — server config 加新值时不重装即可显示 (ADR-020 §D6 弹性)
//
// 仍 out of scope (Week 3+):
// - People autocomplete (需要 person table + LRU)
// - AI 建议 pending 状态显示（Day 12+/Week 3）
// - List view (Week 3)

import SwiftUI

struct PimCaptureView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(HarnessStore.self) private var harnessStore

    @State private var content: String = ""
    @State private var commitmentState: String = "inbox"
    @State private var selectedDomains: Set<String> = []
    @State private var isSubmitting: Bool = false
    @State private var errorMessage: String?

    let pimAPI: PimAPI

    /// Optional callback after successful capture (parent can refresh list).
    var onCaptured: ((PimItemDto) -> Void)?

    /// Server-driven commitment states (fallback to bundle default if config absent).
    private var commitmentStates: [String] {
        harnessStore.config.pim?.commitmentStates ?? PimCommitmentState.defaultValues
    }

    /// Server-driven domain vocabulary (fallback to bundle default).
    private var domainVocabulary: [String] {
        harnessStore.config.pim?.domainVocabulary
            ?? PimConfig.fallback.domainVocabulary
            ?? ["工作", "家庭", "健康", "财务", "学习", "兴趣", "关系"]
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextEditor(text: $content)
                        .frame(minHeight: 120)
                        .accessibilityLabel("Pim capture content")
                } header: {
                    Text("Content")
                }

                Section {
                    Picker("Commitment", selection: $commitmentState) {
                        ForEach(commitmentStates.filter { $0 != "archived" }, id: \.self) { state in
                            Text(stateLabel(state)).tag(state)
                        }
                    }
                    .accessibilityLabel("Commitment state picker")
                } header: {
                    Text("Commitment")
                } footer: {
                    Text("Server-driven (\(commitmentStates.count) options from config). 默认 Inbox.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section {
                    ForEach(domainVocabulary, id: \.self) { domain in
                        Toggle(isOn: domainBinding(domain)) {
                            Text(domain)
                        }
                        .accessibilityLabel("Domain \(domain) toggle")
                    }
                } header: {
                    Text("Domains")
                } footer: {
                    if selectedDomains.isEmpty {
                        Text("可选。默认不打标签。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("Selected: \(selectedDomains.sorted().joined(separator: ", "))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
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
                    .disabled(trimmedContent.isEmpty || isSubmitting)
                }
            }
            .alert("捕获失败", isPresented: errorBinding, actions: {
                Button("OK", role: .cancel) { errorMessage = nil }
            }, message: {
                Text(errorMessage ?? "")
            })
        }
    }

    // MARK: - Helpers

    private var trimmedContent: String {
        content.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var errorBinding: Binding<Bool> {
        Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )
    }

    private func domainBinding(_ domain: String) -> Binding<Bool> {
        Binding(
            get: { selectedDomains.contains(domain) },
            set: { isOn in
                if isOn {
                    selectedDomains.insert(domain)
                } else {
                    selectedDomains.remove(domain)
                }
            }
        )
    }

    /// Pretty-print commitment state for UI (capitalize first letter).
    private func stateLabel(_ state: String) -> String {
        guard let first = state.first else { return state }
        return first.uppercased() + state.dropFirst()
    }

    private func submit() async {
        let trimmed = trimmedContent
        guard !trimmed.isEmpty else { return }
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let domains = selectedDomains.isEmpty ? nil : Array(selectedDomains).sorted()
            let item = try await pimAPI.capture(
                content: trimmed,
                commitmentState: commitmentState == "inbox" ? nil : commitmentState,
                domainTags: domains
            )
            onCaptured?(item)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
