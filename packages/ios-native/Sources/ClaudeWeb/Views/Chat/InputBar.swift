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
    @FocusState private var inputFocused: Bool

    @State private var pendingImages: [PendingImage] = []
    @State private var pickerSelection: [PhotosPickerItem] = []
    @State private var showFilePicker = false
    @State private var atQuery: String? = nil       // non-nil when @ is active

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !pendingImages.isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
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
                // Photo picker button
                PhotosPicker(
                    selection: $pickerSelection,
                    maxSelectionCount: 5,
                    matching: .images
                ) {
                    Image(systemName: pendingImages.isEmpty ? "photo" : "photo.badge.checkmark")
                        .frame(width: 36, height: 44)
                        .foregroundStyle(pendingImages.isEmpty ? AnyShapeStyle(.secondary) : AnyShapeStyle(Color.accentColor))
                }
                .buttonStyle(.plain)
                .disabled(busy)  // PhotosPicker disabled when busy, so queued attachments are always nil (by design; architecture supports it for future use)
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
                        atQuery = extractAtQuery(newValue)
                        if atQuery != nil { showFilePicker = true }
                    }
                    .toolbar {
                        ToolbarItemGroup(placement: .keyboard) {
                            Spacer()
                            Button("完成") { inputFocused = false }
                        }
                    }
                    .sheet(isPresented: $showFilePicker) {
                        AtFilePicker(cwd: cwd, query: atQuery ?? "") { picked in
                            insertFilePath(picked)
                        }
                        .presentationDetents([.medium, .large])
                        .presentationDragIndicator(.visible)
                    }

                pttButton

                if busy {
                    if canSend {
                        Button(action: doQueue) {
                            Image(systemName: "text.badge.plus")
                                .frame(width: 36, height: 44)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Color.accentColor)
                        .accessibilityLabel("加入队列")
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
    }

    // MARK: - Send

    private func doSend() {
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
                .onChanged { _ in
                    if recorder.state == .idle {
                        Task { await recorder.start() }
                    }
                }
                .onEnded { _ in
                    if recorder.state == .recording {
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

    /// Replace the `@query` suffix in draft with the picked absolute path.
    private func insertFilePath(_ absPath: String) {
        guard let atIdx = draft.range(of: "@", options: .backwards)?.lowerBound else {
            draft += absPath
            return
        }
        draft = String(draft[..<atIdx]) + absPath + " "
        atQuery = nil
    }
}
