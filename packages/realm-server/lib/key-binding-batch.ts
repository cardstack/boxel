import {
  keyFitsSlot,
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
  slotKeyKinds,
  type CallApiKeyKind,
  type CallApiSlot,
  type OperationCallApi,
  type OperationDefinition,
} from '@cardstack/runtime-common/card-operations';
import { operationDisplayLabel } from '@cardstack/runtime-common/card-operations/label';
import {
  bindingSnapshot,
  canonicalInstance,
  fingerprintOf,
  MAX_BATCH_SLOTS,
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
import { limitsOf } from './key-limit-settings.ts';
import {
  apiHostList,
  apiHostsOfKeySql,
  apiHostsServe,
  arrayColumn,
  sendableKeySql,
} from './oauth.ts';
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
// was approved. Asked with `interactive`, a slot approved for pipelines only
// needs it too (`pipelines-only`), so a card that is refused
// `interactive-use-not-approved` can be approved for it: the window offers
// those only when the user chooses interactive use. A slot approved and
// unchanged is left out, and so is an operation with nothing left. Review asks
// only for the changed ones.
//
// One confirmation approves at most `MAX_BATCH_SLOTS` slots, so a batch
// holds the operations that fit, in the order the window shows them, and says
// how many more remain for the next one.
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

// `new`: never approved, or its grant is gone. `changed`: its request changed
// since it was approved. `pipelines-only`: approved, unchanged, for pipelines
// only, in a batch asked for with `interactive`.
export type BatchSlotStatus = 'new' | 'changed' | 'pipelines-only';

export interface BatchSlot {
  // The token the slot is written as: `userKey`, `apiKey`, `apiKey:<name>`.
  slot: string;
  key: CallApiSlot['key'];
  // The kind of key its declaration says fills it; only a key of that kind
  // may be approved for it.
  keyKind?: CallApiSlot['keyKind'];
  // The kinds of key that can fill it: its declared kind, or every kind its
  // request can take (`slotKeyKinds`).
  kinds: CallApiKeyKind[];
  status: BatchSlotStatus;
  snapshot: BindingSnapshot;
  fingerprint: string;
  // What the slot was last approved with: the request, and the key or share
  // that filled it. Absent for a slot never approved.
  approved?: {
    snapshot: BindingSnapshot;
    keyId: string | null;
    shareId: string | null;
    interactive: boolean;
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
  // Whether the realm's policy opens it to people who aren't signed in, who
  // are then served through a share whose key allows anonymous use
  // (`Realm.sharedKeyOperationsOpenToAnonymous`).
  openToAnonymous: boolean;
}

export interface BatchGroup {
  destination: DestinationDisplay;
  operations: BatchOperation[];
}

// A key of the caller's that a `{{userKey}}` slot can take, with the batch's
// destinations its grants already cover, and those its credential is good
// at.
export interface BatchKey {
  id: string;
  name: string;
  kind: UserKeyKind;
  state: string;
  covers: string[];
  serves: string[];
}

// A share of the caller's in the realm, for an `{{apiKey}}` slot, with
// whether any binding of it is approved for interactive use yet, and the
// daily budget in force. The first interactive approval of a share names its
// daily budget. Whether people who aren't signed in may use the share, and
// their cap, are the key's, as its owner set them.
export interface BatchShare {
  id: string;
  label: string;
  keyId: string;
  keyName: string;
  keyKind: UserKeyKind;
  covers: string[];
  // The batch's destinations its key's credential is good at.
  serves: string[];
  interactive: boolean;
  dailyBudget: number;
  anonymous: boolean;
  anonymousDailyCap: number | null;
  anonymousMonthlyCap: number | null;
}

export interface ApprovalBatch {
  realm: { url: string; name: string };
  card: { name: string; module: string; exportName: string };
  instance: string | null;
  review: boolean;
  groups: BatchGroup[];
  // How many more operations need approving than one confirmation can take:
  // they are asked for again once these are approved.
  remaining: number;
  // How many more operations approved for pipelines only were left out, in a
  // batch asked with `interactive`. They take only the room the operations
  // that need approving leave, so they never hold one back.
  remainingPipelinesOnly: number;
  keys: BatchKey[];
  shares: BatchShare[];
}

export interface ApprovalBatchRequest {
  target: SecureWindowTarget;
  review?: boolean;
  // Also answer slots approved for pipelines only.
  interactive?: boolean;
}

// What a binding is read as here, with the snapshot of its last approval.
interface BindingRow {
  slot: string;
  key_id: string | null;
  share_id: string | null;
  approved_by: string;
  fingerprint: string;
  state: string;
  interactive: boolean;
  // Whether its grant is still there for its key, or its share's key.
  has_grant: boolean;
  share_owner: string | null;
  share_state: string | null;
  // The kind of the key that fills it, its own or its share's.
  key_kind: string | null;
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
  { target, review = false, interactive = false }: ApprovalBatchRequest,
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
  let openToAnonymous = new Set(
    await realm.sharedKeyOperationsOpenToAnonymous(resolvedType),
  );
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
        interactive,
      });
      if (!status || (review && status !== 'changed')) {
        continue;
      }
      slots.push({
        slot: token,
        key: slot.key,
        ...(slot.keyKind ? { keyKind: slot.keyKind } : {}),
        kinds: slotKeyKinds(slot, request),
        status,
        snapshot,
        fingerprint,
        ...(row
          ? {
              approved: {
                snapshot: snapshotOf(row),
                keyId: row.key_id,
                shareId: row.share_id,
                interactive: Boolean(row.interactive),
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
      status: slots.some((s) => s.status === 'changed')
        ? 'changed'
        : slots.some((s) => s.status === 'new')
          ? 'new'
          : 'pipelines-only',
      slots,
      openToAnonymous: openToAnonymous.has(name),
    });
  }

  let sorted: BatchGroup[] = [...groups.values()].sort((a, b) =>
    a.destination.href.localeCompare(b.destination.href),
  );
  for (let group of sorted) {
    group.operations.sort(
      (a, b) => a.label.localeCompare(b.label) || a.name.localeCompare(b.name),
    );
  }
  let { kept, remaining, remainingPipelinesOnly } = withinSlotLimit(
    sorted,
    MAX_BATCH_SLOTS,
  );
  sorted = kept;
  let destinations = sorted.map((g) => g.destination.href);
  let coveredBy = (grants: string[]) =>
    destinations.filter((d) => grants.some((g) => destinationCovers(g, d)));
  let servedBy = (apiHosts: string[] | null) =>
    destinations.filter((d) => apiHostsServe(apiHosts, d));

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
    remaining,
    remainingPipelinesOnly,
    keys: needsUserKey
      ? (await slotKeys(dbAdapter, user)).map(
          ({ grants, apiHosts, ...key }) => ({
            ...key,
            covers: coveredBy(grants),
            serves: servedBy(apiHosts),
          }),
        )
      : [],
    shares: needsShare
      ? ownShares.map(({ grants, apiHosts, ...share }) => ({
          ...share,
          covers: coveredBy(grants),
          serves: servedBy(apiHosts),
        }))
      : [],
  };
}

// The operations one confirmation can approve, at most `max` slots in all, in
// the order the window shows them; an operation is never split. Operations
// that need approving (`new`, `changed`) come first; ones approved for
// pipelines only fill what room is left, so a card with more of those than
// one confirmation holds can't keep the ones that need approving out of every
// batch. Answers how many of each were left out, for the window to say they
// come next.
export function withinSlotLimit(
  groups: BatchGroup[],
  max: number,
): { kept: BatchGroup[]; remaining: number; remainingPipelinesOnly: number } {
  let slots = 0;
  let keep = new Set<BatchOperation>();
  let take = (pipelinesOnly: boolean) => {
    let left = 0;
    for (let group of groups) {
      for (let operation of group.operations) {
        if ((operation.status === 'pipelines-only') !== pipelinesOnly) {
          continue;
        }
        if (left === 0 && slots + operation.slots.length <= max) {
          slots += operation.slots.length;
          keep.add(operation);
        } else {
          left++;
        }
      }
    }
    return left;
  };
  let remaining = take(false);
  let remainingPipelinesOnly = take(true);
  let kept = groups
    .map((group) => ({
      ...group,
      operations: group.operations.filter((o) => keep.has(o)),
    }))
    .filter((group) => group.operations.length > 0);
  return { kept, remaining, remainingPipelinesOnly };
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
  {
    user,
    ownsShareHere,
    interactive,
  }: { user: string; ownsShareHere: boolean; interactive: boolean },
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
  if (
    row.state === 'needs-reapproval' ||
    row.fingerprint !== fingerprint ||
    (row.key_kind !== null && !keyFitsSlot(row.key_kind, slot.keyKind))
  ) {
    return 'changed';
  }
  if (interactive && !row.interactive) {
    return 'pipelines-only';
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
    `SELECT b.operation_name, b.instance_url, b.slot, b.key_id, b.share_id, b.approved_by, b.fingerprint, b.state, b.interactive,
            (g.id IS NOT NULL) AS has_grant, s.owner AS share_owner, s.state AS share_state,
            (SELECT k.kind FROM user_keys k WHERE k.id = COALESCE(b.key_id, s.key_id)) AS key_kind,
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
// grants' destinations and, for an OAuth key, its client's API hosts. An
// OAuth client that only signs people in is never granted a destination, so
// it is left out.
async function slotKeys(
  dbAdapter: DBAdapter,
  user: string,
): Promise<
  (Omit<BatchKey, 'covers' | 'serves'> & {
    grants: string[];
    apiHosts: string[] | null;
  })[]
> {
  let rows = await query(dbAdapter, [
    `SELECT k.id, k.name, k.kind, k.state, ${apiHostsOfKeySql('k.id')} AS api_hosts,
            COALESCE(ARRAY_AGG(g.destination) FILTER (WHERE g.id IS NOT NULL), '{}') AS grants
       FROM user_keys k
       LEFT JOIN user_key_grants g ON g.key_id = k.id
      WHERE k.owner = `,
    param(user),
    ` AND ${sendableKeySql('k.id')}
      GROUP BY k.id, k.name, k.kind, k.state
      ORDER BY k.name`,
  ]);
  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    kind: row.kind as UserKeyKind,
    state: row.state as string,
    grants: arrayColumn(row.grants),
    apiHosts: apiHostList(row.api_hosts),
  }));
}

// The caller's active shares in the realm, by label, each with its key's
// grants' destinations and, for an OAuth key, its client's API hosts. A
// share of an OAuth client that only signs people in is how teammates
// connect their own accounts, never a credential a request sends, so it is
// left out.
async function sharesIn(
  dbAdapter: DBAdapter,
  realmURL: string,
  user: string,
): Promise<
  (Omit<BatchShare, 'covers' | 'serves'> & {
    grants: string[];
    apiHosts: string[] | null;
  })[]
> {
  let rows = await query(dbAdapter, [
    `SELECT s.id, s.label, s.key_id, k.name AS key_name, k.kind AS key_kind, ${apiHostsOfKeySql('s.key_id')} AS api_hosts, s.daily_budget, k.anonymous, k.anonymous_daily_cap, k.anonymous_monthly_cap,
            EXISTS (SELECT 1 FROM key_bindings b WHERE b.share_id = s.id AND b.interactive) AS interactive,
            COALESCE(ARRAY_AGG(g.destination) FILTER (WHERE g.id IS NOT NULL), '{}') AS grants
       FROM key_shares s
       JOIN user_keys k ON k.id = s.key_id
       LEFT JOIN user_key_grants g ON g.key_id = s.key_id
      WHERE s.realm_url = `,
    param(realmURL),
    ` AND s.owner = `,
    param(user),
    ` AND s.state = 'active'
        AND ${sendableKeySql('s.key_id')}
      GROUP BY s.id, s.label, s.key_id, k.name, k.kind, s.daily_budget, k.anonymous, k.anonymous_daily_cap, k.anonymous_monthly_cap
      ORDER BY s.label`,
  ]);
  return rows.map((row) => ({
    id: row.id as string,
    label: row.label as string,
    keyId: row.key_id as string,
    keyName: row.key_name as string,
    keyKind: row.key_kind as UserKeyKind,
    grants: arrayColumn(row.grants),
    apiHosts: apiHostList(row.api_hosts),
    interactive: Boolean(row.interactive),
    dailyBudget: limitsOf(row).dailyBudget,
    anonymous: Boolean(row.anonymous),
    anonymousDailyCap:
      row.anonymous_daily_cap == null ? null : Number(row.anonymous_daily_cap),
    anonymousMonthlyCap:
      row.anonymous_monthly_cap == null
        ? null
        : Number(row.anonymous_monthly_cap),
  }));
}
