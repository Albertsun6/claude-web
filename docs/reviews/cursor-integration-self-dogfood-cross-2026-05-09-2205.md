我会按你给的 Phase 1 输入直接做只读评审，不改文件；下面会严格用 verdict markdown 输出，并把不确定项放进 False-Positive Watch。# Cross Review — ADR-017 cursor-cli-cross-reviewer

**Reviewer**: vessel-cross-reviewer  
**Model**: gpt-5.5-medium (via cursor-agent CLI)  
**Date**: 2026-05-09 22:05  
**Files reviewed**:
- `docs/adr/vessel/ADR-017-cursor-cli-cross-reviewer.md`
- `.claude/skills/reviewer-cross/SKILL.md`
- `scripts/cursor-review.sh`
- `docs/research/cursor-cli-cross-reviewer-2026-05-09.md`

---

## Summary

- Blockers: 0
- Majors: 3
- Minors: 4
- Lens 5 findings: 2
- 总体判断：建议小改后合并

## Numeric Score

| Lens | Score (0..5) |
|---|---|
| 正确性 | 3.8 |
| 跨端对齐 | 3.6 |
| Eva 改造 + Vessel 硬约束 | 4.0 |
| 安全 + 4 类硬触发 | 3.4 |
| 集体盲区检测 | 3.6 |

**Overall**：3.7

## Findings

### M1 [MAJOR] self-dogfood 成功标准会奖励 false positive

**Where**: `docs/adr/vessel/ADR-017-cursor-cli-cross-reviewer.md` §「验证」  
**Lens**: 1, 5  
**Issue**: ADR 要求 self-dogfood 必须让 cursor 找出至少 1 条 BLOCKER/MAJOR 来证明异质性有效。  
**Why this is major**: 这和 SKILL 里的 “认 false positive 合法”“5 lens 都搜了 0 finding 也要明说”冲突，会把 reviewer 训练成故意打高严重度问题。异质性的证据应该是独立评审过程有效，而不是必须产出重大问题。  
**Suggested fix**: 把验证标准改成：cross verdict 文件存在、5 lens 都覆盖、Lens 5 至少尝试、findings 被 Phase 2/3 正常分类；不要要求必须出现 BLOCKER/MAJOR。

### M2 [MAJOR] prompt 外发前没有本地脱敏/拒绝门禁

**Where**: `scripts/cursor-review.sh` §「拼装 prompt」；`docs/adr/vessel/ADR-017-cursor-cli-cross-reviewer.md` §「负面」②；`docs/research/cursor-cli-cross-reviewer-2026-05-09.md` §9  
**Lens**: 4  
**Issue**: 脚本会把 SKILL、LEARNINGS 和 artifact 原文完整拼进 prompt 发给 cursor-agent，但没有执行 secrets/private-path/token-like 字符串检查。  
**Why this is major**: ADR 已承认 prompt 会发到 Cursor 服务器；本次 research artifact 里已经包含 `/Users/yongqian/...` 这类私人路径。未来评审 trace/spec 时，如果混入 token、私有路径、用户 prompt，脚本不会阻止外发。  
**Suggested fix**: 在 `cursor-agent` 调用前加一个只读 preflight：至少检查 token-like pattern、绝对用户路径、`.env`/credential 文件名；命中时退出并提示先脱敏。也可以要求调用者显式传 `--allow-private-paths` 才继续。

### M3 [MAJOR] 版本兼容性“缓解”只写了打印版本，没有真正检查参数可用

**Where**: `docs/adr/vessel/ADR-017-cursor-cli-cross-reviewer.md` §「负面」③；`scripts/cursor-review.sh` `CURSOR_VER=$(cursor-agent --version 2>&1 | head -1)`  
**Lens**: 1, 3  
**Issue**: ADR 说脚本启动时检查 `cursor-agent --version`，如不兼容输出警告；实际脚本只打印版本，没有验证 `--mode plan`、`--model gpt-5.5-medium`、`--output-format text` 是否仍受支持。  
**Why this is major**: 这个脚本是治理流程入口。如果 Cursor CLI 参数变更，失败会发生在正式评审阶段，而且错误不会被归类成“版本不兼容”。  
**Suggested fix**: 加一个 dry-run/help 检查，例如解析 `cursor-agent --help` 是否包含关键 flag，或失败时输出明确的兼容性诊断和人工回退步骤。

### m1 [MINOR] project-level 与 user-level SKILL 路径叙述不一致

**Where**: `docs/adr/vessel/ADR-017-cursor-cli-cross-reviewer.md` §「文件结构」；`docs/research/cursor-cli-cross-reviewer-2026-05-09.md` §6  
**Lens**: 2, 3  
**Issue**: ADR 和脚本采用项目内 `.claude/skills/reviewer-cross/SKILL.md`，但 research 迁移路径写“`~/.claude/skills/reviewer-cross/SKILL.md` 已是用户级跨项目共享，直接用，无新文件”。  
**Suggested fix**: 统一为项目级 SKILL 是 source of truth；用户级 Eva skill 只作为 prior art，不作为 Vessel runtime path。

### m2 [MINOR] research 对 prompt 传入方式描述和脚本不一致

**Where**: `docs/research/cursor-cli-cross-reviewer-2026-05-09.md` §2；`scripts/cursor-review.sh` §「调用 cursor-agent」  
**Lens**: 2  
**Issue**: research 写“prompt 通过 stdin (cat 临时文件) 传入”，但实际脚本是把 `$(cat "$PROMPT_FILE")` 作为 positional argument。  
**Suggested fix**: 把 research 改成“通过 positional argument 传入”，避免以后维护者按 stdin pipe 重写导致行为变化。

### m3 [MINOR] `artifact-name` 没有限制字符，输出路径可被意外改写

**Where**: `scripts/cursor-review.sh` `OUTPUT_FILE="docs/reviews/${ARTIFACT_NAME}-cross-${TS}.md"`  
**Lens**: 4  
**Issue**: `artifact-name` 直接拼进路径；如果传入 `../x`、包含斜杠或空格，输出位置会偏离预期或失败。  
**Suggested fix**: 限制 `ARTIFACT_NAME` 只允许 `[A-Za-z0-9._-]+`，不符合就退出 64。

### m4 [MINOR] Lens 5 找到一个 over-cautious 痕迹：Phase 2 “至少 1 条 disagree/refine”可能制造形式分歧

**Where**: `.claude/skills/reviewer-cross/SKILL.md` §「Independence Constraints」6  
**Lens**: 5  
**Issue**: Phase 2 要求至少一条 disagree/refine，否则自动 escalate “phase 2 信号弱”。  
**Suggested fix**: 可以保留“全 agree 需要解释为什么不是橡皮图章”，但不要硬性要求制造 disagree/refine；否则简单 artifact 会被迫产生低质量分歧。

## False-Positive Watch

- F? M2 的“私人路径外发”是否算必须修的安全问题，取决于 Vessel 是否把本机绝对路径也纳入 trace-redaction-spec 的硬脱敏范围；如果仅把 token/password 视为 secrets，则可降级为 MINOR。
- F? M3 假设 Cursor CLI 参数未来可能变化；如果团队接受“脚本失败即人工修复”，可降级为 MINOR，但 ADR 当前已经承诺了启动检查，所以仍建议修。

## What I Did Not Look At

- 没有读取真实仓库文件，只评审了用户提供的 artifact 内容。
- 没有运行 `cursor-agent --help`、`cursor-agent --version` 或脚本。
- 没有运行 gitleaks、pnpm audit、license scan。
- 没有检查 Swift Codable、SQLite migration、TypeScript interface；v5.4 lite 当前 artifact 仍是 ADR/SKILL/script 阶段。
