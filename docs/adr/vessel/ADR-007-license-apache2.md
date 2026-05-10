# ADR-007: Vessel 项目 License = Apache-2.0

- **Status**: Accepted
- **Date**: 2026-05-09
- **Deciders**: yongqian
- **Tags**: license, open-source
- **Tier**: 2

## Context

Vessel 长期目标包含开源分享。需要选定 license。选项：
- MIT（最宽松）
- Apache-2.0（含专利保护）
- BSD-3-Clause / ISC（与 MIT 类似但更精简）

## Decision

**Apache-2.0**。理由：
1. **专利保护**——Apache-2.0 含专利授权条款（MIT 没有）。Vessel 涉及 Soul Spec / Capability 装卸 / 三层 boot 等创新设计，专利条款防御性强
2. **业界主流**——Anthropic / Microsoft / Google 大量项目用 Apache-2.0；与 Eva borrowed dependencies（pnpm / hono / zod / sqlite-vec / fastembed）兼容
3. **明确归属**——Apache-2.0 要求 NOTICE 文件（写明所有第三方贡献），符合 ADR-013 Stage 6 license-checker 的 "记录归属" 政策

## 落地

- 仓库根加 `LICENSE` 文件（标准 Apache-2.0 文本）
- 加 `NOTICE` 文件，列出所有借鉴的开源项目（按 [`docs/legal/THIRD_PARTY_LICENSE_LOG.md`](../../legal/THIRD_PARTY_LICENSE_LOG.md)）
- 每个 source file 顶部加 SPDX header：`// SPDX-License-Identifier: Apache-2.0`（v0.1 release 前批量加，不阻塞当前开发）
- README 加 license badge

## Consequences

- ✅ 与 Eva borrowed code 兼容（Eva 是 owner 私有，可由 owner 自由 relicense）
- ✅ 任何人 fork 后专利方面有保护
- ⚠️ AGPL/SSPL/BUSL 依赖**不能进 v0.1 release**（按 ADR-014 §「Release Gate」license log policy）
- ⚠️ 公司/法人贡献需 CLA（v1+ 议题，单 owner 不需要）

## Prior Art

- Anthropic CLI tools（Apache-2.0）
- HashiCorp 早期项目（v1.0 之前 Apache-2.0；后改 BUSL，反例参考）
- Most modern AI/ML libraries（Apache-2.0）
