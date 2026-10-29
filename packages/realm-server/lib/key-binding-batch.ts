import {
  logger,
  param,
  query,
  rri,
  trimExecutableExtension,
  type DBAdapter,
  type Definition,
} from '@cardstack/runtime-common';
import {
  destinationCovers,
  type CallApiSlot,
  type OperationCallApi,
  type OperationDefinition,
} from '@cardstack/runtime-common/card-operations';
import { operationDisplayLabel } from '@cardstack/runtime-common/card-operations/label';
import {
  bindingSnapshot,
  canonicalInstance,
  fingerprintOf,
  slotToken,
  type BindingSnapshot,
  type KeyBinding,
} from './key-bindings.ts';
import {
  describeDestination,
  resolveWindowRequest,
  type Deps,
  type DestinationDisplay,
  type SecureWindowTarget,
} from './secure-window.ts';
import { normalizeGrantDestination } from './user-key-grants.ts';
import { UserKeyError, type UserKeyKind } from './user-keys.ts';

// The batch the secure window approves in one confirmation: every `callApi`
// operation on one card definition, in one realm, that needs the caller's
// approval, read from the definition cache and the binding tables now.
//
// An operation needs the caller's approval for a slot when the caller is the
// one who approves it — their own key for a `{{userKey}}` slot, a share of
// theirs in the realm for an `{{apiKey}}` slot — and the slot has no binding,
// has one whose grant is gone, or has one whose request has changed since it
// was approved. Approvals are for pipelines only, so a binding approved for
// them is approved. A slot approved and unchanged is left out, and so
// is an operation with nothing left. Review asks only for the changed ones.
//
// A batch never spans card definitions or realms: it is one type's
// operations, approved in the realm the window was opened for. An operation
// approved per instance is in the batch only when the window was opened for a
// card, and is approved for that card.
//
// The answer carries what the window shows and what the approval names back:
// each slot's request and fingerprint, the snapshot it was last approved with
// (for a changed slot, so the window can diff the two field by field), the
// caller's keys a slot can take and the shares of theirs in the realm, each
// with the destinations in the batch its grants already cover. Nothing of any
// key's value is read.

const log = logger('realm:key-bindings');

export type BatchSlotStatus = 'new' | 'changed';

export interface BatchSlot {
  // The token the slot is written as: `userKey`, `apiKey`, `apiKey:<name>`.
  slot: string;
  key: CallApiSlot['key'];
  status: BatchSlotStatus;
  snapshot: BindingSnapshot;
  fingerprint: string;
  // What the slot was last approved with: the request, and the key or share
  // that filled it. Absent for a slot never approved.
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
  // The URL as declared, without its origin: its path, with `{name}`
  // segments, and its query.
  path: string;
  // The card it is approved for, when it is approved per instance.
  instance: string | null;
  status: BatchSlotStatus;
  slots: BatchSlot[];
}

export interface BatchGroup {
  destination: DestinationDisplay;
  operations: BatchOperation[];
}

// A key of the caller's that a `{{userKey}}` slot can take, with the batch's
// destinations its grants already cover.
export interface BatchKey {
  id: string;
  name: string;
  kind: UserKeyKind;
  state: string;
  covers: string[];
}

// A share of the caller's in the realm, for an `{{apiKey}}` slot.
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
  keys: BatchKey[];
  shares: BatchShare[];
}

export interface ApprovalBatchRequest {
  target: SecureWindowTarget;
  review?: boolean;
}

// What a binding is read as here, with the snapshot of its last approval.
interface BindingRow {
  slot: string;
  key_id: string | null;
  share_id: string | null;
  approved_by: string;
  fingerprint: string;
  state: string;
  // Whether its grant is still there for its key, or its share's key.
  has_grant: boolean;
  share_owner: string | null;
  share_state: string | null;
  destination: string;
  method: string;
  path_template: string;
  headers_template: string;
  placement: string;
  placement_name: string;
  transform: string | null;
  body_template: string | null;
}

function snapshotOf(row: BindingRow): BindingSnapshot {
  return {
    destination: row.destination,
    method: row.method,
    pathTemplate: row.path_template,
    headersTemplate: row.headers_template,
    placement: row.placement,
    placementName: row.placement_name,
    transform: row.transform,
    bodyTemplate: row.body_template,
  };
}

// The operation's URL as a person reads it beside its host: everything after
// the origin.
function pathOf(url: string): string {
  let origin = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(url)?.[0] ?? '';
  return url.slice(origin.length) || '/';
}

// A `callApi` operation that sends a credential and whose declaration has no
// problems: the operations a binding can be approved for.
function approvable(
  operation: OperationDefinition,
): operation is OperationDefinition & { callApi: OperationCallApi } {
  return (
    operation.base === 'callApi' &&
    !operation.invalid &&
    operation.callApi !== undefined &&
    operation.callApi.slots.length > 0
  );
}

export async function approvalBatch(
  deps: Deps,
  user: string,
  { target, review = false }: ApprovalBatchRequest,
): Promise<ApprovalBatch> {
  let { dbAdapter } = deps;
  let resolved = await resolveWindowRequest(deps, user, { target });
  let { realm, realmName } = resolved;
  let { codeRef, instanceURL, definition } = resolved.target!;
  let realmURL = new URL(realm.url);
  let resolvedType = realm.operationCore.resolveCodeRef(codeRef, realmURL);
  if (!resolvedType) {
    throw new UserKeyError(404, 'no such realm, card or operation');
  }
  // Bindings name the type with its module resolved against the realm and
  // its executable extension trimmed, as `bindingType` does.
  let type = {
    module: trimExecutableExtension(String(resolvedType.module)),
    name: resolvedType.name,
  };
  let instance = instanceURL
    ? canonicalInstance(realmURL, instanceURL.href)
    : null;

  let rows = await bindingRows(dbAdapter, realmURL.href, type, user);
  let ownShares = await sharesIn(dbAdapter, realmURL.href, user);

  let groups = new Map<string, BatchGroup>();
  for (let [name, operation] of Object.entries(definition.operations ?? {})) {
    if (!approvable(operation)) {
      continue;
    }
    let request = operation.callApi;
    if (request.perInstance && !instance) {
      continue;
    }
    let forInstance = request.perInstance ? instance : null;
    let slots: BatchSlot[] = [];
    for (let slot of request.slots) {
      let token = slotToken(slot);
      let snapshot = bindingSnapshot(request, slot);
      let fingerprint = fingerprintOf(snapshot);
      let row = rows.find(
        (r) =>
          r.operation_name === name &&
          (r.instance_url ?? null) === forInstance &&
          r.slot === token &&
          (slot.key === 'userKey'
            ? r.key_id !== null && r.approved_by === user
            : r.share_id !== null),
      );
      let status = slotStatus(row, slot, fingerprint, {
        user,
        ownsShareHere: ownShares.length > 0,
      });
      if (!status || (review && status !== 'changed')) {
        continue;
      }
      slots.push({
        slot: token,
        key: slot.key,
        status,
        snapshot,
        fingerprint,
        ...(row
          ? {
              approved: {
                snapshot: snapshotOf(row),
                keyId: row.key_id,
                shareId: row.share_id,
              },
            }
          : {}),
      });
    }
    if (slots.length === 0) {
      continue;
    }
    let destination = normalizeGrantDestination(request.destination);
    let group = groups.get(destination);
    if (!group) {
      group = { destination: describeDestination(destination), operations: [] };
      groups.set(destination, group);
    }
    group.operations.push({
      name,
      label: operationDisplayLabel(name, operation),
      method: request.method,
      path: pathOf(request.url),
      instance: forInstance,
      status: slots.some((s) => s.status === 'changed') ? 'changed' : 'new',
      slots,
    });
  }

  let sorted = [...groups.values()].sort((a, b) =>
    a.destination.href.localeCompare(b.destination.href),
  );
  for (let group of sorted) {
    group.operations.sort(
      (a, b) => a.label.localeCompare(b.label) || a.name.localeCompare(b.name),
    );
  }
  let destinations = sorted.map((g) => g.destination.href);
  let coveredBy = (grants: string[]) =>
    destinations.filter((d) => grants.some((g) => destinationCovers(g, d)));

  let needsUserKey = sorted.some((g) =>
    g.operations.some((o) => o.slots.some((s) => s.key === 'userKey')),
  );
  let needsShare = sorted.some((g) =>
    g.operations.some((o) => o.slots.some((s) => s.key !== 'userKey')),
  );
  return {
    realm: { url: realm.url, name: realmName },
    card: {
      name: definition.displayName ?? codeRef.name,
      module: codeRef.module,
      exportName: codeRef.name,
    },
    instance,
    review,
    groups: sorted,
    keys: needsUserKey
      ? (await slotKeys(dbAdapter, user)).map(({ grants, ...key }) => ({
          ...key,
          covers: coveredBy(grants),
        }))
      : [],
    shares: needsShare
      ? ownShares.map(({ grants, ...share }) => ({
          ...share,
          covers: coveredBy(grants),
        }))
      : [],
  };
}

// What the key page names each of the owner's bindings by, as the approval
// batch names them: its operation's label and its card definition's display
// name. Each type is looked up once, the way a batch looks it up
// (`resolveWindowRequest`), so a realm or module the owner can't read says
// nothing here, and a name never depends on what the definition cache happens
// to hold: the lookup mounts a realm that isn't mounted yet and fills the
// cache on a miss, as opening the approve page would. A type that can't be
// read, for any reason, is named by its export name, and its operations by
// their names split into words, which tells nothing the binding row doesn't
// already hold. So one realm that fails to mount names only its own
// bindings that way, and the listing still answers.
export interface BindingNames {
  operationLabel: string;
  cardName: string;
}

export async function bindingNames(
  deps: Deps,
  owner: string,
  bindings: KeyBinding[],
): Promise<BindingNames[]> {
  let definitions = new Map<string, Promise<Definition | undefined>>();
  let definitionOf = (binding: KeyBinding) => {
    let { realm, type } = binding;
    let cacheKey = JSON.stringify([realm, type.module, type.name]);
    let definition = definitions.get(cacheKey);
    if (!definition) {
      definition = resolveWindowRequest(deps, owner, {
        target: {
          kind: 'type',
          realm: rri(realm),
          module: rri(type.module),
          name: type.name,
        },
      }).then(
        ({ target }) => target?.definition,
        (error) => {
          if (!(error instanceof UserKeyError)) {
            log.warn(
              `naming bindings of ${type.module}#${type.name} in ${realm}: ${String(error)}`,
            );
          }
          return undefined;
        },
      );
      definitions.set(cacheKey, definition);
    }
    return definition;
  };
  return await Promise.all(
    bindings.map(async (binding) => {
      let definition = await definitionOf(binding);
      let operations = definition?.operations ?? {};
      return {
        operationLabel: operationDisplayLabel(
          binding.operation,
          Object.hasOwn(operations, binding.operation)
            ? operations[binding.operation]
            : undefined,
        ),
        cardName: definition?.displayName ?? binding.type.name,
      };
    }),
  );
}

// Whether a slot needs the caller's approval, and why; undefined when it
// doesn't, or when it isn't the caller's to approve.
function slotStatus(
  row: BindingRow | undefined,
  slot: CallApiSlot,
  fingerprint: string,
  { user, ownsShareHere }: { user: string; ownsShareHere: boolean },
): BatchSlotStatus | undefined {
  // A share slot is approved by the owner of the share's key. Its binding
  // serves every caller, so one someone else approved is theirs to keep up,
  // and with none, only a caller with a share here can approve one.
  if (slot.key !== 'userKey') {
    if (row ? row.share_owner !== user : !ownsShareHere) {
      return undefined;
    }
    // A suspended share is resumed or swapped, not approved again.
    if (row && row.share_state !== 'active') {
      return undefined;
    }
  }
  if (!row || !row.has_grant) {
    return 'new';
  }
  if (row.state === 'needs-reapproval' || row.fingerprint !== fingerprint) {
    return 'changed';
  }
  return undefined;
}

async function bindingRows(
  dbAdapter: DBAdapter,
  realmURL: string,
  type: { module: string; name: string },
  user: string,
): Promise<
  (BindingRow & { operation_name: string; instance_url: string | null })[]
> {
  return (await query(dbAdapter, [
    `SELECT b.operation_name, b.instance_url, b.slot, b.key_id, b.share_id, b.approved_by, b.fingerprint, b.state,
            (g.id IS NOT NULL) AS has_grant, s.owner AS share_owner, s.state AS share_state,
            a.destination, a.method, a.path_template, a.headers_template, a.placement, a.placement_name, a.transform, a.body_template
       FROM key_bindings b
       JOIN key_binding_approvals a ON a.id = b.approval_id
       LEFT JOIN key_shares s ON s.id = b.share_id
       LEFT JOIN user_key_grants g ON g.id = b.grant_id AND g.key_id = COALESCE(b.key_id, s.key_id)
      WHERE b.realm_url = `,
    param(realmURL),
    ` AND b.definition_url = `,
    param(type.module),
    ` AND b.export_name = `,
    param(type.name),
    ` AND (b.share_id IS NOT NULL OR b.approved_by = `,
    param(user),
    `)`,
  ])) as unknown as (BindingRow & {
    operation_name: string;
    instance_url: string | null;
  })[];
}

// The caller's keys a `{{userKey}}` slot can take, by name, each with its
// grants' destinations. An OAuth client that only signs people in is never
// granted a destination, so it is left out.
async function slotKeys(
  dbAdapter: DBAdapter,
  user: string,
): Promise<(Omit<BatchKey, 'covers'> & { grants: string[] })[]> {
  let rows = await query(dbAdapter, [
    `SELECT k.id, k.name, k.kind, k.state,
            COALESCE(ARRAY_AGG(g.destination) FILTER (WHERE g.id IS NOT NULL), '{}') AS grants
       FROM user_keys k
       LEFT JOIN oauth_clients c ON c.key_id = k.id
       LEFT JOIN user_key_grants g ON g.key_id = k.id
      WHERE k.owner = `,
    param(user),
    ` AND (k.kind <> 'oauth-client' OR c.grant_type = 'client_credentials')
      GROUP BY k.id, k.name, k.kind, k.state
      ORDER BY k.name`,
  ]);
  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    kind: row.kind as UserKeyKind,
    state: row.state as string,
    grants: grantList(row.grants),
  }));
}

// The caller's active shares in the realm, by label, each with its key's
// grants' destinations.
async function sharesIn(
  dbAdapter: DBAdapter,
  realmURL: string,
  user: string,
): Promise<(Omit<BatchShare, 'covers'> & { grants: string[] })[]> {
  let rows = await query(dbAdapter, [
    `SELECT s.id, s.label, s.key_id, k.name AS key_name,
            COALESCE(ARRAY_AGG(g.destination) FILTER (WHERE g.id IS NOT NULL), '{}') AS grants
       FROM key_shares s
       JOIN user_keys k ON k.id = s.key_id
       LEFT JOIN user_key_grants g ON g.key_id = s.key_id
      WHERE s.realm_url = `,
    param(realmURL),
    ` AND s.owner = `,
    param(user),
    ` AND s.state = 'active'
      GROUP BY s.id, s.label, s.key_id, k.name
      ORDER BY s.label`,
  ]);
  return rows.map((row) => ({
    id: row.id as string,
    label: row.label as string,
    keyId: row.key_id as string,
    keyName: row.key_name as string,
    grants: grantList(row.grants),
  }));
}

// An aggregated array column, as the adapter returns it: an array, or
// Postgres' text form of one.
function grantList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value as string[];
  }
  if (typeof value === 'string') {
    let inner = value.replace(/^\{|\}$/g, '');
    return inner === ''
      ? []
      : inner.split(',').map((item) => item.replace(/^"|"$/g, ''));
  }
  return [];
}
