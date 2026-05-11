// VesselDiscovery — verify that a candidate URL (Bonjour-discovered or
// manually entered) is actually a vessel-core via the no-auth /api/vessel/health
// probe.
//
// Used by:
//   - settings UI: when user picks a discovered service, ping /health to
//     confirm "yes, this is Vessel"
//   - first-launch flow: try every discovered service, pick the first that
//     answers /health
//   - manual IP entry: verify before saving as backendURL
//
// Backend contract (M2-iOS-α):
//   GET /api/vessel/health → 200 JSON {service: "vessel", version, hostname,
//     uptimeSec, bonjour, soul, sessions, runs}
//   No auth header required (LAN discovery probe).

import Foundation

/// Result of a /health probe — present only when the response confirms vessel.
struct VesselHealth: Codable, Equatable {
    let service: String
    let version: String
    let hostname: String
    let uptimeSec: Int
    let bonjour: BonjourInfo?
    let soul: SoulInfo?

    struct BonjourInfo: Codable, Equatable {
        let published: Bool
        let instanceName: String?
        let port: Int?
        let type: String?
    }

    struct SoulInfo: Codable, Equatable {
        let present: Bool
        let name: String?
        let error: String?
    }

    /// Display name preferred order: soul.name → bonjour.instanceName → hostname.
    var displayName: String {
        if let s = soul, s.present, let n = s.name, !n.isEmpty { return n }
        if let b = bonjour, b.published, let n = b.instanceName, !n.isEmpty { return n }
        return hostname
    }
}

enum VesselDiscoveryError: Error, LocalizedError {
    case timeout
    case notVessel(status: Int)
    case malformed(String)
    case network(String)

    var errorDescription: String? {
        switch self {
        case .timeout: return "未连接（超时）"
        case .notVessel(let s): return "返回 HTTP \(s)，非 vessel-core"
        case .malformed(let m): return "响应格式异常：\(m)"
        case .network(let m): return "网络错误：\(m)"
        }
    }
}

enum VesselDiscovery {
    /// Probe `<url>/api/vessel/health` and return parsed VesselHealth, or
    /// throw with a UI-friendly error.
    ///
    /// Caller should pass the base URL (scheme + host + port), e.g.
    /// `URL(string: "http://Yongqians-Mac.local:3030")`.
    static func probe(_ baseURL: URL, timeout: TimeInterval = 2.0) async throws -> VesselHealth {
        let url = baseURL.appendingPathComponent("api/vessel/health")

        var req = URLRequest(url: url)
        req.timeoutInterval = timeout
        req.httpMethod = "GET"

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch let err as URLError where err.code == .timedOut {
            throw VesselDiscoveryError.timeout
        } catch {
            throw VesselDiscoveryError.network(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw VesselDiscoveryError.malformed("non-HTTP response")
        }
        guard http.statusCode == 200 else {
            throw VesselDiscoveryError.notVessel(status: http.statusCode)
        }

        let decoder = JSONDecoder()
        let health: VesselHealth
        do {
            health = try decoder.decode(VesselHealth.self, from: data)
        } catch {
            throw VesselDiscoveryError.malformed(error.localizedDescription)
        }

        guard health.service == "vessel" else {
            throw VesselDiscoveryError.malformed("service != \"vessel\" (got \"\(health.service)\")")
        }
        return health
    }
}
