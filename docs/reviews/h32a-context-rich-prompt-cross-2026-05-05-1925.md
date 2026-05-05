`cursor-agent --print -p /tmp/h32a-cross-prompt.md` 被环境拒绝了，所以我没有生成 `docs/reviews/*.md` 文件。下面是我按同一份 `reviewer-cross` prompt 做的静态 verdict。

## Summary
- Blockers: 1
- Majors: 2
- Minors: 1
- 总体判断：必须先修 B1；M1/M2 建议同轮修掉。

## Numeric Score
| Lens | Score |
|---|---:|
| 正确性 | 2.5 |
| 跨端对齐 | 4.0 |
| 不可逆 | 3.5 |
| 安全 | 3.5 |
| 简化 | 3.0 |

Overall score: 3.3，有 blocker，上限 3.9。

## Findings
### B1 [BLOCKER] ContextBundle DB row 先提交，snapshot rename 后失败会留下坏引用
**Where**: `packages/backend/src/context-manager.ts`

```242:263:packages/backend/src/context-manager.ts
  writeFileSync(tmpPath, snapshot, "utf-8");

  let row;
  try {
    row = createContextBundle(db, {
      id: bundleId,
      taskId: input.taskId,
      artifactRefs,
      maxTokens: TOTAL_CHAR_BUDGET,
      prunedFiles,
      summary,
      snapshotPath,
    });
  } catch (err) {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
  try {
    renameSync(tmpPath, snapshotPath);
  } catch (renameErr) {
```

**Issue**: `context_bundle` row 已经插入后，`renameSync` 失败会留下指向不存在 `snapshotPath` 的 DB row。  
**Why blocker**: 这正好破坏 prompt 里重点要求的 “ContextBundle 持久化原子性”。后续 task / audit 看到的是已创建 bundle，但 snapshot 不存在。  
**Suggested fix**: 先 `write tmp -> rename final`，再插入 DB；如果 DB insert 失败，删除 final snapshot。或者在 `rename` catch 里同步删除 `context_bundle` row，但前者更简单。

### M1 [MAJOR] strategy 没产出 spec 仍会被 approved，失败被推迟到 implement
**Where**: `packages/backend/src/scheduler.ts`

```237:244:packages/backend/src/scheduler.ts
    // Stage 完成：用 "approved" 表示 M1 无 review gate 的完成状态
    setStageStatus(this.db, stage.id, "approved");

    // M2 v1 (3.2-A')：strategy stage 完成后扫 docs/specs/<issue.id>.md 存为 spec artifact
    // implement stage 通过 ContextManager listArtifactsForIssue 自动读到 — 无需 fs lookup
    if (stage.kind === "strategy") {
      this.harvestSpecArtifact(issue, stage, cwd);
```

**Issue**: `harvestSpecArtifact` missing 只 warn，不 fail；但 implement 的 `mustHave=["spec"]` 会 fail-loud。  
**Why major**: strategy 的 declared output 是 spec，没产出时却被标 approved，会制造一个“已通过但不可执行”的流水线状态。  
**Suggested fix**: strategy 阶段应在 `approved` 前 harvest；missing / createArtifact 失败时抛错并让 stage 进入 `failed`。

### M2 [MAJOR] mustHave artifact 不受总预算约束，多个 spec 会突破 16000 char invariant
**Where**: `packages/backend/src/context-manager.ts`

```134:154:packages/backend/src/context-manager.ts
  // mustHave first — 不削 budget，缺则 throw
  for (const kind of selector.mustHave) {
    const matches = artifacts.filter((a) => a.kind === kind && a.superseded_by === null && a.content_text !== null);
    if (matches.length === 0) {
      throw new Error(
        `ContextBundleMissingMustInclude: stage='${stageKind}' kind='${kind}'. ` +
          `Resolve by re-running prior stage that produces this artifact, or marking issue wont_fix.`,
      );
    }
    for (const a of matches) {
      const cut = truncate(a.content_text!, ARTIFACT_PER_ITEM_MAX);
```

**Issue**: 每条 mustHave 最多 8000，但所有 mustHave 合计不检查 `remainingBudget`。如果有两个 unsuperseded spec，prompt 会超过 `TOTAL_CHAR_BUDGET=16000`。  
**Suggested fix**: mustHave 仍优先，但要记录 `must-have-over-budget`，并定义超预算策略：保留最新 spec、或 fail-loud 要求先 supersede 旧 spec。

### m1 [MINOR] `SPEC_HARVEST_MAX_BYTES` 实际按 JS 字符数裁剪
**Where**: `packages/backend/src/scheduler.ts`

```25:27:packages/backend/src/scheduler.ts
/** Cap spec.md content size when harvesting (M2 v1 3.2-A')。
 *  > 16KB 的 spec 不正常，先削，记到 audit log。M3 上 token-aware budget 时去掉。 */
const SPEC_HARVEST_MAX_BYTES = 16384;
```

**Issue**: 后面用的是 `raw.length` 和 `slice`，不是 `Buffer.byteLength`。中文 spec 可能明显超过 16KB bytes。  
**Suggested fix**: 要么改名为 `SPEC_HARVEST_MAX_CHARS`，要么按 UTF-8 bytes 裁剪。当前 v1 用 char budget 的话，改名更一致。
