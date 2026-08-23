import { isHash } from '@cardstack/deck/repository';

export const REALM_VIEW_CONTEXT_SPEC = 'boxel-realm-view-context-v1';
export const REALM_VIEW_HEADER = 'X-Boxel-Realm-View';
export const REALM_LIVE_VIEW = 'live';

export type RealmView = typeof REALM_LIVE_VIEW | string;

export interface RealmViewContext {
  schema: typeof REALM_VIEW_CONTEXT_SPEC;
  realmRRI: string;
  branch: string;
  repositoryHash: string;
  treeHash: string;
  lockHash: string;
  historyHead: string;
}

export interface ExactRealmView {
  context: RealmViewContext;
  indexGenerationHash: string;
}

export function isRealmViewContext(value: unknown): value is RealmViewContext {
  if (!value || typeof value !== 'object') return false;
  let view = value as Partial<RealmViewContext>;
  return (
    view.schema === REALM_VIEW_CONTEXT_SPEC &&
    typeof view.realmRRI === 'string' &&
    view.realmRRI.startsWith('@') &&
    view.realmRRI.endsWith('/') &&
    typeof view.branch === 'string' &&
    view.branch.trim() !== '' &&
    typeof view.repositoryHash === 'string' &&
    isHash(view.repositoryHash) &&
    typeof view.treeHash === 'string' &&
    isHash(view.treeHash) &&
    typeof view.lockHash === 'string' &&
    isHash(view.lockHash) &&
    typeof view.historyHead === 'string' &&
    view.historyHead.trim() !== ''
  );
}

export function isExactRealmView(value: unknown): value is ExactRealmView {
  if (!value || typeof value !== 'object') return false;
  let view = value as Partial<ExactRealmView>;
  return (
    isRealmViewContext(view.context) &&
    typeof view.indexGenerationHash === 'string' &&
    isHash(view.indexGenerationHash)
  );
}

export function realmViewHash(headers: Headers): string | undefined {
  let value = headers.get(REALM_VIEW_HEADER)?.trim().toLowerCase();
  return value && isHash(value) ? value : undefined;
}

export function realmViewName(value?: string): RealmView {
  let normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === REALM_LIVE_VIEW) {
    return REALM_LIVE_VIEW;
  }
  if (!isHash(normalized)) {
    throw new Error(`invalid Realm view ${value}`);
  }
  return normalized;
}

// Prerender affinity is an opaque scheduler key, not a resource URL. Include
// the exact view so live and branch renders never reuse one browser page,
// Loader graph, batch owner, or icon memo.
export function realmViewAffinityValue(
  realmURL: string,
  realmView?: string,
): string {
  return realmView ? `${realmURL}|realm-view:${realmView}` : realmURL;
}

export function withRealmView(
  request: Request,
  indexGenerationHash: string,
): Request {
  if (!isHash(indexGenerationHash)) {
    throw new Error(`invalid Realm view hash ${indexGenerationHash}`);
  }
  let headers = new Headers(request.headers);
  headers.set(REALM_VIEW_HEADER, indexGenerationHash);
  return new Request(request, { headers });
}
