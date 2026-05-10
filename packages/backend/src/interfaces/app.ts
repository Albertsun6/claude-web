/**
 * Capability App — 装卸式插件（FRAMEWORK §2.5）
 *
 * Capability 通过 manifest.yaml 声明依赖 + 提供的 Skill/Tool。
 * vessel-core 启动时按 manifest 加载（NFR-C1 / NFR-C2 / NFR-C3）。
 *
 * Lifecycle: install() → boot() → enable() → ([disable() → enable()])* → uninstall()
 *
 * v0A.1 修订（A1）：soul.md 拆 4 sibling，AppManifest.soulInjection 仍 'cli-runner-only'
 *
 * @see ADR-007 / ADR-009 / NFR-C1~C3
 * @see FRAMEWORK §2.5
 */

import type { Skill } from './skill.js';
import type { Tool, PermissionScope } from './tool.js';

export interface CapabilityApp {
  readonly manifest: AppManifest;

  /** 启动时调用；注册 Skill/Tool；spawn helper subprocess（如 ML worker） */
  boot(ctx: AppBootContext): Promise<void>;

  /** 优雅卸载（按 NFR-C1 30 秒内）；清理子进程；注销 Tool/Skill */
  uninstall(): Promise<void>;

  /** Health check */
  health(): Promise<{ ok: boolean; reason?: string }>;

  /** 列出此 App 提供的 Skill */
  skills(): Skill[];

  /** 列出此 App 暴露的 Tool（可能 0 个） */
  tools(): Tool[];
}

export interface AppBootContext {
  /** App 工作目录（packages/capability-<id>/） */
  appDir: string;
  /** 可读取 instance 数据目录 */
  instanceDataDir: string;
  /** 注册 ML worker 用 */
  spawnHelper(spec: HelperSpawnSpec): Promise<HelperHandle>;
}

export interface AppManifest {
  /** id 必须匹配 directory name（packages/capability-<id>/） */
  id: string;
  name: string;
  version: string;                              // semver
  description: string;
  author?: string;

  /**
   * v0A.1 修订（Claude M-A1 + cursor M3）：z.number().int().min(1) 让 v2+ 可用
   * （不是 z.literal(1) 字面量）
   */
  schemaVersion: number;

  /** 此 App 提供的 Skill ids */
  skills: string[];

  /** 此 App 暴露的 Tool ids（通过 MCP 或 internal） */
  tools?: string[];

  /** 依赖的 ML worker（如 voice 依赖 whisper / piper） */
  mlWorkers?: ('embedding' | 'asr' | 'tts')[];

  /** Permission scope（路径白名单 / 操作） */
  permissionScope?: PermissionScope;

  /**
   * Soul Spec 是否注入到此 App 的 Skill prompt（按 ADR-004 + R-12）
   * v0.1：仅 cli-runner-based skills（capability-coding）
   * v1+：可扩展到 'all-skills'
   */
  soulInjection?: 'cli-runner-only' | 'all-skills';
}

export interface HelperSpawnSpec {
  type: 'ml-worker' | 'mcp-server';
  cmd: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface HelperHandle {
  pid: number;
  pgid: number;                                 // process group id（NFR-C2 SIGTERM 用）
  shutdown(): Promise<void>;                    // SIGTERM + 5s SIGKILL
}
