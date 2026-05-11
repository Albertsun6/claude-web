# Secrets and Test Tokens Log

> **Policy**（E2 owner 决策 2026-05-09）：发现 token / secret / test token / 示例 token 时**不打断当前工作**，**必须在此 log 记录**。如为了复现必须保留值，放到 `.gitignore` 覆盖的本地文件（如 `instance/`、`.env.local`），**不要提交到 git**。所有未"removed"或"approved-for-public"的条目，**v0.1 release / 公开发布 / 分发 / 上架前必须集中清理**。
>
> **Hard Stop（不延后）**：**真实 production secret**（如 owner 自己的 API key 直接 commit）→ 仍触发 4 类硬触发 #5 escalation owner 立即处理。
>
> **Scope**：
> - ✅ test token / 示例 token / fixture token → 此 log（defer 到 release 前）
> - ✅ 借鉴代码里出现的 license header / 作者信息 → THIRD_PARTY_LICENSE_LOG.md
> - 🚨 真实 production API key / OAuth token / 数据库密码 → 立即 escalation
>
> **配套**：[ADR-014 §「Escalation #5 secrets」](../adr/vessel/ADR-014-review-workflow.md) + [ADR-013 §「Stage 5 secrets re-scan」](../adr/vessel/ADR-013-rename-strategy.md) + [RISKS R-06a](../design/RISKS.md)
>
> **Tooling**：`gitleaks detect --no-git --source .` + `gitleaks detect --source .`（含 git 历史）

---

## 字段定义（每条记录必填）

| 字段 | 说明 |
|---|---|
| **id** | `SEC-NNN`（递增编号） |
| **date** | 发现日期 YYYY-MM-DD |
| **detector** | `gitleaks` / `trufflehog` / `manual` / `cursor-cross-review` / 等 |
| **source** | 来源项目 / commit / 文件路径 |
| **path** | 在 Vessel 仓库中的相对路径（**不要直接贴值**，仅引用位置） |
| **type** | `api-key` / `oauth-token` / `password` / `private-path` / `email` / `cert` / 其他 |
| **classification** | **`real-production`**（立即 escalation）/ `test-token` / `example-token` / `fixture-token` / `false-positive` / `borrowed-code-leftover` |
| **in-git-history** | `yes` / `no`（gitleaks `--source .` 命中是 yes） |
| **purpose** | 为什么存在 |
| **expiry** | 处理期限（默认 `before-v0.1-release`；real-production 立即） |
| **status** | `recorded` / `replaced-with-env-var` / `moved-to-gitignored` / `removed` / `false-positive-confirmed` / `approved-for-public` |
| **notes** | owner 备注 |

---

## 状态汇总

- **active（待处理）**：0
- **resolved**：0
- **real-production-found**：0（**应该永远 = 0**；非 0 = 4 类硬触发 #5 escalation）
- **总条目**：0

---

## 0B Stage 5 gitleaks 扫描结果（2026-05-10）

**Scope**：Vessel 仓库全量（含从 Eva 继承的 git 历史 241 commits / 5.40 MB）。
**Tooling**：`gitleaks detect --source . --report-format json --exit-code 0`。
**结果**：`no leaks found`（241 commits scanned, 1.31s）。

**判断**：Eva 历史无残留 secret 命中；Vessel 0B 引入的新文件（5 接口 stub / observability/trace.ts / startup-env-check.ts / migrate-eva-to-vessel.ts / REFERENCES.md）也无命中。

**未来变化触发**：每次重要里程碑 closeout 前重新跑 gitleaks；命中 → 按本 log 模板追加条目；real-production 命中 → 4 类硬触发 #5 escalation。

---

## 日志（按时间倒序）

_（暂无 active 条目。）_

### 模板

```markdown
### SEC-001 — <type> in <path>
- **id**: SEC-001
- **date**: YYYY-MM-DD
- **detector**: gitleaks | trufflehog | manual | cursor-cross-review
- **source**: <借鉴的项目 URL / commit / 来源说明>
- **path**: `<relative-path-in-vessel>`
- **type**: api-key | oauth-token | password | private-path | email | cert
- **classification**: test-token | example-token | fixture-token | false-positive | borrowed-code-leftover
- **in-git-history**: yes | no
- **purpose**: <为什么存在>
- **expiry**: before-v0.1-release
- **status**: recorded
- **notes**: <owner 备注，如"已用 env var 替代但旧 commit 残留"或"是 npm package 公开 demo key"等>
```

---

## Real-Production Escalation 协议

如发现 `classification: real-production`：

1. ❌ **不**写入此 log（log 是 defer 用的）
2. ✅ 立即写 `instance/inbox/<TS>-real-secret-found.md`
3. ✅ 触发 4 类硬触发 #5 escalation
4. ✅ owner 立即处理：① 撤销 token（如 OpenAI dashboard / GitHub PAT）② `git filter-repo` 清理历史 ③ force push（如已上 GitHub）④ 备份 mirror

---

## Release Gate（v0.1 release 前必须满足）

```bash
# 1. 无 real-production 条目（应该恒成立，否则失败）
test "$(grep -c 'real-production' SECRETS_AND_TEST_TOKENS_LOG.md)" = "0"

# 2. 所有非 false-positive / approved 条目都已处理
grep -c "status: recorded" SECRETS_AND_TEST_TOKENS_LOG.md            # 应该 = 0
grep -c "status: moved-to-gitignored" SECRETS_AND_TEST_TOKENS_LOG.md # 应该 = 0（已搬到 .gitignored 但仍要核实）

# 3. final gitleaks scan clean
gitleaks detect --source . --no-banner | tail -1 | grep -q "no leaks found"
```

未通过 → 4 类硬触发 #5 release-gate escalation owner 处理。

---

## Quick reference: 常见 false-positive 模式

| 模式 | 是否 false-positive | 备注 |
|---|---|---|
| `sk-test-...`（Stripe test token） | ✅ false-positive | 公开测试 key，无风险 |
| `sk-XXXXX...`（占位符） | ✅ false-positive | 文档示例 |
| `AKIA0000...`（占位符 AWS） | ✅ false-positive | 全 0/X 字符 |
| `<your-api-key>`（占位符） | ✅ false-positive | 字面占位 |
| `https://example.com/<token>`（占位符 URL） | ✅ false-positive | 文档 URL |
| 真实 `sk-ant-...` (~50+ 字符 base64-like) | 🚨 real-production | 立即 escalation |
| 真实 `ghp_...`（GitHub PAT） | 🚨 real-production | 立即 escalation |
