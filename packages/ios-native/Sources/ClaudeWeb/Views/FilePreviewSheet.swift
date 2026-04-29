import SwiftUI

struct FilePreviewSheet: View {
    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) var dismiss

    let cwd: String
    let relativePath: String
    let entry: FsEntry
    @State private var fileContent: String?
    @State private var markdownContent: AttributedString?
    @State private var loadState: LoadState = .idle

    private enum FileKind {
        case image, text, binary(label: String)
    }

    private var fileKind: FileKind {
        switch (entry.name as NSString).pathExtension.lowercased() {
        case "png", "jpg", "jpeg", "gif", "webp", "heic", "bmp", "ico":
            return .image
        case "pdf": return .binary(label: "PDF")
        case "mp4", "webm", "mov", "m4v": return .binary(label: "视频")
        case "mp3", "wav", "m4a", "aac", "flac", "ogg": return .binary(label: "音频")
        default: return .text
        }
    }

    private var isMarkdown: Bool {
        (entry.name as NSString).pathExtension.lowercased() == "md"
    }

    private var fsAPI: FsAPI {
        FsAPI(backend: { settings.backendURL }, token: { settings.authToken })
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Header
                ZStack {
                    Text(entry.name)
                        .font(.headline)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.horizontal, 44)
                    HStack {
                        Spacer()
                        Button(action: { dismiss() }) {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 20))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(12)
                .background(Color(.tertiarySystemFill))

                // Content
                Group {
                    switch fileKind {
                    case .image:
                        imagePreview
                    case .binary(let label):
                        binaryPlaceholder(label)
                    case .text:
                        textBody
                    }
                }

                // Footer
                if let size = entry.size {
                    HStack(spacing: 12) {
                        Text("Size: \(formatSize(size))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                    }
                    .padding(8)
                    .background(Color(.tertiarySystemFill))
                }
            }
            .navigationBarTitleDisplayMode(.inline)
        }
        .onAppear {
            if case .text = fileKind {
                Task { await loadFile() }
            }
        }
    }

    @ViewBuilder
    private var textBody: some View {
        if loadState == .loading {
            VStack {
                ProgressView("Loading...")
            }
            .frame(maxHeight: .infinity)
        } else if case .failed(let error) = loadState {
            errorView(error)
        } else if let attributed = markdownContent {
            markdownPreview(attributed)
        } else if let content = fileContent {
            plainPreview(content)
        }
    }

    @ViewBuilder
    private var imagePreview: some View {
        let url = fsAPI.getBlobURL(root: cwd, relativePath: relativePath)
        ScrollView([.horizontal, .vertical]) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .empty:
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                case .success(let image):
                    image.resizable().scaledToFit()
                case .failure(let error):
                    errorView(error.localizedDescription)
                @unknown default:
                    EmptyView()
                }
            }
            .padding(16)
        }
        .frame(maxHeight: .infinity)
    }

    @ViewBuilder
    private func binaryPlaceholder(_ label: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "doc")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("\(label) 文件")
                .font(.headline)
            Text("尚不支持在 app 内预览。")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxHeight: .infinity)
    }

    @ViewBuilder
    private func errorView(_ message: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 32))
                .foregroundStyle(.red)
            Text("Error")
                .font(.headline)
            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Close") { dismiss() }
        }
        .frame(maxHeight: .infinity)
    }

    @ViewBuilder
    private func markdownPreview(_ attributed: AttributedString) -> some View {
        ScrollView {
            Text(attributed)
                .font(.callout)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .textSelection(.enabled)
        }
    }

    @ViewBuilder
    private func plainPreview(_ content: String) -> some View {
        let isCode = isCodeFile(entry.name)
        ScrollView {
            Text(content)
                .font(isCode ? .system(.callout, design: .monospaced) : .callout)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .textSelection(.enabled)
        }
    }

    private func loadFile() async {
        loadState = .loading
        do {
            let content = try await fsAPI.readFile(root: cwd, relativePath: relativePath)
            self.fileContent = content
            if isMarkdown {
                let options = AttributedString.MarkdownParsingOptions(
                    allowsExtendedAttributes: true,
                    interpretedSyntax: .full,
                    failurePolicy: .returnPartiallyParsedIfPossible
                )
                markdownContent = try? AttributedString(markdown: content, options: options)
            }
            loadState = .loaded
        } catch {
            loadState = .failed(error.localizedDescription)
        }
    }

    private func isCodeFile(_ name: String) -> Bool {
        let ext = (name as NSString).pathExtension.lowercased()
        let codeExts = ["swift", "ts", "tsx", "js", "jsx", "py", "json", "yaml", "yml",
                        "toml", "html", "css", "xml", "sh", "rb", "go", "java", "c", "h", "cpp"]
        return codeExts.contains(ext)
    }

    private func formatSize(_ bytes: Int) -> String {
        let formatter = ByteCountFormatter()
        formatter.allowedUnits = [.useBytes, .useKB, .useMB]
        formatter.countStyle = .file
        return formatter.string(fromByteCount: Int64(bytes))
    }
}
