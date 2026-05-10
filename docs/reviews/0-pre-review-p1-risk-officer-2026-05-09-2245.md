# Phase 1 Verdict — vessel-risk-officer

- **Artifact**: 0-pre 6 产物
- **Phase**: 1 (isolated)
- **Role**: vessel-risk-officer
- **Date**: 2026-05-09 22:45
- **Lens**: 风险登记 / 安全 / 失败模式 / 可观测性 / 4 类硬触发

---

## BLOCKER（2 条，均含硬触发命中）

### B-R1: 🚨 ADR-013 §3 方案 A 含 `rm -rf ~/Desktop/Vessel` 危险 runbook（4 类硬触发 #8）

**Where**: `ADR-013` §3 "处理方案" "A. 备份 Vessel/ docs/ 内容到 ~/Desktop/vessel-plan-backup-2026-05-09/ → mv claude-web → rm -rf ~/Desktop/Vessel → mv → 恢复"

**Issue**: ADR Status=Accepted 意味着 runbook 会被照做。`rm -rf ~/Desktop/Vessel` 是**破坏性数据迁移**（4 类硬触发 #8 命中）：
- 删除 docs/ 之外的内容（隐藏文件 / .git / 未来本地状态）
- 备份只覆盖 docs/ —— 漏掉非 docs 内容（如 .gitignore / instance/ / scripts/）
- 不可恢复

**与 cursor cross-reviewer B1 完全一致**——cursor 用 Lens 5 异质源也找出此 BLOCKER。**真集体盲区**：Claude（写 ADR-013）+ Claude pragmatist 都没看到，cursor 用 GPT-5.5 + Lens 5 抓到。

**Why blocker + escalation-required**: 触及 4 类硬触发 #8（破坏性数据迁移），按 ADR-014 必须 stop owner 确认。

**Suggested fix**:
- 删除方案 A（破坏性）
- 锁定方案 B（rsync + cp .git，不删源）
- ADR-013 §3 改成 "处理方案 = B（rsync 复制 + 保留源）"，A 整段移除
- 加 escape hatch："如确实需要删除老 Vessel/，必须先 mv 到 trash，且需 owner 显式 review-and-confirm"

### B-R2: 🚨 R-06 license 风险被 gitleaks 错误覆盖（4 类硬触发 #6 license）

**Where**: `RISKS.md` R-06 标题 "Eva license / 历史敏感数据" + mitigation 写 "gitleaks 全跑 clean"

**Issue**: 跟 cursor M4 finding 完全一致。R-06 把两个不同风险**强行合并**：
- secrets / API key 泄露 → gitleaks 能 detect
- license 风险（Eva 依赖 / 文档资产 license 是否可继承） → gitleaks **不能** detect

R-06 标 mitigated 是错误推论。license 是独立的 4 类硬触发 #6，需要 `pnpm licenses ls` / `license-checker` 工具单独扫。

**Why blocker + escalation-required**: 触及 4 类硬触发 #6（license 风险），不应被 secrets scan 推论 mitigate。

**Suggested fix**: 拆分 R-06：
- **R-06a**：Eva 仓库 secrets / 历史敏感数据 — Status=mitigated（gitleaks clean 2026-05-09）
- **R-06b**：Eva 依赖 license 兼容性（AGPL/SSPL 检测）+ Eva 文档资产 license 归属 — Status=active，缓解策略 = 0B 跑 `pnpm licenses ls` + `license-checker` + 文档资产手动 audit

---

## MAJOR（5 条）

### M-R1: ADR-013 改名 + 数据迁移 缺 secrets re-scan 触发条件

**Where**: `ADR-013` 整篇

**Issue**: 改名期间会 grep-replace 大量字符串，可能引入新的 secrets（比如改 env var 时漏写示例值）。0B 完成后必须 re-run gitleaks。

**Suggested fix**: ADR-013 §2 末尾加 "Stage 5 (0B 收尾): re-run `gitleaks detect --no-git --source .` 退出码 0；如有 finding → 4 类硬触发 #5 escalation"。

### M-R2: ML worker 启动失败「降级对应 capability」缺具体降级语义

**Where**: `ADR-012` §4 "标 capability unavailable / 通知用户"

**Issue**: pragmatist M-P4 也提到这个，risk lens 视角更严：
- "降级"具体怎么落地：拒绝 capability invoke 还是返回 mock/error？
- "通知用户"具体在哪：inbox / Web UI badge / iOS push？
- 失败重试策略：worker 启动失败一次就放弃 vs N 次重试？
- 安全风险：如果 worker 启动失败但被认为已启动（health check race），用户调 capability 会无声失败

**Suggested fix**: ADR-012 §4 加：
- Capability invoke 时 health check（每次调用前）；ok=true 才执行
- failure 路径：返回 `{ status: "capability_unavailable", reason: "<原因>" }` 给 caller
- 通知策略：写 inbox 文件 + 控制台 warn log（v1+ 加 UI badge）
- 重试：spawn 失败立即报错，不静默重试（避免假成功）

### M-R3: cursor M2 (migration 0004 复用) 同意 + 风险升级

**Where**: `EVA_TO_VESSEL_MAPPING.md` §1.5

**Issue**: cursor 已找出此 BLOCKER。risk lens 加固：
- v103 一旦 production 跑过（M1C-A 时），用户 DB 已 user_version=103
- M1C-B 时再加 embedding 表，schema_version 必须升 v104（不能"重填 v103"）
- 跨用户安装版本不一致时（owner 在不同机器跑不同 milestone）会导致 migration 不可逆

**Suggested fix**: 同 cursor M2 fix：拆 0004/0005/0006/0007；每个 milestone 独立 schema_version。

### M-R4: M1C-A workflow_state 序列化失败的安全风险

**Where**: `RISKS.md` 没单独列；`EVA_TO_VESSEL_MAPPING.md` §1.1 #5

**Issue**: scheduler.ts 加 workflow_state 持久化，**JSON 序列化 stage state**。如果某 stage 含敏感数据（user_prompt 全文 / token-like 字符串），会被 raw 写入 SQLite—— **隐私泄露**风险。

**Suggested fix**:
- 加 R-14：workflow_state 序列化 stage state 必须按 trace-redaction-spec.md 同等规则脱敏
- M1C-A acceptance 加：`workflow_state.serialized_state` 字段不出现 token-like / user_prompt 全文

### M-R5: iOS Bonjour `_vessel._tcp` 服务名 + 端口未在 RISKS 标可观测性风险

**Where**: `RISKS.md` R-05 / R-13 + `EVA_TO_VESSEL_MAPPING.md` #14, #31

**Issue**: Bonjour 自动发现把 vessel-core 服务名 `_vessel._tcp` 广播到本地网络——**任何同 Wi-Fi 的设备都能 discover**。如果用户在公共 Wi-Fi（咖啡馆 / 共享办公室），他人能看到 vessel-core 在跑。
- 不是直接漏数据（auth token 仍保护），但**暴露 service identity**
- 进一步：unauth port scan + brute force token

**Suggested fix**:
- 加 R-15：iOS Bonjour 服务广播暴露 vessel-core service identity；缓解 = 仅家庭 Wi-Fi 启用 Bonjour，企业/公共 Wi-Fi 自动 disable + 强制手填 IP；或加 mDNS 加密扩展
- M2-iOS acceptance 加：网络环境检测（SSID 白名单或 IP 范围检测）

---

## MINOR（3 条）

### m-R1: RISKS.md R-07 缓解策略写 "✅" 但实际是计划性 mitigation 不是 verified

**Where**: `RISKS.md` R-07 mitigation "已有 characterization tests（test-cli / test-e2e / test-stale-session / test-scheduler-* / test-auth / test-permission）✅"

**Issue**: ✅ 表示已验证。但实际 0-pre 没真跑这些测试（pragmatist m-P1 也提到没跑 `pnpm test:cli`）。"已有"≠"已通过"。

**Suggested fix**: ✅ 改成 ⏳，0B 第一步跑测试通过后再标 ✅。

### m-R2: cursor m3 (私人路径) 同意但 risk lens 视角更弱

**Where**: `EVA_INVENTORY.md` 全文 / `ADR-013` 全文

**Issue**: cursor m3 找出 `/Users/yongqian/...` 私人绝对路径。risk lens 视角：当前 Vessel 仓库是私有，path 暴露低风险；**但**未来开源时这是问题。

**Suggested fix**: 不阻塞 0-pre。0B / 开源前再批量改 `~/Desktop/...` 占位符。当前接受 + 标记到 R-15 "未来开源前清理私人路径"。

### m-R3: ADR-012 §4 启动失败 5 类原因清单完整但缺"无 Python venv"细分

**Where**: `ADR-012` §4 "首次启动失败模式 + 检测策略"

**Issue**: 5 类原因：
- 模型下载 / Python 版本 / pip install / 目录权限 / venv 没建好

但 venv 子项漏列：
- uv 不在 PATH
- venv 已建但 Python interpreter 损坏
- venv 在 home 但权限不对

**Suggested fix**: §4 加 venv 子原因（3 条）。

---

## Decision-required（无）

risk-officer 不抛 owner 决策；但 B-R1 + B-R2 是 4 类硬触发命中（#8 + #6），按 ADR-014 必须 stop owner 确认。

## Risk Callouts（4 类硬触发）

- 🚨 **B-R1（#8 破坏性数据迁移）**：ADR-013 §3 `rm -rf ~/Desktop/Vessel`——立即 stop
- 🚨 **B-R2（#6 license）**：R-06 误判 mitigated——拆分为 R-06a/R-06b
- ⚠️ **M-R5（隐私）**：iOS Bonjour 服务名暴露——M2-iOS 时落地缓解
- ⚠️ **M-R4（隐私）**：workflow_state 序列化敏感数据——M1C-A 落地脱敏

## What I Did Not Look At

- 没读其他 reviewer verdict（隔离评审）
- 没跑 `pnpm licenses ls` / `license-checker`（B-R2 缓解工具，但本次评审 scope 是 read-only）
- 没真跑 `pnpm test:cli` 验证 R-07
- 没扫 ADR-014 / ADR-015 / ADR-016 / ADR-017 secrets 风险（scope 限于 6 个 0-pre 产物）

## 总结

2 BLOCKER（均触硬触发） + 5 MAJOR + 3 MINOR。**最关键的两条 B-R1 / B-R2 都跟 cursor cross-reviewer 一致**——这是 B' 流程的成功示例：cursor 用 Lens 5 异质源率先找出，risk lens 后续从 4 类硬触发角度独立确认。Claude architect / pragmatist 都没看到这两条——**真异质性 + risk-officer 加固**双重保险。
