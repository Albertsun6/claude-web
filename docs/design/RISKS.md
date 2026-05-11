# RISKS — Vessel 风险登记表

> **Status**: v0-pre · 2026-05-09 · 含 R-01~R-13（13 条；超过 v5.4 plan 0A 完成判定的 11 条要求）
>
> **来源**：v5.4 plan 累计 + v5.4 dogfood P3 仲裁分流 + cursor self-dogfood 实证 + EVA_INVENTORY 已知架构债务

---

## 风险等级图例

- 🔴 **高**：实施 milestone 时大概率触发，需要前置缓解
- 🟠 **中**：可能触发，缓解策略到位即可
- 🟢 **低**：影响范围小，缓解成本低

---

## 风险登记表

| ID | 风险 | 可能性 | 影响 | 缓解策略 | 验证（Verification） | 归属里程碑 | 触发硬触发？ |
|---|---|---|---|---|---|---|---|
| **R-01** | CC CLI 不支持非交互模式 | 高 | 高 | Eva cli-runner 已踩过坑（已用 `--print` + stream-json）；保留 PTY 包装作 fallback | `cli-runner.test.ts` 跑通；`vessel-core "echo hi"` 退出码 0 | M0.5 | — |
| **R-02** | fastembed 模型下载失败（中国网络） | 中 | 中 | 提前缓存模型到 `~/.vessel/models/`；提供国内镜像；M1C-B health check 报具体原因 | M1C-B Acceptance：`vessel-core --health` 报"model download failed: <URL>"；`pgrep -f embedding_server.py` 返回有进程 | M1C-B | — |
| **R-03** | sqlite-vec 在 macOS arm64 编译失败 | 低 | 高 | 0B 阶段先 spike `pnpm install sqlite-vec`；备选 hnswlib | 0B Acceptance：`import { vec0 } from 'sqlite-vec'` 不报错 | M1C-B 前 spike | — |
| **R-04** | CC CLI 子进程 auth 不能复用 | 中 | 高 | Eva 已验证 `~/.claude/` 跨子进程；显式 `cwd` + `env`；test-auth.ts | `cli-runner.test.ts` mock fs 测 `auth.ts verifyAllowedPath`；真实 CC CLI integration test 一次 | M0.5 | — |
| **R-05** | iOS 真机网络发现 Mac vessel-core 失败 | 中 | 中 | Bonjour `_vessel._tcp` + 手填 IP fallback（M2-iOS Acceptance 必需） | iOS app 启动后 `NWBrowser` OK 或手填 IP+端口连接 OK；ping ≤ 100ms | M2-iOS | — |
| **R-06a** | 🟢 Eva 历史敏感数据（API key / token / 私人路径）— **policy 修订 2026-05-09（E2）：log-not-block + release gate** | 低（gitleaks clean） | 低（已 mitigation） | gitleaks 全跑 clean（工作树 218MB / 历史 201 commits 无 finding，2026-05-09 21:55）；ADR-013 Stage 5 持续 re-scan，**结果进 [SECRETS log](security/../../docs/security/SECRETS_AND_TEST_TOKENS_LOG.md)**；test/example token 不阻塞，release 前清理；**真实 production secret 仍立即 escalation** | 0B Stage 5 跑 gitleaks，结果写 SECRETS log（`real-production` 计数 = 0）；release gate 检查 log 全部 resolved | 0B（持续）+ release gate | ✅ #5 secrets（分类） |
| **R-06b** | 🟠 Eva 依赖 license 兼容性（AGPL/SSPL/BUSL）+ 文档资产 license 归属 — **policy 修订 2026-05-09（E2）：log-not-block + release gate** | 中 | 中（defer 后） | ADR-013 Stage 6 跑 license-checker，**结果进 [LICENSE log](../legal/THIRD_PARTY_LICENSE_LOG.md)**（`status: copied-temporarily / needs-replacement`）；可以先借鉴或搬用；release 前集中清理 | 0B Stage 6 license scan，结果写 LICENSE log；release gate 检查 log 全部 resolved（`removed` / `approved-for-public`） | 0B（持续）+ release gate | ✅ #6 license（log-not-block） |
| **R-07** | Eva 现有测试覆盖不足（决定哪些代码可改不破坏） | 中 | 高 | **分两类处理**：① 即将重构核心模块（cli-runner / scheduler / permission）—— 已有 characterization tests（test-cli / test-e2e / test-stale-session / test-scheduler-* / test-auth / test-permission）✅；② 暂时不动模块（inbox / notifications / heartbeat / iOS 等）—— 冻结接受，**coverage: unknown** 进风险登记。**覆盖率不是目标，防回归才是目标** | 改造前：核心模块 e2e 测试通过；改造后：相同测试通过（regression baseline） | 0-pre / 0B | — |
| **R-08** | 用户 Eva 数据迁移（运行中数据库 schema → Vessel） | 中 | 中 | 0B 写 `scripts/migrate-eva-to-vessel.ts`；`--dry-run` 必跑；migration 0004（v103）自动跑；**全部非破坏性**（不删源） | 0B Acceptance：`pnpm migrate:eva-to-vessel --dry-run` 退出码 0；实迁后 `~/.vessel/harness.db` 存在且 `~/.claude-web/harness.db` 仍存在 | 0B | ✅ #8 数据迁移 |
| **R-09** | 品牌改名风险（git remote / iOS bundle id / 部署脚本 / 外部链接 / TestFlight 重审） | 中 | 中 | 按 ADR-013 改名 4-Stage runbook；Stage 4 iOS 改名延后到 M2-iOS（TestFlight 2-3 天审核可等）；保留 git remote alias `claude-web-legacy` | Stage 1：`pnpm install + pnpm test:cli` 通过；Stage 2：`~/.vessel/` 存在；Stage 3：`grep -ri claude-web docs/` 仅命中 eva-legacy/；Stage 4：iOS TestFlight build 上传 | 0B (Stage 1-3) + M2-iOS (Stage 4) | — |
| **R-10** | Eva 旧架构债务（11 条登记，见 EVA_INVENTORY §6） | 中 | 中 | EVA_INVENTORY §6 列出全部；每条债务在改造时同步处理或显式 defer；M1C-A 必处理 scheduler STAGE_SEQUENCE 硬编码（高） | 改造每模块时跑 characterization tests + 新增功能测试 | 跨多 milestone | — |
| **R-11** | TS 在 fastembed / whisper / Piper / sqlite-vec 集成可行性 | 中 | 高 | M1C-B 前 spike：① fastembed-js（ONNX Node）；② Python worker；fallback = M1C-B 推 v1+，M1C-A 仍跑（HITL Workflow 不依赖 embedding） | M1C-B spike 报告进 `docs/research/embedding-typescript-options-<DATE>.md`（按 ADR-015 模板） | M1C-B 前 | — |
| **R-12** | Soul Spec v0.1 仅 cli-runner 注入，非 cli-runner Skill 不带 soul prompt | 中 | 中 | 已 ADR-004 锁定为 v0.1 trade-off；CONCEPTS §1.2 加"Soul 作用范围"段；M2-Soul Acceptance 不要求"非 cli-runner Skill 带 soul prompt"；v1+ 决定是否扩展到所有 Skill | M2-Soul Acceptance：FakeCodingDriver 验证 cli-runner 调用 prompt 含 soul.md；其他 Skill 不验证（明确 N/A） | M2-Soul | — |
| **R-13** | iOS Local Network 权限被拒绝率（企业网络 / 访客 Wi-Fi / VLAN / VPN） | 中 | 中 | Bonjour 自动发现失败时 UI 显示"Local Network 权限被拒"具体原因 + "切换到手填 IP" 入口可见；M2-iOS Acceptance 包含权限拒绝场景测试 | iOS app 强制 deny Local Network 权限后启动；UI 显示具体提示 + 手填 IP 入口可见 | M2-iOS | — |
| **R-14** | M1C-A workflow_state 序列化 stage state 含敏感数据（user_prompt 全文 / token / 文件绝对路径）写 SQLite | 中 | 中 | M1C-A 实施时，`workflow_state.serialized_state` 字段必须按 [trace-redaction-spec](trace-redaction-spec.md) 同等规则脱敏（白名单字段 + 黑名单匹配 + 文件 0600） | M1C-A Acceptance：`SELECT serialized_state FROM workflow_state` 不出现 `user_prompt` 全文 / token-like 字符串；表文件 mode 0600 | M1C-A | ✅ #5 secrets（间接） |
| **R-15** | iOS Bonjour `_vessel._tcp` 服务广播暴露 vessel-core service identity 给同 Wi-Fi 设备（公共 / 企业网络） + 文档私人路径 v0.1 release 前未清理 | 中 | 中 | M2-iOS：仅家庭 Wi-Fi 启用 Bonjour（SSID 白名单或 IP 范围检测）；公共/企业网络自动 disable + 强制手填 IP；v0.1 release 前批量改文档 `/Users/yongqian/...` → `~/Desktop/...` 占位符 | M2-iOS Acceptance 加网络环境检测；release 前 `grep -r "/Users/yongqian" docs/` 仅命中 eva-legacy/ | M2-iOS / v0.1 release 前 | — |

---

## v5.4 dogfood P3 仲裁分流到本表的项

按 v5.4 plan 评审辩论流水 v5.3→v5.4 + cursor self-dogfood：

| 来源 finding | 落到本表 | 备注 |
|---|---|---|
| dogfood B-P2（0-pre 工作量低估）| 不另列（影响 0-pre 实施节奏，不是技术风险） | EVA_INVENTORY 收缩到核心模块已缓解 |
| dogfood B-R2（ML worker 启动失败 fallback） | 已合并到 R-11 | ADR-012 Consequences ④ |
| dogfood B-R3（Trace 脱敏） | 不另列（已落 trace-redaction-spec.md + M0 acceptance C-1/C-2/C-3） | 不算 ongoing 风险 |
| dogfood M-A1（Soul Spec 作用范围） | **R-12** | — |
| dogfood M-R4（iOS Local Network 权限） | **R-13** | — |
| cursor self-dogfood M2（prompt 外发无脱敏） | 不另列（已落 cursor-review.sh preflight） | 持续风险归在 ADR-014 escalation #5 |
| cursor self-dogfood m4（Phase 2 disagree 硬约束 reward gaming） | 不另列（已落 SKILL.md escape hatch） | 持续运营时观察 |

---

## 验证策略（Verification 列汇总）

每条风险都有可执行的检查命令。改造每个 milestone 后回看 RISKS：

- 已触发但已缓解的标 ~~strikethrough~~（如 R-06 已用 gitleaks 验证 clean）
- 新发现的风险**追加**进表（不删旧条目）
- v0.1 release 前必须确保所有 R-01~R-13 都有 Verification 通过

---

## 跟 plan v5.4 的 Acceptance 对应

v5.4 plan 0A 完成判定第 5 条："RISKS ≥ 11 条（含 R-01~R-05 + R-06~R-11）+ 每条缓解策略"。

本表 **13 条**（R-01~R-13），**超过 11 条要求** ✅。

每条都有：缓解策略 ✅ + Verification ✅ + 归属里程碑 ✅ + 风险等级 ✅ + 4 类硬触发标注（如适用）✅。
