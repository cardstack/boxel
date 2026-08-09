import type { BoxelExecutionPolicyInput } from '@cardstack/host/lib/boxel-execution-policy';
import type { BoxelExecutionMode } from '@cardstack/host/lib/boxel-runtime';
import type { BoxelSourceClassification } from '@cardstack/host/lib/boxel-source-classifier';

export type ExecutionGraphOwner =
  | 'host'
  | 'direct'
  | 'capsule'
  | 'sandbox'
  | 'prerender';

export type ExecutionGraphEdge =
  | 'host-route'
  | 'trusted-portal'
  | 'trusted-callback'
  | 'runtime-local'
  | 'host-capability'
  | 'store-update'
  | 'prerender-placeholder';

export type ExecutionGraphProof = 'exact' | 'protocol-only' | 'browser-gated';

export interface ExecutionGraphNode {
  id: string;
  owner: ExecutionGraphOwner;
  via: ExecutionGraphEdge;
  parent?: string;
  principal: string;
  surfaceId: string;
  policy?: BoxelExecutionPolicyInput;
  expectedReason?: string;
}

export interface ExecutionGraphScenario {
  id: string;
  description: string;
  proof: ExecutionGraphProof;
  evidence: string[];
  nodes: ExecutionGraphNode[];
}

export const capsuleSource: BoxelSourceClassification = {
  tier: 'capsule',
  reason: 'default-user-card',
  imports: [],
  signals: [],
  moduleGraph: [],
  propagatesToImporters: false,
  authoredEditTemplate: false,
};

export const sandboxSource: BoxelSourceClassification = {
  tier: 'sandbox',
  reason: 'browser-runtime:document',
  imports: [],
  signals: ['document'],
  moduleGraph: [],
  propagatesToImporters: false,
  authoredEditTemplate: false,
};

export const sandboxSourceWithEdit: BoxelSourceClassification = {
  ...sandboxSource,
  authoredEditTemplate: true,
};

export function policy(
  overrides: Partial<BoxelExecutionPolicyInput> = {},
): BoxelExecutionPolicyInput {
  return {
    trusted: false,
    format: 'isolated',
    source: capsuleSource,
    prefersFullSandbox: false,
    volatile: false,
    ...overrides,
  };
}

function routedNode(
  id: string,
  owner: BoxelExecutionMode,
  options: {
    parent?: string;
    principal?: string;
    surfaceId?: string;
    policy?: Partial<BoxelExecutionPolicyInput>;
    reason?: string;
  } = {},
): ExecutionGraphNode {
  return {
    id,
    owner,
    via: 'host-route',
    parent: options.parent,
    principal: options.principal ?? 'viewer:one',
    surfaceId: options.surfaceId ?? `surface:${id}`,
    policy: policy(options.policy),
    expectedReason: options.reason,
  };
}

function fixedNode(
  id: string,
  owner: ExecutionGraphOwner,
  via: Exclude<ExecutionGraphEdge, 'host-route'>,
  parent: string | undefined,
  options: { principal?: string; surfaceId?: string } = {},
): ExecutionGraphNode {
  return {
    id,
    owner,
    via,
    parent,
    principal: options.principal ?? 'viewer:one',
    surfaceId: options.surfaceId ?? `surface:${id}`,
  };
}

/**
 * The minimum alternating-owner graph. These are protocol scenarios, not a
 * claim that every row already has an end-to-end browser proof. The `proof`
 * field makes that distinction executable and visible in test output.
 */
export const executionGraphScenarios: ExecutionGraphScenario[] = [
  {
    id: 'G-01',
    description: 'ordinary authored card',
    proof: 'exact',
    evidence: ['realm-mirror-compatibility-test.gts: G-01/G-02'],
    nodes: [routedNode('card', 'capsule')],
  },
  {
    id: 'G-02',
    description: 'Capsule card through a trusted Base field portal',
    proof: 'exact',
    evidence: ['realm-mirror-compatibility-test.gts: G-01/G-02'],
    nodes: [
      routedNode('card', 'capsule'),
      fixedNode('base-field', 'direct', 'trusted-portal', 'card'),
      fixedNode('authored-field', 'capsule', 'trusted-callback', 'base-field'),
    ],
  },
  {
    id: 'G-03',
    description: 'recursive authored FieldDef delegation',
    proof: 'exact',
    evidence: ['rp-equivalence-test.gts: nested authored FieldDef delegation'],
    nodes: [
      routedNode('card', 'capsule'),
      fixedNode('base-field-1', 'direct', 'trusted-portal', 'card'),
      fixedNode(
        'authored-field-1',
        'capsule',
        'trusted-callback',
        'base-field-1',
      ),
      fixedNode('base-field-2', 'direct', 'trusted-portal', 'authored-field-1'),
      fixedNode(
        'authored-field-2',
        'capsule',
        'trusted-callback',
        'base-field-2',
      ),
    ],
  },
  {
    id: 'G-04',
    description: 'linked card re-enters Host policy',
    proof: 'exact',
    evidence: ['realm-mirror-compatibility-test.gts: G-04'],
    nodes: [
      routedNode('parent', 'capsule'),
      fixedNode('relationship-portal', 'host', 'host-capability', 'parent'),
      routedNode('linked-child', 'capsule', { parent: 'relationship-portal' }),
    ],
  },
  {
    id: 'G-05',
    description: 'Rich Markdown portal embeds an authored card',
    proof: 'exact',
    evidence: ['realm-mirror-compatibility-test.gts: G-05'],
    nodes: [
      routedNode('article', 'capsule'),
      fixedNode('markdown-portal', 'direct', 'trusted-portal', 'article'),
      fixedNode('embed-request', 'host', 'host-capability', 'markdown-portal'),
      routedNode('embedded-card', 'capsule', { parent: 'embed-request' }),
    ],
  },
  {
    id: 'G-06',
    description: 'Capsule parent delegates a browser-dependent child',
    proof: 'exact',
    evidence: [
      'realm-mirror-compatibility-test.gts: G-06',
      'rp-sandbox-test.gts: RP-15.3, RP-6.4 iframe mount',
    ],
    nodes: [
      routedNode('parent', 'capsule'),
      fixedNode('child-request', 'host', 'host-capability', 'parent'),
      routedNode('browser-child', 'sandbox', {
        parent: 'child-request',
        policy: { source: sandboxSource },
        reason: sandboxSource.reason,
      }),
    ],
  },
  {
    id: 'G-07',
    description: 'Sandbox-local Base and authored child stay in one document',
    proof: 'exact',
    evidence: [
      'rp-sandbox-test.gts: G-07 sandbox-local module graph',
      'rp-sandbox-test.gts: RP-15.3 dynamic import authority',
    ],
    nodes: [
      routedNode('browser-card', 'sandbox', {
        policy: { source: sandboxSource },
        reason: sandboxSource.reason,
      }),
      fixedNode(
        'sandbox-base-field',
        'sandbox',
        'runtime-local',
        'browser-card',
      ),
      fixedNode(
        'sandbox-authored-field',
        'sandbox',
        'runtime-local',
        'sandbox-base-field',
      ),
    ],
  },
  {
    id: 'G-08',
    description: 'Sandbox write is reauthorized and reconciles consumers',
    proof: 'exact',
    evidence: [
      'rp-continuity-test.gts: RP-20.5 canonical push',
      'rp-continuity-test.gts: RP-20.6 write, fan-out, and loop termination',
    ],
    nodes: [
      routedNode('capsule-consumer', 'capsule'),
      routedNode('sandbox-editor', 'sandbox', {
        policy: { source: sandboxSourceWithEdit, format: 'edit' },
        reason: sandboxSource.reason,
      }),
      fixedNode('write-proposal', 'host', 'host-capability', 'sandbox-editor'),
      fixedNode('canonical-store', 'host', 'store-update', 'write-proposal'),
      fixedNode(
        'capsule-reconcile',
        'capsule',
        'store-update',
        'canonical-store',
      ),
      fixedNode(
        'sandbox-reconcile',
        'sandbox',
        'store-update',
        'canonical-store',
      ),
    ],
  },
  {
    id: 'G-09',
    description: 'inert prerender hands off to an interactive Sandbox',
    proof: 'exact',
    evidence: [
      'boxel-execution-test.ts: scoped server prerender placeholder',
      'rp-sandbox-test.gts: resize diagnostic unlocks first paint',
      'execution-runtime-browser-smoke.mjs: Sandbox interactive handoff',
    ],
    nodes: [
      fixedNode(
        'indexed-html',
        'prerender',
        'prerender-placeholder',
        undefined,
      ),
      fixedNode('mount', 'host', 'host-capability', 'indexed-html'),
      routedNode('interactive-card', 'sandbox', {
        parent: 'mount',
        policy: { source: sandboxSource },
        reason: sandboxSource.reason,
      }),
    ],
  },
  {
    id: 'G-10',
    description: 'one Capsule card retains two warm format islands',
    proof: 'exact',
    evidence: ['realm-mirror-compatibility-test.gts: G-10'],
    nodes: [
      routedNode('isolated', 'capsule'),
      routedNode('embedded', 'capsule', { surfaceId: 'surface:isolated' }),
    ],
  },
  {
    id: 'G-11',
    description: 'safe compact module and browser-heavy isolated module split',
    proof: 'exact',
    evidence: ['rp-protocol-statics-test.ts: RP-6.2 split modules'],
    nodes: [
      routedNode('atom-module', 'capsule', {
        policy: { format: 'atom' },
        surfaceId: 'surface:split-card',
      }),
      routedNode('isolated-module', 'sandbox', {
        policy: { format: 'isolated', source: sandboxSource },
        reason: sandboxSource.reason,
        surfaceId: 'surface:split-card',
      }),
    ],
  },
  {
    id: 'G-12',
    description: 'Surface capabilities terminate in the Host for both tiers',
    proof: 'exact',
    evidence: [
      'surface-service-test.ts: direct and Sandbox client share Host surface',
    ],
    nodes: [
      routedNode('direct-card', 'direct', {
        policy: { trusted: true },
        reason: 'trusted-boxel-module',
      }),
      fixedNode('direct-surface', 'host', 'host-capability', 'direct-card'),
      routedNode('capsule-card', 'capsule'),
      fixedNode('capsule-surface', 'host', 'host-capability', 'capsule-card'),
      routedNode('sandbox-card', 'sandbox', {
        policy: { source: sandboxSource },
        reason: sandboxSource.reason,
      }),
      fixedNode('sandbox-surface', 'host', 'host-capability', 'sandbox-card'),
    ],
  },
  {
    id: 'G-13',
    description:
      'deep alternating graph reconciles a Sandbox write back into Capsule',
    proof: 'exact',
    evidence: [
      'boxel-execution-graph-test.ts: G-13 deep alternating graph',
      'rp-continuity-test.gts: RP-20.6 write, fan-out, and loop termination',
    ],
    nodes: [
      routedNode('capsule-root', 'capsule'),
      fixedNode('base-portal', 'direct', 'trusted-portal', 'capsule-root'),
      fixedNode('capsule-child', 'capsule', 'trusted-callback', 'base-portal'),
      fixedNode('sandbox-request', 'host', 'host-capability', 'capsule-child'),
      routedNode('sandbox-child', 'sandbox', {
        parent: 'sandbox-request',
        policy: { source: sandboxSource },
        reason: sandboxSource.reason,
      }),
      fixedNode(
        'sandbox-base-field',
        'sandbox',
        'runtime-local',
        'sandbox-child',
      ),
      fixedNode('write-proposal', 'host', 'host-capability', 'sandbox-child'),
      fixedNode('canonical-store', 'host', 'store-update', 'write-proposal'),
      fixedNode(
        'capsule-reconciliation',
        'capsule',
        'store-update',
        'canonical-store',
      ),
    ],
  },
];

export const requiredExecutionGraphEdges: ReadonlyArray<
  readonly [ExecutionGraphOwner, ExecutionGraphEdge, ExecutionGraphOwner]
> = [
  ['host', 'host-route', 'direct'],
  ['host', 'host-route', 'capsule'],
  ['host', 'host-route', 'sandbox'],
  ['capsule', 'trusted-portal', 'direct'],
  ['direct', 'trusted-callback', 'capsule'],
  ['capsule', 'host-capability', 'host'],
  ['sandbox', 'host-capability', 'host'],
  ['sandbox', 'runtime-local', 'sandbox'],
  ['prerender', 'host-capability', 'host'],
  ['host', 'store-update', 'host'],
  ['host', 'store-update', 'capsule'],
  ['host', 'store-update', 'sandbox'],
];

export function graphEdgeKey(
  from: ExecutionGraphOwner,
  via: ExecutionGraphEdge,
  to: ExecutionGraphOwner,
): string {
  return `${from} --${via}--> ${to}`;
}

export function scenarioEdgeKeys(scenario: ExecutionGraphScenario): string[] {
  let nodes = new Map(scenario.nodes.map((node) => [node.id, node]));
  let edges: string[] = [];
  for (let node of scenario.nodes) {
    if (!node.parent) {
      if (node.via === 'host-route') {
        edges.push(graphEdgeKey('host', node.via, node.owner));
      }
      continue;
    }
    let parent = nodes.get(node.parent);
    if (!parent) {
      throw new Error(
        `${scenario.id} node '${node.id}' names missing parent '${node.parent}'`,
      );
    }
    edges.push(graphEdgeKey(parent.owner, node.via, node.owner));
  }
  return edges;
}
