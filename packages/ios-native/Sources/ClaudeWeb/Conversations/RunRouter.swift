// runId → conversationId routing table. Built when sendPrompt fires, read
// when an incoming WS message arrives, torn down on every sessionEnded
// (any reason). Without this map, WS messages for a backgrounded
// conversation would land in the wrong UI focus.

import Foundation

@MainActor
final class RunRouter {
    private var map: [String: String] = [:]

    func bind(runId: String, to convId: String) {
        map[runId] = convId
    }

    func resolve(runId: String) -> String? {
        map[runId]
    }

    func release(runId: String) {
        map.removeValue(forKey: runId)
    }

    /// Drop every entry pointing at the given conversation. Called on close
    /// so the table doesn't leak runIds for conversations that no longer exist.
    func releaseAll(forConversation convId: String) {
        map = map.filter { $0.value != convId }
    }
}
