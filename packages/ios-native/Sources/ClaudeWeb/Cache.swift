// Codable JSON cache at Application Support. Mirrors server state for offline
// reads and crash-survival of conversation→sessionId bindings.
//
// Layout:
//   Application Support/com.albertsun6.claudeweb-native/cache/
//   ├── projects.json            # last GET /api/projects snapshot
//   ├── conversations.json       # all known conversation metadata
//   └── sessions/
//       └── <conversationId>.json   # ChatLine[] snapshot of one conversation
//
// LRU: at most 50 session files kept. Oldest by mtime gets dropped first.
// projects.json and conversations.json are unbounded (small payloads).
//
// Atomicity: every write goes through writeFile-tmp + rename, so a process
// crash mid-write can't leave a half-formed file. Decode failures fall back
// to "empty cache" — UI shows a fresh state and bootstrap re-fetches.

import Foundation
import Observation

@MainActor
@Observable
final class Cache {
    private let root: URL
    private let projectsPath: URL
    private let conversationsPath: URL
    private let sessionsDir: URL

    private static let MAX_SESSIONS = 50

    /// Optional telemetry sink. Injected after init via `bindTelemetry`.
    private weak var telemetry: Telemetry?

    func bindTelemetry(_ tel: Telemetry) {
        self.telemetry = tel
    }

    init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let bundleId = Bundle.main.bundleIdentifier ?? "com.albertsun6.claudeweb-native"
        let cacheRoot = support.appendingPathComponent(bundleId).appendingPathComponent("cache")
        self.root = cacheRoot
        self.projectsPath = cacheRoot.appendingPathComponent("projects.json")
        self.conversationsPath = cacheRoot.appendingPathComponent("conversations.json")
        self.sessionsDir = cacheRoot.appendingPathComponent("sessions")
        try? FileManager.default.createDirectory(at: sessionsDir, withIntermediateDirectories: true)
    }

    // MARK: - Projects snapshot

    func loadProjects() -> [ProjectDTO] {
        decodeOrDefault(at: projectsPath, default: ProjectsCache(version: 1, projects: [])).projects
    }

    func saveProjects(_ projects: [ProjectDTO]) {
        encodeAtomic(ProjectsCache(version: 1, projects: projects), to: projectsPath)
    }

    // MARK: - Conversations metadata

    func loadConversations() -> [Conversation] {
        decodeOrDefault(at: conversationsPath, default: ConversationsCache(version: 1, conversations: [])).conversations
    }

    func saveConversations(_ conversations: [Conversation]) {
        encodeAtomic(ConversationsCache(version: 1, conversations: conversations), to: conversationsPath)
    }

    // MARK: - Session messages

    func loadSession(_ conversationId: String) -> [ChatLine] {
        decodeOrDefault(
            at: sessionPath(conversationId),
            default: SessionCache(version: 1, messages: [])
        ).messages
    }

    func saveSession(_ conversationId: String, messages: [ChatLine]) {
        encodeAtomic(SessionCache(version: 1, messages: messages), to: sessionPath(conversationId))
        enforceLRU()
    }

    func dropSession(_ conversationId: String) {
        try? FileManager.default.removeItem(at: sessionPath(conversationId))
    }

    /// Wipe everything on disk — projects.json, conversations.json, all
    /// session files. After this the next bootstrap behaves like a clean
    /// install (cache empty → server reconcile re-populates).
    func eraseAll() {
        try? FileManager.default.removeItem(at: projectsPath)
        try? FileManager.default.removeItem(at: conversationsPath)
        if let entries = try? FileManager.default.contentsOfDirectory(at: sessionsDir, includingPropertiesForKeys: nil) {
            for url in entries { try? FileManager.default.removeItem(at: url) }
        }
        telemetry?.warn("cache.erase_all")
    }

    // MARK: - LRU

    /// Keeps at most MAX_SESSIONS files in sessions/. Drops oldest by
    /// modification time. Cheap — directory has tens of files at most.
    private func enforceLRU() {
        guard let entries = try? FileManager.default.contentsOfDirectory(
            at: sessionsDir,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: .skipsHiddenFiles
        ) else { return }
        if entries.count <= Self.MAX_SESSIONS { return }

        let withDates: [(URL, Date)] = entries.compactMap { url in
            let mod = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
            return (url, mod ?? .distantPast)
        }
        let sorted = withDates.sorted { $0.1 < $1.1 } // oldest first
        let toDrop = sorted.prefix(entries.count - Self.MAX_SESSIONS)
        for (url, _) in toDrop {
            try? FileManager.default.removeItem(at: url)
        }
        if !toDrop.isEmpty {
            telemetry?.log("cache.lru.evicted", props: ["count": String(toDrop.count)])
        }
    }

    // MARK: - File path helpers

    private func sessionPath(_ id: String) -> URL {
        // Sanitize: allow only [A-Za-z0-9-_] in filename. Conversation ids
        // are UUIDs from us OR sessionIds from CLI (also UUID-shaped), so
        // this is defensive against future edge cases.
        let safe = id.unicodeScalars.map { c -> String in
            (c.isASCII && (CharacterSet.alphanumerics.contains(c) || c == "-" || c == "_"))
                ? String(c) : "_"
        }.joined()
        return sessionsDir.appendingPathComponent("\(safe).json")
    }

    // MARK: - Generic decode/encode helpers

    private func decodeOrDefault<T: Decodable>(at url: URL, default fallback: T) -> T {
        guard let data = try? Data(contentsOf: url) else { return fallback }
        do {
            return try jsonDecoder.decode(T.self, from: data)
        } catch {
            // Format mismatch (likely from app upgrade) — start fresh, the
            // server is the source of truth and bootstrap will re-populate.
            telemetry?.warn("cache.decode.failed", props: ["file": url.lastPathComponent, "error": error.localizedDescription])
            return fallback
        }
    }

    private func encodeAtomic<T: Encodable>(_ value: T, to url: URL) {
        do {
            let data = try jsonEncoder.encode(value)
            let tmp = url.appendingPathExtension("tmp")
            try data.write(to: tmp, options: .atomic)
            // Cross-platform "atomic rename": replace the original.
            _ = try? FileManager.default.replaceItemAt(url, withItemAt: tmp)
        } catch {
            telemetry?.error("cache.encode.failed", error: error, props: ["file": url.lastPathComponent])
        }
    }

    private let jsonEncoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = [.sortedKeys]
        return e
    }()

    private let jsonDecoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()
}

// MARK: - Cache file shapes

private struct ProjectsCache: Codable {
    let version: Int
    let projects: [ProjectDTO]
}

private struct ConversationsCache: Codable {
    let version: Int
    let conversations: [Conversation]
}

private struct SessionCache: Codable {
    let version: Int
    let messages: [ChatLine]
}
