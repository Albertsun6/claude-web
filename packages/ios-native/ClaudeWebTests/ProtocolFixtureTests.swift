import XCTest
@testable import ClaudeWeb

final class ProtocolFixtureTests: XCTestCase {
    // MARK: - Helpers

    func fixture(_ name: String) throws -> Data {
        // Load fixtures from the shared package source directory.
        // This works both in Xcode (via workspace) and CI.
        let fileManager = FileManager.default
        let currentDir = fileManager.currentDirectoryPath

        // Try multiple common paths where fixtures might be located
        let possiblePaths = [
            // Running from ios-native directory
            "\(currentDir)/../shared/fixtures/protocol/\(name).json",
            // Running from repo root
            "\(currentDir)/packages/shared/fixtures/protocol/\(name).json",
            // Absolute path if running from xcode
            "/Users/yongqian/Desktop/claude-web/packages/shared/fixtures/protocol/\(name).json",
        ]

        for path in possiblePaths {
            if fileManager.fileExists(atPath: path) {
                return try Data(contentsOf: URL(fileURLWithPath: path))
            }
        }

        // Last resort: try bundle reference
        let bundle = Bundle(for: Self.self)
        if let url = bundle.url(forResource: name, withExtension: "json",
                               subdirectory: "protocol") {
            return try Data(contentsOf: url)
        }

        XCTFail("Could not find fixture '\(name).json' in any expected location")
        throw NSError(domain: "FixtureMissing", code: 1, userInfo: [
            NSLocalizedDescriptionKey: "Fixture not found: \(name).json"
        ])
    }

    // MARK: - ServerMessage Decode Tests

    func testServerSDKMessageSystemInit() throws {
        let data = try fixture("server-sdk-message-system-init")
        let msgs = try ServerMessage.decode(data)
        XCTAssertEqual(msgs.count, 1)
        guard case .sdkMessage(let runId, let raw) = msgs[0] else {
            return XCTFail("expected sdkMessage")
        }
        XCTAssertEqual(runId, "run-abc123")
        guard case .systemInit(let sessionId, let model) = raw else {
            return XCTFail("expected systemInit")
        }
        XCTAssertEqual(sessionId, "session-xyz789")
        XCTAssertEqual(model, "claude-haiku-4-5")
    }

    func testServerSDKMessageAssistantText() throws {
        let data = try fixture("server-sdk-message-assistant-text")
        let msgs = try ServerMessage.decode(data)
        XCTAssertEqual(msgs.count, 1)
        guard case .sdkMessage(let runId, let raw) = msgs[0] else {
            return XCTFail("expected sdkMessage")
        }
        XCTAssertEqual(runId, "run-abc123")
        guard case .assistantContent(let text, _) = raw else {
            return XCTFail("expected assistantContent")
        }
        XCTAssertEqual(text, "你好！有什么我可以帮助你的？")
    }

    func testServerSDKMessageThinkingAndText() throws {
        let data = try fixture("server-sdk-message-thinking-and-text")
        let msgs = try ServerMessage.decode(data)
        // thinking block + assistantContent = 2 messages
        XCTAssertEqual(msgs.count, 2)
        guard case .sdkMessage(_, let raw0) = msgs[0],
              case .thinking(let text) = raw0 else {
            return XCTFail("first message should be thinking")
        }
        XCTAssertEqual(text, "用户想要帮助，我应该友好回应。")

        guard case .sdkMessage(_, let raw1) = msgs[1],
              case .assistantContent(let txt, _) = raw1 else {
            return XCTFail("second message should be assistantContent")
        }
        XCTAssertEqual(txt, "当然可以！")
    }

    func testServerSDKMessageToolUse() throws {
        let data = try fixture("server-sdk-message-tool-use")
        let msgs = try ServerMessage.decode(data)
        XCTAssertEqual(msgs.count, 1)
        guard case .sdkMessage(let runId, let raw) = msgs[0] else {
            return XCTFail("expected sdkMessage")
        }
        XCTAssertEqual(runId, "run-abc123")
        guard case .assistantContent(_, let toolUses) = raw else {
            return XCTFail("expected assistantContent with toolUses")
        }
        XCTAssertGreaterThan(toolUses.count, 0)
        XCTAssertEqual(toolUses[0].name, "Bash")
    }

    func testServerSDKMessageToolResult() throws {
        let data = try fixture("server-sdk-message-tool-result")
        let msgs = try ServerMessage.decode(data)
        XCTAssertEqual(msgs.count, 1)
        guard case .sdkMessage(_, let raw) = msgs[0] else {
            return XCTFail("expected sdkMessage")
        }
        guard case .toolResult(_, let isError) = raw else {
            return XCTFail("expected toolResult")
        }
        XCTAssertEqual(isError, false)
    }

    func testServerSDKMessageResult() throws {
        let data = try fixture("server-sdk-message-result")
        let msgs = try ServerMessage.decode(data)
        XCTAssertEqual(msgs.count, 1)
        guard case .sdkMessage(_, let raw) = msgs[0] else {
            return XCTFail("expected sdkMessage")
        }
        guard case .result(let costUSD) = raw else {
            return XCTFail("expected result")
        }
        XCTAssertEqual(costUSD, 0.0012)
    }

    func testServerPermissionRequest() throws {
        let data = try fixture("server-permission-request")
        let msgs = try ServerMessage.decode(data)
        XCTAssertEqual(msgs.count, 1)
        guard case .permissionRequest(let runId, let requestId, let toolName, _) = msgs[0] else {
            return XCTFail("expected permissionRequest")
        }
        XCTAssertEqual(runId, "run-abc123")
        XCTAssertEqual(requestId, "req-perm-001")
        XCTAssertEqual(toolName, "Bash")
    }

    func testServerError() throws {
        let data = try fixture("server-error")
        let msgs = try ServerMessage.decode(data)
        XCTAssertEqual(msgs.count, 1)
        guard case .error(let runId, let message) = msgs[0] else {
            return XCTFail("expected error")
        }
        XCTAssertEqual(runId, "run-abc123")
        XCTAssertEqual(message, "cwd not in allowed roots")
    }

    func testServerErrorGlobal() throws {
        let data = try fixture("server-error-global")
        let msgs = try ServerMessage.decode(data)
        XCTAssertEqual(msgs.count, 1)
        guard case .error(let runId, let message) = msgs[0] else {
            return XCTFail("expected error")
        }
        XCTAssertNil(runId)
        XCTAssertEqual(message, "invalid token")
    }

    func testServerClearRunMessages() throws {
        let data = try fixture("server-clear-run-messages")
        let msgs = try ServerMessage.decode(data)
        XCTAssertEqual(msgs.count, 1)
        guard case .clearRunMessages(let runId) = msgs[0] else {
            return XCTFail("expected clearRunMessages")
        }
        XCTAssertEqual(runId, "run-abc123")
    }

    func testServerSessionEndedCompleted() throws {
        let data = try fixture("server-session-ended-completed")
        let msgs = try ServerMessage.decode(data)
        XCTAssertEqual(msgs.count, 1)
        guard case .sessionEnded(let runId, let reason) = msgs[0] else {
            return XCTFail("expected sessionEnded")
        }
        XCTAssertEqual(runId, "run-abc123")
        XCTAssertEqual(reason, "completed")
    }

    func testServerSessionEndedInterrupted() throws {
        let data = try fixture("server-session-ended-interrupted")
        let msgs = try ServerMessage.decode(data)
        XCTAssertEqual(msgs.count, 1)
        guard case .sessionEnded(let runId, let reason) = msgs[0] else {
            return XCTFail("expected sessionEnded")
        }
        XCTAssertEqual(runId, "run-abc123")
        XCTAssertEqual(reason, "interrupted")
    }

    func testServerSessionEvent() throws {
        let data = try fixture("server-session-event")
        let msgs = try ServerMessage.decode(data)
        XCTAssertEqual(msgs.count, 1)
        guard case .sessionEvent(let cwd, let sessionId, let byteOffset, _) = msgs[0] else {
            return XCTFail("expected sessionEvent")
        }
        XCTAssertEqual(cwd, "/Users/test/project")
        XCTAssertEqual(sessionId, "session-xyz789")
        XCTAssertEqual(byteOffset, 2048)
    }

    // MARK: - ClientMessage Encode Tests

    func testClientUserPromptEncode() throws {
        let msg = ClientMessage.userPrompt(
            runId: "run-abc123",
            prompt: "帮我写一个 hello world",
            cwd: "/Users/test/project",
            model: "claude-haiku-4-5",
            permissionMode: "default",
            resumeSessionId: nil,
            attachments: nil
        )
        let data = try JSONEncoder().encode(msg)
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(dict["type"] as? String, "user_prompt")
        XCTAssertEqual(dict["runId"] as? String, "run-abc123")
        XCTAssertEqual(dict["prompt"] as? String, "帮我写一个 hello world")
        XCTAssertEqual(dict["cwd"] as? String, "/Users/test/project")
        XCTAssertEqual(dict["model"] as? String, "claude-haiku-4-5")
        XCTAssertEqual(dict["permissionMode"] as? String, "default")
    }

    func testClientPermissionReplyEncode() throws {
        let msg = ClientMessage.permissionReply(
            requestId: "req-perm-001",
            decision: "allow",
            runId: "run-abc123",
            toolName: "Bash"
        )
        let data = try JSONEncoder().encode(msg)
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(dict["type"] as? String, "permission_reply")
        XCTAssertEqual(dict["requestId"] as? String, "req-perm-001")
        XCTAssertEqual(dict["decision"] as? String, "allow")
        XCTAssertEqual(dict["runId"] as? String, "run-abc123")
        XCTAssertEqual(dict["toolName"] as? String, "Bash")
    }

    func testClientInterruptEncode() throws {
        let msg = ClientMessage.interrupt(runId: "run-abc123")
        let data = try JSONEncoder().encode(msg)
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(dict["type"] as? String, "interrupt")
        XCTAssertEqual(dict["runId"] as? String, "run-abc123")
    }

    func testClientSessionSubscribeEncode() throws {
        let msg = ClientMessage.sessionSubscribe(
            cwd: "/Users/test/project",
            sessionId: "session-xyz789",
            fromByteOffset: 1024
        )
        let data = try JSONEncoder().encode(msg)
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(dict["type"] as? String, "session_subscribe")
        XCTAssertEqual(dict["cwd"] as? String, "/Users/test/project")
        XCTAssertEqual(dict["sessionId"] as? String, "session-xyz789")
        XCTAssertEqual(dict["fromByteOffset"] as? Int, 1024)
    }

    func testClientSessionUnsubscribeEncode() throws {
        let msg = ClientMessage.sessionUnsubscribe(
            cwd: "/Users/test/project",
            sessionId: "session-xyz789"
        )
        let data = try JSONEncoder().encode(msg)
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(dict["type"] as? String, "session_unsubscribe")
        XCTAssertEqual(dict["cwd"] as? String, "/Users/test/project")
        XCTAssertEqual(dict["sessionId"] as? String, "session-xyz789")
    }
}
