// Shown when user types @ in the input bar. Lets them browse/search the
// current project's file tree and insert a file path into the draft.
//
// UX flow:
//   User types "@"          → sheet opens at cwd root, no filter
//   User types "@src"       → same sheet, entries filtered by "src"
//   User taps a directory   → descend into it
//   User taps a file        → onPick(absolutePath) called, sheet dismisses
//   User taps ✕ or swipes  → sheet dismissed, @ stays in draft

import SwiftUI

struct AtFilePicker: View {
    /// Root project directory (e.g. ~/Desktop/my-project)
    let cwd: String
    /// Current query after the @ (may be empty)
    let query: String
    /// Called with the absolute file path the user selected.
    let onPick: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(AppSettings.self) private var settings
    @State private var path: String = ""          // relative to cwd
    @State private var entries: [FsEntry] = []
    @State private var loading = false
    @State private var errorMsg: String? = nil

    private var fs: FsAPI {
        FsAPI(backend: { settings.backendURL }, token: { settings.authToken })
    }

    // MARK: - Derived

    private var absolutePath: String {
        path.isEmpty ? cwd : (cwd as NSString).appendingPathComponent(path)
    }

    private var filtered: [FsEntry] {
        guard !query.isEmpty else { return entries }
        return entries.filter { $0.name.localizedCaseInsensitiveContains(query) }
    }

    private var breadcrumbs: [String] {
        // ["", "src", "components"] for path "src/components"
        var parts = [""]
        if !path.isEmpty {
            parts += path.components(separatedBy: "/").filter { !$0.isEmpty }
        }
        return parts
    }

    // MARK: - Body

    var body: some View {
        NavigationStack {
            Group {
                if loading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let err = errorMsg {
                    ContentUnavailableView("加载失败", systemImage: "exclamationmark.triangle", description: Text(err))
                } else if filtered.isEmpty {
                    ContentUnavailableView("无匹配文件", systemImage: "doc.questionmark", description: Text(query.isEmpty ? "目录为空" : "没有匹配 "\(query)" 的文件"))
                } else {
                    List {
                        // Back button (not at root)
                        if !path.isEmpty {
                            Button {
                                ascend()
                            } label: {
                                Label("返回上级", systemImage: "chevron.left")
                                    .foregroundStyle(.accentColor)
                            }
                        }
                        ForEach(filtered) { entry in
                            Button {
                                pick(entry)
                            } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: entry.isDir ? "folder.fill" : fileIcon(entry.name))
                                        .foregroundStyle(entry.isDir ? .yellow : .secondary)
                                        .frame(width: 20)
                                    Text(entry.name)
                                        .foregroundStyle(.primary)
                                        .lineLimit(1)
                                    Spacer()
                                    if entry.isDir {
                                        Image(systemName: "chevron.right")
                                            .font(.caption)
                                            .foregroundStyle(.tertiary)
                                    } else if let size = entry.size {
                                        Text(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
                                            .font(.caption)
                                            .foregroundStyle(.tertiary)
                                    }
                                }
                            }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle(breadcrumbTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                // Breadcrumb trail in the principal slot on wide enough screens
                ToolbarItem(placement: .principal) {
                    breadcrumbView
                }
            }
        }
        .task(id: absolutePath) { await load() }
    }

    // MARK: - Breadcrumb

    private var breadcrumbTitle: String {
        path.isEmpty ? (cwd as NSString).lastPathComponent : (absolutePath as NSString).lastPathComponent
    }

    private var breadcrumbView: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                ForEach(Array(breadcrumbs.enumerated()), id: \.offset) { idx, crumb in
                    Button {
                        let newPath = breadcrumbs[1...idx].joined(separator: "/")
                        path = newPath
                    } label: {
                        Text(idx == 0 ? (cwd as NSString).lastPathComponent : crumb)
                            .font(.caption)
                            .lineLimit(1)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(idx == breadcrumbs.count - 1 ? .primary : .accentColor)
                    if idx < breadcrumbs.count - 1 {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 9))
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
    }

    // MARK: - Actions

    private func pick(_ entry: FsEntry) {
        if entry.isDir {
            path = path.isEmpty ? entry.name : "\(path)/\(entry.name)"
        } else {
            let abs = (absolutePath as NSString).appendingPathComponent(entry.name)
            onPick(abs)
            dismiss()
        }
    }

    private func ascend() {
        let parts = path.components(separatedBy: "/").filter { !$0.isEmpty }
        path = parts.dropLast().joined(separator: "/")
    }

    private func load() async {
        loading = true
        errorMsg = nil
        do {
            entries = try await fs.listChildren(of: absolutePath)
        } catch {
            errorMsg = error.localizedDescription
        }
        loading = false
    }

    // MARK: - Icon helper

    private func fileIcon(_ name: String) -> String {
        let ext = (name as NSString).pathExtension.lowercased()
        switch ext {
        case "swift": return "swift"
        case "ts", "tsx", "js", "jsx", "mjs": return "chevron.left.forwardslash.chevron.right"
        case "py": return "terminal"
        case "md", "txt": return "doc.text"
        case "json", "yaml", "yml", "toml": return "doc.badge.gearshape"
        case "png", "jpg", "jpeg", "gif", "svg", "webp": return "photo"
        case "pdf": return "doc.richtext"
        case "sh", "zsh", "bash": return "terminal"
        default: return "doc"
        }
    }
}
