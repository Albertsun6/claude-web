---
description: Research comparable open-source projects and append useful ideas to docs/IDEAS.md
---

Run the `borrow-open-source` skill workflow.

Use this when I ask to 借鉴 / 参考 / 横向比较 / 找类似开源项目 / 下载源码研究 / 把好功能加入 ideas.

Default behavior:

1. Identify the target open-source project(s).
2. Inspect README, docs, changelog, and relevant source files.
3. If source download is needed, shallow clone to a scratch location and do read-only analysis.
4. Extract product, architecture, mobile, permission, security, deployment, and workflow strengths.
5. Evaluate fit for `claude-web` / Seaidea.
6. Append actionable candidates to `docs/IDEAS.md`.

Hard rules:

- Do not run unknown project install/build/dev scripts by default.
- Do not copy large source code from other projects.
- Record license and subscription/API model when relevant.
- Do not implement code unless I explicitly ask.
- If an idea later ships, move it from `docs/IDEAS.md` to `fuction.md`.
