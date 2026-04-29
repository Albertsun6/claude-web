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

---

## 测试

- [ ] 本地运行 `pnpm test:protocol` — 协议 fixture 测试通过
- [ ] iOS 端编译通过（若改了 Protocol.swift）
- [ ] Frontend build 通过：`pnpm --filter @claude-web/frontend build`

---

💡 **提示**：GitHub Actions CI 会自动检查协议文件和 fixture 同步。如果 protocol.ts 或 Protocol.swift 改了但 fixture 没改，CI 会失败。
