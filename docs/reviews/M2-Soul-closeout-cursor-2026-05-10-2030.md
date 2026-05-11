# M2-Soul — Closeout Review (cursor cross-review lens)
Date: 2026-05-10-2030

## Cross-cutting concerns

### PASS: ROADMAP M2-Soul 验收 4 条全部满足
1. clone jarvis-style.soul.md 不改字段直接保存 → init 退出码 1 + stderr "must modify ≥ 1 field" ✅ (test-soul.ts Test 6 第一个 spawn)
2. 改 ≥ 1 字段后保存 → 退出码 0 + ~/.vessel/soul.md 写入 ✅ (Test 6 第二个 spawn)
3. `vessel-core soul show-prompt` 输出包含 soul.md 所有 personality 字段值 ✅ (Test 6 第三个 spawn + Test 3 grep 校验 8 个独立字段值)
4. cli-runner 调用 prompt 包含 soul.md 渲染内容 ✅ (Test 8 验证 loadSoulOrNull → renderSoulPrompt 路径)

每个验收都有对应可执行测试断言。

### PASS: Eva 路径不受影响
- Eva web/iOS path 通过 cli-runner 调用 Claude CLI，没有 ~/.vessel/soul.md
  时 loadSoulOrNull 返回 null，buildArgs 跳过 --append-system-prompt
- 现有 cli-runner 的 5 项 args（--print / --input-format / ...）顺序不变
- 测试套件 m1b / m1bplus / workflow / lessons / coding-driver 全部回归通过
- 没有改 Eva 现有 CLAUDE.md / README / 文档

### PASS: 子命令风格与既有命令一致
- `vessel-core init` / `vessel-core soul show-prompt` / `vessel-core soul list-templates`
- 同 lesson / workflow 子命令一样：早期 dispatch + 直接 process.exit
- HELP 字符串更新有 examples 段
- 错误消息格式：`vessel-core <command>: <reason>`

### PASS: TypeScript strict mode 干净
- 0 tsc errors with --noEmit
- 类型 SoulSpec / SoulPersonality / SoulPreferences 都有 export
- 无 `any` 强转
- 类型守卫到位（typeof string 检查、Array.isArray + 元素类型检查）

### Finding matrix 汇总

| ID | 严重度 | 来源 | Finding | 决策 |
|---|---|---|---|---|
| MINOR-arch-1 | MINOR | architect | FRAMEWORK.md 没同步 SoulSpec schema | defer/docs |
| MINOR-arch-2 | MINOR | architect | schema 演进 migration 路径 YAGNI | defer/v2 schema 时 |
| MINOR-prag-1 | MINOR | pragmatist | cmdInit 没 --dry-run | accepted-as-is |
| MINOR-prag-2 | MINOR | pragmatist | 测试硬编码 TEMPLATE_JARVIS 字符串 | accepted-as-is |
| MINOR-risk-1 | MINOR | risk | --append-system-prompt 在 ps 可见 | defer/--append-system-prompt-file |

5 MINOR, 0 MAJOR, 0 BLOCKER. 全部 deferred / accepted-as-is. 无 fix-now。

## Verdict: PASS
