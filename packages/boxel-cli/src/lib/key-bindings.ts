import { realmServerRequest } from './secure-session.ts';
import { canonicalRealmUrl } from './user-keys.ts';

// A realm as the CLI names it to the realm server: a prefix-form id
// (`@cardstack/catalog/`) as written, which the server resolves, or a URL in
// the form the server stores.
export function realmArgument(realm: string): string {
  return realm.startsWith('@')
    ? realm.endsWith('/')
      ? realm
      : `${realm}/`
    : canonicalRealmUrl(realm);
}

// The realm server's bindings routes, as `boxel keys approve`, `revoke`,
// `pending` and `ungrant` use them. A binding is a key owner's approval of
// one `callApi` operation, in one realm, to send a chosen key (or share) in
// one of its credential slots; a grant is where a key may be sent. Reading a
// preview or the user's own bindings takes any session of the user; building
// a batch, approving, revoking and removing a grant take the profile's
// secure session.

type FetchFn = typeof fetch;

// What a slot's request reaches the vendor as, the fields a binding's
// fingerprint is taken over, as the realm server reads them back.
export interface BindingSnapshot {
  destination: string;
  method: string;
  pathTemplate: string;
  headersTemplate: string;
  placement: string;
  placementName: string;
  transform: string | null;
  bodyTemplate: string | null;
}

export interface BatchSlot {
  slot: string;
  key: 'userKey' | 'apiKey';
  status: 'new' | 'changed';
  snapshot: BindingSnapshot;
  fingerprint: string;
  approved?: {
    snapshot: BindingSnapshot;
    keyId: string | null;
    shareId: string | null;
  };
}

export interface BatchOperation {
  name: string;
  label: string;
  method: string;
  path: string;
  instance: string | null;
  status: 'new' | 'changed';
  slots: BatchSlot[];
}

export interface BatchGroup {
  // The destination as lowered (`href`, an origin and a path prefix ending
  // in `/`), its host, its path, and the registrable domain a person
  // recognizes it by.
  destination: {
    href: string;
    host: string;
    path: string;
    registrableDomain: string;
  };
  operations: BatchOperation[];
}

export interface BatchKey {
  id: string;
  name: string;
  kind: string;
  state: string;
  covers: string[];
}

export interface BatchShare {
  id: string;
  label: string;
  keyId: string;
  keyName: string;
  covers: string[];
}

export interface ApprovalBatch {
  realm: { url: string; name: string };
  card: { name: string; module: string; exportName: string };
  instance: string | null;
  review: boolean;
  groups: BatchGroup[];
  remaining: number;
  keys: BatchKey[];
  shares: BatchShare[];
}

// What the batch is asked for: a card type in a realm, or one card.
export type BatchTarget =
  | { kind: 'type'; module: string; name: string; realm: string }
  | { kind: 'instance'; url: string };

export async function approvalBatch(
  realmServerUrl: string,
  token: string,
  { target, review = false }: { target: BatchTarget; review?: boolean },
  fetchFn: FetchFn = fetch,
): Promise<ApprovalBatch> {
  let json = await realmServerRequest(realmServerUrl, '_key-bindings/batch', {
    method: 'POST',
    token,
    fetchFn,
    body: {
      data: {
        type: 'key-binding-batch',
        attributes: {
          target:
            target.kind === 'type'
              ? { ...target, realm: realmArgument(target.realm) }
              : target,
          review,
        },
      },
    },
  });
  return json.data.attributes as ApprovalBatch;
}

export interface OperationApproval {
  codeRef: { module: string; name: string };
  operation: string;
  instance?: string;
  expectedDestination: string;
  slots: Record<
    string,
    | { keyId: string; expectedFingerprint: string }
    | { shareId: string; expectedFingerprint: string }
  >;
}

export interface KeyBinding {
  id: string;
  realm: string;
  type: { module: string; name: string };
  operation: string;
  instance: string | null;
  slot: string;
  keyId: string | null;
  shareId: string | null;
  grantId: string | null;
  approvedBy: string;
  interactive: boolean;
  anonymous: boolean;
  fingerprint: string;
  approvalId: string;
  state: 'active' | 'needs-reapproval' | 'suspended';
  // In the user's own listing: what the key page names it by.
  operationLabel?: string;
  cardName?: string;
}

export interface ApprovedBinding extends KeyBinding {
  request: BindingSnapshot;
  grant: { id: string; destination: string; created: boolean };
}

function fromResource<T>(resource: {
  id: string;
  attributes: Record<string, unknown>;
}): T {
  return { id: resource.id, ...resource.attributes } as T;
}

// Approves operations in one realm in one confirmation. `interactive` and
// `anonymous` ask for use beyond pipelines, which the realm server refuses,
// since it offers neither.
export async function approveOperations(
  realmServerUrl: string,
  token: string,
  {
    realm,
    operations,
    interactive,
    anonymous,
  }: {
    realm: string;
    operations: OperationApproval[];
    interactive?: boolean;
    anonymous?: boolean;
  },
  fetchFn: FetchFn = fetch,
): Promise<{ batchId: string; approved: ApprovedBinding[] }> {
  let json = await realmServerRequest(realmServerUrl, '_key-bindings', {
    method: 'POST',
    token,
    fetchFn,
    body: {
      data: {
        type: 'key-binding-approval',
        attributes: {
          realm: realmArgument(realm),
          operations,
          ...(interactive ? { interactive: true } : {}),
          ...(anonymous ? { anonymous: true } : {}),
        },
      },
    },
  });
  return {
    batchId: json.meta.batchId,
    approved: json.data.map(
      (resource: {
        id: string;
        attributes: Record<string, unknown>;
        meta: { request: BindingSnapshot; grant: ApprovedBinding['grant'] };
      }) => ({
        ...fromResource<KeyBinding>(resource),
        request: resource.meta.request,
        grant: resource.meta.grant,
      }),
    ),
  };
}

// Which bindings to list. The realm server resolves each, in prefix form or
// as a URL, as it keys bindings, so the CLI never compares its own spelling
// of a realm or module with the server's.
export interface BindingFilter {
  realm?: string;
  module?: string;
  name?: string;
  operation?: string;
  instance?: string;
}

export async function listOwnBindings(
  realmServerUrl: string,
  token: string,
  filter: BindingFilter = {},
  fetchFn: FetchFn = fetch,
): Promise<KeyBinding[]> {
  let query = new URLSearchParams(
    Object.entries(filter).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  ).toString();
  let json = await realmServerRequest(
    realmServerUrl,
    query ? `_key-bindings?${query}` : '_key-bindings',
    { token, fetchFn },
  );
  return json.data.map(fromResource<KeyBinding>);
}

export async function revokeBinding(
  realmServerUrl: string,
  token: string,
  bindingId: string,
  fetchFn: FetchFn = fetch,
): Promise<void> {
  await realmServerRequest(
    realmServerUrl,
    `_key-bindings/${encodeURIComponent(bindingId)}`,
    { method: 'DELETE', token, fetchFn },
  );
}

// What approving one operation would record now: its destination and, per
// slot, the request and its fingerprint.
export interface BindingPreview {
  type: { module: string; name: string };
  destination: string;
  perInstance: boolean;
  slots: {
    slot: string;
    key: 'userKey' | 'apiKey';
    snapshot: BindingSnapshot;
    fingerprint: string;
  }[];
}

export async function previewBinding(
  realmServerUrl: string,
  token: string,
  {
    realm,
    module,
    name,
    operation,
  }: { realm: string; module: string; name: string; operation: string },
  fetchFn: FetchFn = fetch,
): Promise<BindingPreview> {
  let query = new URLSearchParams({ realm, module, name, operation });
  let json = await realmServerRequest(
    realmServerUrl,
    `_key-bindings/preview?${query}`,
    { token, fetchFn },
  );
  return json.data.attributes as BindingPreview;
}

// Removes one of the user's grants, revoking every binding sent under it.
export async function removeGrant(
  realmServerUrl: string,
  token: string,
  grantId: string,
  fetchFn: FetchFn = fetch,
): Promise<{ revokedBindings: string[] }> {
  let json = await realmServerRequest(
    realmServerUrl,
    `_user-key-grants/${encodeURIComponent(grantId)}`,
    { method: 'DELETE', token, fetchFn },
  );
  return { revokedBindings: json?.meta?.revokedBindings ?? [] };
}
