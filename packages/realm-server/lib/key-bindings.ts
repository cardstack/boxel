import { createHash, randomUUID } from 'node:crypto';
import {
  keyFitsSlot,
  logger,
  param,
  query,
  RealmPaths,
  rri,
  trimExecutableExtension,
  type DBAdapter,
  type Expression,
  type LocalPath,
  type Querier,
} from '@cardstack/runtime-common';
import type { CodeRef } from '@cardstack/runtime-common/code-ref';
import {
  notApproved,
  OperationFailure,
  type CallApiFilledSlot,
  type CallApiSlot,
  type CallApiSlotLookup,
  type OperationCallApi,
  type OperationCore,
} from '@cardstack/runtime-common/card-operations';
import {
  SecretDecryptionError,
  type SecretsKeyring,
} from './secrets-at-rest/index.ts';
import type { SecureSessionClient } from './secure-session.ts';
import { revokeBindingsIn } from './key-binding-revocation.ts';
import {
  createOrReuseGrantIn,
  lookupGrantOperation,
  normalizeGrantDestination,
  openGrantForSending,
  operationGrantDestination,
  type UserKeyGrant,
  type UserKeyGrantState,
} from './user-key-grants.ts';
import {
  MINTING_KINDS,
  UserKeyError,
  type UserKeyKind,
  type UserKeyState,
} from './user-keys.ts';
import {
  oauthAccessToken,
  OAuthTokenError,
  type OAuthTokenFailure,
} from './oauth.ts';
import {
  serviceAccountAccessToken,
  ServiceAccountTokenError,
} from './google-service-account-keys.ts';
import {
  claimKeyProbe,
  claimProbe,
  clearKeyRejected,
  credentialRejected,
  DEFAULT_PROBE_INTERVAL_MS,
  emitKeyGrantEvent,
  hostOf,
  markKeyRejected,
  probeDue,
} from './key-grant-rejection.ts';
import {
  chargeInteractiveCall,
  validateLimitChanges,
  type LimitSubject,
} from './key-limits.ts';
import { refusedFrom, subjectOfRefusal } from './key-use-subject.ts';
import { recordFillRefusal } from './key-uses.ts';

// Bindings: a key owner's approval for one `callApi` operation, in one realm,
// to send a chosen key in one of the operation's credential slots. Card code
// never names a key; the binding does, so nothing is searched when the
// operation is invoked and nothing can be ambiguous.
//
// - **One binding per slot.** A `{{userKey}}` slot is filled from the
//   caller's own binding, approved with one of their own keys, and serves only
//   them. An `{{apiKey}}` slot is filled from the realm's binding to a share,
//   approved by the owner of the share's key, and serves every caller there.
//   An operation declared `perInstance` is approved for each card on its own.
// - **Per realm.** An operation reads its instance's fields, and whoever can
//   write a realm controls those, so approving it in one realm says nothing
//   about another.
// - **Under a grant.** Approving creates or reuses a grant of the key for the
//   operation's destination (`user-key-grants.ts`), and the binding records
//   it. The credential is that grant's copy, opened under the destination the
//   grant stored, and the request is sent only where that destination covers
//   it, checked on the request as built and before anything is filled in.
// - **Checked by fingerprint.** The binding records a SHA-256 of the request
//   as approved (`bindingSnapshot`): what reaches the vendor, never the
//   label or the response mapping. Every call compares it with what the
//   definition cache lowers the operation to now. A binding whose request has
//   changed goes to `needs-reapproval`, its owner gets one notice, and nothing
//   is sent until they approve the new request.
// - **Pipelines, and interactive use when approved for it.** A pipeline the
//   realm server runs as its payer (`Realm.handlePipeline`) is served by any
//   active binding. An interactive invocation — a card in the browser, the AI
//   assistant, the CLI — is served only by a binding approved `interactive`,
//   and refused `interactive-use-not-approved` by one approved for pipelines
//   only. Approving interactive use is the owner's choice for the whole
//   confirmation; a share's first interactive approval also sets the share's
//   daily budget, since every reader of its realm can then spend it.
// - **Anonymous use, of a key whose owner allows it.** A caller who isn't
//   signed in, whom the realm's policy admits to the operation, is served by
//   an interactive share binding only when the key the share holds allows
//   anonymous use, which its owner decides for the key itself
//   (`user-keys.ts`). Any other binding refuses them
//   `anonymous-use-not-approved`. A `{{userKey}}` slot never fills for such a
//   caller. A binding itself is never approved for anonymous use: whether
//   visitors are served follows the policy and the key, so the two can't
//   disagree binding by binding.
// - **Within the owner's limits.** An interactive call counts against the
//   limits of the share or key filling each slot, and is refused
//   `rate-limited`, `over-budget` or `rate-limit-unavailable` before anything
//   is opened (`key-limits.ts`). A pipeline's call doesn't count.
// - **Approved only on the secure origin.** Approving and revoking take a
//   session signed in on the secure origin, from the secure window or the CLI
//   (`handle-key-bindings.ts`), never the app page's session, which card code
//   can reach.
//
// Each approval, re-approval and revocation appends a row to
// `key_binding_approvals` with a readable copy of the request, for people: the
// review of a changed request diffs against it, and an owner's history reads
// it. The call path reads only the fingerprint.

export type KeyBindingState = 'active' | 'needs-reapproval' | 'suspended';

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
  state: KeyBindingState;
}

// What a binding's fingerprint is taken over, as text a person can read. Each
// template keeps its typed references (a parameter, a field of the instance)
// as the markers lowering wrote, so a value an invocation fills is a
// placeholder here.
export interface BindingSnapshot {
  destination: string;
  method: string;
  // The URL with its `{name}` segments, what fills each of them, and the query
  // string.
  pathTemplate: string;
  headersTemplate: string;
  // Where the slot's key goes (`header`, `query`, `path`, `body`) and under
  // what name: the header or query parameter, the path segment, or the dotted
  // path in the body.
  placement: string;
  placementName: string;
  transform: string | null;
  // The JSON body, or the GraphQL document and its variables.
  bodyTemplate: string | null;
}

const BINDING_COLUMNS = `id, realm_url, definition_url, export_name, operation_name, instance_url, slot, key_id, share_id, grant_id, approved_by, interactive, anonymous, fingerprint, approval_id, state`;

const log = logger('realm:key-bindings');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The most operation slots one confirmation may approve.
export const MAX_BATCH_SLOTS = 100;

function toBinding(row: Record<string, unknown>): KeyBinding {
  return {
    id: row.id as string,
    realm: row.realm_url as string,
    type: {
      module: row.definition_url as string,
      name: row.export_name as string,
    },
    operation: row.operation_name as string,
    instance: (row.instance_url as string | null) ?? null,
    slot: row.slot as string,
    keyId: (row.key_id as string | null) ?? null,
    shareId: (row.share_id as string | null) ?? null,
    grantId: (row.grant_id as string | null) ?? null,
    approvedBy: row.approved_by as string,
    interactive: Boolean(row.interactive),
    anonymous: Boolean(row.anonymous),
    fingerprint: row.fingerprint as string,
    approvalId: row.approval_id as string,
    state: row.state as KeyBindingState,
  };
}

// The token a slot is written as in the declaration, which is how a binding
// names it: `userKey`, `apiKey`, or `apiKey:token` for a named slot.
export function slotToken(slot: Pick<CallApiSlot, 'key' | 'name'>): string {
  return slot.name === slot.key ? slot.key : `${slot.key}:${slot.name}`;
}

// JSON with every object's members in UTF-16 code-unit order (the order `<`
// compares strings in), so one template
// always encodes to the same text however its declaration was written.
function canonicalJSON(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJSON).join(',')}]`;
  }
  let entries = Object.entries(value as Record<string, unknown>)
    .filter(([, member]) => member !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJSON(member)}`)
    .join(',')}}`;
}

// The request as a binding for `slot` records it.
export function bindingSnapshot(
  request: OperationCallApi,
  slot: Pick<CallApiSlot, 'placement' | 'at' | 'transform'>,
): BindingSnapshot {
  return {
    destination: request.destination,
    method: request.method,
    pathTemplate: canonicalJSON({
      url: request.url,
      path: request.path ?? {},
      query: request.query ?? {},
    }),
    headersTemplate: canonicalJSON(request.headers ?? {}),
    placement: slot.placement,
    // `headers.authorization` is the `authorization` header; `json.auth.token`
    // is `auth.token` in the body.
    placementName: slot.at.slice(slot.at.indexOf('.') + 1),
    transform: slot.transform ?? null,
    bodyTemplate: request.body ? canonicalJSON(request.body) : null,
  };
}

// SHA-256 over the snapshot's fields, in a fixed order and encoding, as hex.
export function fingerprintOf(snapshot: BindingSnapshot): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'boxel-key-binding-v1',
        snapshot.destination,
        snapshot.method,
        snapshot.pathTemplate,
        snapshot.headersTemplate,
        snapshot.placement,
        snapshot.placementName,
        snapshot.transform,
        snapshot.bodyTemplate,
      ]),
    )
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Approving
// ---------------------------------------------------------------------------

export interface OperationApproval {
  // The operation's type, resolved against the realm, and its name there.
  codeRef: CodeRef;
  operation: string;
  // The card, for an operation declared `perInstance`.
  instance?: string;
  // The destination the approver was shown. Approving is refused when the
  // operation sends elsewhere now.
  expectedDestination: string;
  // What fills each slot being approved, by its token: one of the approver's
  // own keys for a `userKey` slot, a share in the realm for an `apiKey` slot.
  // `expectedFingerprint` is the fingerprint of the request the approver was
  // shown for that slot (`previewBindings`). Approving is refused when the
  // operation sends anything else now, so an edit between showing a request
  // and approving it — the key moved from a header into the body, say — is
  // never approved unseen.
  slots: Record<
    string,
    { keyId?: string; shareId?: string; expectedFingerprint?: string }
  >;
}

function codeRefOf(type: { module: string; name: string }): CodeRef {
  return { module: rri(type.module), name: type.name };
}

// The type an operation is bound through, as bindings record it and calls
// look it up: the module resolved against the realm with any executable
// extension trimmed, so `…/inbox` and `…/inbox.gts` name one type.
export function bindingType(
  core: Pick<OperationCore, 'resolveCodeRef'>,
  codeRef: CodeRef,
  relativeTo: URL,
): { module: string; name: string } | undefined {
  let resolved = core.resolveCodeRef(codeRef, relativeTo);
  return resolved
    ? {
        module: trimExecutableExtension(String(resolved.module)),
        name: resolved.name,
      }
    : undefined;
}

export interface SlotPreview {
  slot: string;
  key: CallApiSlot['key'];
  snapshot: BindingSnapshot;
  fingerprint: string;
}

// What approving an operation would record for each of its slots, read from
// the definition cache now: the request as the approval screen shows it, and
// the fingerprint an approval of it names as `expectedFingerprint`. Reads
// nothing of anyone's keys.
export async function previewBindings(
  core: Pick<
    OperationCore,
    'resolveCodeRef' | 'definitionLookup' | 'readsRealmOf'
  >,
  {
    realmURL,
    codeRef,
    operation,
    caller,
  }: { realmURL: URL; codeRef: CodeRef; operation: string; caller: string },
): Promise<{
  type: { module: string; name: string };
  destination: string;
  perInstance: boolean;
  slots: SlotPreview[];
}> {
  let type = bindingType(core, codeRef, realmURL);
  let definition = type
    ? await lookupGrantOperation(
        core,
        realmURL,
        codeRefOf(type),
        operation,
        caller,
      )
    : undefined;
  let destination = operationGrantDestination(definition);
  let request = definition!.callApi!;
  return {
    type: type!,
    destination,
    perInstance: request.perInstance === true,
    slots: request.slots.map((slot) => {
      let snapshot = bindingSnapshot(request, slot);
      return {
        slot: slotToken(slot),
        key: slot.key,
        snapshot,
        fingerprint: fingerprintOf(snapshot),
      };
    }),
  };
}

export interface ApprovedBinding {
  binding: KeyBinding;
  snapshot: BindingSnapshot;
  grant: UserKeyGrant;
  grantCreated: boolean;
}

// One confirmation: approves every slot `operations` names, in `realm`, as
// `approver`. Each operation's grant is created or reused first, then every
// binding and its approval row is written in one transaction, all sharing
// one batch. A slot already bound is approved again: its key or share, grant
// and fingerprint move to what this confirmation says, and it is active.
export async function approveBindings(
  dbAdapter: DBAdapter,
  keyring: SecretsKeyring,
  {
    core,
    realmURL,
    approver,
    via,
    operations,
    interactive = false,
    anonymous,
    dailyBudgets = {},
  }: {
    core: Pick<
      OperationCore,
      'resolveCodeRef' | 'definitionLookup' | 'readsRealmOf'
    >;
    realmURL: URL;
    approver: string;
    via: SecureSessionClient;
    operations: OperationApproval[];
    // Approves interactive use as well as pipelines, for every slot.
    interactive?: boolean;
    anonymous?: boolean;
    // A daily budget for a share this approval fills, by share id. Required
    // for a share's first interactive approval, accepted for any share an
    // interactive approval fills, and refused otherwise.
    dailyBudgets?: Record<string, number>;
  },
): Promise<{ batchId: string; approved: ApprovedBinding[] }> {
  if (anonymous) {
    throw new UserKeyError(403, 'anonymous use of a binding is not offered');
  }
  for (let [shareId, budget] of Object.entries(dailyBudgets)) {
    if (!interactive) {
      throw new UserKeyError(
        400,
        'a daily budget is set with an approval for interactive use',
      );
    }
    let { dailyBudget } = validateLimitChanges({ dailyBudget: budget });
    if (dailyBudget == null) {
      throw new UserKeyError(
        400,
        `the daily budget for share ${shareId} is a whole number of calls`,
      );
    }
  }
  if (operations.length === 0) {
    throw new UserKeyError(400, 'an approval names at least one operation');
  }
  let slotCount = operations.reduce(
    (n, { slots }) => n + Object.keys(slots).length,
    0,
  );
  if (slotCount === 0) {
    throw new UserKeyError(400, 'an approval fills at least one slot');
  }
  if (slotCount > MAX_BATCH_SLOTS) {
    throw new UserKeyError(
      400,
      `an approval fills at most ${MAX_BATCH_SLOTS} slots`,
    );
  }

  // Read and check every operation before writing anything.
  let planned: {
    type: { module: string; name: string };
    operation: string;
    instance: string | null;
    request: OperationCallApi;
    destination: string;
    fills: { slot: CallApiSlot; keyId?: string; shareId?: string }[];
  }[] = [];
  for (let approval of operations) {
    let type = bindingType(core, approval.codeRef, realmURL);
    let definition = type
      ? await lookupGrantOperation(
          core,
          realmURL,
          codeRefOf(type),
          approval.operation,
          approver,
        )
      : undefined;
    let destination = operationGrantDestination(definition);
    let request = definition!.callApi!;
    if (
      destination !== normalizeGrantDestination(approval.expectedDestination)
    ) {
      throw new UserKeyError(
        409,
        `operation "${approval.operation}" sends to another destination than the one approved; show it again`,
      );
    }
    let instance: string | null = null;
    if (request.perInstance) {
      instance = instanceIn(realmURL, approval.instance, approval.operation);
    } else if (approval.instance !== undefined) {
      throw new UserKeyError(
        400,
        `operation "${approval.operation}" is approved for the realm, not per instance, so an approval of it names no instance`,
      );
    }
    let fills: (typeof planned)[number]['fills'] = [];
    for (let [token, fill] of Object.entries(approval.slots)) {
      let slot = request.slots.find((s) => slotToken(s) === token);
      if (!slot) {
        throw new UserKeyError(
          400,
          `operation "${approval.operation}" has no credential slot ${JSON.stringify(token)}`,
        );
      }
      if (!fill || typeof fill !== 'object') {
        throw new UserKeyError(
          400,
          `slot ${token} is filled with a key or a share`,
        );
      }
      if (typeof fill.expectedFingerprint !== 'string') {
        throw new UserKeyError(
          400,
          `slot ${token} names the fingerprint of the request its approver was shown, as expectedFingerprint`,
        );
      }
      if (
        fill.expectedFingerprint !==
        fingerprintOf(bindingSnapshot(request, slot))
      ) {
        throw new UserKeyError(
          409,
          `operation "${approval.operation}" sends another request than the one shown for slot ${token}; show it again`,
        );
      }
      if (slot.key === 'userKey') {
        if (typeof fill.keyId !== 'string' || fill.shareId !== undefined) {
          throw new UserKeyError(
            400,
            `slot ${token} is filled with one of your own keys, as keyId`,
          );
        }
        fills.push({ slot, keyId: fill.keyId });
      } else {
        if (typeof fill.shareId !== 'string' || fill.keyId !== undefined) {
          throw new UserKeyError(
            400,
            `slot ${token} is filled with one of the realm's shares, as shareId`,
          );
        }
        fills.push({ slot, shareId: fill.shareId });
      }
    }
    planned.push({
      type: type!,
      operation: approval.operation,
      instance,
      request,
      destination,
      fills,
    });
  }

  let filledShares = new Set(
    planned.flatMap((p) => p.fills.flatMap((f) => f.shareId ?? [])),
  );
  for (let shareId of Object.keys(dailyBudgets)) {
    if (!filledShares.has(shareId)) {
      throw new UserKeyError(
        400,
        `share ${shareId} fills no slot of this approval, so its daily budget isn't set here`,
      );
    }
  }

  let batchId = randomUUID();
  let approved: ApprovedBinding[] = [];
  await dbAdapter.withTransaction(async (txQuery) => {
    let shareKeys = new Map<string, string>();
    for (let shareId of [...filledShares].sort()) {
      shareKeys.set(
        shareId,
        await lockApprovableShare(txQuery, realmURL, shareId, approver),
      );
      if (interactive) {
        await setFirstInteractiveBudget(
          txQuery,
          shareId,
          dailyBudgets[shareId],
        );
      }
    }
    for (let plan of planned) {
      for (let fill of plan.fills) {
        let keyId =
          fill.shareId !== undefined ? shareKeys.get(fill.shareId) : fill.keyId;
        await assertKeyFitsSlot(txQuery, keyId!, fill.slot, plan.operation);
        let { grant, created } = await createOrReuseGrantIn(txQuery, keyring, {
          owner: approver,
          keyId: keyId!,
          destination: plan.destination,
          via,
        });
        let snapshot = bindingSnapshot(plan.request, fill.slot);
        let binding = await writeApproval(txQuery, {
          batchId,
          realmURL: realmURL.href,
          type: plan.type,
          operation: plan.operation,
          instance: plan.instance,
          slot: slotToken(fill.slot),
          keyId: fill.keyId ?? null,
          shareId: fill.shareId ?? null,
          grantId: grant.id,
          approver,
          via,
          snapshot,
          interactive,
        });
        approved.push({ binding, snapshot, grant, grantCreated: created });
      }
    }
  });
  return { batchId, approved };
}

// A card of the realm, as an operation approved per instance names it: the
// URL an invocation on it is addressed by once the realm canonicalizes its
// target (`canonicalizeTarget`), with the realm's root naming its index card
// and a trailing slash, query or fragment naming what it hangs off. A card's
// `.json` source names the card too. A prefix-form id is resolved to its URL
// before this is called.
export function canonicalInstance(realmURL: URL, instance: string): string {
  let url: URL;
  try {
    url = new URL(instance);
  } catch {
    throw new UserKeyError(400, 'an instance is the id of a card');
  }
  let paths = new RealmPaths(realmURL);
  let local: LocalPath;
  try {
    local = paths.local(url);
  } catch {
    throw new UserKeyError(400, 'an instance is a card in the realm');
  }
  local = local.replace(/\.json$/, '') as LocalPath;
  return paths.fileURL(local === '' ? ('index' as LocalPath) : local).href;
}

function instanceIn(
  realmURL: URL,
  instance: unknown,
  operation: string,
): string {
  if (typeof instance !== 'string') {
    throw new UserKeyError(
      400,
      `operation "${operation}" is approved per instance, so an approval of it names the card`,
    );
  }
  return canonicalInstance(realmURL, instance);
}

// The key a share in the realm holds, for its key's owner to approve it with,
// with the share locked so a swap or suspension waits for the approval.
// Refuses to approve a key of another kind than the slot's declaration names
// (`keyKind` on a `callApi`). A slot that declares no kind takes any key a
// grant can be made for.
async function assertKeyFitsSlot(
  txQuery: Querier,
  keyId: string,
  slot: CallApiSlot,
  operation: string,
): Promise<void> {
  if (!slot.keyKind || !UUID.test(keyId)) {
    return;
  }
  let [key] = await txQuery([
    `SELECT kind FROM user_keys WHERE id = `,
    param(keyId),
  ]);
  if (key && !keyFitsSlot(key.kind as string, slot.keyKind)) {
    throw new UserKeyError(
      400,
      `operation "${operation}" takes a ${KEY_KIND_NAMES[slot.keyKind]} in slot ${slotToken(slot)}, and this key is ${KEY_NAMES_BY_KIND[key.kind as string] ?? `a ${key.kind} key`}`,
    );
  }
}

const KEY_KIND_NAMES: Record<NonNullable<CallApiSlot['keyKind']>, string> = {
  static: 'key or token sent as it is',
  'google-service-account': 'Google service account',
  oauth: 'connected account',
};

const KEY_NAMES_BY_KIND: Record<string, string> = {
  static: 'a key or token sent as it is',
  'google-service-account': 'a Google service account',
  'oauth-connection': 'a connected account',
  'oauth-client': 'an OAuth client',
};

async function lockApprovableShare(
  txQuery: Querier,
  realmURL: URL,
  shareId: string,
  approver: string,
): Promise<string> {
  let [share] = UUID.test(shareId)
    ? await txQuery([
        `SELECT owner, key_id, state FROM key_shares WHERE id = `,
        param(shareId),
        ` AND realm_url = `,
        param(realmURL.href),
        ` FOR UPDATE`,
      ])
    : [];
  if (!share || share.owner !== approver || !share.key_id) {
    throw new UserKeyError(404, 'no such share of yours in the realm');
  }
  if (share.state !== 'active') {
    throw new UserKeyError(
      409,
      'the share is suspended; resume it or swap a key into it first',
    );
  }
  return share.key_id as string;
}

// A share approved for interactive use serves every reader of its realm, so
// the first approval that allows it names the share's daily budget, which is
// set with it. A later one may name one too, and sets it. Runs with the share
// locked, so two first approvals can't both skip it.
async function setFirstInteractiveBudget(
  txQuery: Querier,
  shareId: string,
  dailyBudget: number | undefined,
): Promise<void> {
  if (dailyBudget === undefined) {
    let [already] = await txQuery([
      `SELECT 1 FROM key_bindings WHERE share_id = `,
      param(shareId),
      ` AND interactive LIMIT 1`,
    ]);
    if (!already) {
      throw new UserKeyError(
        400,
        `share ${shareId} is approved for interactive use for the first time, so the approval names its daily budget, as dailyBudgets`,
      );
    }
    return;
  }
  await txQuery([
    `UPDATE key_shares SET daily_budget = `,
    param(dailyBudget),
    `, updated_at = NOW() WHERE id = `,
    param(shareId),
  ]);
}

// Writes one slot's approval: the binding, created or moved to what was just
// approved, and its approval row.
async function writeApproval(
  txQuery: Querier,
  {
    batchId,
    realmURL,
    type,
    operation,
    instance,
    slot,
    keyId,
    shareId,
    grantId,
    approver,
    via,
    snapshot,
    interactive,
  }: {
    batchId: string;
    realmURL: string;
    type: { module: string; name: string };
    operation: string;
    instance: string | null;
    slot: string;
    keyId: string | null;
    shareId: string | null;
    grantId: string;
    approver: string;
    via: SecureSessionClient;
    snapshot: BindingSnapshot;
    interactive: boolean;
  },
): Promise<KeyBinding> {
  let [existing] = await txQuery([
    `SELECT id FROM key_bindings WHERE realm_url = `,
    param(realmURL),
    ` AND definition_url = `,
    param(type.module),
    ` AND export_name = `,
    param(type.name),
    ` AND operation_name = `,
    param(operation),
    ` AND COALESCE(instance_url, '') = `,
    param(instance ?? ''),
    ` AND slot = `,
    param(slot),
    ...(keyId !== null
      ? [` AND key_id IS NOT NULL AND approved_by = `, param(approver)]
      : [` AND share_id IS NOT NULL`]),
    ` FOR UPDATE`,
  ]);
  let fingerprint = fingerprintOf(snapshot);
  let approvalId = randomUUID();
  let bindingId = (existing?.id as string | undefined) ?? randomUUID();
  let [row] = existing
    ? await txQuery([
        `UPDATE key_bindings SET key_id = `,
        param(keyId),
        `, share_id = `,
        param(shareId),
        `, grant_id = `,
        param(grantId),
        `, approved_by = `,
        param(approver),
        `, interactive = `,
        param(interactive),
        `, anonymous = false, fingerprint = `,
        param(fingerprint),
        `, approval_id = `,
        param(approvalId),
        `, state = 'active', updated_at = NOW() WHERE id = `,
        param(bindingId),
        ` RETURNING ${BINDING_COLUMNS}`,
      ])
    : await txQuery([
        `INSERT INTO key_bindings (id, realm_url, definition_url, export_name, operation_name, instance_url, slot, key_id, share_id, grant_id, approved_by, interactive, fingerprint, approval_id, state) VALUES (`,
        param(bindingId),
        `, `,
        param(realmURL),
        `, `,
        param(type.module),
        `, `,
        param(type.name),
        `, `,
        param(operation),
        `, `,
        param(instance),
        `, `,
        param(slot),
        `, `,
        param(keyId),
        `, `,
        param(shareId),
        `, `,
        param(grantId),
        `, `,
        param(approver),
        `, `,
        param(interactive),
        `, `,
        param(fingerprint),
        `, `,
        param(approvalId),
        `, 'active') RETURNING ${BINDING_COLUMNS}`,
      ]);
  await insertApprovalRow(txQuery, {
    id: approvalId,
    bindingId,
    batchId,
    grantId,
    action: existing ? 're-approved' : 'approved',
    realmURL,
    type,
    operation,
    instance,
    slot,
    keyId,
    shareId,
    snapshot,
    fingerprint,
    actor: approver,
    via,
    interactive,
  });
  return toBinding(row);
}

async function insertApprovalRow(
  txQuery: Querier,
  row: {
    id: string;
    bindingId: string;
    batchId: string;
    grantId: string;
    action: 'approved' | 're-approved';
    realmURL: string;
    type: { module: string; name: string };
    operation: string;
    instance: string | null;
    slot: string;
    keyId: string | null;
    shareId: string | null;
    snapshot: BindingSnapshot;
    fingerprint: string;
    actor: string;
    via: SecureSessionClient;
    interactive: boolean;
  },
): Promise<void> {
  let { snapshot } = row;
  await txQuery([
    `INSERT INTO key_binding_approvals (id, binding_id, batch_id, grant_id, action, interactive, anonymous, realm_url, definition_url, export_name, operation_name, instance_url, slot, key_id, share_id, destination, method, path_template, headers_template, placement, placement_name, transform, body_template, fingerprint, actor, via) VALUES (`,
    param(row.id),
    `, `,
    param(row.bindingId),
    `, `,
    param(row.batchId),
    `, `,
    param(row.grantId),
    `, `,
    param(row.action),
    `, `,
    param(row.interactive),
    `, false, `,
    param(row.realmURL),
    `, `,
    param(row.type.module),
    `, `,
    param(row.type.name),
    `, `,
    param(row.operation),
    `, `,
    param(row.instance),
    `, `,
    param(row.slot),
    `, `,
    param(row.keyId),
    `, `,
    param(row.shareId),
    `, `,
    param(snapshot.destination),
    `, `,
    param(snapshot.method),
    `, `,
    param(snapshot.pathTemplate),
    `, `,
    param(snapshot.headersTemplate),
    `, `,
    param(snapshot.placement),
    `, `,
    param(snapshot.placementName),
    `, `,
    param(snapshot.transform),
    `, `,
    param(snapshot.bodyTemplate),
    `, `,
    param(row.fingerprint),
    `, `,
    param(row.actor),
    `, `,
    param(row.via),
    `)`,
  ]);
}

// ---------------------------------------------------------------------------
// Revoking, listing
// ---------------------------------------------------------------------------

// Revokes one binding its owner approved. Its grant stays, for other bindings
// and later approvals. Another user's binding answers as one that doesn't
// exist.
export async function revokeBinding(
  dbAdapter: DBAdapter,
  {
    owner,
    bindingId,
    via,
  }: { owner: string; bindingId: string; via: SecureSessionClient },
): Promise<void> {
  if (!UUID.test(bindingId)) {
    throw new UserKeyError(404, 'no such binding');
  }
  let revoked = await dbAdapter.withTransaction((txQuery) =>
    revokeBindingsIn(txQuery, {
      where: [`id = `, param(bindingId), ` AND approved_by = `, param(owner)],
      actor: owner,
      via,
    }),
  );
  if (revoked.length === 0) {
    throw new UserKeyError(404, 'no such binding');
  }
}

// The bindings the user approved, in every realm.
export async function listOwnBindings(
  dbAdapter: DBAdapter,
  owner: string,
): Promise<KeyBinding[]> {
  let rows = await query(dbAdapter, [
    `SELECT ${BINDING_COLUMNS} FROM key_bindings WHERE approved_by = `,
    param(owner),
    ` ORDER BY realm_url, definition_url, export_name, operation_name, instance_url NULLS FIRST, slot`,
  ]);
  return rows.map(toBinding);
}

// ---------------------------------------------------------------------------
// Swapping a key into a share
// ---------------------------------------------------------------------------

// Moves a share's bindings to the key just swapped into it: each gets a grant
// of the new key for the destination it was last approved for, created or
// reused, the new owner as its approver, and a `re-approved` row. Its
// fingerprint stays: the new owner approves the request as it was approved.
// Runs in the swap's own transaction, with the share locked.
export async function moveShareBindingsIn(
  txQuery: Querier,
  keyring: SecretsKeyring,
  {
    shareId,
    keyId,
    owner,
    via,
  }: {
    shareId: string;
    keyId: string;
    owner: string;
    via: SecureSessionClient | undefined;
  },
): Promise<string[]> {
  let rows = await txQuery([
    `SELECT b.id, b.approval_id, b.fingerprint, b.interactive, last.realm_url, last.definition_url, last.export_name, last.operation_name, last.instance_url, last.slot, last.destination, last.method, last.path_template, last.headers_template, last.placement, last.placement_name, last.transform, last.body_template
       FROM key_bindings b JOIN key_binding_approvals last ON last.id = b.approval_id
      WHERE b.share_id = `,
    param(shareId),
    ` ORDER BY b.id FOR UPDATE OF b`,
  ]);
  if (rows.length === 0) {
    return [];
  }
  if (!via) {
    throw new UserKeyError(
      403,
      'the share has approved operations, so a key is swapped into it only from the secure window or the CLI',
    );
  }
  let batchId = randomUUID();
  let moved: string[] = [];
  for (let row of rows) {
    let { grant } = await createOrReuseGrantIn(txQuery, keyring, {
      owner,
      keyId,
      destination: row.destination,
      via,
    });
    let approvalId = randomUUID();
    await txQuery([
      `UPDATE key_bindings SET grant_id = `,
      param(grant.id),
      `, approved_by = `,
      param(owner),
      `, approval_id = `,
      param(approvalId),
      `, updated_at = NOW() WHERE id = `,
      param(row.id as string),
    ]);
    await insertApprovalRow(txQuery, {
      id: approvalId,
      bindingId: row.id as string,
      batchId,
      grantId: grant.id,
      action: 're-approved',
      realmURL: row.realm_url as string,
      type: {
        module: row.definition_url as string,
        name: row.export_name as string,
      },
      operation: row.operation_name as string,
      instance: (row.instance_url as string | null) ?? null,
      slot: row.slot as string,
      keyId: null,
      shareId,
      snapshot: {
        destination: row.destination as string,
        method: row.method as string,
        pathTemplate: row.path_template as string,
        headersTemplate: row.headers_template as string,
        placement: row.placement as string,
        placementName: row.placement_name as string,
        transform: (row.transform as string | null) ?? null,
        bodyTemplate: (row.body_template as string | null) ?? null,
      },
      fingerprint: row.fingerprint as string,
      actor: owner,
      via,
      interactive: Boolean(row.interactive),
    });
    moved.push(row.id as string);
  }
  return moved;
}

// ---------------------------------------------------------------------------
// Filling slots at call time
// ---------------------------------------------------------------------------

function refusal(
  status: number,
  code:
    | 'share-suspended'
    | 'binding-needs-reapproval'
    | 'interactive-use-not-approved'
    | 'anonymous-use-not-approved',
  title: string,
  detail: string,
  slot: CallApiSlot,
): OperationFailure {
  return new OperationFailure({
    status,
    code,
    title,
    detail,
    meta: { slot: { name: slot.name, key: slot.key } },
  });
}

// Where a slot's binding is, as conditions on `key_bindings b`: in this realm,
// for this operation of this type, on this card for an operation approved per
// instance (`instance`, without `.json`) or on none otherwise, for this slot;
// approved by the caller with one of their own keys for a `userKey` slot, and
// to a share for an `apiKey` slot. A call fills a slot from this binding and no
// other, so whatever names the key a slot is sent with reads it here too.
function slotBindingConditions({
  realmURL,
  type,
  operation,
  instance,
  caller,
  slot,
}: {
  realmURL: string;
  type: { module: string; name: string };
  operation: string;
  instance: string | null;
  caller: string;
  slot: Pick<CallApiSlot, 'key' | 'name'>;
}): Expression {
  return [
    `b.realm_url = `,
    param(realmURL),
    ` AND b.definition_url = `,
    param(type.module),
    ` AND b.export_name = `,
    param(type.name),
    ` AND b.operation_name = `,
    param(operation),
    ` AND COALESCE(b.instance_url, '') = `,
    param(instance ?? ''),
    ` AND b.slot = `,
    param(slotToken(slot)),
    ...(slot.key === 'userKey'
      ? [` AND b.key_id IS NOT NULL AND b.approved_by = `, param(caller)]
      : [` AND b.share_id IS NOT NULL`]),
  ];
}

// What names the bindings that could fill an operation's slots: the realm,
// the type the operation was resolved on, the operation, the card (for an
// operation approved per instance), the caller whose own `{{userKey}}`
// bindings count, and how the invocation arrived.
export type BindingLookup = Omit<CallApiSlotLookup, 'instance'> & {
  instance: string | null;
};

// The card a binding names for this invocation: null for an operation
// approved on its type, and `undefined` for a per-instance operation invoked
// on the type, which no approval names.
export function bindingInstance(
  request: OperationCallApi,
  instance: string | undefined,
): string | null | undefined {
  if (!request.perInstance) {
    return null;
  }
  return instance ? instance.replace(/\.json$/, '') : undefined;
}

// A binding as a slot is checked against it, with its share and its grant.
// `grant_id` is the grant only while it is still there for the binding's key
// (or its share's key): a grant that is gone or belongs to another key fills
// nothing, so it reads as none. `bound_grant_id` is the grant the binding
// names, whatever became of it. `key_state` is the state of the key that
// grant belongs to.
export interface CheckedSlotBinding {
  id: string;
  slot: string;
  key_id: string | null;
  share_id: string | null;
  grant_id: string | null;
  bound_grant_id: string | null;
  approved_by: string;
  interactive: boolean;
  fingerprint: string;
  approval_id: string;
  state: KeyBindingState;
  share_state: string | null;
  // Whether the key the binding's share holds allows anonymous use; null for
  // a personal key's binding, or a share with no key.
  share_key_anonymous: boolean | null;
  share_key_id: string | null;
  share_owner: string | null;
  grant_state: string | null;
  grant_destination: string | null;
  probe_due: boolean;
  grant_key_id: string | null;
  key_kind: string | null;
  key_state: string | null;
  key_probe_due: boolean;
}

// What checking a slot found: the refusal a call would get for it, or that it
// would be filled (`probe`: under a grant the vendor rejected, as its probe;
// `keyProbe`: with a service-account key Google refused, as the key's probe).
// `key-rejected` is a service-account key Google refused whose probe isn't
// due.
export type SlotCheck =
  | {
      slot: CallApiSlot;
      binding: CheckedSlotBinding;
      refused?: undefined;
      probe: boolean;
      keyProbe: boolean;
    }
  | {
      slot: CallApiSlot;
      binding: CheckedSlotBinding | undefined;
      refused: 'binding-not-approved';
    }
  | {
      slot: CallApiSlot;
      binding: CheckedSlotBinding;
      refused:
        | 'share-suspended'
        | 'binding-needs-reapproval'
        | 'interactive-use-not-approved'
        | 'anonymous-use-not-approved'
        | 'credential-rejected'
        | 'key-rejected';
    };

// Every slot of the request checked against the binding that would fill it:
// approved in this realm, for this operation (and this card, when it is
// approved per instance), by the caller for a `{{userKey}}` slot; its share,
// if it has one, not suspended; its fingerprint the one the request has now;
// approved for how the invocation arrived, and for a caller who isn't signed
// in, its share's key allowing anonymous use; its grant still there for its
// key;
// that grant not rejected by the vendor, unless its probe is due; and the
// grant's key not a service-account key Google refused, unless the key's
// probe is due. The first check a slot fails is its answer.
//
// This is the one place a call (`fillSlots`), a pipeline's admission
// (`pipelineAdmission`) and readiness (`keyReadiness`) learn what a call
// would do, so a check added for one is a check for all three. It writes
// nothing: what a refusal changes (moving a binding to `needs-reapproval`,
// claiming a probe) is the call's to do.
export async function checkSlots(
  dbAdapter: DBAdapter,
  lookup: BindingLookup,
  { probeIntervalMs }: { probeIntervalMs: number },
): Promise<SlotCheck[]> {
  let { request } = lookup;
  let checks: SlotCheck[] = [];
  for (let slot of request.slots) {
    let [binding] = (await query(dbAdapter, [
      `SELECT b.id, b.slot, b.key_id, b.share_id, g.id AS grant_id, b.grant_id AS bound_grant_id, b.approved_by, b.interactive, b.fingerprint, b.approval_id, b.state,
              s.state AS share_state, (SELECT sk.anonymous FROM user_keys sk WHERE sk.id = s.key_id) AS share_key_anonymous, s.key_id AS share_key_id, s.owner AS share_owner,
              g.state AS grant_state, g.destination AS grant_destination,
              k.id AS grant_key_id, k.kind AS key_kind, k.state AS key_state,
              `,
      ...probeDue('g.last_probe_at', probeIntervalMs),
      ` AS probe_due, `,
      ...probeDue('k.last_probe_at', probeIntervalMs),
      ` AS key_probe_due
         FROM key_bindings b
         LEFT JOIN key_shares s ON s.id = b.share_id
         LEFT JOIN user_key_grants g ON g.id = b.grant_id AND g.key_id = COALESCE(b.key_id, s.key_id)
         LEFT JOIN user_keys k ON k.id = g.key_id
        WHERE `,
      ...slotBindingConditions({ ...lookup, slot }),
    ])) as unknown as (CheckedSlotBinding | undefined)[];
    checks.push(checkSlot(lookup, slot, binding));
  }
  return checks;
}

// The first check `slot` fails against the binding that would fill it, or
// that it would be filled.
function checkSlot(
  lookup: BindingLookup,
  slot: CallApiSlot,
  binding: CheckedSlotBinding | undefined,
): SlotCheck {
  if (!binding) {
    return { slot, binding, refused: 'binding-not-approved' };
  }
  if (
    binding.share_id &&
    (binding.share_state !== 'active' || binding.state === 'suspended')
  ) {
    return { slot, binding, refused: 'share-suspended' };
  }
  // A key of another kind than the slot's declaration names is approved
  // again, as a changed request is: the declaration may be newer than the
  // approval.
  if (
    binding.state === 'needs-reapproval' ||
    binding.fingerprint !==
      fingerprintOf(bindingSnapshot(lookup.request, slot)) ||
    (binding.key_kind != null && !keyFitsSlot(binding.key_kind, slot.keyKind))
  ) {
    return { slot, binding, refused: 'binding-needs-reapproval' };
  }
  if (lookup.mode === 'interactive' && !binding.interactive) {
    return { slot, binding, refused: 'interactive-use-not-approved' };
  }
  // A personal key's binding has no share, so a `{{userKey}}` slot reaching
  // here for such a caller is refused too.
  if (lookup.anonymous && !binding.share_key_anonymous) {
    return { slot, binding, refused: 'anonymous-use-not-approved' };
  }
  if (!binding.grant_id) {
    return { slot, binding, refused: 'binding-not-approved' };
  }
  let probe = binding.grant_state === 'rejected';
  if (probe && !binding.probe_due) {
    return { slot, binding, refused: 'credential-rejected' };
  }
  let keyProbe =
    binding.key_kind === 'google-service-account' &&
    binding.key_state === 'rejected';
  if (keyProbe && !binding.key_probe_due) {
    return { slot, binding, refused: 'key-rejected' };
  }
  return { slot, binding, probe, keyProbe };
}

// The binding for each of the request's slots, checked (`checkSlots`). A
// binding whose request has changed goes to `needs-reapproval` here, and its
// owner gets one notice, unless the call came from a published realm
// (`publishedRealmURL`), whose copy of the source's code may be older than
// what was approved: then the call is refused and the binding is left as it
// is. Throws the refusal for the first slot that fails.
//
// A call claims a rejected grant's or key's probe when one is due
// (`claimProbe: true`); an admission only asks whether one is due, so a run
// that would probe is admitted and one that would be refused is not. A call
// (`claimProbe: true`) that arrived interactively is counted against the
// limits of the shares and keys filling its slots once every slot has passed
// its checks, and before any probe is claimed, so a call refused for a limit
// uses up no probe.
async function checkedBindings(
  dbAdapter: DBAdapter,
  lookup: CallApiSlotLookup,
  rejection: {
    probeIntervalMs: number;
    claimProbe: boolean;
    publishedRealmURL?: string;
  },
): Promise<CheckedBinding[]> {
  let { request } = lookup;
  let refuseNotApproved = () =>
    new OperationFailure(
      notApproved(
        lookup.operation,
        request,
        rejection.publishedRealmURL ?? lookup.realmURL,
      ),
    );
  let instance = bindingInstance(request, lookup.instance);
  if (instance === undefined) {
    throw refuseNotApproved();
  }
  let checked: CheckedBinding[] = [];
  // The rejected grants and keys this call would probe, claimed only once
  // every slot has passed its other checks, so a call refused for another
  // reason uses up no probe.
  let rejected = new Map<
    string,
    { slot: CallApiSlot; destination: string; subject: LimitSubject }
  >();
  let rejectedKeys = new Map<
    string,
    { slot: CallApiSlot; destination: string; subject: LimitSubject }
  >();
  for (let check of await checkSlots(
    dbAdapter,
    { ...lookup, instance },
    rejection,
  )) {
    let { slot } = check;
    switch (check.refused) {
      case undefined:
        break;
      case 'binding-not-approved':
        if (check.binding?.bound_grant_id) {
          log.warn(
            `binding ${check.binding.id} can't fill slot "${slot.name}": its grant ${check.binding.bound_grant_id} is gone or belongs to another key than the binding's`,
          );
        }
        throw refuseNotApproved();
      case 'share-suspended':
        throw refusedFrom(
          limitSubjectOf(check.binding),
          refusal(
            409,
            'share-suspended',
            'Share suspended',
            `operation "${lookup.operation}" fills the credential slot "${slot.name}" from a share this realm suspended`,
            slot,
          ),
        );
      case 'binding-needs-reapproval':
        if (!rejection.publishedRealmURL) {
          await markNeedsReapproval(
            dbAdapter,
            check.binding.id,
            check.binding.approval_id,
          );
        }
        throw refusedFrom(
          limitSubjectOf(check.binding),
          refusal(
            409,
            'binding-needs-reapproval',
            'Binding needs re-approval',
            `operation "${lookup.operation}" sends another request than the one approved for the credential slot "${slot.name}", so nothing is sent until its key's owner approves it again`,
            slot,
          ),
        );
      case 'interactive-use-not-approved':
        throw refusedFrom(
          limitSubjectOf(check.binding),
          refusal(
            403,
            'interactive-use-not-approved',
            'Interactive use not approved',
            // Says whose key the slot takes, in the words the other refusals
            // use, since the AI assistant sees only the message and answers a
            // caller's own key and a realm's shared key differently.
            slot.key === 'userKey'
              ? `operation "${lookup.operation}" is approved for scheduled pipelines only, so the key for the credential slot "${slot.name}" (the invoking user's own key) isn't used when it is invoked from a browser, the AI assistant or the CLI. The invoking user can allow that in the approval window, by choosing "On a schedule and when the card is opened"`
              : `operation "${lookup.operation}" is approved for scheduled pipelines only, so the key for the credential slot "${slot.name}" (the realm's key) isn't used when it is invoked from a browser, the AI assistant or the CLI. Whoever shared the realm's key can allow that in the approval window, by choosing "On a schedule and when the card is opened"`,
            slot,
          ),
        );
      case 'anonymous-use-not-approved':
        throw refusedFrom(
          limitSubjectOf(check.binding),
          refusal(
            401,
            'anonymous-use-not-approved',
            'Anonymous use not approved',
            `operation "${lookup.operation}" fills the credential slot "${slot.name}" from a key whose owner hasn't allowed people who aren't signed in to use it, so it is used only for signed-in callers. Sign in to use it`,
            slot,
          ),
        );
      case 'credential-rejected':
        throw refusedFrom(
          limitSubjectOf(check.binding),
          credentialRejected(
            lookup.operation,
            slot,
            check.binding.grant_destination!,
          ),
        );
      case 'key-rejected':
        throw refusedFrom(
          limitSubjectOf(check.binding),
          serviceAccountRejected(
            lookup.operation,
            slot,
            check.binding.grant_destination!,
          ),
        );
    }
    let { probe, keyProbe } = check;
    if (probe) {
      rejected.set(check.binding.grant_id!, {
        slot,
        destination: check.binding.grant_destination!,
        subject: limitSubjectOf(check.binding),
      });
    }
    if (keyProbe) {
      rejectedKeys.set(check.binding.grant_key_id!, {
        slot,
        destination: check.binding.grant_destination!,
        subject: limitSubjectOf(check.binding),
      });
    }
    checked.push({ slot, binding: check.binding, probe, keyProbe });
  }
  if (rejection.claimProbe && lookup.mode === 'interactive') {
    await chargeInteractiveCall(dbAdapter, {
      realmURL: lookup.realmURL,
      operation: lookup.operation,
      caller: lookup.caller,
      ...(lookup.anonymous ? { anonymous: lookup.anonymous } : {}),
      subjects: checked.map(({ binding }) => limitSubjectOf(binding)),
    });
  }
  if (rejection.claimProbe && (rejected.size > 0 || rejectedKeys.size > 0)) {
    // Two slots can send under one grant, and two grants of one key share
    // the key's one probe; one claim covers each. A claim is the check again,
    // in one statement, so of calls arriving together only one probes. The
    // claims are one transaction: a call refused at any of them claims none.
    await dbAdapter.withTransaction(async (txQuery) => {
      for (let [grantId, { slot, destination, subject }] of rejected) {
        if (!(await claimProbe(txQuery, grantId, rejection.probeIntervalMs))) {
          throw refusedFrom(
            subject,
            credentialRejected(lookup.operation, slot, destination),
          );
        }
      }
      for (let [keyId, { slot, destination, subject }] of rejectedKeys) {
        if (!(await claimKeyProbe(txQuery, keyId, rejection.probeIntervalMs))) {
          throw refusedFrom(
            subject,
            serviceAccountRejected(lookup.operation, slot, destination),
          );
        }
      }
    });
  }
  return checked;
}

// What a slot's use counts against: the share it is filled from, or the
// personal key it is filled with.
export function limitSubjectOf(
  binding: Pick<CheckedSlotBinding, 'share_id' | 'key_id'>,
): LimitSubject {
  return binding.share_id
    ? { kind: 'share', id: binding.share_id }
    : { kind: 'key', id: binding.key_id! };
}

// A binding that passed every check, with whether the call is the probe of
// its rejected grant (`probe`) or of its rejected key (`keyProbe`).
interface CheckedBinding {
  slot: CallApiSlot;
  binding: CheckedSlotBinding;
  probe: boolean;
  keyProbe: boolean;
}

// What fills one of an operation's slots for `caller`, read from the binding a
// call would fill it from (`slotBindingConditions`), without checking it or
// opening anything: the key, for a `userKey` slot, which is always one of the
// caller's own; for an `apiKey` slot, the share and its owner, and the key
// only when the caller owns it, with its kind and state (an OAuth connection
// its service refused to refresh is `rejected`). `grantState` is the state of
// the grant the key is sent under, so a rejected key can be told apart.
// `bound` is null when nothing is bound to the slot.
export interface SlotBinding {
  slot: string;
  key: CallApiSlot['key'];
  bound: {
    state: KeyBindingState;
    grantState: UserKeyGrantState | null;
    key: {
      id: string;
      name: string;
      kind: UserKeyKind;
      state: UserKeyState;
    } | null;
    share: {
      id: string;
      label: string;
      state: 'active' | 'suspended';
      owner: string;
    } | null;
  } | null;
}

export async function slotBindings(
  dbAdapter: DBAdapter,
  {
    realmURL,
    type,
    operation,
    instance,
    caller,
    slots,
  }: {
    realmURL: string;
    type: { module: string; name: string };
    operation: string;
    // The card, without `.json`, for an operation approved per instance.
    instance: string | null;
    caller: string;
    slots: Pick<CallApiSlot, 'key' | 'name'>[];
  },
): Promise<SlotBinding[]> {
  let found: SlotBinding[] = [];
  for (let slot of slots) {
    let [row] = await query(dbAdapter, [
      `SELECT b.state, g.state AS grant_state,
              s.id AS share_id, s.label AS share_label, s.state AS share_state, s.owner AS share_owner,
              k.id AS key_id, k.name AS key_name, k.kind AS key_kind, k.state AS key_state
         FROM key_bindings b
         LEFT JOIN key_shares s ON s.id = b.share_id
         LEFT JOIN user_key_grants g ON g.id = b.grant_id
         LEFT JOIN user_keys k ON k.id = COALESCE(b.key_id, s.key_id) AND k.owner = `,
      param(caller),
      ` WHERE `,
      ...slotBindingConditions({
        realmURL,
        type,
        operation,
        instance,
        caller,
        slot,
      }),
    ]);
    found.push({
      slot: slotToken(slot),
      key: slot.key,
      bound: row
        ? {
            state: row.state as KeyBindingState,
            grantState: (row.grant_state as UserKeyGrantState | null) ?? null,
            key: row.key_id
              ? {
                  id: row.key_id as string,
                  name: row.key_name as string,
                  kind: row.key_kind as UserKeyKind,
                  state: row.key_state as UserKeyState,
                }
              : null,
            share: row.share_id
              ? {
                  id: row.share_id as string,
                  label: row.share_label as string,
                  state: row.share_state as 'active' | 'suspended',
                  owner: row.share_owner as string,
                }
              : null,
          }
        : null,
    });
  }
  return found;
}

// Moves a binding to `needs-reapproval`, recording the notice its owner gets
// only when this is the move: a binding already there is notified already.
// Only the approval that was compared moves, so an owner approving again while
// a call is checking the old approval keeps their new one.
async function markNeedsReapproval(
  dbAdapter: DBAdapter,
  bindingId: string,
  approvalId: string,
): Promise<void> {
  await query(dbAdapter, [
    `WITH moved AS (UPDATE key_bindings SET state = 'needs-reapproval', updated_at = NOW() WHERE id = `,
    param(bindingId),
    ` AND approval_id = `,
    param(approvalId),
    ` AND state <> 'needs-reapproval' RETURNING id, approved_by)
    INSERT INTO key_binding_notices (binding_id, owner, reason)
    SELECT id, approved_by, 'needs-reapproval' FROM moved`,
  ]);
}

// How a call fills its slots. `publishedRealmURL` is set for a call made on a
// published realm, whose lookup names the realm it was published from, where
// its bindings are: a refusal it is told, and a use recorded for it, name the
// published realm, and a binding approved for a later request than the
// published copy sends refuses the call and stays approved for the source.
export interface FillOptions {
  probeIntervalMs?: number;
  publishedRealmURL?: string;
}

// Fills every slot of a `callApi` request from its binding: the key's value
// opened from the binding's grant, under the destination the grant stored,
// with the slot's transform applied. A grant that is gone, belongs to another
// key than the binding's (or its share's), or whose copy doesn't open, fills
// nothing: the binding is refused as not approved. A grant the vendor rejected
// fills only the call that claims its probe; every other is refused
// `credential-rejected`. Each slot reports its grant, so the sender can act on
// the vendor's answer.
export async function fillSlots(
  dbAdapter: DBAdapter,
  // Read only once a binding's grant is opened, so a slot nobody approved is
  // refused without the keyring.
  keyring: () => SecretsKeyring,
  lookup: CallApiSlotLookup,
  options: FillOptions = {},
): Promise<CallApiFilledSlot[]> {
  // A refusal raised here is recorded against the share or key that raised
  // it; one raised once the slots are filled is the executor's to report
  // (`recordUse`), against every share and key filling them.
  try {
    return await fillCheckedSlots(dbAdapter, keyring, lookup, options);
  } catch (error) {
    if (error instanceof OperationFailure) {
      await recordFillRefusal(
        dbAdapter,
        { ...lookup, realmURL: options.publishedRealmURL ?? lookup.realmURL },
        error,
      );
    }
    throw error;
  }
}

async function fillCheckedSlots(
  dbAdapter: DBAdapter,
  keyring: () => SecretsKeyring,
  lookup: CallApiSlotLookup,
  {
    probeIntervalMs = DEFAULT_PROBE_INTERVAL_MS,
    publishedRealmURL,
  }: FillOptions,
): Promise<CallApiFilledSlot[]> {
  let filled: CallApiFilledSlot[] = [];
  for (let checked of await checkedBindings(dbAdapter, lookup, {
    probeIntervalMs,
    claimProbe: true,
    ...(publishedRealmURL ? { publishedRealmURL } : {}),
  })) {
    // A refusal filling this slot, from an unusable grant or a credential
    // whose token can't be minted, is this binding's share's or key's.
    try {
      filled.push(
        await fillCheckedSlot(
          dbAdapter,
          keyring,
          lookup,
          checked,
          publishedRealmURL ?? lookup.realmURL,
        ),
      );
    } catch (error) {
      if (error instanceof OperationFailure && !subjectOfRefusal(error)) {
        refusedFrom(limitSubjectOf(checked.binding), error);
      }
      throw error;
    }
  }
  return filled;
}

async function fillCheckedSlot(
  dbAdapter: DBAdapter,
  keyring: () => SecretsKeyring,
  lookup: CallApiSlotLookup,
  { slot, binding, probe, keyProbe }: CheckedBinding,
  // The realm the caller invoked, which a refusal names.
  invokedRealmURL: string,
): Promise<CallApiFilledSlot> {
  let opened: Awaited<ReturnType<typeof openGrantForSending>>;
  let ring = keyring();
  try {
    opened = await openGrantForSending(dbAdapter, ring, {
      owner: binding.approved_by,
      grantId: binding.grant_id!,
    });
  } catch (error) {
    // A grant that is gone, or whose copy doesn't open, fills nothing: the
    // binding is as good as unapproved. Anything else is a fault, not a
    // refusal.
    let unusable =
      (error instanceof UserKeyError && error.status === 404) ||
      error instanceof SecretDecryptionError;
    log.warn(
      `binding ${binding.id} can't fill slot "${slot.name}": its grant ${unusable ? 'is unusable' : 'failed to open'} (${error instanceof Error ? error.name : 'unknown error'})`,
    );
    if (!unusable) {
      throw error;
    }
    throw new OperationFailure(
      notApproved(lookup.operation, lookup.request, invokedRealmURL),
    );
  }
  let bindingKey = binding.key_id ?? binding.share_key_id;
  if (opened.keyId !== bindingKey) {
    throw new OperationFailure(
      notApproved(lookup.operation, lookup.request, invokedRealmURL),
    );
  }
  // A key that mints its access tokens sends the one it mints now; its
  // grant's marker has only proved the grant real.
  let mints = MINTING_KINDS.has(opened.kind);
  let secret = mints
    ? await mintedToken(dbAdapter, ring, opened, slot, {
        operation: lookup.operation,
        grantId: binding.grant_id!,
        realmURL: lookup.realmURL,
        shareId: binding.share_id ?? undefined,
        keyProbe,
      })
    : opened.value;
  let value =
    slot.transform === 'basic'
      ? Buffer.from(secret, 'utf8').toString('base64')
      : secret;
  return {
    name: slot.name,
    value,
    ...(value !== secret ? { raw: secret } : {}),
    destination: opened.destination,
    countsAgainst: limitSubjectOf(binding),
    // A vendor's 401 to a stored key rejects the grant it was sent under. A
    // minted token's refusal is its connection's to judge when it next
    // refreshes, so a 401 to one is only the vendor's answer.
    ...(mints
      ? {}
      : {
          grant: {
            id: binding.grant_id!,
            destination: opened.destination,
            slot: { name: slot.name, key: slot.key },
            realmURL: lookup.realmURL,
            ...(binding.share_id ? { shareId: binding.share_id } : {}),
            copy: opened.copy,
            probe,
          },
        }),
  };
}

const MINTING_REFUSALS: Record<OAuthTokenFailure, string> = {
  rejected: 'its vendor no longer accepts it, so its owner signs in again',
  'needs-admin':
    'the OAuth client it mints through is unavailable, so an administrator of that client needs to set it up again',
  unavailable:
    'its token endpoint kept failing, so asking again later may succeed',
};

const SERVICE_ACCOUNT_REJECTED =
  'Google no longer accepts its service account key, so nothing is sent with it until its owner replaces the key or a periodic retry mints a token';

// The refusal for a slot whose service-account key Google refused. Nothing
// was sent, not even to Google, unless the call was the key's probe.
function serviceAccountRejected(
  operation: string,
  slot: Pick<CallApiSlot, 'name' | 'key'>,
  destination: string,
): OperationFailure {
  return new OperationFailure({
    status: 424,
    code: 'credential-rejected',
    title: 'Credential rejected',
    detail: `operation "${operation}" can't fill the credential slot "${slot.name}": ${SERVICE_ACCOUNT_REJECTED}`,
    meta: {
      slot: { name: slot.name, key: slot.key },
      destination,
      reason: 'rejected',
    },
  });
}

// The access token a minting key sends now, or the refusal for why it has
// none: `credential-rejected`, with the reason. A service-account key Google
// refuses becomes `rejected` (see `key-grant-rejection.ts`); the key's probe
// that mints returns it to `active`.
async function mintedToken(
  dbAdapter: DBAdapter,
  keyring: SecretsKeyring,
  opened: { keyId: string; kind: string; destination: string },
  slot: CallApiSlot,
  call: {
    operation: string;
    grantId: string;
    realmURL: string;
    shareId?: string;
    keyProbe: boolean;
  },
): Promise<string> {
  let { operation } = call;
  try {
    let token =
      opened.kind === 'google-service-account'
        ? await serviceAccountAccessToken(dbAdapter, keyring, opened.keyId, {
            fresh: call.keyProbe,
          })
        : await oauthAccessToken(dbAdapter, keyring, opened.keyId);
    if (call.keyProbe) {
      emitKeyGrantEvent({
        event: 'key-probe',
        key: opened.keyId,
        minted: true,
      });
      await clearKeyRejected(
        (expression) => query(dbAdapter, expression),
        opened.keyId,
        'probe',
      );
    }
    return token;
  } catch (error) {
    if (
      !(error instanceof OAuthTokenError) &&
      !(error instanceof ServiceAccountTokenError)
    ) {
      throw error;
    }
    emitKeyGrantEvent({
      event: 'mint-failed',
      key: opened.keyId,
      kind: opened.kind,
      host: hostOf(opened.destination),
      realm: call.realmURL,
      reason: error.reason,
    });
    if (call.keyProbe) {
      emitKeyGrantEvent({
        event: 'key-probe',
        key: opened.keyId,
        minted: false,
      });
    }
    if (
      error instanceof ServiceAccountTokenError &&
      error.reason === 'rejected'
    ) {
      // Only a refusal of the key itself is held against it; any other refuses
      // this call alone.
      if (error.copy && error.keyRefused) {
        await markKeyRejected(dbAdapter, {
          keyId: opened.keyId,
          grantId: call.grantId,
          realmURL: call.realmURL,
          shareId: call.shareId,
          copy: error.copy,
        });
      }
      throw serviceAccountRejected(operation, slot, opened.destination);
    }
    let why = MINTING_REFUSALS[error.reason];
    throw new OperationFailure({
      status: 424,
      code: 'credential-rejected',
      title: 'Credential rejected',
      detail: `operation "${operation}" can't fill the credential slot "${slot.name}": ${why}`,
      meta: {
        slot: { name: slot.name, key: slot.key },
        destination: opened.destination,
        reason: error.reason,
      },
    });
  }
}

// Whether a pipeline may invoke an operation, asked before the run starts: the
// same checks a call makes, without opening any key. A Scheduling System run
// asks this at admission for each operation it declares, as its payer, so a
// missing or changed approval stops the run before anything is sent. Answers
// with the refusal the call would get, or nothing when it would be served. A
// grant the vendor rejected admits the run only while its probe is due, since
// only then would the call be sent.
export async function pipelineAdmission(
  dbAdapter: DBAdapter,
  {
    core,
    realmURL,
    codeRef,
    operation,
    instance,
    payer,
    probeIntervalMs = DEFAULT_PROBE_INTERVAL_MS,
  }: {
    core: Pick<
      OperationCore,
      'resolveCodeRef' | 'definitionLookup' | 'readsRealmOf'
    >;
    realmURL: URL;
    codeRef: CodeRef;
    operation: string;
    instance?: string;
    payer: string;
    probeIntervalMs?: number;
  },
): Promise<OperationFailure | undefined> {
  let type = bindingType(core, codeRef, realmURL);
  let definition = type
    ? await lookupGrantOperation(
        core,
        realmURL,
        codeRefOf(type),
        operation,
        payer,
      )
    : undefined;
  if (!definition || definition.base !== 'callApi' || !definition.callApi) {
    return new OperationFailure({
      status: 404,
      code: 'target-not-found',
      title: 'Unknown operation',
      detail: `no callApi operation "${operation}" on ${JSON.stringify(codeRef)} in realm ${realmURL.href}`,
    });
  }
  if (definition.invalid) {
    return new OperationFailure({
      status: 422,
      code: 'invalid-operation',
      title: 'Invalid operation',
      detail: `operation "${operation}" is declared but could not be lowered to a runnable form`,
      meta: { issues: definition.issues ?? [] },
    });
  }
  try {
    await checkedBindings(
      dbAdapter,
      {
        realmURL: realmURL.href,
        type: type!,
        operation,
        ...(instance
          ? { instance: canonicalInstance(realmURL, instance) }
          : {}),
        caller: payer,
        mode: 'pipeline',
        request: definition.callApi,
      },
      { probeIntervalMs, claimProbe: false },
    );
  } catch (error) {
    if (error instanceof OperationFailure) {
      return error;
    }
    throw error;
  }
  return undefined;
}
