// Directory picker for "open as project / new conversation cwd". Lists subdirs
// of the current path via /api/fs/tree, lets the user descend, ascend, and
// create new folders via /api/fs/mkdir. Files are not shown — the picker is
// for choosing a directory only.

import SwiftUI

struct DirectoryPicker: View {
    let initialPath: String
    let onSelect: (String) -> Void

    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss

    @State private var path: String
    @State private var entries: [FsEntry] = []
    @State private var loadState: LoadState = .idle
    @State private var showMkdir = false
    @State private var newFolderName = ""
    @State private var mkdirError: String?

    enum LoadState: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    init(initialPath: String, onSelect: @escaping (String) -> Void) {
        self.initialPath = initialPath
        self.onSelect = onSelect
        _path = State(initialValue: initialPath)
    }

    private var fs: FsAPI {
        FsAPI(backend: { settings.backendURL }, token: { settings.authToken })
    }

    var body: some View {
        VStack(spacing: 0) {
            breadcrumb
            Divider()
            content
        }
        .navigationTitle("选择目录")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("取消") { dismiss() }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    onSelect(path)
                    dismiss()
                } label: {
                    Text("选择")
                        .fontWeight(.bold)
                }
            }
        }
        .task(id: path) {
            await load()
        }
        .onAppear {
            // Force reset to initialPath every time the picker is shown.
            // Defends against SwiftUI retaining @State across NavigationStack
            // pop+push (observed on iOS 17/18 in some scenarios) which would
            // otherwise reopen the picker at the previously navigated path.
            if path != initialPath {
                path = initialPath
            }
        }
        .alert("新建文件夹", isPresented: $showMkdir) {
            TextField("文件夹名称", text: $newFolderName)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("取消", role: .cancel) {
                newFolderName = ""
            }
            Button("创建") {
                Task { await mkdir() }
            }
        } message: {
            if let err = mkdirError {
                Text(err)
            } else {
                Text("将在 \(path) 下创建")
            }
        }
    }

    // MARK: - Breadcrumb

    private var breadcrumb: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(Array(breadcrumbComponents.enumerated()), id: \.offset) { _, component in
                    Button {
                        path = component.fullPath
                    } label: {
                        Text(component.label)
                            .font(.caption)
                            .foregroundStyle(component.fullPath == path ? Color.primary : Color.accentColor)
                    }
                    if component.fullPath != path {
                        Image(systemName: "chevron.right")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
    }

    private struct Crumb {
        let label: String
        let fullPath: String
    }

    private var breadcrumbComponents: [Crumb] {
        // Splits "/Users/yongqian/Desktop" into clickable crumbs.
        var crumbs: [Crumb] = [Crumb(label: "/", fullPath: "/")]
        let parts = path.split(separator: "/").map(String.init)
        var accum = ""
        for part in parts {
            accum += "/" + part
            crumbs.append(Crumb(label: part, fullPath: accum))
        }
        return crumbs
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        switch loadState {
        case .idle, .loading:
            VStack { Spacer(); ProgressView(); Spacer() }
        case .failed(let msg):
            VStack(spacing: 12) {
                Spacer()
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                    .font(.largeTitle)
                Text(msg)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                Button("重试") { Task { await load() } }
                Spacer()
            }
            .padding()
        case .loaded:
            List {
                Section {
                    if let parent = parentPath {
                        Button {
                            path = parent
                        } label: {
                            Label("..", systemImage: "arrow.up")
                                .foregroundStyle(.secondary)
                        }
                    }
                    Button {
                        newFolderName = ""
                        mkdirError = nil
                        showMkdir = true
                    } label: {
                        Label("新建文件夹…", systemImage: "folder.badge.plus")
                            .foregroundStyle(Color.accentColor)
                    }
                }
                Section("子目录") {
                    let dirs = entries.filter { $0.isDir }
                    if dirs.isEmpty {
                        Text("（空）")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    ForEach(dirs) { entry in
                        Button {
                            path = (path as NSString).appendingPathComponent(entry.name)
                        } label: {
                            HStack {
                                Image(systemName: "folder.fill")
                                    .foregroundStyle(Color.accentColor)
                                Text(entry.name)
                                    .foregroundStyle(.primary)
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .foregroundStyle(.tertiary)
                                    .font(.caption)
                            }
                        }
                    }
                }
            }
        }
    }

    private var parentPath: String? {
        if path == "/" { return nil }
        let p = (path as NSString).deletingLastPathComponent
        return p.isEmpty ? "/" : p
    }

    // MARK: - Actions

    private func load() async {
        loadState = .loading
        do {
            let result = try await fs.listChildren(of: path)
            entries = result
            loadState = .loaded
        } catch {
            loadState = .failed(error.localizedDescription)
        }
    }

    private func mkdir() async {
        let name = newFolderName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        do {
            let created = try await fs.mkdir(parent: path, name: name)
            // Auto-select the freshly-created folder. The user almost always
            // creates a folder specifically to use it; making them tap "选择"
            // afterwards is friction.
            mkdirError = nil
            newFolderName = ""
            onSelect(created)
            dismiss()
        } catch {
            mkdirError = error.localizedDescription
            // Re-open the alert so user sees the error
            showMkdir = true
        }
    }
}
