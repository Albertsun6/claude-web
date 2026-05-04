// Thin HTTP client for /api/harness/* CRUD endpoints.
// Mirrors harness-queries.ts shapes. M1 scope: Initiative / Issue / Stage / Decision.

import Foundation

// MARK: - DTOs

struct HarnessInitiative: Codable, Identifiable, Equatable {
    let id: String
    let project_id: String
    let title: String
    let intent: String
    let status: String        // draft | active | paused | done
    let owner_human: String
    let created_at: Int64
    let updated_at: Int64
}

struct HarnessIssue: Codable, Identifiable, Equatable {
    let id: String
    let project_id: String
    let initiative_id: String?
    let title: String
    let body: String
    let priority: String      // low | normal | high
    let status: String        // triaged | in_progress | awaiting_review | approved | rejected | done | cancelled
    let created_at: Int64
    let updated_at: Int64
}

struct HarnessStage: Codable, Identifiable, Equatable {
    let id: String
    let issue_id: String
    let kind: String          // strategy | discovery | spec | … | observe
    let status: String        // pending | running | awaiting_review | approved | rejected | skipped | failed
    let weight: String        // heavy | light | checklist
    let assigned_agent_profile: String
    let started_at: Int64?
    let ended_at: Int64?
    let created_at: Int64
}

struct HarnessDecision: Codable, Identifiable, Equatable {
    let id: String
    let stage_id: String
    let requested_by: String
    let options_json: String
    let chosen_option: String?
    let decided_by: String?
    let rationale: String?
    let decided_at: Int64?
    let created_at: Int64

    var options: [String] {
        (try? JSONDecoder().decode([String].self, from: Data(options_json.utf8))) ?? []
    }
}

// MARK: - API Client

@Observable
final class HarnessAPI {
    private let baseURL: () -> URL
    private let authToken: () -> String

    init(baseURL: @escaping () -> URL, authToken: @escaping () -> String) {
        self.baseURL = baseURL
        self.authToken = authToken
    }

    // MARK: Project resolution

    /// If we only have a cwd path (not a UUID), fetch /api/projects and find the matching id.
    func resolveProjectId(cwd: String) async throws -> String {
        struct ProjectsResponse: Codable {
            struct Project: Codable { let id: String; let cwd: String }
            let projects: [Project]
        }
        let resp = try await get("api/projects", ProjectsResponse.self)
        return resp.projects.first(where: { $0.cwd == cwd })?.id ?? cwd
    }

    // MARK: Initiatives

    func listInitiatives(projectId: String) async throws -> [HarnessInitiative] {
        struct R: Codable { let ok: Bool; let data: [HarnessInitiative]? }
        return try await get("api/harness/initiatives?projectId=\(encode(projectId))", R.self).data ?? []
    }

    func createInitiative(projectId: String, cwd: String, title: String, intent: String = "") async throws -> HarnessInitiative {
        struct Body: Encodable { let projectId, cwd, title, intent: String }
        struct R: Codable { let ok: Bool; let data: HarnessInitiative? }
        return try await post("api/harness/initiatives",
                              body: Body(projectId: projectId, cwd: cwd, title: title, intent: intent),
                              R.self).data!
    }

    // MARK: Issues

    func listIssues(projectId: String, initiativeId: String? = nil) async throws -> [HarnessIssue] {
        var q = "projectId=\(encode(projectId))"
        if let iid = initiativeId { q += "&initiativeId=\(encode(iid))" }
        struct R: Codable { let ok: Bool; let data: [HarnessIssue]? }
        return try await get("api/harness/issues?\(q)", R.self).data ?? []
    }

    func createIssue(projectId: String, initiativeId: String?, title: String, body: String = "") async throws -> HarnessIssue {
        struct Body: Encodable { let projectId: String; let initiativeId: String?; let title: String; let body: String }
        struct R: Codable { let ok: Bool; let data: HarnessIssue? }
        return try await post("api/harness/issues",
                              body: Body(projectId: projectId, initiativeId: initiativeId, title: title, body: body),
                              R.self).data!
    }

    // MARK: Stages

    func listStages(issueId: String) async throws -> [HarnessStage] {
        struct R: Codable { let ok: Bool; let data: [HarnessStage]? }
        return try await get("api/harness/stages?issueId=\(encode(issueId))", R.self).data ?? []
    }

    func createStage(issueId: String, kind: String) async throws -> HarnessStage {
        struct Body: Encodable { let issueId: String; let kind: String }
        struct R: Codable { let ok: Bool; let data: HarnessStage? }
        return try await post("api/harness/stages",
                              body: Body(issueId: issueId, kind: kind),
                              R.self).data!
    }

    func setStageStatus(stageId: String, status: String) async throws {
        struct Body: Encodable { let status: String }
        struct R: Codable { let ok: Bool }
        _ = try await put("api/harness/stages/\(stageId)/status",
                          body: Body(status: status), R.self)
    }

    // MARK: Decisions

    func listDecisions(stageId: String) async throws -> [HarnessDecision] {
        struct R: Codable { let ok: Bool; let data: [HarnessDecision]? }
        return try await get("api/harness/decisions?stageId=\(encode(stageId))", R.self).data ?? []
    }

    func resolveDecision(decisionId: String, chosenOption: String) async throws {
        struct Body: Encodable { let chosenOption: String; let decidedBy: String }
        struct R: Codable { let ok: Bool }
        _ = try await put("api/harness/decisions/\(decisionId)",
                          body: Body(chosenOption: chosenOption, decidedBy: "user"), R.self)
    }

    // MARK: Helpers

    private func encode(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s
    }

    private func request(method: String, path: String) -> URLRequest {
        // Use string concatenation so query params don't get percent-encoded
        // by appendingPathComponent (which encodes "?" and "=").
        let base = baseURL().absoluteString.hasSuffix("/")
            ? baseURL().absoluteString
            : baseURL().absoluteString + "/"
        let url = URL(string: base + path)!
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 8
        let tok = authToken()
        if !tok.isEmpty { req.setValue("Bearer \(tok)", forHTTPHeaderField: "Authorization") }
        return req
    }

    private func get<R: Decodable>(_ path: String, _ type: R.Type) async throws -> R {
        let (data, _) = try await URLSession.shared.data(for: request(method: "GET", path: path))
        return try JSONDecoder().decode(type, from: data)
    }

    private func post<B: Encodable, R: Decodable>(_ path: String, body: B, _ type: R.Type) async throws -> R {
        var req = request(method: "POST", path: path)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(body)
        let (data, _) = try await URLSession.shared.data(for: req)
        return try JSONDecoder().decode(type, from: data)
    }

    private func put<B: Encodable, R: Decodable>(_ path: String, body: B, _ type: R.Type) async throws -> R {
        var req = request(method: "PUT", path: path)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(body)
        let (data, _) = try await URLSession.shared.data(for: req)
        return try JSONDecoder().decode(type, from: data)
    }
}
