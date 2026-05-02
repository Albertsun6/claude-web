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

        // 3. Restore missing sessionIds so drawer shows sids for all conversations
        Task { await autoRestoreSessionIds() }
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

    /// Forget a project: server-side removes it from projects.json (jsonl
    /// transcripts on disk are preserved). Also drops the in-memory
    /// conversations rooted at this cwd, their session caches, and clears
    /// focus if the active conversation was one of them — without this
    /// cleanup the drawer would leave the cwd visible as ·未注册.
    func forgetProject(_ id: String) async throws {
        let target = projects.first { $0.id == id }
        try await projectsAPI.forget(id: id)
        projects.removeAll { $0.id == id }
        cache.saveProjects(projects)
        historyByProject.removeValue(forKey: id)
        if let target {
            dropLocalConversations(forCwd: target.cwd)
        }
    }

    /// Single entry point the drawer uses to "close a cwd" — handles both
    /// registered (calls forgetProject) and unregistered orphans (just drops
    /// in-memory conversations). Reaches the same end state either way:
    /// the cwd disappears from the drawer.
    func closeCwd(_ cwd: String) async throws {
        let norm = (cwd as NSString).standardizingPath
        if let project = projects.first(where: { ($0.cwd as NSString).standardizingPath == norm }) {
            try await forgetProject(project.id)
        } else {
            dropLocalConversations(forCwd: cwd)
        }
    }

    /// Local-only cleanup. Called by both forgetProject (after the server
    /// hop) and closeCwd (for unregistered orphans where there is no server
    /// project to forget). Idempotent — safe to call when there are no
    /// conversations left under the cwd.
    private func dropLocalConversations(forCwd cwd: String) {
        guard let client else { return }
        let normCwd = (cwd as NSString).standardizingPath
        let toClose = client.conversations.values
            .filter { ($0.cwd as NSString).standardizingPath == normCwd }
            .map { $0.id }
        for convId in toClose {
            client.closeConversation(convId)
            cache.dropSession(convId)
        }
        if let curr = client.currentConversationId, toClose.contains(curr) {
            client.currentConversationId = client.sortedConversations().first?.id
        }
        cache.saveConversations(client.conversationsList())
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
    /// Then automatically subscribes to live jsonl tail so any updates
    /// driven by another Claude Code client mirror in real time.
    func openHistoricalSession(_ session: SessionMeta, in project: ProjectDTO) async throws -> String {
        guard let client else { throw RegistryError.notBound }
        // Dedup against existing conversations — if already adopted, just
        // re-subscribe (no-op if already subscribed) so reopening a previously
        // unsubscribed conversation reconnects the follow.
        if let existing = client.conversations.values.first(where: { $0.sessionId == session.sessionId }) {
            // Re-fetch transcript to refresh fileSize, then subscribe from the
            // new offset. Skipped if already following.
            if !client.isFollowing(existing.id) {
                if let resp = try? await sessionsAPI.transcript(cwd: project.cwd, sessionId: session.sessionId) {
                    client.subscribeSession(
                        convId: existing.id, cwd: project.cwd,
                        sessionId: session.sessionId,
                        fromByteOffset: resp.fileSize ?? 0
                    )
                }
            }
            return existing.id
        }
        let resp = try await sessionsAPI.transcript(cwd: project.cwd, sessionId: session.sessionId)
        let lines = TranscriptParser.parse(resp.messages)
        // Use sessionId as the conversation id for historical loads — stable
        // across app restarts, and dedup just works.
        // Title preference: backend's first-prompt preview (works for both
        // iOS-driven and Claude Code Desktop-driven sessions) → makeTitle
        // truncates / cleans. Fallback to date-based "MMdd-N" if jsonl had
        // no readable user message (rare).
        let existingTitles = Array(client.conversations.values.map { $0.title })
        let previewBased = TitleHelper.makeTitle(from: session.preview)
        let derivedTitle = previewBased.isEmpty
            ? ConversationNamer.title(for: session.modifiedAt, existingTitles: existingTitles)
            : previewBased
        let conv = Conversation(
            id: session.sessionId,
            cwd: project.cwd,
            sessionId: session.sessionId,
            title: derivedTitle,
            createdAt: session.modifiedAt,
            lastUsed: session.modifiedAt
        )
        client.adopt(conv, messages: lines)
        cache.saveSession(conv.id, messages: lines)
        cache.saveConversations(client.conversationsList())
        // Auto-subscribe so any new lines appended by another Claude Code
        // client tailing the same jsonl mirror in here in real time.
        client.subscribeSession(
            convId: conv.id, cwd: project.cwd,
            sessionId: session.sessionId,
            fromByteOffset: resp.fileSize ?? 0
        )
        return conv.id
    }

    // MARK: - Session restoration (drawer sid display)

    /// Auto-restore sessionIds for conversations that lack one. Runs
    /// in background so it doesn't block UI. Two cases:
    ///
    /// A) Project has no live conversations (cache was cleared) → adopt the
    ///    most recent historical session so it appears in the drawer with a sid.
    ///
    /// B) Project has conversations but sessionId == nil (cache exists, but
    ///    conversation was created but never sent a prompt) → bind the most
    ///    recent sessionId to the conversation without reloading transcript.
    private func autoRestoreSessionIds() async {
        guard let client else { return }
        for project in projects {
            let norm = (project.cwd as NSString).standardizingPath
            let convs = client.sortedConversations().filter {
                ($0.cwd as NSString).standardizingPath == norm
            }
            guard let sessions = try? await sessionsAPI.list(cwd: project.cwd),
                  let latest = sessions.first else { continue }
            if convs.isEmpty {
                // Case A: No live conversation — adopt the latest session
                _ = try? await openHistoricalSession(latest, in: project)
            } else {
                // Case B: Live conversations without sessionId — bind the latest
                for conv in convs where conv.sessionId == nil {
                    client.bindSessionId(latest.sessionId, toConversation: conv.id)
                }
            }
        }
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
