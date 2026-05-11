/**
 * EchoSkill — M0 reference Skill (FRAMEWORK §2.2).
 *
 * Loop: { text } → { text: 'echoed: ' + text }
 *
 * Used to validate the M0 闭环：CLI → Intent → bootSession → Orchestrator → EchoSkill
 * → Session SQLite → Trace. No external state, no Tools, no Memory writes beyond
 * what Orchestrator already does for skill_invocations.
 */

import type { Skill, SkillContext } from '../interfaces/skill.js';

interface EchoIntent { text: string }
interface EchoArtifact { kind: 'echo'; text: string }

export const EchoSkill: Skill = {
  id: 'echo',
  capabilityId: 'core',                             // M0 还没 Capability App，挂在 'core' namespace
  description: 'Echoes input text back as `echoed: <text>`',

  async invoke(intent: unknown, _ctx: SkillContext): Promise<unknown> {
    const i = intent as EchoIntent;
    if (typeof i?.text !== 'string') {
      throw new Error('EchoSkill.invoke: intent.text must be a string');
    }
    const artifact: EchoArtifact = { kind: 'echo', text: `echoed: ${i.text}` };
    return artifact;
  },
};
