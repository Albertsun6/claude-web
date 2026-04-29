import SwiftUI

struct FileBrowserPanel: View {
    @Environment(AppSettings.self) private var settings

    let cwd: String
    @State private var currentPath = ""
    @State private var entries: [FsEntry] = []
    @State private var loadState: LoadState = .idle

    var onFileSelected: (String, String, FsEntry) -> Void

    private var fsAPI: FsAPI {
        FsAPI(backend: { settings.backendURL }, token: { settings.authToken })
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Files")
                    .font(.headline)
                Spacer()
                Button(action: { Task { await loadFiles() } }) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 12, weight: .semibold))
                }
                .disabled(loadState == .loading)
            }
            .padding(12)
            .background(Color(.tertiarySystemFill))

            // File List
            Group {
                if loadState == .loading {
                    VStack {
                        ProgressView()
                    }
                } else if entries.isEmpty {
                    VStack {
                        Text("No files")
                            .foregroundStyle(.secondary)
                    }
                } else {
                    fileListContent
                }
            }
            .frame(maxHeight: .infinity)
        }
        .background(Color(.systemBackground))
        .onAppear { Task { await loadFiles() } }
    }

    @ViewBuilder
    private var fileListContent: some View {
        let fullPath = currentPath
        List {
            // Parent directory
            if !currentPath.isEmpty {
                Button(action: { goUp() }) {
                    HStack(spacing: 10) {
                        Image(systemName: "arrow.up")
                            .frame(width: 20, alignment: .center)
                        Text("..")
                        Spacer()
                    }
                }
                .foregroundStyle(.primary)
            }

            // Files
            ForEach(entries) { entry in
                fileRow(entry, currentPath: fullPath)
            }
        }
        .listStyle(.plain)
    }

    @ViewBuilder
    private func fileRow(_ entry: FsEntry, currentPath: String) -> some View {
        let relativePath = currentPath.isEmpty ? entry.name : currentPath + "/" + entry.name
        Button(action: {
            if entry.isDir {
                navigateTo(relativePath)
            } else {
                onFileSelected(cwd, relativePath, entry)
            }
        }) {
            HStack(spacing: 10) {
                Image(systemName: fileIconName(entry.name, isDir: entry.isDir))
                    .frame(width: 20, alignment: .center)
                    .font(.system(size: 14))

                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.name)
                        .font(.body)
                        .lineLimit(1)
                    if let size = entry.size {
                        Text(formatSize(size))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()

                if entry.isDir {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .foregroundStyle(.primary)
    }

    private func loadFiles() async {
        loadState = .loading
        do {
            let fullPath = currentPath.isEmpty ? cwd : cwd + "/" + currentPath
            entries = try await fsAPI.listChildren(of: fullPath)
            loadState = .loaded
        } catch {
            loadState = .failed(error.localizedDescription)
        }
    }

    private func navigateTo(_ path: String) {
        currentPath = path
        Task { await loadFiles() }
    }

    private func goUp() {
        let components = currentPath.split(separator: "/", omittingEmptySubsequences: true)
        currentPath = components.count > 1 ? components.dropLast().joined(separator: "/") : ""
        Task { await loadFiles() }
    }

    private func fileIconName(_ name: String, isDir: Bool) -> String {
        if isDir { return "folder" }
        let ext = (name as NSString).pathExtension.lowercased()
        switch ext {
        case "swift": return "swift"
        case "ts", "tsx", "js", "jsx", "mjs": return "chevron.left.forwardslash.chevron.right"
        case "py": return "terminal"
        case "md", "txt": return "doc.text"
        case "json", "yaml", "yml", "toml": return "doc.badge.gearshape"
        case "png", "jpg", "jpeg", "gif", "svg", "webp": return "photo"
        case "pdf": return "doc.richtext"
        case "mp4", "webm", "mov", "m4v": return "film"
        case "mp3", "wav", "aac", "m4a", "flac": return "music.note"
        default: return "doc"
        }
    }

    private func formatSize(_ bytes: Int) -> String {
        let formatter = ByteCountFormatter()
        formatter.allowedUnits = [.useBytes, .useKB, .useMB]
        formatter.countStyle = .file
        return formatter.string(fromByteCount: Int64(bytes))
    }
}

enum LoadState: Equatable {
    case idle
    case loading
    case loaded
    case failed(String)
}
