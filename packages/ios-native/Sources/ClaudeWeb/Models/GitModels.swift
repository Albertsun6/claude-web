// Mirror of backend git status response. Decoded by GitAPI; held inside
// ConversationChatState.pendingGitGate so the H5 "out-the-door check" sheet
// has a clear data type to render.

import Foundation

struct GitStatusFile: Decodable, Equatable, Identifiable {
    let path: String
    let indexStatus: String
    let workingStatus: String

    /// Synthetic id — git porcelain uses path uniqueness within a status.
    var id: String { path }

    /// True if there are changes in either index or working tree (XY != "  ").
    var hasChange: Bool {
        indexStatus.trimmingCharacters(in: .whitespaces) != ""
            || workingStatus.trimmingCharacters(in: .whitespaces) != ""
    }

    var isUntracked: Bool {
        indexStatus == "?" && workingStatus == "?"
    }

    var isStaged: Bool {
        let s = indexStatus.trimmingCharacters(in: .whitespaces)
        return !s.isEmpty && s != "?"
    }

    var isModified: Bool {
        let w = workingStatus.trimmingCharacters(in: .whitespaces)
        return !w.isEmpty && w != "?"
    }
}

struct GitStatusReport: Decodable, Equatable {
    let branch: String?
    let ahead: Int
    let behind: Int
    let files: [GitStatusFile]

    var isDirty: Bool { !files.isEmpty }

    var staged: [GitStatusFile] { files.filter { $0.isStaged } }
    var modified: [GitStatusFile] { files.filter { $0.isModified && !$0.isUntracked } }
    var untracked: [GitStatusFile] { files.filter { $0.isUntracked } }
}
