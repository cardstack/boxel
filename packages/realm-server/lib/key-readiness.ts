import { param, query, type DBAdapter } from '@cardstack/runtime-common';
import {
  destinationCovers,
  type CallApiReadinessLookup,
  type CallApiSlot,
  type KeyReadiness,
} from '@cardstack/runtime-common/card-operations';
import { bindingSnapshot, fingerprintOf, slotToken } from './key-bindings.ts';

// Readiness: what a card can learn before it invokes a `callApi`, so it can
// show "Connect", "Allow" or "Review" instead of a refusal after the click.
//
// It asks of each slot what filling it at call time asks (`checkedBindings`
// and `fillSlots` in `key-bindings.ts`), in the same order, for a caller
// invoking from a card, and answers with what would fix the slot furthest
// from filling. Those two read the same rows, so a check added to one belongs
// in the other. It reads rows and opens no key, so a grant whose copy
// wouldn't open reads as a grant here and is refused at the call. Like the
// capability check it rides on, the answer is advisory: the call checks again.
//
// Nothing here is written. A binding whose fingerprint no longer matches reads
// as `needs-reapproval` without being moved there; the call that is refused
// for it moves it and notifies its owner.
//
// A reader is told only an answer from the `KeyReadiness` list. A share's
// owner, its name and its limits never appear in one, and every way a share
// slot falls short reads the same, `needs-admin`, to anyone but the owner of
// the share's key, who is told what they could fix themselves. A share whose
// key the vendor refused reads `credential-rejected` to every caller, as the
// call itself is refused for each of them.

// The order slot answers are reported in: the first slot to need something
// further up the list decides the operation's answer. A slot only an
// administrator can fix stops the call whatever the caller does, so it comes
// first. Connecting a key comes before approving one, since the approval
// names the key.
const PRECEDENCE: KeyReadiness[] = [
  'needs-admin',
  'credential-rejected',
  'over-budget',
  'rate-limited',
  'needs-connect',
  'needs-reapproval',
  'needs-approval',
  'ready',
];

// What a binding is read as here: the row a call would fill a slot from.
interface BindingRow {
  slot: string;
  approved_by: string;
  key_id: string | null;
  share_id: string | null;
  interactive: boolean;
  fingerprint: string;
  state: string;
  share_state: string | null;
  share_owner: string | null;
  grant_id: string | null;
  key_state: string | null;
}

// Answers `undefined` where no answer can be given: a per-instance operation
// asked about on its type, which no approval names.
export async function keyReadiness(
  dbAdapter: DBAdapter,
  lookup: CallApiReadinessLookup,
): Promise<KeyReadiness | undefined> {
  let { request } = lookup;
  if (request.slots.length === 0) {
    return 'ready';
  }
  // A call that sends a credential and authenticated nobody is refused before
  // any binding is looked at, so signing in is what fixes it whatever the
  // slot is.
  if (!lookup.caller) {
    return 'needs-sign-in';
  }
  if (request.perInstance && !lookup.instance) {
    return undefined;
  }
  let instance = request.perInstance
    ? lookup.instance!.replace(/\.json$/, '')
    : null;
  let rows = await bindingsFor(dbAdapter, lookup, instance);
  // Read once, and only where a `{{userKey}}` slot has no binding to fill it.
  let covering: Promise<boolean> | undefined;
  let callerCovers = () =>
    (covering ??= callerHasCoveringGrant(dbAdapter, lookup));
  let answers: KeyReadiness[] = [];
  for (let slot of request.slots) {
    let token = slotToken(slot);
    answers.push(
      slot.key === 'userKey'
        ? await userKeyReadiness(
            rows.find(
              (row) =>
                row.slot === token &&
                row.key_id !== null &&
                row.approved_by === lookup.caller,
            ),
            lookup,
            slot,
            callerCovers,
          )
        : shareReadiness(
            rows.find((row) => row.slot === token && row.share_id !== null),
            lookup,
            slot,
          ),
    );
  }
  return answers.reduce<KeyReadiness>(
    (worst, answer) =>
      PRECEDENCE.indexOf(answer) < PRECEDENCE.indexOf(worst) ? answer : worst,
    'ready',
  );
}

// Every binding of this operation in this realm (and for this card, when it is
// approved per instance) that could fill one of its slots for this caller: the
// realm's share bindings, and the caller's own `{{userKey}}` ones. Each comes
// with whether its grant is still there for its key (or its share's key), and
// that key's state.
async function bindingsFor(
  dbAdapter: DBAdapter,
  lookup: CallApiReadinessLookup,
  instance: string | null,
): Promise<BindingRow[]> {
  return (await query(dbAdapter, [
    `SELECT b.slot, b.approved_by, b.key_id, b.share_id, b.interactive, b.fingerprint, b.state,
            s.state AS share_state, s.owner AS share_owner, g.id AS grant_id, k.state AS key_state
       FROM key_bindings b
       LEFT JOIN key_shares s ON s.id = b.share_id
       LEFT JOIN user_key_grants g ON g.id = b.grant_id AND g.key_id = COALESCE(b.key_id, s.key_id)
       LEFT JOIN user_keys k ON k.id = g.key_id
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
    ` AND (b.share_id IS NOT NULL OR b.approved_by = `,
    param(lookup.caller!),
    `)`,
  ])) as unknown as BindingRow[];
}

// The vendor refused the key itself, such as Google's token endpoint refusing
// a service-account key, so every grant of it is refused until its owner
// replaces it or a periodic retry is accepted.
function keyRejected(row: BindingRow): boolean {
  return row.key_state === 'rejected';
}

function needsReapproval(
  row: BindingRow,
  lookup: CallApiReadinessLookup,
  slot: CallApiSlot,
): boolean {
  return (
    row.state === 'needs-reapproval' ||
    row.fingerprint !== fingerprintOf(bindingSnapshot(lookup.request, slot))
  );
}

// A `{{userKey}}` slot is filled only from the caller's own binding.
async function userKeyReadiness(
  row: BindingRow | undefined,
  lookup: CallApiReadinessLookup,
  slot: CallApiSlot,
  callerCovers: () => Promise<boolean>,
): Promise<KeyReadiness> {
  if (row) {
    if (needsReapproval(row, lookup, slot)) {
      return 'needs-reapproval';
    }
    if (!row.interactive) {
      return 'needs-approval';
    }
    // A binding whose grant is gone fills nothing, so it is as good as none.
    // Readiness for a grant the vendor rejected is answered here, from the
    // grant's own state, once grants carry one.
    if (row.grant_id) {
      return keyRejected(row) ? 'credential-rejected' : 'ready';
    }
  }
  return (await callerCovers()) ? 'needs-approval' : 'needs-connect';
}

// Whether any of the caller's keys may already be sent where the operation
// sends, by the rule sending applies (`destinationCovers`).
async function callerHasCoveringGrant(
  dbAdapter: DBAdapter,
  lookup: CallApiReadinessLookup,
): Promise<boolean> {
  let rows = await query(dbAdapter, [
    `SELECT destination FROM user_key_grants WHERE owner = `,
    param(lookup.caller!),
  ]);
  return rows.some(({ destination }) =>
    destinationCovers(destination as string, lookup.request.destination),
  );
}

// An `{{apiKey}}` slot is filled from the realm's share, for every caller. Only
// the owner of the share's key can approve it, so anyone else is told an
// administrator needs to set it up, however it falls short.
function shareReadiness(
  row: BindingRow | undefined,
  lookup: CallApiReadinessLookup,
  slot: CallApiSlot,
): KeyReadiness {
  if (!row || row.share_state !== 'active' || row.state === 'suspended') {
    return 'needs-admin';
  }
  let theirs = row.share_owner === lookup.caller;
  if (needsReapproval(row, lookup, slot)) {
    return theirs ? 'needs-reapproval' : 'needs-admin';
  }
  if (!row.interactive) {
    return theirs ? 'needs-approval' : 'needs-admin';
  }
  if (!row.grant_id) {
    return 'needs-admin';
  }
  return keyRejected(row) ? 'credential-rejected' : 'ready';
}
