/**
 * CodingSkill — wraps CodingDriver per ADR-016 path C.
 *
 * Loop:
 *   intent { text } → driver.submit({ runId, prompt, workspace }) → artifact { files, exitCode }
 *
 * Workspace passed in via SkillContext.workspaceDir (orchestrator computes it
 * as instance/workspace/<runId>/ from the CodingDriver helper).
 *
 * Out of scope (M0.5):
 *   - Soul prompt prefix (M2-Soul fills systemPromptPrefix)
 *   - Permission router wiring (M1B)
 */

import type { Skill, SkillContext } from '../interfaces/skill.js';
import type { CodingDriver } from '../drivers/types.js';

interface CodingIntent { text: string; runId: string }

export interface CodingArtifact {
  kind: 'coding';
  files: string[];
  exitCode: number;
  cancelled: boolean;
  stdoutPath?: string;
  message_count?: number;
}

export function makeCodingSkill(driver: CodingDriver): Skill {
  return {
    id: 'coding',
    capabilityId: 'coding',
    description: 'Spawn coding CLI to write files in an isolated workspace.',

    async invoke(intent: unknown, ctx: SkillContext): Promise<unknown> {
      const i = intent as CodingIntent;
      if (typeof i?.text !== 'string' || typeof i?.runId !== 'string') {
        throw new Error('CodingSkill.invoke: intent.{text,runId} must be strings');
      }

      const artifact = await driver.submit(
        {
          runId: i.runId,
          prompt: i.text,
          workspace: ctx.workspaceDir,
          // systemPromptPrefix is M2-Soul; left undefined here.
        },
        {
          traceCtx: ctx.traceCtx,
          abortSignal: ctx.abortSignal,
          onMessage: ctx.onProgress,                  // M1A-β WS streaming pass-through
        },
      );

      const result: CodingArtifact = {
        kind: 'coding',
        files: artifact.files,
        exitCode: artifact.exitCode,
        cancelled: artifact.metadata?.cancelled === true,
        stdoutPath: artifact.stdoutPath,
        message_count: typeof artifact.metadata?.message_count === 'number'
          ? (artifact.metadata.message_count as number)
          : undefined,
      };
      return result;
    },
  };
}
