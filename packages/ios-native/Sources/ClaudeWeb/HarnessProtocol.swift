// HarnessProtocol.swift — Mirrors packages/shared/src/harness-protocol.ts
//
// 同源：
// - TS Zod: packages/shared/src/harness-protocol.ts
// - JSON fixtures: packages/shared/fixtures/harness/*.json
// - Doc: docs/HARNESS_PROTOCOL.md
// - DDL: docs/HARNESS_DATA_MODEL.md §1
//
// Round 1 + Round 2 评审反馈已吸收（HARNESS_REVIEW_LOG.md）。
//
// 跨端 round-trip 不变量：每个 Codable struct decode + 重 encode 后与原 JSON deep-equal。
// M-1 范围内 Swift round-trip 由人工抽样验证；M1+ 引入自动化 CI 与 TS 端 fixture 互相 round-trip。

import Foundation

// MARK: - Version constants

enum HarnessProtocolVersion {
    static let current = "1.0"
    static let minClient = "1.0"
}

/// The harness protocol version this iOS client supports.
/// Compared against server's `minClientVersion` (NOT app marketing version
/// CFBundleShortVersionString — those are independent semantics).
/// Bump when iOS adds support for a new harness protocol major version.
let HARNESS_PROTOCOL_CLIENT_VERSION = "1.0"

// MARK: - Enums (must match TS string literals exactly)

enum StageKind: String, Codable, CaseIterable {
    case strategy, discovery, spec, compliance, design, implement, test, review, release, observe
}

enum StageStatus: String, Codable {
    case pending, running
    case awaitingReview = "awaiting_review"
    case approved, rejected, skipped, failed
}

enum StageWeight: String, Codable {
    case heavy, light, checklist
}

enum TaskStatus: String, Codable {
    case pending, running, completed, failed, cancelled
}

enum TaskModel: String, Codable {
    case opus, sonnet, haiku
}

enum InitiativeStatus: String, Codable {
    case draft, active, paused, done
}

enum IssuePriority: String, Codable {
    case low, normal, high, critical
}

enum IssueStatus: String, Codable {
    case inbox, triaged, planned
    case inProgress = "in_progress"
    case blocked, done
    case wontFix = "wont_fix"
}

enum IssueSource: String, Codable {
    case ideasMd = "ideas_md"
    case userFeedback = "user_feedback"
    case gitLog = "git_log"
    case telemetry, inbox, manual
}

enum IdeaCaptureSource: String, Codable {
    case voice, text, web
}

enum MethodologyAppliesTo: String, Codable {
    case claudeWeb = "claude-web"
    case enterpriseAdmin = "enterprise-admin"
    case universal
}

enum ArtifactKind: String, Codable {
    case methodology, spec
    case designDoc = "design_doc"
    case architectureDoc = "architecture_doc"
    case adr, patch
    case prUrl = "pr_url"
    case testReport = "test_report"
    case coverageReport = "coverage_report"
    case reviewNotes = "review_notes"
    case reviewVerdict = "review_verdict"
    case decisionNote = "decision_note"
    case metricSnapshot = "metric_snapshot"
    case retrospective
    case changelogEntry = "changelog_entry"
}

enum ArtifactStorage: String, Codable {
    case inline, file
}

enum AuditOp: String, Codable {
    case insert, update, delete, migrate
}

// MARK: - 13 entity DTOs

struct ProjectDto: Codable {
    let id: String
    let cwd: String
    let name: String
    let defaultBranch: String
    let worktreeRoot: String
    let harnessEnabled: Bool
    let createdAt: Int64
}

struct Kpi: Codable {
    let name: String
    let target: String
    let selected: Bool
}

struct InitiativeDto: Codable {
    let id: String
    let projectId: String
    let title: String
    let intent: String
    let kpis: [Kpi]
    let status: InitiativeStatus
    let ownerHuman: String
    let methodologyVersion: String
    let createdAt: Int64
    let updatedAt: Int64
}

struct IssueDto: Codable {
    let id: String
    let projectId: String
    let initiativeId: String?
    let source: IssueSource
    let title: String
    let body: String
    let labels: [String]
    let priority: IssuePriority
    let status: IssueStatus
    let retrospectiveId: String?
    let createdAt: Int64
    let updatedAt: Int64
}

struct IdeaCaptureDto: Codable {
    let id: String
    let projectId: String?
    let body: String
    let audioPath: String?
    let transcript: String?
    let source: IdeaCaptureSource
    let capturedAt: Int64
    let processedIntoIssueId: String?
}

struct StageDto: Codable {
    let id: String
    let issueId: String
    let kind: StageKind
    let status: StageStatus
    let weight: StageWeight
    let gateRequired: Bool
    let assignedAgentProfile: String
    let methodologyId: String
    /// Provisional persistence-only — Round 2 cross M2 注：M2 dogfood 决定后可能升级为
    /// stage_artifact join table + stageArtifactRefs wire DTO，wire-format v2.0 之后不承诺向后兼容。
    let inputArtifactIds: [String]
    let outputArtifactIds: [String]
    let reviewVerdictIds: [String]
    let startedAt: Int64?
    let endedAt: Int64?
    let createdAt: Int64
}

struct MethodologyDto: Codable {
    let id: String
    let stageKind: StageKind
    let version: String
    let appliesTo: MethodologyAppliesTo
    let contentRef: String
    let approvedBy: String
    let approvedAt: Int64
}

struct TaskDto: Codable {
    let id: String
    let stageId: String
    let agentProfileId: String
    let model: TaskModel
    let cwd: String
    let worktreePath: String?
    let prompt: String
    let skillSet: [String]
    let permissionMode: String
    let contextBundleId: String
    let runIds: [String]
    let status: TaskStatus
    let createdAt: Int64
    let updatedAt: Int64
}

struct ContextBundleDto: Codable {
    let id: String
    let taskId: String
    let artifactRefs: [String]
    let maxTokens: Int
    let prunedFiles: [String]
    let summary: String
    let snapshotPath: String
    let createdAt: Int64
}

struct RunDto: Codable {
    let id: String
    let taskId: String
    let sessionId: String?
    let exitCode: Int?
    let model: String
    let tokensIn: Int?
    let tokensOut: Int?
    let cost: Double?
    let transcriptPath: String
    let startedAt: Int64
    let endedAt: Int64?
}

struct ArtifactDto: Codable {
    let id: String
    let stageId: String
    let kind: ArtifactKind
    let ref: String?
    let hash: String
    let storage: ArtifactStorage
    let contentText: String?
    let contentPath: String?
    let sizeBytes: Int
    /// Round 1 arch 垂直#8 + Round 2 cross M3：metadata 在 wire 上是任意 JSON 对象。
    /// Swift 端用 [String: AnyCodable] 表达；DB 端 CHECK json_valid 已强制合法 JSON。
    let metadata: [String: AnyCodable]
    let supersededBy: String?
    let createdAt: Int64
}

struct ReviewVerdictDto: Codable {
    let id: String
    let stageId: String
    let reviewerProfileId: String
    let model: String
    let score: Double
    let dimensions: [String: Double]
    let notes: String
    let agreesWithPrior: Bool?
    let createdAt: Int64
}

struct DecisionOption: Codable {
    let label: String
    let value: String
}

struct DecisionDto: Codable {
    let id: String
    let stageId: String
    let requestedBy: String
    let options: [DecisionOption]
    let chosenOption: String?
    let decidedBy: String?
    let rationale: String?
    let decidedAt: Int64?
    let createdAt: Int64
}

struct CostSummary: Codable {
    let totalUsd: Double
    let byStage: [String: Double]
    let byModel: [String: Double]
}

struct RetrospectiveDto: Codable {
    let id: String
    let issueId: String
    let whatWentWell: String
    let whatToImprove: String
    let methodologyFeedback: String
    let costSummary: CostSummary
    let createdBy: String
    let createdAt: Int64
}

// MARK: - Audit Log
//
// Round 1 arch M1：before / after 字段是 **explicit-null nullable**，
// 即使为 nil 也必须在 wire 上发 `null` 而不是省略，与 TS Zod `.nullable()` 对齐。
// rationale 是 **optional**（省略字段，与 TS .optional() 对齐）。

struct AuditLogEntry: Codable {
    let ts: Int64
    let actor: String
    let op: AuditOp
    let table: String
    let id: String
    /// 显式 nullable：`null` 表示"无前态"（如 insert）；不允许 wire 上省略
    let before: [String: AnyCodable]?
    /// 显式 nullable：`null` 表示"被删除"（如 delete）
    let after: [String: AnyCodable]?
    /// 真 optional：rationale 不存在时 wire 上完全省略
    let rationale: String?

    enum CodingKeys: String, CodingKey {
        case ts, actor, op, table, id, before, after, rationale
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ts = try c.decode(Int64.self, forKey: .ts)
        actor = try c.decode(String.self, forKey: .actor)
        op = try c.decode(AuditOp.self, forKey: .op)
        table = try c.decode(String.self, forKey: .table)
        id = try c.decode(String.self, forKey: .id)
        // decodeIfPresent 会把"省略"和"null"都映射成 nil；M-1 范围内不区分
        before = try c.decodeIfPresent([String: AnyCodable].self, forKey: .before)
        after = try c.decodeIfPresent([String: AnyCodable].self, forKey: .after)
        rationale = try c.decodeIfPresent(String.self, forKey: .rationale)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(ts, forKey: .ts)
        try c.encode(actor, forKey: .actor)
        try c.encode(op, forKey: .op)
        try c.encode(table, forKey: .table)
        try c.encode(id, forKey: .id)
        // 显式 null：nil 时 encode null（不要用 encodeIfPresent，那会丢字段）
        if let b = before { try c.encode(b, forKey: .before) } else { try c.encodeNil(forKey: .before) }
        if let a = after  { try c.encode(a, forKey: .after)  } else { try c.encodeNil(forKey: .after)  }
        // rationale 是真 optional：nil 时省略
        if let r = rationale { try c.encode(r, forKey: .rationale) }
    }
}

// MARK: - Harness Event (WS)

enum HarnessEvent: Codable {
    case stageChanged(stageId: String, status: StageStatus)   // Round 1 cross M2: enum lock
    case taskStarted(taskId: String)
    case taskCompleted(taskId: String, success: Bool)
    case decisionRequested(decisionId: String)
    case runAppended(runId: String, lineCount: Int)
    case reviewComplete(verdictId: String)
    case configChanged(protocolVersion: String)
    /// Round 1 arch M3: 未知 kind 不抛错 → 转 minor bump 不再被迫 major bump。
    /// UI 层应当 ignore unknown 并提示用户升级（log warn），不阻塞 WS 流。
    case unknown(kind: String, raw: [String: AnyCodable])

    enum CodingKeys: String, CodingKey {
        case type, kind, stageId, status, taskId, success, decisionId, runId, lineCount, verdictId, protocolVersion
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(String.self, forKey: .type)
        guard type == "harness_event" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "expected type=harness_event")
        }
        let kind = try c.decode(String.self, forKey: .kind)
        switch kind {
        case "stage_changed":
            self = .stageChanged(
                stageId: try c.decode(String.self, forKey: .stageId),
                status: try c.decode(StageStatus.self, forKey: .status),
            )
        case "task_started":
            self = .taskStarted(taskId: try c.decode(String.self, forKey: .taskId))
        case "task_completed":
            self = .taskCompleted(taskId: try c.decode(String.self, forKey: .taskId), success: try c.decode(Bool.self, forKey: .success))
        case "decision_requested":
            self = .decisionRequested(decisionId: try c.decode(String.self, forKey: .decisionId))
        case "run_appended":
            self = .runAppended(runId: try c.decode(String.self, forKey: .runId), lineCount: try c.decode(Int.self, forKey: .lineCount))
        case "review_complete":
            self = .reviewComplete(verdictId: try c.decode(String.self, forKey: .verdictId))
        case "config_changed":
            self = .configChanged(protocolVersion: try c.decode(String.self, forKey: .protocolVersion))
        default:
            // Forward-compat: 拿到 raw payload 给 UI 决定 ignore / 显示升级提示
            let raw = try [String: AnyCodable](from: decoder)
            self = .unknown(kind: kind, raw: raw)
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode("harness_event", forKey: .type)
        switch self {
        case .stageChanged(let stageId, let status):
            try c.encode("stage_changed", forKey: .kind)
            try c.encode(stageId, forKey: .stageId)
            try c.encode(status, forKey: .status)
        case .taskStarted(let taskId):
            try c.encode("task_started", forKey: .kind)
            try c.encode(taskId, forKey: .taskId)
        case .taskCompleted(let taskId, let success):
            try c.encode("task_completed", forKey: .kind)
            try c.encode(taskId, forKey: .taskId)
            try c.encode(success, forKey: .success)
        case .decisionRequested(let decisionId):
            try c.encode("decision_requested", forKey: .kind)
            try c.encode(decisionId, forKey: .decisionId)
        case .runAppended(let runId, let lineCount):
            try c.encode("run_appended", forKey: .kind)
            try c.encode(runId, forKey: .runId)
            try c.encode(lineCount, forKey: .lineCount)
        case .reviewComplete(let verdictId):
            try c.encode("review_complete", forKey: .kind)
            try c.encode(verdictId, forKey: .verdictId)
        case .configChanged(let protocolVersion):
            try c.encode("config_changed", forKey: .kind)
            try c.encode(protocolVersion, forKey: .protocolVersion)
        case .unknown(_, let raw):
            // round-trip：编码时直接展开 raw 到容器，保留所有字段
            try raw.encode(to: encoder)
        }
    }
}

// MARK: - M0 modelList Round (RFC §1)

struct ModelCapabilities: Codable, Equatable {
    let supportsThinking: Bool
    let supportsLongContext: Bool
    let contextWindow: Int
}

struct ModelListItem: Codable, Equatable {
    let id: String
    let displayName: String
    let description: String?
    let capabilities: ModelCapabilities
    let recommendedFor: [String]
    let isDefault: Bool
    let enabled: Bool
}

// permissionModes Round (M0 mini-milestone B, protocolVersion 1.1)
//
// 三端同步：与 PermissionMode (Protocol.swift) + ClientMessage.permissionMode + cli-runner permission-hook 一致
struct PermissionModeItem: Codable, Equatable {
    let id: String                       // "default" | "acceptEdits" | "bypassPermissions" | "plan"
    let displayName: String              // 短名 (per ADR-0011 displayName 治理总则)
    let description: String?
    let isDefault: Bool
    let riskLevel: String?               // hint-only string，推荐 "low"/"medium"/"high"; 未知值默认色 + telemetry warn
}

// agentProfiles Round (M0 mini-milestone C, protocolVersion 1.2)
// 同 PermissionModeItem 设计：短 displayName + hint-only string 字段。
// id / stage / modelHint 均为 opaque string（不锁 enum）—— minor bump 友好。
struct AgentProfileItem: Codable, Equatable {
    let id: String                       // opaque stable string，对应 Task.agentProfileId
    let displayName: String              // 短名 (per ADR-0011 displayName 治理总则)
    let description: String              // 一行职责
    let stage: String                    // hint-only "discovery"/"implement"/etc
    let modelHint: String                // hint-only "opus"/"sonnet"/"haiku"/"adaptive"
    let enabled: Bool                    // M0=11 false + PM=true
}

struct HarnessConfig: Codable, Equatable {
    let protocolVersion: String
    let minClientVersion: String
    let etag: String
    let modelList: [ModelListItem]
    // permissionModes Round (M0 mini-milestone B, protocolVersion 1.1):
    // **Optional 不是 required** (phase 3 BLOCKER 修复) — 双向 minor bump 兼容：
    // v1.1 build 32 + v1.0 server payload 时 nil → store 层 ?? bundleFallback().permissionModes!
    // ADR-0015 footnote 已记录 server-driven 字段必须 optional 的硬约束
    //
    // **警告**：不要给 HarnessConfig 加自定义 init(from:) + container.allKeys 校验——会反向破坏
    // Apple Swift Decodable 默认的 ignore unknown keys 行为，导致老 build 31 收到新字段时 decode 失败
    let permissionModes: [PermissionModeItem]?
    // agentProfiles Round (M0 mini-milestone C, protocolVersion 1.2)：
    // 同 permissionModes 的双向 minor bump 兼容硬约束 — Swift 端 optional，
    // store 层 ?? bundleFallback().agentProfiles! 兜底。
    let agentProfiles: [AgentProfileItem]?
}

// MARK: - Version comparator (RFC §2.3, mirrors packages/shared/src/version.ts)

/// Numeric semver-ish comparison. Defeats string lex (1.10 vs 1.9).
/// Returns -1 if a < b, 0 if equal, 1 if a > b. Missing parts treated as 0.
func compareVersion(_ a: String, _ b: String) -> Int {
    let pa = a.split(separator: ".").map { Int($0) ?? 0 }
    let pb = b.split(separator: ".").map { Int($0) ?? 0 }
    let len = max(pa.count, pb.count)
    for i in 0..<len {
        let x = i < pa.count ? pa[i] : 0
        let y = i < pb.count ? pb[i] : 0
        if x < y { return -1 }
        if x > y { return 1 }
    }
    return 0
}

// MARK: - AnyCodable helper (for metadata / before / after JSON-shaped fields)

/// Wraps an arbitrary Codable value. Used for fields like Artifact.metadata where
/// schema is not typed at M-1 (Round 2 cross M3 + arch 垂直#8 — typed schema
/// 留给 M2 dogfood toy 企业仓库后再敲).
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) { self.value = value }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() {
            self.value = NSNull()
        } else if let v = try? c.decode(Bool.self) {
            self.value = v
        } else if let v = try? c.decode(Int64.self) {
            self.value = v
        } else if let v = try? c.decode(Double.self) {
            self.value = v
        } else if let v = try? c.decode(String.self) {
            self.value = v
        } else if let v = try? c.decode([AnyCodable].self) {
            self.value = v.map { $0.value }
        } else if let v = try? c.decode([String: AnyCodable].self) {
            self.value = v.mapValues { $0.value }
        } else {
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "AnyCodable: unsupported type")
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch value {
        case is NSNull: try c.encodeNil()
        case let v as Bool: try c.encode(v)
        case let v as Int: try c.encode(v)
        case let v as Int64: try c.encode(v)
        case let v as Double: try c.encode(v)
        case let v as String: try c.encode(v)
        case let v as [Any]: try c.encode(v.map { AnyCodable($0) })
        case let v as [String: Any]: try c.encode(v.mapValues { AnyCodable($0) })
        default:
            throw EncodingError.invalidValue(value, .init(codingPath: [], debugDescription: "AnyCodable: unsupported type"))
        }
    }
}
