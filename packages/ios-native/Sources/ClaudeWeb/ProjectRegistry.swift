// Coordinator between server projects (~/.claude-web/projects.json), iOS
// in-memory Conversation state (BackendClient.conversations), and the
// on-disk Cache. Exists so UI doesn't have to chain three async layers
// every time it needs "what's my list of projects + their conversations".
//
// Source-of-truth split:
//   - Server projects.json     → which cwds are "registered" (cross-device)
//   - BackendClient            → live conversation state (this device, this session)
//   - Cache                    → offline / crash-survival snapshot of both
//   - Settings.openProjectIds  → which projects are visible on THIS device
//
// Bootstrap sequence on app launch:
//   1. Load cache → UI shows last-known state instantly
//   2. Connect WS (BackendClient.connect)
//   3. Fetch GET /api/projects → reconcile → save cache
//   4. Restore conversation focus from settings.currentConversationId

import Foundation
import Observation

@MainActor
@Observable
final class ProjectRegistry {
    /// Server-registered projects. Mirror of /api/projects. Updated on
    /// bootstrap, openByPath, rename, forget. Cached to disk for offline.
    var projects: [ProjectDTO] = []

    /// Loaded historical session metadata per project (from /api/sessions/list).
    /// Refreshed on demand when the user opens a project's conversation list.
    var historyByProject: [String: [SessionMeta]] = [:]

    enum SyncState: Equatable {
        case idle           // never tried
        case loading
        case synced(Date)   // last successful fetch
        case offline        // server unreachable; using cache
    }
    var syncState: SyncState = .idle

    private let cache: Cache
    private let projectsAPI: ProjectsAPI
    private let sessionsAPI: SessionsAPI
    private weak var client: BackendClient?
    private weak var telemetry: Telemetry?

    init(cache: Cache, projectsAPI: ProjectsAPI, sessionsAPI: SessionsAPI) {
        self.cache = cache
        self.projectsAPI = projectsAPI
        self.sessionsAPI = sessionsAPI
    }

    func bind(client: BackendClient) {
        self.client = client
    }

    func bindTelemetry(_ tel: Telemetry) {
        self.telemetry = tel
    }

    // MARK: - Bootstrap

    /// Load cache (synchronous) so UI has SOMETHING immediately, then fire
    /// async fetch to reconcile with server. Caller awaits if it cares about
    /// the fetched data; UI binding is reactive either way.
    func bootstrap() async {
        // 1. Load cache snapshot — instant, even when offline
        projects = cache.loadProjects()
        let cachedConversations = cache.loadConversations()
        if let client {
            for conv in cachedConversations {
                client.adopt(conv, messages: cache.loadSession(conv.id))
            }
        }

        // 2. Server reconcile
        await refresh()
    }

    /// Pull fresh project list from server. On failure, mark offline and
    /// keep using cache.
    func refresh() async {
        syncState = .loading
        do {
            let fresh = try await projectsAPI.list()
            projects = fresh
            cache.saveProjects(fresh)
            syncState = .synced(Date())
            telemetry?.log("registry.refresh.ok", props: ["count": String(fresh.count)])
        } catch {
            syncState = .offline
            telemetry?.warn("registry.refresh.offline", props: ["error": error.localizedDescription])
        }
    }

    // MARK: - Project ops

    /// Register a cwd as a project (idempotent). Used by "打开文件夹" flow.
    @discardableResult
    func openByPath(cwd: String, name: String = "") async throws -> ProjectDTO {
        do {
            let p = try await projectsAPI.create(name: name, cwd: cwd)
            if !projects.contains(where: { $0.id == p.id }) {
                projects.append(p)
            } else if let idx = projects.firstIndex(where: { $0.id == p.id }) {
                projects[idx] = p
            }
            cache.saveProjects(projects)
            telemetry?.log("project.open", props: ["id": p.id])
            return p
        } catch {
            telemetry?.error("project.open.failed", error: error, props: ["cwd": cwd])
            throw error
        }
    }

    /// Forget a project (server-side: remove from projects.json; jsonl on
    /// disk preserved). UI should also drop in-memory conversations under
    /// this cwd.
    func forgetProject(_ id: String) async throws {
        try await projectsAPI.forget(id: id)
        projects.removeAll { $0.id == id }
        cache.saveProjects(projects)
        historyByProject.removeValue(forKey: id)
    }

    func renameProject(_ id: String, to name: String) async throws -> ProjectDTO {
        let updated = try await projectsAPI.rename(id: id, to: name)
        if let idx = projects.firstIndex(where: { $0.id == id }) {
            projects[idx] = updated
        }
        cache.saveProjects(projects)
        return updated
    }

    /// Returns projects whose cwd no longer exists on disk. UI prompts user
    /// for confirmation before calling forgetProject() on each.
    func cleanup() async throws -> [ProjectDTO] {
        try await projectsAPI.cleanup()
    }

    // MARK: - History sessions

    /// Load (or refresh) the historical session list for a project. The
    /// returned items are jsonl files under ~/.claude/projects/<encoded>/,
    /// each one a candidate "conversation to resume".
    @discardableResult
    func loadHistorySessions(forProject project: ProjectDTO) async throws -> [SessionMeta] {
        let sessions = try await sessionsAPI.list(cwd: project.cwd)
        historyByProject[project.id] = sessions
        return sessions
    }

    /// Pull a historical session's full transcript and adopt it as a
    /// conversation in BackendClient. dedup: if a conversation with this
    /// sessionId already exists, return its id instead of creating a copy.
    func openHistoricalSession(_ session: SessionMeta, in project: ProjectDTO) async throws -> String {
        guard let client else { throw RegistryError.notBound }
        // Dedup against existing conversations
        if let existing = client.conversations.values.first(where: { $0.sessionId == session.sessionId }) {
            return existing.id
        }
        let resp = try await sessionsAPI.transcript(cwd: project.cwd, sessionId: session.sessionId)
        let lines = TranscriptParser.parse(resp.messages)
        // Use sessionId as the conversation id for historical loads — stable
        // across app restarts, and dedup just works.
        let conv = Conversation(
            id: session.sessionId,
            cwd: project.cwd,
            sessionId: session.sessionId,
            title: session.preview.isEmpty
                ? "（历史会话）"
                : String(session.preview.prefix(30)),
            createdAt: session.modifiedAt,
            lastUsed: session.modifiedAt
        )
        client.adopt(conv, messages: lines)
        cache.saveSession(conv.id, messages: lines)
        cache.saveConversations(client.conversationsList())
        return conv.id
    }

    // MARK: - Conversation queries (cross-reference via cwd)

    func project(forCwd cwd: String) -> ProjectDTO? {
        let norm = (cwd as NSString).standardizingPath
        return projects.first { (($0.cwd as NSString).standardizingPath) == norm }
    }
}

enum RegistryError: LocalizedError {
    case notBound
    var errorDescription: String? {
        switch self {
        case .notBound: return "ProjectRegistry 未绑定 BackendClient"
        }
    }
}
