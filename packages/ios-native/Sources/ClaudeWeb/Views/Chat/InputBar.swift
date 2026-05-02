import SwiftUI
import PhotosUI

// MARK: - Pending image (local, before send)

private struct PendingImage: Identifiable {
    let id = UUID()
    let mediaType: String
    let dataBase64: String
    /// UIImage for thumbnail display only.
    let thumbnail: UIImage
}

// MARK: - InputBar

struct InputBar: View {
    @Binding var draft: String
    let cwd: String
    let busy: Bool
    let onSend: ([ImageAttachment]) -> Void
    let onQueue: ([ImageAttachment]) -> Void
    let onStop: () -> Void
    let onTranscript: (String) -> Void

    @Environment(VoiceRecorder.self) private var recorder
    @Environment(InboxAPI.self) private var inboxAPI
    @FocusState private var inputFocused: Bool

    @State private var pendingImages: [PendingImage] = []
    @State private var pickerSelection: [PhotosPickerItem] = []
    @State private var showFilePicker = false
    @State private var atQuery: String? = nil       // non-nil when @ is active
    @State private var promptHistory: [String] = []
    @State private var historyIndex: Int = -1       // -1 = no history browsing
    @State private var showSlashCommands = false
    @State private var slashQuery: String? = nil
    @State private var showContextSheet = false
    @State private var showPhotosPicker = false
    @State private var showInboxSheet = false

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !pendingImages.isEmpty
    }

    /// Icon for the combined attach menu. Filled "+" when there are pending
    /// images, plain "+" otherwise — matches the way send/photo buttons
    /// signal "you have something staged."
    private var attachIconName: String {
        pendingImages.isEmpty ? "plus.circle" : "plus.circle.fill"
    }

    var body: some View {
        VStack(spacing: 0) {
            // Keyboard tools row (history nav + 完成) — shown only while focused.
            // Sits at the very top of InputBar so it lives above any other rows.
            keyboardToolsRow
                .animation(.easeInOut(duration: 0.15), value: inputFocused)

            // Recorder hint
            if recorder.state != .idle {
                HStack(spacing: 6) {
                    Circle().fill(statusColor).frame(width: 8, height: 8)
                    Text(statusLabel).font(.caption).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)
                .padding(.top, 6)
            }

            // Image preview tray
            if !pendingImages.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(pendingImages) { img in
                            ZStack(alignment: .topTrailing) {
                                Image(uiImage: img.thumbnail)
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: 64, height: 64)
                                    .clipShape(.rect(cornerRadius: 8))
                                Button {
                                    pendingImages.removeAll { $0.id == img.id }
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .font(.system(size: 16))
                                        .foregroundStyle(.white)
                                        .background(Color.black.opacity(0.5), in: .circle)
                                }
                                .offset(x: 4, y: -4)
                            }
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                }
            }

            // Input row
            HStack(alignment: .bottom, spacing: 6) {
                // Combined attach menu: photos + context. Replaces two separate
                // buttons (PhotoPicker + paperclip) that were squeezing the
                // text field on smaller screens.
                Menu {
                    Button {
                        showPhotosPicker = true
                    } label: {
                        Label(
                            pendingImages.isEmpty ? "添加图片" : "添加图片（已 \(pendingImages.count) 张）",
                            systemImage: "photo"
                        )
                    }
                    .disabled(busy)

                    Button {
                        showContextSheet = true
                    } label: {
                        Label("附加 git diff / 剪贴板", systemImage: "paperclip")
                    }

                    Divider()

                    Button {
                        showInboxSheet = true
                    } label: {
                        Label("碎想 Inbox（不发送，先存）", systemImage: "lightbulb")
                    }
                } label: {
                    Image(systemName: attachIconName)
                        .frame(width: 36, height: 44)
                        .foregroundStyle(pendingImages.isEmpty ? AnyShapeStyle(.secondary) : AnyShapeStyle(Color.accentColor))
                }
                .accessibilityLabel("附加")
                .photosPicker(
                    isPresented: $showPhotosPicker,
                    selection: $pickerSelection,
                    maxSelectionCount: 5,
                    matching: .images
                )
                .onChange(of: pickerSelection) { _, items in
                    Task { await loadPickedImages(items) }
                }

                TextField("输入指令，或按住麦克风说话…", text: $draft, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...4)
                    .submitLabel(.send)
                    .onSubmit(doSend)
                    .focused($inputFocused)
                    .onChange(of: draft) { _, newValue in
                        slashQuery = extractSlashQuery(newValue)
                        if slashQuery != nil { showSlashCommands = true }

                        atQuery = extractAtQuery(newValue)
                        if atQuery != nil && slashQuery == nil { showFilePicker = true }
                    }
                    .sheet(isPresented: $showSlashCommands) {
                        SlashCommandPicker { selected in
                            draft = selected + " "
                            showSlashCommands = false
                            slashQuery = nil
                        }
                        .presentationDetents([.medium, .large])
                        .presentationDragIndicator(.visible)
                    }
                    .sheet(isPresented: $showFilePicker) {
                        AtFilePicker(cwd: cwd, query: atQuery ?? "") { picked in
                            insertFilePath(picked)
                        }
                        .presentationDetents([.medium, .large])
                        .presentationDragIndicator(.visible)
                    }
                    .sheet(isPresented: $showContextSheet) {
                        ContextAttachSheet(cwd: cwd) { injected in
                            appendContext(injected)
                        }
                        .presentationDetents([.medium, .large])
                        .presentationDragIndicator(.visible)
                    }
                    .sheet(isPresented: $showInboxSheet) {
                        InboxCaptureSheet(api: inboxAPI) {
                            showInboxSheet = false
                        }
                        .presentationDetents([.medium, .large])
                        .presentationDragIndicator(.visible)
                    }

                pttButton

                if busy {
                    if canSend {
                        Button(action: doQueue) {
                            HStack(spacing: 3) {
                                Image(systemName: "text.badge.plus")
                                Text("排队")
                                    .font(.caption.bold())
                            }
                            .padding(.horizontal, 8)
                            .frame(height: 32)
                            .background(Color.accentColor.opacity(0.15), in: .capsule)
                            .foregroundStyle(Color.accentColor)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("加入队列：claude 跑完当前会自动发出")
                    }
                    Button(role: .destructive, action: onStop) {
                        Image(systemName: "stop.fill")
                            .frame(width: 44, height: 44)
                    }
                } else {
                    Button(action: doSend) {
                        Image(systemName: "paperplane.fill")
                            .frame(width: 44, height: 44)
                    }
                    .disabled(!canSend)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(.bar)
        .onAppear { loadPromptHistory() }
    }

    // MARK: - Keyboard tools row
    //
    // Replaces SwiftUI's `.toolbar { ToolbarItemGroup(placement: .keyboard) }`
    // because that placement renders inconsistently on physical devices
    // (observed 2026-05-02: works in simulator, overlaps the input row on
    // iPhone 15 Pro Max). Drawing the row inside InputBar's own VStack means
    // iOS pushes the whole bar up with the keyboard automatically — no
    // dependency on inputAccessoryView timing.
    @ViewBuilder
    private var keyboardToolsRow: some View {
        if inputFocused {
            HStack(spacing: 16) {
                Button {
                    traverseHistory(direction: .up)
                } label: {
                    Image(systemName: "chevron.up")
                        .font(.system(size: 14, weight: .semibold))
                }
                .disabled(historyIndex >= promptHistory.count - 1)
                Button {
                    traverseHistory(direction: .down)
                } label: {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 14, weight: .semibold))
                }
                .disabled(historyIndex < 0)
                Spacer()
                Button("完成") { inputFocused = false }
                    .font(.callout.weight(.medium))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .background(Color(.secondarySystemBackground))
            .overlay(alignment: .top) {
                Divider()
            }
            .overlay(alignment: .bottom) {
                Divider()
            }
            .transition(.opacity.combined(with: .move(edge: .bottom)))
        }
    }

    // MARK: - Send

    private func doSend() {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            savePromptToHistory(trimmed)
            historyIndex = -1
        }
        let attachments = pendingImages.map {
            ImageAttachment(mediaType: $0.mediaType, dataBase64: $0.dataBase64)
        }
        onSend(attachments)
        pendingImages = []
        pickerSelection = []
    }

    private func doQueue() {
        let attachments = pendingImages.map {
            ImageAttachment(mediaType: $0.mediaType, dataBase64: $0.dataBase64)
        }
        onQueue(attachments)
        pendingImages = []
        pickerSelection = []
    }

    // MARK: - Photo loading

    private func loadPickedImages(_ items: [PhotosPickerItem]) async {
        var loaded: [PendingImage] = []
        for item in items {
            guard let data = try? await item.loadTransferable(type: Data.self),
                  let ui = UIImage(data: data) else { continue }

            let (compressed, mime) = compress(ui, originalData: data)
            guard let b64 = compressed?.base64EncodedString() else { continue }
            let thumb = thumbnail(ui)
            loaded.append(PendingImage(mediaType: mime, dataBase64: b64, thumbnail: thumb))
        }
        // Merge, cap at 5 total
        pendingImages = (pendingImages + loaded).prefix(5).map { $0 }
    }

    /// JPEG-compress if PNG > 1 MB, keep PNG otherwise. Returns (data, mimeType).
    private func compress(_ image: UIImage, originalData: Data) -> (Data?, String) {
        let maxBytes = 1 * 1024 * 1024
        if originalData.count <= maxBytes {
            return (originalData, "image/png")
        }
        // Try JPEG at 0.8 quality first, then 0.5
        for q in [0.8, 0.5] as [CGFloat] {
            if let jpg = image.jpegData(compressionQuality: q), jpg.count <= maxBytes {
                return (jpg, "image/jpeg")
            }
        }
        return (image.jpegData(compressionQuality: 0.3), "image/jpeg")
    }

    private func thumbnail(_ image: UIImage) -> UIImage {
        let size = CGSize(width: 128, height: 128)
        return UIGraphicsImageRenderer(size: size).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    // MARK: - PTT

    /// Drag distance (pt) above the button at which we arm "release to cancel".
    /// 80pt matches WeChat / Telegram's feel — far enough that a stray jitter
    /// won't trigger, close enough that the gesture stays in thumb-reach.
    private static let cancelThreshold: CGFloat = 80

    private var pttButton: some View {
        Button {
            Task { await togglePTT() }
        } label: {
            Image(systemName: recordingIcon)
                .frame(width: 44, height: 44)
                .foregroundStyle(recordingFG)
                .background(recordingBG, in: .circle)
        }
        .buttonStyle(.plain)
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    if recorder.state == .idle {
                        Task { await recorder.start() }
                    }
                    // Translation.height < 0 means dragged upward.
                    let armed = value.translation.height <= -Self.cancelThreshold
                    if armed != recorder.cancelArmed {
                        recorder.cancelArmed = armed
                        // Tactile feedback on entering / leaving the cancel
                        // zone — lets the user blind-confirm without looking.
                        let style: UIImpactFeedbackGenerator.FeedbackStyle = armed ? .medium : .light
                        UIImpactFeedbackGenerator(style: style).impactOccurred()
                    }
                }
                .onEnded { _ in
                    guard recorder.state == .recording else { return }
                    if recorder.cancelArmed {
                        recorder.cancel()
                    } else {
                        Task {
                            if let text = await recorder.stopAndTranscribe(), !text.isEmpty {
                                onTranscript(text)
                            }
                        }
                    }
                }
        )
        .disabled(busy)
    }

    private func togglePTT() async {
        switch recorder.state {
        case .idle:
            await recorder.start()
        case .recording:
            if let text = await recorder.stopAndTranscribe(), !text.isEmpty {
                onTranscript(text)
            }
        default:
            break
        }
    }

    private var recordingIcon: String {
        switch recorder.state {
        case .recording: return "mic.fill"
        case .uploading: return "waveform"
        default: return "mic"
        }
    }
    private var recordingFG: Color {
        recorder.state == .idle ? .accentColor : .white
    }
    private var recordingBG: Color {
        switch recorder.state {
        case .recording: return .red
        case .uploading: return .blue
        default: return Color.accentColor.opacity(0.15)
        }
    }
    private var statusColor: Color {
        switch recorder.state {
        case .recording: return .red
        case .uploading: return .blue
        case .error: return .orange
        default: return .gray
        }
    }
    private var statusLabel: String {
        switch recorder.state {
        case .recording: return "录音中…松开发送"
        case .uploading: return "上传识别中…"
        case .error(let msg): return msg
        default: return ""
        }
    }

    // MARK: - @ file detection

    /// Returns the query string after the last `@` if it looks like an
    /// active file completion (no spaces after @). Returns nil otherwise.
    private func extractAtQuery(_ text: String) -> String? {
        guard let atIdx = text.range(of: "@", options: .backwards)?.upperBound else {
            return nil
        }
        let afterAt = String(text[atIdx...])
        // A space or newline after @ means the user finished; dismiss picker.
        if afterAt.contains(" ") || afterAt.contains("\n") { return nil }
        return afterAt   // empty string = just typed @, show full list
    }

    /// Append a context block (git diff, clipboard) to the draft. If the
    /// draft already has content, separates with a blank line so blocks
    /// remain visually distinct.
    private func appendContext(_ block: String) {
        if draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            draft = block
        } else {
            draft += "\n\n" + block
        }
    }

    /// Replace the `@query` suffix in draft with the picked absolute path.
    private func insertFilePath(_ absPath: String) {
        guard let atIdx = draft.range(of: "@", options: .backwards)?.lowerBound else {
            draft += absPath
            return
        }
        draft = String(draft[..<atIdx]) + absPath + " "
        atQuery = nil
    }

    // MARK: - Prompt history

    private enum HistoryDirection { case up, down }

    private func loadPromptHistory() {
        if let data = UserDefaults.standard.data(forKey: "promptHistory"),
           let decoded = try? JSONDecoder().decode([String].self, from: data) {
            promptHistory = decoded
        }
    }

    private func savePromptToHistory(_ prompt: String) {
        promptHistory.removeAll { $0 == prompt }
        promptHistory.insert(prompt, at: 0)
        if promptHistory.count > 50 {
            promptHistory = Array(promptHistory.prefix(50))
        }
        saveHistory()
    }

    private func traverseHistory(direction: HistoryDirection) {
        if direction == .up {
            let nextIdx = historyIndex + 1
            if nextIdx < promptHistory.count {
                historyIndex = nextIdx
                draft = promptHistory[nextIdx]
            }
        } else {
            if historyIndex > 0 {
                historyIndex -= 1
                draft = promptHistory[historyIndex]
            } else if historyIndex == 0 {
                historyIndex = -1
                draft = ""
            }
        }
    }

    private func saveHistory() {
        if let encoded = try? JSONEncoder().encode(promptHistory) {
            UserDefaults.standard.set(encoded, forKey: "promptHistory")
        }
    }

    // MARK: - Slash command detection

    private func extractSlashQuery(_ text: String) -> String? {
        guard text.hasPrefix("/") else { return nil }
        let afterSlash = String(text.dropFirst())
        if afterSlash.contains(" ") || afterSlash.contains("\n") { return nil }
        return afterSlash
    }
}

// MARK: - Slash Command Picker

private struct SlashCommandPicker: View {
    let onSelect: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    private let commands = [
        ("clear", "清除所有消息"),
        ("compact", "压缩对话历史"),
        ("usage", "显示用量统计"),
        ("think", "启用思考模式"),
        ("no-think", "关闭思考模式"),
    ]

    var body: some View {
        NavigationStack {
            List {
                ForEach(commands, id: \.0) { cmd, desc in
                    Button {
                        onSelect("/" + cmd)
                        dismiss()
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) {
                                Image(systemName: icon(for: cmd))
                                    .foregroundStyle(Color.accentColor)
                                Text("/" + cmd)
                                    .font(.system(.body, design: .monospaced))
                                    .foregroundStyle(.primary)
                            }
                            Text(desc)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
            .navigationTitle("命令")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func icon(for cmd: String) -> String {
        switch cmd {
        case "clear": return "xmark.circle.fill"
        case "compact": return "arrow.down.doc.fill"
        case "usage": return "chart.bar.fill"
        case "think", "no-think": return "brain.fill"
        default: return "command"
        }
    }
}
