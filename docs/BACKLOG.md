# Vessel Backlog

**最近更新**: 2026-05-12T03:00:00Z
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

  - id: steward-v05-r1-worker-signal-fileflag
    title: R1 worker→master signaling — file flag canonical (Steward V0.5)
    priority: P0
    size: S
    status: planned
    parallel_safe_files:
      - "scripts/steward-signal-done.sh"
      - "packages/backend/src/lib/spawn-done-flags.ts"
      - "docs/STEWARD_PROMPTS.md"
      - "docs/STEWARD_USAGE.md"
      - "docs/adr/vessel/ADR-019-steward-v0-contract.md"
    depends_on: []
    note: "worker 完成时写 ~/.vessel/spawn-done/<task-id>.json (canonical) + 镜像到 inbox (mirror) + PR title scan (fallback)。proposal: docs/proposals/STEWARD_PARALLEL_MECHANISM_EVAL.md §5 R1"
    refs: ["pr:#53", "proposal:STEWARD_PARALLEL_MECHANISM_EVAL.md"]

  - id: steward-v05-r2-worker-pr-no-auto-merge
    title: R2 worker open PR + signal, code 不默认 auto-merge (Steward V0.5)
    priority: P1
    size: S
    status: planned
    parallel_safe_files:
      - "docs/STEWARD_PROMPTS.md"
      - "docs/STEWARD_USAGE.md"
      - "docs/adr/vessel/ADR-019-steward-v0-contract.md"
    depends_on: ["steward-v05-r1-worker-signal-fileflag"]
    note: "Steward 收线协议改：worker 开 PR + 写 done flag，主线人工 review 后 merge；docs/research 分支 CI 过+branch protection 通过可 auto-merge。proposal §5 R2"
    refs: ["pr:#53", "proposal:STEWARD_PARALLEL_MECHANISM_EVAL.md"]

  - id: m2-voice-proposal
    title: M2-Voice Capability 设计提案
    priority: P2
    size: M
    status: planned
    assigned_kind: main
    parallel_safe_files: ["docs/proposals/"]
    depends_on: []
    note: "调研 whisper-large > 500MB 走 worker subprocess (ADR-012)；写到 docs/proposals/M2-VOICE-CAPABILITY.md；可并行候选"

  - id: ai-coding-agent-execution-control-survey
    title: 在 AI coding agent (Claude Code / Cursor / Aider / Windsurf / OpenHands 等) 项目里如何精确控制每一个执行过程
    priority: P2
    size: L
    status: in_progress
    assigned_kind: worktree
    assigned_cwd: ~/Desktop/Vessel-coding-agent-survey
    parallel_safe_files: ["docs/proposals/"]
    depends_on: []
    note: "用 /survey skill Deep 模式 (Claude × 2 + cursor-agent gpt-5.5-medium 异构) 调研 5+ AI coding agent 的执行控制机制；输出 docs/proposals/AI_CODING_AGENT_EXECUTION_CONTROL.md；走 Steward V0.4 即时代办 spawn 路径 (PR #51)"

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
    blocked_reason: "R1 file flag (steward-v05-r1) 覆盖了 worker→master 完成场景；通用 cross-session push 仍无 specific use case"
    parallel_safe_files: ["packages/backend/src/routes/inbox.ts"]
    note: "Inbox 加 target=sessionId|worktreeName 字段；现在 R1 Layer 2 mirror 用 inbox 但只走完成信号，通用 push 等具体场景再开"

  - id: steward-v05-r3-trajectory-persist
    title: R3 worker trajectory 持久化 (Steward V0.5+)
    priority: P3
    size: M
    status: blocked
    blocked_reason: "观察 2-3 周真实并行 dogfood 之后再决定优先级；OpenHands trajectory 是参考实现"
    parallel_safe_files:
      - "packages/backend/src/routes/sessions.ts"
      - "docs/STEWARD_USAGE.md"
    note: "worker session jsonl 落 ~/.vessel/trajectories/<task-id>/ 供 retrospective；proposal §5 R3。**前置 gate**: 至少 3 次真实并行 task 之后人工评估"
    refs: ["pr:#53"]

  - id: steward-v05-r4-sandbox-staging
    title: R4 sandbox-staging 探索 (Steward V0.5+, 远期)
    priority: P3
    size: L
    status: blocked
    blocked_reason: "Plandex 的 plan/context branches 是参考；Vessel 当前 worktree 隔离已 cover 80% 场景，sandbox 引入复杂度需 specific use case 驱动"
    parallel_safe_files: []
    note: "worker 改动落 sandbox branch，主线决定是否 promote；proposal §5 R4。**前置 gate**: R1+R2 ship 后观察 worktree 隔离是否仍有 leakage"
    refs: ["pr:#53"]
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
