# Skills 治理索引

项目级 Skill 放在 `.claude/skills/`，命令入口放在 `.claude/commands/`。

## 原则

- Skill 是可复用工作流，不是一次性聊天记录。
- 默认先研究、计划、写文档；只有用户明确要求才改代码。
- 外部源码默认只读分析，不运行陌生脚本。
- 用户可见功能完成后检查 `docs/USER_MANUAL.md`。
- 已完成 idea 从 `docs/IDEAS.md` 移到 `fuction.md`。

## 已登记 Skill

| Skill | 命令入口 | 用途 | 默认写入 |
|---|---|---|---|
| `update-manual` | `/update-manual` | 同步用户手册 | `docs/USER_MANUAL.md` |
| `borrow-open-source` | `/borrow-open-source` | 研究同类开源项目，提炼可借鉴功能 | `docs/IDEAS.md` |
