# ADR-012 Amendment 2026-05-10 — Risk Officer Review
Date: 2026-05-11-0000

## Findings

### PASS: 路径选型避开 archived 维护
fastembed-js archived 是真实 supply chain 风险（单作者 read-only repo 不会再
有 security patch）。Amendment 切到 HF 官方维护的 transformers.js（Apache-2.0,
组织维护）显著降低 supply chain 风险。

### PASS: 模型权重 supply chain 在 spike report § 9 已识别
Spike report 提到"模型从 HF CDN 下载，HF 默认 https + ETag 校验，权重不签名 →
极端 supply chain 攻击仍可能。Mitigation: 首次下载后 SHA pinning"。amendment
没重复但通过 spike report 引用关联。M1C-B 实施时落实。

### MINOR-1: amendment 没强制 SHA pinning 进入 Acceptance
按 §11 spike report 推荐"M1C-B 实施时 SHA pinning"，但 amendment 没写为
acceptance criteria。如果 M1C-B 跳过 SHA pinning，未来权重被替换无人察觉。
**Risk**: Low for 个人单机。
**Verdict**: MINOR — defer / M1C-B 实施 closeout 时强制检查 docs/notes/
model-sha-pinning.md 文件存在。

### PASS: in-process embedding 不增加新攻击面
跑在 vessel-core 进程内，与既有 cli-runner / mdns publisher / mcpManager 同
样的进程边界。不像 Ollama daemon 多一个网络 listener。

### PASS: license 检查 spike report 已覆盖
- 推理库（transformers.js, sqlite-vec, onnxruntime-node, better-sqlite3）：全部 Apache-2.0 / MIT
- 模型（bge-small-zh-v1.5）：MIT
- 排除 jina-v3（CC-BY-NC）和 m3e（NC + 停维护）
- "license 突变"风险：HF 官方 + BAAI + Alex Garcia（sqlite-vec）三方都不太可
  能突变，但 v0.5 release 前应再核一次

### MINOR-2: onnxruntime-node native binary supply chain
onnxruntime-node 是 Microsoft 官方但 prebuilt binary 通过 npm 分发。npm
install 路径下的 prebuilt 校验仅靠 SHA512 (npm registry)，没有 GPG 签名。
**Risk**: Low — Microsoft 官方包 supply chain 与 Node.js / TypeScript 同等级
信任。
**Verdict**: MINOR — accepted-as-is.

### INFO: 国内 HF CDN 失败的隐私态势
首启卡 30s-2min 期间，user 不知道发生了什么（"app 卡住了？"）。M1C-B 实施
时 UI / CLI 必须给用户清晰信号——这不是 risk 问题，是 UX 问题，但风险维
度的"用户信心"与之相关。

## Verdict: PASS — 2 MINOR (deferred / accepted-as-is)
