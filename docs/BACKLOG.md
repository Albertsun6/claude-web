# Vessel Backlog

**最近更新**: 2026-05-12T17:40:00Z
**Steward 启动仪式**: 见 [`docs/STEWARD_PROMPTS.md`](STEWARD_PROMPTS.md) 或 [`docs/STEWARD_USAGE.md`](STEWARD_USAGE.md)
**Schema 契约**: [`docs/adr/vessel/ADR-019-steward-v0-contract.md`](adr/vessel/ADR-019-steward-v0-contract.md)
**Source-of-truth**: 本文件是唯一写入点（I1）；`status` 字段是状态唯一权威（I10）；section header 仅人眼导航

---

## Active (planned / in_progress)

```yaml
items:
  - id: testflight-encryption-compliance
    title: TestFlight Build 49 加密合规对话框
    priority: P1
    size: S
    status: in_progress
    assigned_kind: user-manual
    parallel_safe_files: []
    depends_on: []
    note: "App Store Connect → Seaidea → TestFlight → 编辑加密信息；走 HTTPS/WSS 选'未含加密'或'Apple 提供'"
    refs: ["pr:#42"]

  - id: testflight-install-verify
    title: TestFlight Build 49 装到 iPhone 验证
    priority: P1
    size: S
    status: planned
    assigned_kind: user-manual
    depends_on: ["testflight-encryption-compliance"]
    parallel_safe_files: []
    note: "iPhone TestFlight app → 接受邀请 → 安装；首启动验证 backend 连通"

  - id: voice-roundtrip-measure
    title: 真机 voice round-trip ≤ 8 秒实测
    priority: P2
    size: M
    status: planned
    assigned_kind: user-manual
    depends_on: ["testflight-install-verify"]
    parallel_safe_files: []
    note: "5+ 轮 voice 对话，收集 voice.mic.released → voice.first_audio.played 时延"
    refs: ["commit:eaa24e2"]

  - id: offline-checklist-verify
    title: Mac 离线 graceful failure 真机验证
    priority: P2
    size: S
    status: planned
    assigned_kind: user-manual
    depends_on: ["testflight-install-verify"]
    parallel_safe_files: []
    note: "跑 IOS_NATIVE_DEVICE_TEST.md §6.6 / §6.7 / §8.1-8.3 + cache 回退"
    refs: ["commit:9b6d091"]

  - id: m2-voice-proposal
    title: M2-Voice Capability 设计提案
    priority: P2
    size: M
    status: planned
    assigned_kind: main
    parallel_safe_files: ["docs/proposals/"]
    depends_on: []
    note: "调研 whisper-large > 500MB 走 worker subprocess (ADR-012)；写到 docs/proposals/M2-VOICE-CAPABILITY.md；可并行候选"

```

---

## Blocked / On Hold

```yaml
items:
  - id: m2-ops-mvp
    title: M2 OperationsDispatcher v0 (execution_depth=operations 路由)
    priority: P3
    size: L
    status: blocked
    blocked_reason: "用户 2026-05-11 决定先不做"
    parallel_safe_files: ["packages/backend/src/operations/"]
    note: "orchestrator.ts 已留 TODO(ops-mvp) 占位；解锁条件不明，等具体场景"

  - id: cross-session-messaging
    title: Step 3 跨 Claude session 主动消息通道
    priority: P3
    size: M
    status: blocked
    blocked_reason: "无具体场景；eva:sessions 可见性已能 cover 多数协调需求"
    parallel_safe_files: ["packages/backend/src/routes/inbox.ts"]
    note: "Inbox 加 target=sessionId|worktreeName 字段，撞到时再做"
```

---

## Done

```yaml
items:
  - id: intent-classifier-v1
    title: Intent Classifier v1 (M2-intent-v1)
    status: done
    completed_at: 2026-05-11T11:33:50Z
    refs: ["pr:#39", "pr:#41", "tag:v0.7.0-M2", "commit:9282890"]
    note: "Rules-first depth × domain classifier + memory.db v4→v5 + orchestrator.runIntent 接 classify()"

  - id: eva-sessions-derived-view
    title: pnpm eva:sessions 派生视图 (Step 2 并行 session 协调)
    status: done
    completed_at: 2026-05-11T12:31:58Z
    refs: ["pr:#40", "pr:#41", "tag:v0.7.0-M2", "commit:73987b6"]
    note: "零写入、零 daemon；解析 ps + ~/.claude/projects jsonl mtime"

  - id: m2-ios-gamma-prep
    title: M2-iOS-γ prep (rename + voice telemetry + offline map + TestFlight playbook)
    status: done
    completed_at: 2026-05-11T13:09:37Z
    refs: ["pr:#42", "pr:#43", "tag:v0.7.1-M2gamma", "commit:a433752"]

  - id: galaxy-telecom-team-fix
    title: DEVELOPMENT_TEAM 切到 GALAXY TELECOM (23PRXWBRNH) + -allowProvisioningDeviceRegistration
    status: done
    completed_at: 2026-05-12T00:00:00Z
    refs: ["pr:#44", "pr:#45", "tag:v0.7.2", "commit:8743fc5"]

  - id: eva-sessions-json-output
    title: pnpm eva:sessions 加 --format json
    status: done
    completed_at: 2026-05-12T17:40:00Z
    refs: ["adr:019"]
    note: "契约 API 升级；JSON shape 锁进 ADR-019 §eva:sessions JSON contract（Steward 消费侧依赖）"
```
