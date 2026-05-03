// Thin HTTP client for /api/worktrees + /api/work endpoints.
// Mirrors backend's WorkRecord shape so encode/decode round-trips cleanly.
//
// Created in Stage A (commit 4). Used by ConversationsSheet for "+ 隔离
// worktree" entry; will be reused by WorktreeFinalizeSheet (commit 5).

import Foundation

struct WorkRecord: Codable, Identifiable, Equatable {
    let id: String
    let worktreePath: String
    let branch: String
    let baseBranch: String
    let status: String  // "active" | "idle" | "merged" | "discarded" | "pushed-pending-pr"
    let conversationTitle: String
    let lastActivityAt: Int64
    let createdAt: Int64
}

@Observable
final class WorktreeAPI {
    private let baseURL: () -> URL

    init(baseURL: @escaping () -> URL) {
        self.baseURL = baseURL
    }

    /// Create a new worktree. Backend generates id / branch / worktreePath.
    /// Returns the WorkRecord on 201.
    func createWorktree(cwd: String, conversationTitle: String) async throws -> WorkRecord {
        let url = baseURL().appendingPathComponent("api/worktrees")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let payload: [String: String] = [
            "cwd": cwd,
            "conversationTitle": conversationTitle,
        ]
        req.httpBody = try JSONEncoder().encode(payload)
        req.timeoutInterval = 15  // git worktree add can take a sec
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse else {
            throw NSError(domain: "WorktreeAPI", code: -1, userInfo: [NSLocalizedDescriptionKey: "no response"])
        }
        if http.statusCode != 201 {
            let msg = String(data: data, encoding: .utf8) ?? "unknown"
            throw NSError(
                domain: "WorktreeAPI",
                code: http.statusCode,
                userInfo: [NSLocalizedDescriptionKey: "HTTP \(http.statusCode): \(msg)"],
            )
        }
        struct Wrap: Codable { let work: WorkRecord }
        return try JSONDecoder().decode(Wrap.self, from: data).work
    }

    /// Finalize a worktree. action ∈ {"merge", "push", "discard"}.
    /// Returns the updated WorkRecord. May fail with 409 on merge conflict —
    /// caller should surface "merge failed, worktree preserved for manual fix".
    func finalize(id: String, action: String) async throws -> WorkRecord {
        let url = baseURL().appendingPathComponent("api/worktrees/\(id)/finalize")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(["action": action])
        req.timeoutInterval = 30  // git merge / push can be slow on big repos
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse else {
            throw NSError(domain: "WorktreeAPI", code: -1, userInfo: [NSLocalizedDescriptionKey: "no response"])
        }
        if http.statusCode != 200 {
            let msg = String(data: data, encoding: .utf8) ?? "unknown"
            throw NSError(
                domain: "WorktreeAPI",
                code: http.statusCode,
                userInfo: [NSLocalizedDescriptionKey: "HTTP \(http.statusCode): \(msg)"],
            )
        }
        struct Wrap: Codable { let work: WorkRecord }
        return try JSONDecoder().decode(Wrap.self, from: data).work
    }

    /// List active (non-finalized) worktrees under the given cwd. Pass
    /// includeAll=true to see merged + discarded too. Used by NewConversation
    /// flow's token-saving banner ("N active worktrees in this cwd, consider
    /// continuing one if related") and by Dashboard tab 工作台 (Stage A.5).
    func listByCwd(_ cwd: String, includeAll: Bool = false) async throws -> [WorkRecord] {
        var comps = URLComponents(url: baseURL().appendingPathComponent("api/work"), resolvingAgainstBaseURL: false)!
        var items: [URLQueryItem] = [URLQueryItem(name: "cwd", value: cwd)]
        if includeAll {
            items.append(URLQueryItem(name: "include", value: "all"))
        }
        comps.queryItems = items
        var req = URLRequest(url: comps.url!)
        req.timeoutInterval = 6
        let (data, _) = try await URLSession.shared.data(for: req)
        struct Wrap: Codable { let items: [WorkRecord] }
        return try JSONDecoder().decode(Wrap.self, from: data).items
    }
}
