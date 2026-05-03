## 变更检查清单

### 协议变更（改 protocol.ts 或 Protocol.swift 时）

- [ ] 是否改了 `packages/shared/src/protocol.ts`？
- [ ] 是否同步更新 Swift `packages/ios-native/Sources/ClaudeWeb/Protocol.swift`？
- [ ] 是否新增或更新 `packages/shared/fixtures/protocol/` 中的 fixture？
- [ ] TS 和 iOS 的 decode/encode 行为是否匹配？

### WebSocket / runId 变更（改消息路由时）

- [ ] 所有 `sdk_message`、`error`、`clear_run_messages`、`session_ended` 都能按 runId 路由吗？
- [ ] 所有结束路径都会清理 run handle 吗？
- [ ] WS 断线时是否会 abort 所有 run 和 unregister？
- [ ] 不会把 A 会话的权限弹窗显示到 B 会话吗？

### 安全变更（改 path 校验、auth、binding 时）

- [ ] 后端仍绑定 `127.0.0.1` 吗？
- [ ] 没有绕过 `verifyAllowedPath` 吗？
- [ ] 没有新增可读文件或可执行命令的入口吗？
- [ ] Token 不会写入日志、URL 或错误消息吗？

### 用户可见变更（改 UI、功能、部署时）

- [ ] 是否需要更新 `docs/USER_MANUAL.md`？
- [ ] 是否需要更新 `CLAUDE.md` 的关键不变量？
- [ ] 是否影响 iOS 原生端？

### Harness 流水线 PR（agent 产 PR 时必填，人工 PR 可省）

仅当本 PR 由 harness Coder agent 产出时填写（[HARNESS_PR_GUIDE.md §4](../docs/HARNESS_PR_GUIDE.md)）：

- **Issue ID**：iss-...
- **Stage kind**：spec / design / implement / test / review / release
- **AgentProfile**：Coder / Reviewer-code / Documentor / ...
- **Reviewer Verdicts**：链接到 `docs/reviews/<issue>-arch-*.md` + `<issue>-cross-*.md`（risk-triggered 双 reviewer 时两条）
- **Decision 历史**：链接到 `harness.db.decision` 行（M1 起 PR 描述自动生成）
- **回滚预案**：1-2 句描述回滚命令 + 可能影响范围
- **Changelog 摘要**：1 句进 CHANGELOG.md
- **Cost**：$X.XX (tokens in/out)
- **schema migration**：是 / 否；若是，附 migration 文件链接（[ADR-0015](../docs/adr/ADR-0015-schema-migration.md)）

约束：
- [ ] 通过 `node packages/backend/scripts/test-prod-guard.mjs`
- [ ] 通过 `node packages/backend/scripts/test-git-guard.mjs`
- [ ] 双 reviewer Verdict score 全 ≥ 4.0/5（risk-triggered 触发时）
- [ ] 用户 Decision approved 已记录
- [ ] commit message 含 `harness-stage: <kind>` + `harness-issue: <id>` trailer（[COMMIT_CONVENTION.md](../docs/COMMIT_CONVENTION.md)）
- [ ] branch 名形如 `harness/<issueId>-<slug>`（[branch-naming.md](../docs/branch-naming.md)）

---

## 测试

- [ ] 本地运行 `pnpm test:protocol` — 协议 fixture 测试通过
- [ ] iOS 端编译通过（若改了 Protocol.swift）
- [ ] Frontend build 通过：`pnpm --filter @claude-web/frontend build`

---

💡 **提示**：GitHub Actions CI 会自动检查协议文件和 fixture 同步。如果 protocol.ts 或 Protocol.swift 改了但 fixture 没改，CI 会失败。
