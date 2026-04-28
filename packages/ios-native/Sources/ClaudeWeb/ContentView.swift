// Top-level UI: connection chip + chat list + input + settings sheet.
// M1 scope: text-only. M2 will inline a PTT button next to send.

import SwiftUI

struct ContentView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(BackendClient.self) private var client
    @State private var draft: String = ""
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                connectionChip
                ChatListView(messages: client.messages)
                    .frame(maxHeight: .infinity)
                Divider()
                InputBar(draft: $draft, busy: client.busy, onSend: send, onStop: client.interrupt)
            }
            .navigationTitle("Claude")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: {
                        Image(systemName: "gearshape")
                    }
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
        }
    }

    private var connectionChip: some View {
        HStack(spacing: 6) {
            Circle().fill(chipColor).frame(width: 8, height: 8)
            Text(chipLabel).font(.caption).foregroundStyle(.secondary)
            Spacer()
            Text(settings.cwd.split(separator: "/").last.map(String.init) ?? settings.cwd)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(.bar)
    }

    private var chipColor: Color {
        switch client.state {
        case .connected: return .green
        case .connecting: return .yellow
        case .disconnected: return .gray
        case .error: return .red
        }
    }

    private var chipLabel: String {
        switch client.state {
        case .connected: return "已连接"
        case .connecting: return "连接中…"
        case .disconnected: return "未连接"
        case .error(let msg): return "失败: \(msg)"
        }
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        client.sendPrompt(text, cwd: settings.cwd)
        draft = ""
    }
}

private struct ChatListView: View {
    let messages: [ChatLine]

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(messages) { line in
                        ChatLineView(line: line)
                            .id(line.id)
                    }
                }
                .padding(12)
            }
            .onChange(of: messages.last?.id) { _, newID in
                guard let newID else { return }
                withAnimation { proxy.scrollTo(newID, anchor: .bottom) }
            }
            // Also follow assistant streaming updates (id stays same, text grows).
            .onChange(of: messages.last?.text) { _, _ in
                guard let last = messages.last else { return }
                withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
            }
        }
    }
}

private struct ChatLineView: View {
    let line: ChatLine

    var body: some View {
        switch line.role {
        case .user:
            HStack {
                Spacer(minLength: 40)
                Text(line.text)
                    .padding(10)
                    .background(Color.accentColor.opacity(0.18), in: .rect(cornerRadius: 12))
            }
        case .assistant:
            Text(line.text)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        case .system:
            Text(line.text)
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.vertical, 2)
        case .error:
            Text(line.text)
                .font(.caption)
                .foregroundStyle(.red)
                .padding(8)
                .background(.red.opacity(0.08), in: .rect(cornerRadius: 8))
        }
    }
}

private struct InputBar: View {
    @Binding var draft: String
    let busy: Bool
    let onSend: () -> Void
    let onStop: () -> Void

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("输入指令…", text: $draft, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...4)
                .submitLabel(.send)
                .onSubmit(onSend)
            if busy {
                Button(role: .destructive, action: onStop) {
                    Image(systemName: "stop.fill")
                        .frame(width: 44, height: 44)
                }
            } else {
                Button(action: onSend) {
                    Image(systemName: "paperplane.fill")
                        .frame(width: 44, height: 44)
                }
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
    }
}

struct SettingsView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss
    @State private var draftURL: String = ""
    @State private var draftCwd: String = ""

    var body: some View {
        @Bindable var s = settings
        NavigationStack {
            Form {
                Section("Backend") {
                    TextField("https://mymac.tailcf3ccf.ts.net", text: $draftURL)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                    Button("用模拟器默认 (localhost:3030)") {
                        draftURL = "http://localhost:3030"
                    }
                    Button("用 Tailscale 默认") {
                        draftURL = "https://mymac.tailcf3ccf.ts.net"
                    }
                }
                Section("工作目录") {
                    TextField("/Users/you/Desktop", text: $draftCwd)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
            }
            .navigationTitle("设置")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("保存") {
                        if let u = URL(string: draftURL) { s.backendURL = u }
                        s.cwd = draftCwd
                        dismiss()
                    }
                    .fontWeight(.bold)
                }
            }
            .onAppear {
                draftURL = settings.backendURL.absoluteString
                draftCwd = settings.cwd
            }
        }
    }
}
