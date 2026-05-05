// eva.json — declarative parallel-work + worktree config (M2 v1).
//
// Replaces free-form `WORKTREE_LOCK.md` markdown table that drifted in M1
// 双轨实验 (retrospective 强信号 #1: rebase 报 0 conflict 但段落归属错置).
//
// **Scope of v1 (H12)**:
//   - schema only (this file) + machine-readable file + status reader CLI
//   - **NOT** doing yet: auto-lock / auto-unlock / conflict prevention
//     (留 H13 lifecycle hooks + M2 ResourceLock)
//
// **Single-user local orchestration scope**:
//   v1 把所有本机状态（port / dataDir / 绝对 path）放进 eva.json。
//   团队 / 多机部署需要时再拆 `eva.json` (repo policy) + `eva.local.json` (本机)，
//   现在不预先拆 — KISS。
//
// 灵感来自 [Paseo paseo.json](https://paseo.sh/docs/worktrees) — 借鉴 setup/teardown/
// services 三段思路；不复制 schema 字面，Eva 简化到 worktrees 列表 + ownership。

import { z } from "zod";

/** Lifecycle status — append-only state machine (cross B1 修：消除 released 语义歧义).
 *
 * 关闭路径有两种：
 * - `active` → `done`：**默认关闭路径** — 分支合 dev/main，无论之后 worktree 是否
 *   删除、是否后续 cleanup 删除该 PR 引入的代码（cleanup 不改 status，note 描述）。
 * - `active` → `released`：**替代关闭路径** — 显式撤回（PR 关闭未合）/ superseded
 *   （被另一 PR 取代）/ cancelled（用户决定不做）。**`done` ≠ `released`**：done 标
 *   "merged 至少一次"，released 标 "from never merged 状态退出"。
 *
 * All transitions are **append-only**：v1 不删行，cleanup 时改 status，永不删历史
 * （per M1 双轨实验 retrospective + 用户 manual #5）。 */
export const EvaWorktreeStatusSchema = z.enum(["active", "done", "released"]);
export type EvaWorktreeStatus = z.infer<typeof EvaWorktreeStatusSchema>;

/** Hooks (H13 v1) — 4 个生命周期 hook，灵感来自 [Worktrunk](https://worktrunk.dev/)
 * 7 hooks 模板。Eva v1 收窄到 4 个最常用，其他 3 个（post-switch / pre-commit /
 * pre-merge）暂不开 schema 位（需要时再 bump version）。
 *
 * v1 **手动触发**：`pnpm eva:hook <hookName> <worktreeName>`。无 git wrapper，
 * 无 file watcher。M2 ResourceLock 才上自动化。
 *
 * Hook 命令在对应 worktree 路径下用 shell 执行（`bash -c`），blocking 等结束
 * 退码即终态。`pre-start` / `post-start` / `post-merge` / `pre-remove` 都 blocking
 * — v1 不区分 background（Worktrunk 的 post-start background 留 v2）。 */
const HookCommandSchema = z.string().min(1).max(2000);
/** **strict** — 拒绝未知 hook 名（如 v2 加 post-switch 时必须 bump version + migration）。 */
export const EvaHooksSchema = z
  .object({
    "pre-start": HookCommandSchema.optional(),
    "post-start": HookCommandSchema.optional(),
    "post-merge": HookCommandSchema.optional(),
    "pre-remove": HookCommandSchema.optional(),
  })
  .strict()
  .optional();
export type EvaHooks = z.infer<typeof EvaHooksSchema>;

/** `owns` 字段格式约束（cross M3 修：避免 free-form 漂移到 ResourceLock 时）。
 * 允许：
 * - 相对路径：`packages/backend/src/foo.ts`
 * - 路径 + symbol：`packages/backend/src/foo.ts#computeNextStage`
 *
 * 禁止：
 * - 绝对路径（`/Users/...`）
 * - 父目录跨越（`..`）
 * - 多个 `#` 分隔符
 * - 空 symbol 或 symbol 含空格 / 特殊字符 */
const OWNS_PATTERN = /^[a-zA-Z0-9_./-]+(#[a-zA-Z_][a-zA-Z0-9_-]*)?$/;
const OwnsEntrySchema = z
  .string()
  .min(1)
  .refine((s) => !s.includes(".."), "must not contain '..' parent traversal")
  .refine((s) => !s.startsWith("/"), "must be a relative path")
  .refine((s) => (s.match(/#/g) ?? []).length <= 1, "at most one '#' separator allowed")
  .refine((s) => OWNS_PATTERN.test(s), "must match path or path#symbol format");

export const EvaWorktreeEntrySchema = z.object({
  /** Short human-readable identifier，对应 git branch slug（如 "M1-mini3-context-manager"）。 */
  name: z.string().min(1).max(100),
  /** 完整 git branch 名（可包含 feat/eva-... 前缀）。 */
  branch: z.string().min(1).max(200),
  /** worktree 路径（v1 允许 ~ 展开），单机本地。 */
  path: z.string().min(1),
  /** 服务端口（v1 仅用于本机 dev backend）。可选 — main worktree 可能没单独 backend。 */
  port: z.number().int().min(1024).max(65535).optional(),
  /** 数据目录（CLAUDE_WEB_DATA_DIR）。可选 — main worktree 用默认 ~/.claude-web。 */
  dataDir: z.string().optional(),
  /** 该 worktree 占用 / 修改的文件路径列表（cross M3 修：加格式约束）。
   * 允许 `path` 或 `path#symbol`。v1 仅作为人审 + retrospective evidence；
   * H13 lifecycle hooks 引入时升级为真实 lock 单位（M2 ResourceLock）。 */
  owns: z.array(OwnsEntrySchema).default([]),
  /** 当前状态 — append-only 状态机。 */
  status: EvaWorktreeStatusSchema,
  /** ISO 8601 datetime — 状态更新时间（status 改动时同步改）。cross M4 修：强约束 datetime 格式。 */
  since: z.string().datetime({ offset: true }).optional(),
  /** 自由文本描述 / PR ref / commit SHA / merge 时间等。 */
  note: z.string().optional(),
  /** H13 v1 lifecycle hooks（4 个最常用，可选）。 */
  hooks: EvaHooksSchema,
});
export type EvaWorktreeEntry = z.infer<typeof EvaWorktreeEntrySchema>;

export const EvaConfigSchema = z
  .object({
    /** Schema version — 1 本次 (H12 v1)。bump 必须 ADR + migration plan。 */
    version: z.literal(1),
    /** 历史 + 当前 worktree 注册表。append-only。 */
    worktrees: z.array(EvaWorktreeEntrySchema),
  })
  .superRefine((cfg, ctx) => {
    // Cross M2 修：active 资源唯一性 — 多个 active 不能撞 name / branch / path / port / dataDir。
    // done / released 不查（历史归档可重复）。
    const active = cfg.worktrees.filter((w) => w.status === "active");
    const seen: Record<string, Map<string | number, number>> = {
      name: new Map(),
      branch: new Map(),
      path: new Map(),
      port: new Map(),
      dataDir: new Map(),
    };
    for (let i = 0; i < active.length; i++) {
      const w = active[i];
      for (const key of ["name", "branch", "path"] as const) {
        const v = w[key];
        if (seen[key].has(v)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `active worktrees collide on ${key}="${v}" (entries ${seen[key].get(v)} and ${i})`,
            path: ["worktrees"],
          });
        } else {
          seen[key].set(v, i);
        }
      }
      for (const key of ["port", "dataDir"] as const) {
        const v = w[key];
        if (v === undefined) continue;
        if (seen[key].has(v)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `active worktrees collide on ${key}="${v}" (entries ${seen[key].get(v)} and ${i})`,
            path: ["worktrees"],
          });
        } else {
          seen[key].set(v, i);
        }
      }
    }
  });
export type EvaConfig = z.infer<typeof EvaConfigSchema>;

/**
 * Parse + validate eva.json content. Throws on schema mismatch.
 * Caller responsible for reading file content + freezing result.
 */
export function parseEvaConfig(raw: unknown): EvaConfig {
  return EvaConfigSchema.parse(raw);
}

/** Convenience: count worktrees by status. Used by status reader CLI. */
export function summarizeEvaConfig(cfg: EvaConfig): {
  active: number;
  done: number;
  released: number;
  total: number;
} {
  const active = cfg.worktrees.filter((w) => w.status === "active").length;
  const done = cfg.worktrees.filter((w) => w.status === "done").length;
  const released = cfg.worktrees.filter((w) => w.status === "released").length;
  return { active, done, released, total: cfg.worktrees.length };
}
