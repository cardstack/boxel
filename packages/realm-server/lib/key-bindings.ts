import { createHash, randomUUID } from 'node:crypto';
import {
  logger,
  param,
  query,
  RealmPaths,
  rri,
  trimExecutableExtension,
  type DBAdapter,
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
} from './user-key-grants.ts';
import { MINTING_KINDS, UserKeyError } from './user-keys.ts';
import {
  oauthAccessToken,
  OAuthTokenError,
  type OAuthTokenFailure,
} from './oauth.ts';

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
// - **Pipelines only.** An interactive invocation — a card in the browser, the
//   AI assistant, the CLI — is refused `interactive-use-not-approved`, since
//   no binding is approved for interactive use. A pipeline the realm server
//   runs as its payer (`Realm.handlePipeline`) is served.
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
    interactive,
    anonymous,
  }: {
    core: Pick<
      OperationCore,
      'resolveCodeRef' | 'definitionLookup' | 'readsRealmOf'
    >;
    realmURL: URL;
    approver: string;
    via: SecureSessionClient;
    operations: OperationApproval[];
    interactive?: boolean;
    anonymous?: boolean;
  },
): Promise<{ batchId: string; approved: ApprovedBinding[] }> {
  if (interactive || anonymous) {
    throw new UserKeyError(
      403,
      'a binding is approved for pipelines only: interactive and anonymous use are not offered',
    );
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

  let batchId = randomUUID();
  let approved: ApprovedBinding[] = [];
  await dbAdapter.withTransaction(async (txQuery) => {
    for (let plan of planned) {
      for (let fill of plan.fills) {
        let keyId = fill.keyId;
        if (fill.shareId !== undefined) {
          keyId = await lockApprovableShare(
            txQuery,
            realmURL,
            fill.shareId,
            approver,
          );
        }
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
        `, interactive = false, anonymous = false, fingerprint = `,
        param(fingerprint),
        `, approval_id = `,
        param(approvalId),
        `, state = 'active', updated_at = NOW() WHERE id = `,
        param(bindingId),
        ` RETURNING ${BINDING_COLUMNS}`,
      ])
    : await txQuery([
        `INSERT INTO key_bindings (id, realm_url, definition_url, export_name, operation_name, instance_url, slot, key_id, share_id, grant_id, approved_by, fingerprint, approval_id, state) VALUES (`,
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
    `, false, false, `,
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
    `SELECT b.id, b.approval_id, b.fingerprint, last.realm_url, last.definition_url, last.export_name, last.operation_name, last.instance_url, last.slot, last.destination, last.method, last.path_template, last.headers_template, last.placement, last.placement_name, last.transform, last.body_template
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
    | 'interactive-use-not-approved',
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

// The binding for each of the request's slots, checked: approved in this
// realm, for this operation (and this card, when it is approved per
// instance), by the caller for a `userKey` slot; its share, if it has one, not
// suspended; its fingerprint the one the request has now; and approved for
// how the invocation arrived. A binding whose request has changed goes to
// `needs-reapproval` here, and its owner gets one notice. Throws the refusal
// for the first slot that fails.
async function checkedBindings(
  dbAdapter: DBAdapter,
  lookup: CallApiSlotLookup,
): Promise<{ slot: CallApiSlot; row: Record<string, unknown> }[]> {
  let { request } = lookup;
  let refuseNotApproved = () =>
    new OperationFailure(
      notApproved(lookup.operation, request, lookup.realmURL),
    );
  let instance: string | null = null;
  if (request.perInstance) {
    if (!lookup.instance) {
      throw refuseNotApproved();
    }
    instance = lookup.instance.replace(/\.json$/, '');
  }
  let checked: { slot: CallApiSlot; row: Record<string, unknown> }[] = [];
  for (let slot of request.slots) {
    let [row] = await query(dbAdapter, [
      `SELECT b.id, b.key_id, b.share_id, b.grant_id, b.approved_by, b.interactive, b.fingerprint, b.approval_id, b.state, s.state AS share_state, s.key_id AS share_key_id
         FROM key_bindings b LEFT JOIN key_shares s ON s.id = b.share_id
        WHERE b.realm_url = `,
      param(lookup.realmURL),
      ` AND b.definition_url = `,
      param(lookup.type.module),
      ` AND b.export_name = `,
      param(lookup.type.name),
      ` AND b.operation_name = `,
      param(lookup.operation),
      ` AND COALESCE(b.instance_url, '') = `,
      param(instance ?? ''),
      ` AND b.slot = `,
      param(slotToken(slot)),
      ...(slot.key === 'userKey'
        ? [
            ` AND b.key_id IS NOT NULL AND b.approved_by = `,
            param(lookup.caller),
          ]
        : [` AND b.share_id IS NOT NULL`]),
    ]);
    if (!row) {
      throw refuseNotApproved();
    }
    if (
      row.share_id &&
      (row.share_state !== 'active' || row.state === 'suspended')
    ) {
      throw refusal(
        409,
        'share-suspended',
        'Share suspended',
        `operation "${lookup.operation}" fills the credential slot "${slot.name}" from a share this realm suspended`,
        slot,
      );
    }
    let fingerprint = fingerprintOf(bindingSnapshot(request, slot));
    if (row.state === 'needs-reapproval' || row.fingerprint !== fingerprint) {
      await markNeedsReapproval(
        dbAdapter,
        row.id as string,
        row.approval_id as string,
      );
      throw refusal(
        409,
        'binding-needs-reapproval',
        'Binding needs re-approval',
        `operation "${lookup.operation}" sends another request than the one approved for the credential slot "${slot.name}", so nothing is sent until its key's owner approves it again`,
        slot,
      );
    }
    if (lookup.mode === 'interactive' && !row.interactive) {
      throw refusal(
        403,
        'interactive-use-not-approved',
        'Interactive use not approved',
        `operation "${lookup.operation}" is approved for scheduled pipelines only, so the key for the credential slot "${slot.name}" isn't used when it is invoked from a browser, the AI assistant or the CLI`,
        slot,
      );
    }
    if (!row.grant_id) {
      throw refuseNotApproved();
    }
    checked.push({ slot, row });
  }
  return checked;
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

// Fills every slot of a `callApi` request from its binding: the key's value
// opened from the binding's grant, under the destination the grant stored,
// with the slot's transform applied. A grant that is gone, belongs to another
// key than the binding's (or its share's), or whose copy doesn't open, fills
// nothing: the binding is refused as not approved.
export async function fillSlots(
  dbAdapter: DBAdapter,
  // Read only once a binding's grant is opened, so a slot nobody approved is
  // refused without the keyring.
  keyring: () => SecretsKeyring,
  lookup: CallApiSlotLookup,
): Promise<CallApiFilledSlot[]> {
  let filled: CallApiFilledSlot[] = [];
  for (let { slot, row } of await checkedBindings(dbAdapter, lookup)) {
    let opened: Awaited<ReturnType<typeof openGrantForSending>>;
    let ring = keyring();
    try {
      opened = await openGrantForSending(dbAdapter, ring, {
        owner: row.approved_by as string,
        grantId: row.grant_id as string,
      });
    } catch (error) {
      // A grant that is gone, or whose copy doesn't open, fills nothing: the
      // binding is as good as unapproved. Anything else is a fault, not a
      // refusal.
      let unusable =
        (error instanceof UserKeyError && error.status === 404) ||
        error instanceof SecretDecryptionError;
      log.warn(
        `binding ${row.id} can't fill slot "${slot.name}": its grant ${unusable ? 'is unusable' : 'failed to open'} (${error instanceof Error ? error.name : 'unknown error'})`,
      );
      if (!unusable) {
        throw error;
      }
      throw new OperationFailure(
        notApproved(lookup.operation, lookup.request, lookup.realmURL),
      );
    }
    let bindingKey = (row.key_id ?? row.share_key_id) as string | null;
    if (opened.keyId !== bindingKey) {
      throw new OperationFailure(
        notApproved(lookup.operation, lookup.request, lookup.realmURL),
      );
    }
    // A key that mints its access tokens sends the one it mints now; its
    // grant's marker has only proved the grant real.
    let secret = MINTING_KINDS.has(opened.kind)
      ? await mintedToken(dbAdapter, ring, opened, slot, lookup.operation)
      : opened.value;
    let value =
      slot.transform === 'basic'
        ? Buffer.from(secret, 'utf8').toString('base64')
        : secret;
    filled.push({
      name: slot.name,
      value,
      ...(value !== secret ? { raw: secret } : {}),
      destination: opened.destination,
    });
  }
  return filled;
}

const MINTING_REFUSALS: Record<OAuthTokenFailure, string> = {
  rejected: 'its vendor no longer accepts it, so its owner signs in again',
  'needs-admin':
    'the OAuth client it mints through is unavailable, so an administrator of that client needs to set it up again',
  unavailable:
    'its token endpoint kept failing, so asking again later may succeed',
};

// The access token a minting key sends now, or the refusal for why it has
// none: `credential-rejected`, with the reason.
async function mintedToken(
  dbAdapter: DBAdapter,
  keyring: SecretsKeyring,
  opened: { keyId: string; destination: string },
  slot: CallApiSlot,
  operation: string,
): Promise<string> {
  try {
    return await oauthAccessToken(dbAdapter, keyring, opened.keyId);
  } catch (error) {
    if (!(error instanceof OAuthTokenError)) {
      throw error;
    }
    throw new OperationFailure({
      status: 424,
      code: 'credential-rejected',
      title: 'Credential rejected',
      detail: `operation "${operation}" can't fill the credential slot "${slot.name}": ${MINTING_REFUSALS[error.reason]}`,
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
// with the refusal the call would get, or nothing when it would be served.
export async function pipelineAdmission(
  dbAdapter: DBAdapter,
  {
    core,
    realmURL,
    codeRef,
    operation,
    instance,
    payer,
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
    await checkedBindings(dbAdapter, {
      realmURL: realmURL.href,
      type: type!,
      operation,
      ...(instance ? { instance: canonicalInstance(realmURL, instance) } : {}),
      caller: payer,
      mode: 'pipeline',
      request: definition.callApi,
    });
  } catch (error) {
    if (error instanceof OperationFailure) {
      return error;
    }
    throw error;
  }
  return undefined;
}
