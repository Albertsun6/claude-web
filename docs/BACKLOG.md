# Vessel Backlog

**最近更新**: 2026-05-14T00:00:00Z
**Steward 启动仪式**: 见 [`docs/STEWARD_PROMPTS.md`](STEWARD_PROMPTS.md) 或 [`docs/STEWARD_USAGE.md`](STEWARD_USAGE.md)
**Schema 契约**: [`docs/adr/vessel/ADR-019-steward-v0-contract.md`](adr/vessel/ADR-019-steward-v0-contract.md)
**Source-of-truth**: 本文件是唯一写入点（I1）；`status` 字段是状态唯一权威（I10）；section header 仅人眼导航

---

## Active (planned / in_progress)

```yaml
items:
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

  - id: aisep-v2-implement
    title: AISEP v2 fan-in 实施 (aisep-protocol@0.4.0 + schema + scheduler + runner + cli + report + migrate util)
    priority: P2
    size: XL
    status: in_progress
    assigned_kind: main
    since: 2026-05-14T00:00:00Z
    parallel_safe_files: ["packages/aisep-protocol/", "packages/aisep-core/", "packages/aisep-cli/"]
    depends_on: ["pr:#75-merge"]
    note: "实施 ADR-022 5 个 decision；Pilot-12 dogfood 9 条 ship 条件；目标 ship 2026-06-30。Review trail Phase 1+2+3+R2 都 CLEAR-TO-SHIP。主窗口自做 (2026-05-14 用户决策 spawn→stay)；按螺旋 7 切片推进。"
    refs: ["adr:022", "pr:#75", "proposal:aisep-v2-fan-in.md"]

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

  - id: ai-coding-agent-execution-control-survey
    title: AI coding agent (Claude Code / Cursor / Aider / Windsurf / OpenHands 等) 执行控制机制横向调研
    status: done
    completed_at: 2026-05-12T03:30:00Z
    refs: ["pr:#55", "pr:#52", "commit:de249c2"]
    note: "/survey Deep + hetero + strict 跑 9 工具 × 7 维度，~100 sources，Phase 6 cursor-agent verdict Refine。worktree ~/Desktop/Vessel-coding-agent-survey 已 pre-remove (eva.json done)"

  - id: steward-v05-r1-worker-signal-fileflag
    title: R1 worker→master signaling — file flag canonical (Steward V0.5)
    status: done
    completed_at: 2026-05-12T04:00:00Z
    refs: ["pr:#54", "pr:#53", "adr:019", "proposal:STEWARD_PARALLEL_MECHANISM_EVAL.md"]
    note: "scripts/steward-signal-done.sh (worker writer) + scripts/eva-collect.mjs + pnpm eva:collect (master reader); 新不变量 I12 进 ADR-019; ~/.vessel/spawn-done/<id>.json schema vessel-spawn-done-v1"

  - id: steward-v05-r2-worker-pr-no-auto-merge
    title: R2 worker open PR + signal, code 不默认 auto-merge (Steward V0.5)
    status: done
    completed_at: 2026-05-12T04:00:00Z
    refs: ["pr:#54", "pr:#53", "adr:019"]
    note: "纯协议 + 文档：代码改动 worker 开 PR + signal 但不 auto-merge；docs/research 类 worker 标 'ready for auto-merge' 主线确认后 gh pr merge --auto。新不变量 I13 进 ADR-019"

  - id: testflight-encryption-compliance
    title: TestFlight Build 49 加密合规对话框
    status: done
    completed_at: 2026-05-12T04:10:00Z
    refs: ["pr:#42"]
    note: "App Store Connect → Seaidea → TestFlight 加密信息填完（HTTPS/WSS 走默认豁免）"

  - id: testflight-install-verify
    title: TestFlight Build 49 装到 iPhone 验证
    status: done
    completed_at: 2026-05-12T04:10:00Z
    refs: []
    note: "iPhone TestFlight app 接受邀请 + 安装 + 首启动 backend 连通验证通过"

  - id: project-health-check-2026-05-12
    title: 项目健康度检查 (S 快速版 — git / CI / 基础设施 三维)
    status: done
    completed_at: 2026-05-12T04:30:00Z
    refs: ["retro:docs/retrospectives/HEALTH_CHECK_2026-05-12.md"]
    note: "1 BLOCKER (test:cli cleanup race) + 2 MAJOR (eva.json drift / 3 launchd backends) + 3 MINOR (untracked files / 本地 branch). 修复 spawn 独立 backlog 项"

  - id: installer-auto-build-ci
    title: Vessel-Backend .pkg 自动构建 — push tag 触发 GitHub Actions → 自动 release
    status: done
    completed_at: 2026-05-12T05:30:00Z
    refs: ["pr:#59", "pr:#60", "release:v0.8.2", "commit:b90677f"]
    note: "release.yml 加 build-pkg job (macos-15 arm64 runner) → bash scripts/build-pkg.sh → gh release upload --clobber。验证：v0.8.2-rc1 测试 + v0.8.2 正式 release，2m55s/2m50s wall。CI pkg 10425 文件，比本地 20965 干净 (无 ._ AppleDouble 资源叉)。Intel x64 / code signing 留作后续 backlog"

  - id: installer-auto-update
    title: Vessel-Backend .pkg 自动更新机制 — backend GitHub-API polling + frontend banner (方案 B)
    status: done
    completed_at: 2026-05-12T06:00:00Z
    refs: ["pr:#61", "commit:bbcebff"]
    note: "选 B：后端 /api/version/latest 6h-cached GitHub Releases API；frontend UpdateBanner.tsx 启动时 fetch，hasUpdate=true 显示蓝色 banner + 下载链接 + per-tag dismiss。方案 A (Sparkle) / C (一键 DL) / iOS native UpdateBanner 留单独 backlog"

  - id: aisep-bootstrap-v0-v1
    title: AISEP bootstrap — v0 线性 10 阶段链路 + v1 静态 fan-out + Option E HTML 报告
    status: done
    completed_at: 2026-05-13T08:53:00Z
    refs: ["pr:#68", "tag:aisep-bootstrap-merged-2026-05-13", "commit:b31e341"]
    note: "43 commits 合入 dev：6 个 @vessel/aisep-* TypeScript 包 (protocol/core/workspace/agents/memory/cli) + aisep-protocol@0.3.0 wire format + Pilot-10b 10/10 真业务 dogfood + 334 tests 0 dep-cruiser violations + F1/F2/F6 (claude --print timeout + burst-limit retry)。Phase 2.F 残留 F3/F4/F5 (timeout retry / incremental render hint / cli --help smoke test) 单独 backlog；v2 fan-in proposal target 2026-06。rebase 期间统一 namespace @claude-web/aisep-* → @vessel/aisep-* 跟 PR #39 Vessel kernel 对齐。"
```
