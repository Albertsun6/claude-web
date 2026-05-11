// BonjourBrowser — discover `_vessel._tcp` on the local network using
// Apple's Network.framework (NWBrowser). Async stream of discovered services
// that the app can present as "auto-discovered Mac" entries in settings.
//
// M2-iOS-β scope: discovery layer only. Verifying that a discovered host is
// actually a Vessel (vs some other `_vessel._tcp` impl) is `VesselDiscovery`.
//
// Manual-IP fallback path is preserved — this layer is opt-in: app falls
// back to the saved `Settings.backendURL` when no Bonjour result arrives in
// the discovery window.
//
// Requires Info.plist entry NSBonjourServices = ["_vessel._tcp"]; otherwise
// iOS silently denies the browse. Configured in project.yml.

import Foundation
import Network

/// Result of a single discovered Bonjour service before resolution.
struct DiscoveredVesselService: Hashable, Identifiable {
    /// Bonjour instance name, e.g. "Vessel-yongqians-mac".
    let name: String
    /// `_vessel._tcp` always; tracked for diagnostics.
    let type: String
    /// `local` for mDNS results.
    let domain: String

    /// Stable ID for SwiftUI list diffing.
    var id: String { "\(name).\(type).\(domain)" }
}

/// Bonjour browser actor. Single instance recommended per app launch — the
/// underlying NWBrowser is restartable but holds a kernel resource.
@MainActor
final class BonjourBrowser: ObservableObject {
    /// Currently-discovered services. Updated on the main thread for SwiftUI.
    @Published private(set) var services: [DiscoveredVesselService] = []
    /// Browse state — `.ready` after the first event, `.failed` if entitlements
    /// or network are missing.
    @Published private(set) var state: BrowseState = .idle

    private var browser: NWBrowser?

    enum BrowseState: Equatable {
        case idle
        case browsing
        case ready
        /// Includes the underlying error description for surfacing in UI.
        case failed(String)
    }

    /// Begin browsing `_vessel._tcp` on `local`. Idempotent — calling again
    /// while already browsing is a no-op.
    func start() {
        guard browser == nil else { return }

        let descriptor = NWBrowser.Descriptor.bonjour(type: "_vessel._tcp", domain: "local.")
        let parameters = NWParameters()
        parameters.includePeerToPeer = false  // LAN only

        let b = NWBrowser(for: descriptor, using: parameters)

        b.stateUpdateHandler = { [weak self] newState in
            Task { @MainActor in
                guard let self = self else { return }
                switch newState {
                case .setup, .waiting:
                    self.state = .browsing
                case .ready:
                    self.state = .ready
                case .failed(let err):
                    self.state = .failed(err.localizedDescription)
                case .cancelled:
                    self.state = .idle
                @unknown default:
                    break
                }
            }
        }

        b.browseResultsChangedHandler = { [weak self] results, _ in
            Task { @MainActor in
                guard let self = self else { return }
                self.services = results.compactMap { result in
                    guard case let .service(name, type, domain, _) = result.endpoint else { return nil }
                    return DiscoveredVesselService(name: name, type: type, domain: domain)
                }.sorted { $0.name < $1.name }
            }
        }

        b.start(queue: .main)
        self.browser = b
    }

    /// Stop browsing. Safe to call multiple times.
    func stop() {
        browser?.cancel()
        browser = nil
        services = []
        state = .idle
    }

    /// Resolve a discovered service to a hostname/port pair the rest of the
    /// app can use as a backendURL. Returns nil on resolution timeout.
    ///
    /// `_vessel._tcp` advertises the port; iOS typically returns a hostname
    /// like `Yongqians-MacBook-Pro.local`. We hand the resolved tuple back
    /// to caller; callers should `URL(string: "http://\(host):\(port)")`.
    func resolve(_ service: DiscoveredVesselService, timeout: TimeInterval = 3.0) async -> (host: String, port: UInt16)? {
        let endpoint = NWEndpoint.service(name: service.name, type: service.type, domain: service.domain, interface: nil)
        let connection = NWConnection(to: endpoint, using: .tcp)

        return await withCheckedContinuation { continuation in
            var resumed = false
            let resumeOnce: (((host: String, port: UInt16)?) -> Void) = { result in
                guard !resumed else { return }
                resumed = true
                connection.cancel()
                continuation.resume(returning: result)
            }

            connection.stateUpdateHandler = { newState in
                switch newState {
                case .ready:
                    if case let .hostPort(host: host, port: port) = connection.currentPath?.remoteEndpoint {
                        let hostStr: String
                        switch host {
                        case .name(let n, _): hostStr = n
                        case .ipv4(let v): hostStr = "\(v)"
                        case .ipv6(let v): hostStr = "[\(v)]"
                        @unknown default: hostStr = ""
                        }
                        resumeOnce((hostStr, port.rawValue))
                    } else {
                        resumeOnce(nil)
                    }
                case .failed, .cancelled:
                    resumeOnce(nil)
                default:
                    break
                }
            }
            connection.start(queue: .main)

            DispatchQueue.main.asyncAfter(deadline: .now() + timeout) {
                resumeOnce(nil)
            }
        }
    }
}
