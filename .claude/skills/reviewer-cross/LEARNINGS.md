# vessel-cross-reviewer Learnings

本文件记录"独立 cross-review"中沉淀下来的可复用判断规则。每次跑完 vessel-cross-reviewer 后，**只追加**经过本次评审验证、以后还能复用的经验。

每次最多追加 3 条。冲突时保留两条 + 写明边界。

---

## 初始（2026-05-09）— 空起步

待 dogfood 后第一次累积。

模板：

```markdown
## YYYY-MM-DD (artifact-name)

### N. <规则一句话>

- **来源**：docs/reviews/<artifact>-cross-<TS>.md <finding-id>
- **触发场景**：什么类型的 artifact / 改动会触发此规则
- **规则**：具体应该怎么判断 / 怎么 enforce
- **边界**：什么情况下例外
```
