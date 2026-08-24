import type { RealmViewContext } from './realm-view-context.ts';

export const ASTRA_QUERY_SPEC = 'boxel-astra-query-v1';
export const ASTRA_QUERY_RESULT_SPEC = 'boxel-astra-query-result-v1';

export type AstraQueryViewSelector =
  | { kind: 'branch'; branch: string }
  | { kind: 'checkpoint'; checkpointHash: string }
  | { kind: 'version'; spec: string }
  | { kind: 'index'; indexGenerationHash: string };

export interface AstraQueryRequest {
  schema: typeof ASTRA_QUERY_SPEC;
  query: { text?: string };
  views: AstraQueryViewSelector[];
  compare?: { from: number; to: number };
}

export interface AstraBranchQueryProvenance {
  kind: 'branch' | 'checkpoint' | 'index';
  realmRRI: string;
  selector: AstraQueryViewSelector;
  mutability: 'mutable' | 'immutable';
  indexHash: string;
  treeHash: string;
  repositoryHash: string;
  lockHash: string;
  historyHead: string;
  branch: string;
  checkpointHash?: string;
}

export interface AstraVersionQueryProvenance {
  kind: 'version';
  realmRRI: string;
  selector: AstraQueryViewSelector;
  mutability: 'immutable';
  indexHash: string;
  treeHash: string;
  requested: string;
  resolved: string;
  versionRRI: string;
}

export type AstraQueryProvenance =
  | AstraBranchQueryProvenance
  | AstraVersionQueryProvenance;

export interface AstraQueryCard {
  rri: string;
  logicalRRI: string;
  sourcePath: string;
  document: Record<string, unknown>;
}

export interface AstraQueryViewResult {
  provenance: AstraQueryProvenance;
  cards: AstraQueryCard[];
}

export interface AstraQueryComparison {
  from: number;
  to: number;
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: string[];
}

export interface AstraQueryResult {
  schema: typeof ASTRA_QUERY_RESULT_SPEC;
  query: { text?: string };
  views: AstraQueryViewResult[];
  comparison?: AstraQueryComparison;
}

const HASH = /^[0-9a-f]{64}$/;

export function isAstraQueryRequest(
  value: unknown,
): value is AstraQueryRequest {
  if (!value || typeof value !== 'object') return false;
  let request = value as Partial<AstraQueryRequest>;
  if (
    request.schema !== ASTRA_QUERY_SPEC ||
    !request.query ||
    typeof request.query !== 'object' ||
    (request.query.text !== undefined &&
      typeof request.query.text !== 'string') ||
    !Array.isArray(request.views) ||
    request.views.length === 0 ||
    request.views.length > 8
  ) {
    return false;
  }
  if (!request.views.every(isAstraQueryViewSelector)) return false;
  if (request.compare === undefined) return true;
  return (
    Number.isInteger(request.compare.from) &&
    Number.isInteger(request.compare.to) &&
    request.compare.from >= 0 &&
    request.compare.to >= 0 &&
    request.compare.from < request.views.length &&
    request.compare.to < request.views.length &&
    request.compare.from !== request.compare.to
  );
}

export function isAstraQueryViewSelector(
  value: unknown,
): value is AstraQueryViewSelector {
  if (!value || typeof value !== 'object') return false;
  let selector = value as Partial<AstraQueryViewSelector>;
  if (selector.kind === 'branch') {
    return (
      'branch' in selector &&
      typeof selector.branch === 'string' &&
      selector.branch.trim() !== ''
    );
  }
  if (selector.kind === 'checkpoint') {
    return (
      'checkpointHash' in selector &&
      typeof selector.checkpointHash === 'string' &&
      HASH.test(selector.checkpointHash)
    );
  }
  if (selector.kind === 'version') {
    return (
      'spec' in selector &&
      typeof selector.spec === 'string' &&
      selector.spec.trim() !== ''
    );
  }
  if (selector.kind === 'index') {
    return (
      'indexGenerationHash' in selector &&
      typeof selector.indexGenerationHash === 'string' &&
      HASH.test(selector.indexGenerationHash)
    );
  }
  return false;
}

export function astraBranchProvenance(
  kind: AstraBranchQueryProvenance['kind'],
  selector: AstraQueryViewSelector,
  view: RealmViewContext,
  indexHash: string,
  checkpointHash?: string,
): AstraBranchQueryProvenance {
  return {
    kind,
    realmRRI: view.realmRRI,
    selector,
    mutability: kind === 'branch' ? 'mutable' : 'immutable',
    indexHash,
    treeHash: view.treeHash,
    repositoryHash: view.repositoryHash,
    lockHash: view.lockHash,
    historyHead: view.historyHead,
    branch: view.branch,
    ...(checkpointHash ? { checkpointHash } : {}),
  };
}
