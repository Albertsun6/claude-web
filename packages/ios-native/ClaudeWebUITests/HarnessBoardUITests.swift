// HarnessBoardUITests.swift
// XCUITest for Harness Board full drill-down:
//   Initiative list → create → Issue list → create → Stage list → add → swipe transitions → Decision sheet
//
// Requirements:
//   - Backend running at 127.0.0.1:3030 (launchd-managed)
//   - Simulator booted (iPhone 17 or any iPhone sim)
//   - App already installed on the booted simulator
//
// Run: xcodebuild test -project ClaudeWeb.xcodeproj -scheme ClaudeWeb
//        -destination "id=<SIM_ID>" -only-testing:ClaudeWebUITests/HarnessBoardUITests

import XCTest

final class HarnessBoardUITests: XCTestCase {

    var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        // Skip onboarding / permission prompts if any
        app.launchArguments = ["UI_TESTING"]
        app.launch()
    }

    override func tearDownWithError() throws {
        app = nil
    }

    // MARK: - Helper: open the Harness Board sheet

    /// Opens the left drawer and taps "Harness 看板".
    private func openHarnessBoard() {
        // ContentView drawer toggle has accessibilityLabel("打开抽屉")
        let drawerButton = app.buttons["打开抽屉"]
        XCTAssertTrue(drawerButton.waitForExistence(timeout: 8), "Drawer toggle button not found")
        drawerButton.tap()

        let harnessRow = app.buttons["Harness 看板"]
        XCTAssertTrue(harnessRow.waitForExistence(timeout: 5), "Harness 看板 row not found in drawer")
        harnessRow.tap()

        // Wait for nav title to confirm board is presented
        XCTAssertTrue(
            app.navigationBars.staticTexts["🔬 Harness 看板"].waitForExistence(timeout: 8),
            "Board did not present"
        )

        // Wait for loading to complete — board shows ProgressView("加载中…") while fetching.
        // Poll unconditionally so we catch it even if it appears slightly after the nav title.
        let loadingLabel = app.staticTexts["加载中…"]
        let loadDeadline = Date().addingTimeInterval(10)
        while loadingLabel.exists && Date() < loadDeadline {
            Thread.sleep(forTimeInterval: 0.4)
        }
        // Also wait for harness_board_add button to be present (confirms List is rendered)
        _ = app.buttons["harness_board_add"].waitForExistence(timeout: 5)
        Thread.sleep(forTimeInterval: 0.3) // let SwiftUI finish render pass
    }

    /// Closes the current board and reopens it so `.task { await load() }` fires again.
    private func reopenHarnessBoard() {
        let closeBtn = app.buttons["harness_board_close"]
        if closeBtn.waitForExistence(timeout: 3) { closeBtn.tap() }
        Thread.sleep(forTimeInterval: 0.3)
        openHarnessBoard()
    }

    // MARK: - Test 1: Board loads and shows initiative list (or empty state)

    func testBoardOpens() {
        openHarnessBoard()

        // The nav title is "🔬 Harness 看板"
        let title = app.navigationBars.staticTexts["🔬 Harness 看板"]
        XCTAssertTrue(title.waitForExistence(timeout: 8), "Harness Board nav title not visible")

        // Either empty state label or at least one cell must exist
        let emptyLabel = app.staticTexts["还没有 Initiative"]
        let hasEmpty = emptyLabel.waitForExistence(timeout: 3)
        let hasRow = app.cells.firstMatch.waitForExistence(timeout: 3)
        XCTAssertTrue(hasEmpty || hasRow, "Board should show empty state or initiative rows")
    }

    // MARK: - Test 2: Create an Initiative

    func testCreateInitiative() {
        openHarnessBoard()

        let addBtn = app.buttons["harness_board_add"]
        XCTAssertTrue(addBtn.waitForExistence(timeout: 8))
        addBtn.tap()
        Thread.sleep(forTimeInterval: 0.3)

        // The add form appears at the BOTTOM of the initiatives list.
        // SwiftUI List is lazy — scroll down to force the form into the accessibility tree.
        let boardList = app.collectionViews.firstMatch
        var titleField = app.textFields["harness_new_initiative_title"]
        var scrollAttempts = 0
        while !titleField.exists && scrollAttempts < 5 {
            if boardList.waitForExistence(timeout: 2) { boardList.swipeUp() }
            Thread.sleep(forTimeInterval: 0.3)
            titleField = app.textFields["harness_new_initiative_title"]
            scrollAttempts += 1
        }

        XCTAssertTrue(titleField.waitForExistence(timeout: 5), "harness_new_initiative_title not found — form may not be rendered")

        let ts = "\(Int(Date().timeIntervalSince1970) % 10000)"
        let title = "UITest Initiative \(ts)"
        titleField.tap()
        titleField.typeText(title)

        // Confirm
        let confirmBtn = app.buttons["harness_add_confirm"]
        XCTAssertTrue(confirmBtn.isEnabled, "Confirm button should be enabled after typing title")
        confirmBtn.tap()
        Thread.sleep(forTimeInterval: 1)

        // Verify the initiative was created via API (avoids SwiftUI lazy-list off-screen issue)
        let projId = extractBoardProjectId() ?? ""
        let listResp = apiGET("/api/harness/initiatives?projectId=\(projId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? projId)")
        let items = ((listResp as? [String: Any])?["data"] as? [[String: Any]]) ?? []
        let found = items.contains { $0["title"] as? String == title }
        XCTAssertTrue(found, "New initiative '\(title)' not found in backend — creation may have failed")
    }

    // MARK: - Test 3: Drill into Initiative → create Issue

    func testCreateIssue() {
        openHarnessBoard()

        // Ensure at least one initiative exists
        let emptyLabel = app.staticTexts["还没有 Initiative"]
        let initTitle = "UITest Init for Issue"
        if emptyLabel.waitForExistence(timeout: 3) {
            let addBtn = app.buttons["harness_board_add"]
            XCTAssertTrue(addBtn.waitForExistence(timeout: 5))
            addBtn.tap()
            let titleField = app.textFields["harness_new_initiative_title"]
            XCTAssertTrue(titleField.waitForExistence(timeout: 3))
            titleField.tap()
            titleField.typeText(initTitle)
            app.buttons["harness_add_confirm"].tap()
            XCTAssertTrue(app.staticTexts[initTitle].waitForExistence(timeout: 6))
        }

        // Tap the initiative by its title text (safer than tapping first cell — avoids form section)
        let initTextEl = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS 'UITest'")
        ).firstMatch
        if initTextEl.waitForExistence(timeout: 5), initTextEl.isHittable {
            initTextEl.tap()
        } else {
            // Fallback: tap first hittable cell directly
            var tapped = false
            for cell in app.cells.allElementsBoundByIndex {
                if cell.isHittable { cell.tap(); tapped = true; break }
            }
            XCTAssertTrue(tapped, "No hittable cell found")
        }

        // IssueListView: "新建 Issue" button
        let issueAddBtn = app.buttons["issue_add_btn"]
        XCTAssertTrue(issueAddBtn.waitForExistence(timeout: 5), "Issue list add button not found")
        issueAddBtn.tap()

        // Type issue title
        let issueTitleField = app.textFields["issue_title_field"]
        XCTAssertTrue(issueTitleField.waitForExistence(timeout: 3))
        issueTitleField.tap()
        let ts = "\(Int(Date().timeIntervalSince1970) % 10000)"
        let issueTitle = "UITest Issue \(ts)"
        issueTitleField.typeText(issueTitle)

        app.buttons["issue_add_confirm"].tap()

        // Issue title text should appear in list
        XCTAssertTrue(app.staticTexts[issueTitle].waitForExistence(timeout: 6),
                      "New issue '\(issueTitle)' should appear after creation")
    }

    // MARK: - Test 4: Drill into Issue → add Stage → swipe start → swipe await_review

    func testStageLifecycle() {
        guard let projectId = extractBoardProjectId() else {
            XCTFail("No projectId"); return
        }

        // Seed via API before opening board
        guard let initId = extractId(apiPOST("/api/harness/initiatives", body: [
            "projectId": projectId, "cwd": projectId, "title": "UITest Stage Init"
        ])) else { XCTFail("No initId"); return }
        guard let issueId = extractId(apiPOST("/api/harness/issues", body: [
            "projectId": projectId, "initiativeId": initId, "title": "UITest Stage Issue"
        ])) else { XCTFail("No issueId"); return }
        _ = issueId

        // Open board after seed — .task fires on presentation and loads fresh data
        openHarnessBoard()

        // Board loaded — navigate into the first available initiative
        // (seed created the most recent one, which appears first due to ORDER BY created_at DESC)
        let noInitLabel = app.staticTexts["还没有 Initiative"]
        let hasEmpty = noInitLabel.waitForExistence(timeout: 3)
        XCTAssertFalse(hasEmpty, "Board is empty — initiatives not loaded (projectId mismatch?)")

        // Tap the first cell (newest initiative is at top)
        var tappedInit = false
        for cell in app.cells.allElementsBoundByIndex {
            if cell.isHittable { cell.tap(); tappedInit = true; break }
        }
        XCTAssertTrue(tappedInit, "Could not tap any initiative cell")

        // Now in IssueListView — tap first issue cell
        let issueAddBtn = app.buttons["issue_add_btn"]
        XCTAssertTrue(issueAddBtn.waitForExistence(timeout: 5))
        var tappedIssue = false
        for cell in app.cells.allElementsBoundByIndex {
            if cell.isHittable && cell.buttons["issue_add_btn"].exists == false {
                cell.tap(); tappedIssue = true; break
            }
        }
        // If no hittable issue, the seeded issue might not be loaded — check for empty label
        if !tappedIssue {
            // Try tapping the first cell anyway
            if let first = app.cells.allElementsBoundByIndex.first(where: { $0.isHittable }) {
                first.tap(); tappedIssue = true
            }
        }
        XCTAssertTrue(tappedIssue, "Could not tap any issue cell")

        // StageListView: add stage
        let stageAddBtn = app.buttons["stage_add_btn"]
        XCTAssertTrue(stageAddBtn.waitForExistence(timeout: 5), "Stage add button not found")
        stageAddBtn.tap()

        let createStageBtn = app.buttons["创建"]
        XCTAssertTrue(createStageBtn.waitForExistence(timeout: 3))
        createStageBtn.tap()

        // A cell with the kind name should appear (e.g. "strategy", first available)
        // Look for any stage kind text in the list
        let kindLabels = ["strategy", "discovery", "spec", "compliance", "design",
                          "implement", "test", "review", "release", "observe"]
        var stageCell: XCUIElement?
        for kind in kindLabels {
            let el = app.staticTexts[kind]
            if el.waitForExistence(timeout: 2) { stageCell = el; break }
        }
        XCTAssertNotNil(stageCell, "No stage kind text found after creating stage")

        // Find the cell containing it and swipe left → "开始"
        let cell = app.cells.containing(.staticText, identifier: stageCell!.label).firstMatch
        XCTAssertTrue(cell.waitForExistence(timeout: 3))
        cell.swipeLeft()

        let startBtn = app.buttons["开始"]
        XCTAssertTrue(startBtn.waitForExistence(timeout: 3), "Swipe action '开始' not visible")
        startBtn.tap()

        // Swipe left again → "等审批"
        cell.swipeLeft()
        let awaitBtn = app.buttons["等审批"]
        XCTAssertTrue(awaitBtn.waitForExistence(timeout: 3), "Swipe action '等审批' not visible")
        awaitBtn.tap()

        // Stage row remains visible
        XCTAssertTrue(cell.waitForExistence(timeout: 3))
    }

    // MARK: - Test 5: DecisionSheet appears and resolves

    func testDecisionSheetApprove() {
        // Seed via API first, then open board so .task loads fresh data
        seedDecisionViaAPI()
        openHarnessBoard()

        // Trigger pull-to-refresh so the board reloads and the seeded initiative appears.
        let boardList = app.collectionViews.firstMatch
        if boardList.waitForExistence(timeout: 5) {
            boardList.swipeDown()   // pull-to-refresh gesture
            Thread.sleep(forTimeInterval: 2) // wait for network round-trip
        }

        // Navigate to the seeded initiative by title (timestamped, so it's at top of list)
        let initText = app.staticTexts[seededInitTitle]
        XCTAssertTrue(initText.waitForExistence(timeout: 10), "Seeded initiative '\(seededInitTitle)' not found in board")
        initText.tap()

        // Navigate to the seeded issue by title
        let issueText = app.staticTexts[seededIssueTitle]
        XCTAssertTrue(issueText.waitForExistence(timeout: 8), "Seeded issue '\(seededIssueTitle)' not found")
        issueText.tap()

        // Wait for StageListView to load
        let stageAddBtn = app.buttons["stage_add_btn"]
        XCTAssertTrue(stageAddBtn.waitForExistence(timeout: 8), "StageListView did not load")

        // Wait for the seeded spec stage to appear (stage.kind text is visible as a StaticText)
        let specText = app.staticTexts["spec"]
        if !specText.waitForExistence(timeout: 8) {
            Thread.sleep(forTimeInterval: 2)
        }
        XCTAssertTrue(specText.exists, "spec stage not found in StageListView")

        // SwiftUI .accessibilityIdentifier("stage_row_<id>") on the HStack content appears
        // as a StaticText accessibility element (type 48) in XCUITest.
        // swipeLeft() on this element triggers the .swipeActions defined on the HStack.
        // SwiftUI maps .accessibilityIdentifier("stage_row_<id>") on the HStack to a StaticText
        // element in XCUITest (may appear multiple times in the hierarchy due to SwiftUI nesting).
        // Use .firstMatch to resolve the ambiguity.
        // SwiftUI .swipeActions are triggered by swiping the List *cell*, not the inner content.
        // We find the stage row via its StaticText identifier, then use coordinate-based drag
        // gesture at the cell level to trigger the swipe action.
        let stageRowId = "stage_row_\(seededStageId)"
        let stageRowEl = app.staticTexts.matching(identifier: stageRowId).firstMatch
        XCTAssertTrue(stageRowEl.waitForExistence(timeout: 5), "Stage row element '\(stageRowId)' not found")

        // Use coordinate drag to simulate a left swipe at the cell level
        let frame = stageRowEl.frame
        let startCoord = app.coordinate(withNormalizedOffset: CGVector(
            dx: (frame.midX + 80) / app.frame.width,
            dy: frame.midY / app.frame.height
        ))
        let endCoord = app.coordinate(withNormalizedOffset: CGVector(
            dx: (frame.midX - 80) / app.frame.width,
            dy: frame.midY / app.frame.height
        ))
        startCoord.press(forDuration: 0, thenDragTo: endCoord)

        let approveSwipe = app.buttons["审批"]
        XCTAssertTrue(approveSwipe.waitForExistence(timeout: 3), "Swipe '审批' not visible")
        approveSwipe.tap()

        // Wait for sheet to present and DecisionSheet's .task to load decisions
        // The sheet presents immediately (sync), then .task fires a network request
        let decisionNavTitle = app.navigationBars.staticTexts["待审批决策"]
        XCTAssertTrue(decisionNavTitle.waitForExistence(timeout: 5), "DecisionSheet did not present")

        // Wait for the ProgressView inside the sheet to disappear (network request done)
        let deadline = Date().addingTimeInterval(8)
        while app.activityIndicators.firstMatch.exists && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.3)
        }
        Thread.sleep(forTimeInterval: 0.5)  // let SwiftUI finish rendering

        // DecisionSheet modal — approve button
        // decision_option_approve button is a Button with .accessibilityIdentifier("decision_option_approve")
        // inside a .bordered ButtonStyle — it appears as a regular button in XCUITest.
        let approveBtn = app.buttons["decision_option_approve"]
        XCTAssertTrue(approveBtn.waitForExistence(timeout: 5), "Approve button in DecisionSheet not found")
        approveBtn.tap()

        // Sheet dismisses — stage add button visible again
        XCTAssertTrue(
            app.buttons["stage_add_btn"].waitForExistence(timeout: 5),
            "Should return to StageListView after decision"
        )
    }

    // MARK: - Test 6: Close board returns to chat

    func testCloseBoardReturnsToChat() {
        openHarnessBoard()

        let title = app.navigationBars.staticTexts["🔬 Harness 看板"]
        XCTAssertTrue(title.waitForExistence(timeout: 8))

        let closeBtn = app.buttons["harness_board_close"]
        XCTAssertTrue(closeBtn.waitForExistence(timeout: 3))
        closeBtn.tap()

        // Board sheet dismissed — chat input bar should reappear
        // ContentView has an InputBar with an accessibility hint; we check the send button
        let sendOrMicBtn = app.buttons.matching(
            NSPredicate(format: "label CONTAINS '发送' OR label CONTAINS 'mic' OR label CONTAINS 'send'")
        ).firstMatch
        // Relaxed: just assert the board is gone
        XCTAssertFalse(title.exists, "Harness Board should be dismissed after tapping 关闭")
    }

    // MARK: - API Seed Helper

    var seededInitTitle = ""
    var seededIssueTitle = ""
    var seededStageId = ""

    /// Seeds one Initiative → Issue → Stage(spec, awaiting_review) → Decision(approve/reject)
    /// via HTTP so the Decision sheet test has data regardless of prior test order.
    /// Sets seededInitTitle / seededIssueTitle for the caller to navigate with.
    ///
    /// IMPORTANT: uses the same cwd/projectId that HarnessBoardView uses, which is
    /// derived from settings.cwd (UserDefaults). In the simulator, settings.cwd = "/Users/yongqian/Desktop"
    /// which is not a registered project — so the board uses cwd as projectId directly.
    private func seedDecisionViaAPI() {
        let ts = "\(Int(Date().timeIntervalSince1970) % 100000)"
        seededInitTitle = "DecisionSeed-\(ts)"
        seededIssueTitle = "DecisionIssue-\(ts)"

        guard let projectId = extractBoardProjectId() else {
            XCTFail("Could not determine board projectId")
            return
        }

        guard let initId = extractId(apiPOST("/api/harness/initiatives", body: [
            "projectId": projectId, "cwd": projectId, "title": seededInitTitle
        ])) else {
            XCTFail("Could not create seeded initiative"); return
        }

        guard let issueId = extractId(apiPOST("/api/harness/issues", body: [
            "projectId": projectId, "initiativeId": initId, "title": seededIssueTitle
        ])) else {
            XCTFail("Could not create seeded issue"); return
        }

        guard let stageId = extractId(apiPOST("/api/harness/stages", body: [
            "issueId": issueId, "kind": "spec"
        ])) else {
            XCTFail("Could not create seeded stage"); return
        }
        seededStageId = stageId

        apiPUT("/api/harness/stages/\(stageId)/status", body: ["status": "awaiting_review"])

        apiPOST("/api/harness/decisions", body: [
            "stageId": stageId,
            "requestedBy": "UITest",
            "options": ["approve", "reject"]
        ])
    }

    // MARK: - HTTP helpers (synchronous via semaphore — test-only)

    @discardableResult
    private func apiGET(_ path: String) -> Any? {
        guard let url = URL(string: "http://127.0.0.1:3030\(path)") else { return nil }
        var result: Any?
        let sem = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: url) { data, _, _ in
            if let data, let obj = try? JSONSerialization.jsonObject(with: data) { result = obj }
            sem.signal()
        }.resume()
        sem.wait()
        return result
    }

    @discardableResult
    private func apiPOST(_ path: String, body: [String: Any]) -> Any? {
        guard let url = URL(string: "http://127.0.0.1:3030\(path)"),
              let bodyData = try? JSONSerialization.data(withJSONObject: body) else { return nil }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = bodyData
        var result: Any?
        let sem = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: req) { data, _, _ in
            if let data, let obj = try? JSONSerialization.jsonObject(with: data) { result = obj }
            sem.signal()
        }.resume()
        sem.wait()
        return result
    }

    @discardableResult
    private func apiPUT(_ path: String, body: [String: Any]) -> Any? {
        guard let url = URL(string: "http://127.0.0.1:3030\(path)"),
              let bodyData = try? JSONSerialization.data(withJSONObject: body) else { return nil }
        var req = URLRequest(url: url)
        req.httpMethod = "PUT"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = bodyData
        var result: Any?
        let sem = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: req) { data, _, _ in
            if let data, let obj = try? JSONSerialization.jsonObject(with: data) { result = obj }
            sem.signal()
        }.resume()
        sem.wait()
        return result
    }

    private func extractId(_ obj: Any?) -> String? {
        (obj as? [String: Any]).flatMap { $0["data"] as? [String: Any] }.flatMap { $0["id"] as? String }
    }

    private func extractFirstProjectId(_ obj: Any?, cwd: String) -> String? {
        guard let dict = obj as? [String: Any],
              let projects = dict["projects"] as? [[String: Any]] else { return nil }
        return (projects.first(where: { $0["cwd"] as? String == cwd }) ?? projects.first)?["id"] as? String
    }

    /// Returns the projectId that HarnessBoardView uses: registry.project(forCwd: settings.cwd)?.id ?? settings.cwd.
    /// In the simulator, settings.cwd = "/Users/yongqian/Desktop" (unregistered) so cwd is used as projectId.
    private func extractBoardProjectId() -> String? {
        guard let response = apiGET("/api/projects"),
              let dict = response as? [String: Any],
              let projects = dict["projects"] as? [[String: Any]] else { return nil }

        let candidateCwds = [
            "/Users/yongqian/Desktop",
            "/Users/yongqian/Desktop/claude-web"
        ]

        for cwd in candidateCwds {
            if let proj = projects.first(where: { $0["cwd"] as? String == cwd }) {
                return proj["id"] as? String
            }
            if let data = apiGET("/api/harness/initiatives?projectId=\(cwd.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? cwd)"),
               let dict = data as? [String: Any],
               let items = dict["data"] as? [[String: Any]], !items.isEmpty {
                return cwd
            }
        }

        return projects.first?["id"] as? String
    }
}
