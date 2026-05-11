/**
 * Domain Config — hardcode map of domain → methodology/module/memory-filter hints.
 *
 * Intent Classifier output uses this to select appropriate Memory retrieval strategy
 * and (future) route to the right Operations module.
 *
 * Kept as a static record, not a plugin registry — no dynamic domain registration needed.
 */

export type Domain =
  | 'engineering'
  | 'learning'
  | 'creation'
  | 'finance'
  | 'life'
  | 'social'
  | 'unknown';

export type ExecutionDepth = 'pipeline' | 'operations' | 'direct';

export interface DomainConfig {
  /** Human-readable label */
  label: string;
  /** Which execution depths are typical for this domain */
  typicalDepths: ExecutionDepth[];
  /**
   * Memory retrieval filter: which `kind` values to prefer in KNN search.
   * Empty = no filter (use default KNN top-K).
   */
  memoryKinds: Array<'note' | 'fact' | 'episode' | 'preference'>;
  /**
   * Optional metadata filter applied as a post-filter on KNN results.
   * E.g. { source: 'ops' } matches memory records written by Operations modules.
   */
  metadataFilter?: Record<string, string>;
}

export const DOMAIN_CONFIGS: Record<Domain, DomainConfig> = {
  engineering: {
    label: '软件工程',
    typicalDepths: ['pipeline', 'direct'],
    memoryKinds: ['note', 'episode'],
  },
  learning: {
    label: '学习',
    typicalDepths: ['direct', 'pipeline'],
    memoryKinds: ['note', 'fact', 'preference'],
  },
  creation: {
    label: '创作',
    typicalDepths: ['direct', 'pipeline'],
    memoryKinds: ['note', 'preference'],
  },
  finance: {
    label: '财务/投资',
    typicalDepths: ['operations', 'direct'],
    memoryKinds: ['fact', 'episode'],
    metadataFilter: { domain: 'finance' },
  },
  life: {
    label: '生活管理',
    typicalDepths: ['operations', 'direct'],
    memoryKinds: ['episode'],
    metadataFilter: { source: 'ops' },
  },
  social: {
    label: '社交/沟通',
    typicalDepths: ['operations', 'direct'],
    memoryKinds: ['episode', 'preference'],
  },
  unknown: {
    label: '未知',
    typicalDepths: ['direct'],
    memoryKinds: [],
  },
};

export function getDomainConfig(domain: Domain): DomainConfig {
  return DOMAIN_CONFIGS[domain] ?? DOMAIN_CONFIGS.unknown;
}
