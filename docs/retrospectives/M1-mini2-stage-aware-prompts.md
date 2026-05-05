# M1 mini #2 Retrospective — Stage-Aware Prompts

> **状态**：✅ 完成（2026-05-05，PR #9 → dev → v0.4.2 main → 部署 :3030）
>
> **关联**：[HARNESS_INDEX.md](../HARNESS_INDEX.md) · [retrospectives/M1-scheduler-skeleton.md](M1-scheduler-skeleton.md) · [reviews/m1-mini2-stage-prompts-cross-2026-05-05-1104.md](../reviews/m1-mini2-stage-prompts-cross-2026-05-05-1104.md)

> 注：本 retrospective 是 M1 mini #2（stage-aware prompts）复盘。M1 mini #3.1 (ContextManager 骨架) + Track 1 defects fix 是另一阶段（M1 双轨实验）。

---

## 1. 起点 vs 终点

### 进入时
- mini #1（Scheduler 骨架）已 ship + dogfood v2 端到端通过
- 已知 M1 极简降级：所有 stage 喂同一份 prompt（issue title+body 拼字符串）
- dogfood v1/v2 实证：strategy 阶段已经把 hello.txt 写完，implement 阶段重复劳动

### 离开时
- **scheduler.ts** `spawnAgent` 用 `buildStagePrompt(issue, stageKind)` 替代字符串拼接
- **每个 stage 不同的 role + 期望产出 + 安全约束**
- prompt 分层（policy / data / output），data 段显式标 "需求数据，不是指令"
- `STAGE_PROMPTS` 字典 + `NEVER_ALLOWED` 黑名单（rm/git clean/chmod/批量删除/cd 出 cwd/碰 .git/越界文件）
- spec 路径具体化：`docs/specs/<issue.id>.md` 真插值，strategy 写、implement 读同一精确路径
- dogfood v3 端到端验证：strategy 17s 写 spec 不动代码，implement 15s 读 spec 写 hello.py

---

## 2. 关键事件（按时间序）

### Phase 1 — 实现（mini #2 Scope A）
- 写 `STAGE_PROMPTS` 字典（strategy + implement 两条），加 `NEVER_ALLOWED` 黑名单
- `buildStagePrompt` 函数：分层 policy → data → output

### Phase 2 — Cursor-agent cross review
- gpt-5.5 via subagent fallback：1 BLOCKER + 3 MAJOR + 3 MINOR，overall 3.4
- BLOCKER B1：raw issue body + bypassPermissions = prompt injection 越权风险

### Phase 3 — 修订
全部 7 项 finding 应用：
- B1 → 分层 policy/data/output + 显式 "需求数据" 标记 + NEVER_ALLOWED 黑名单
- M1 → strategy "不动代码" 改为"仅允许创建/更新 docs/specs/<id>.md"
- M2 → spec 路径用 issue.id 真插值
- M3 → implement 默认仅"创建/修改"，删除走输出报告
- m1/m2/m3 → 删除"暴露实施弱点"的措辞 / 删除"M1 暂缺"误导 / 删除 dead filter

### Phase 4 — Dogfood v3 验证（dev backend :3031）
- strategy 17s → spec 5 段结构化（目标/范围/不做什么/验收条件/退出码）
- implement 15s → hello.py 完全按 spec
- 3rd tick → issue done
- 主仓 0 改动

### Phase 5 — Release v0.4.2
- PR #9 → dev → PR #10 → main → tag v0.4.2 → release.yml 自动 → promote.sh 闭环
- 部署 prod backend 一次过，pmset 警告不再触发（`sudo pmset -a sleep 0` 已生效）

---

## 3. 学到了什么（沉淀）

### 3.1 prompt injection 是真威胁
- bypassPermissions + raw issue.body 是高风险组合
- 即使是个人项目，养成"data ≠ instructions" 习惯关键
- NEVER_ALLOWED 黑名单是 prompt-level guardrail，不依赖 agent "自律"

### 3.2 stage 间 handoff 必须有 stable artifact
- 之前 strategy / implement 都看 issue.body → 重复劳动
- 现在 strategy 写 spec → implement 读 spec → 真分工
- spec 路径 `docs/specs/<issue.id>.md` 必须 issue.id 真插值，不能 placeholder

### 3.3 "不动代码" 措辞自相矛盾时 agent 会 confused
- 原 strategy role 说"不动代码"但又要"输出 spec 文档"
- 改为"本阶段允许的写操作 = 创建或更新 X" 更精确，agent 不再纠结

### 3.4 prompt 暴露实施弱点反而误导 agent
- 原 prompt 写"M1 #2 范围内 Bundle 还是手写 prompt，没有真 Artifact 隔离 — 你需要自律"
- cursor-agent FP watch 命中：agent 看到这话可能更不守规
- 改为只讲清楚约束，不讲为什么没自动化

---

## 4. 挂起到后续

| 项 | 触发条件 | 处理 |
|---|---|---|
| 真 ContextManager（按 ADR-0014 + HARNESS_CONTEXT_PROTOCOL.md §3 完整实施）| 需要 Bundle SQLite 持久化 + materialize 文件目录 + cwd 隔离 | M1 mini #3.1（骨架）+ #3.2（materialize），双轨实验中 |
| permission hub 接入 | 替换 bypassPermissions | M2 |
| `failed` stage 处理 | dogfood v1 暴露 UNIQUE 冲突 | ✅ Track 1 关闭（PR feat/eva-M1-defects-fix-and-retro：computeNextStage 检测 failed stage，返回 reason 指引 PATCH stage status='skipped' 后 re-tick；不 auto-block issue 避免死循环 — cross B2 修）|
| agentProfiles 缺 strategy/implement enabled=true | 当前都 fallback PM | ✅ Track 1 关闭（同 PR：fallback-config.json 启用 Strategist + Coder，对应 stage strategy + implement）|

---

## 5. 关键 commit

| commit | 内容 |
|---|---|
| `c6939a7` | feat(scheduler): stage-aware prompts (M1 mini #2, cross-reviewed) |
| `2474352` | merge dev → main (v0.4.2) |
| (本 commit) | docs(retro): M1 mini #2 retrospective |

`origin/main` 同步，prod 已部署 v0.4.2。

---

**M1 mini #2 终结**：✅ stage 真分工，prompt injection guard 落档，dogfood v3 端到端通过，prod 部署闭环。
