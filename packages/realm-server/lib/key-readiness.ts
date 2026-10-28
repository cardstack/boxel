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
// It asks of each slot what filling it at call time asks (`fillSlots` in
// `key-bindings.ts`), for a caller invoking from a card, and answers with what
// would fix the first slot that wouldn't fill. It reads rows and opens no key,
// so a grant whose copy wouldn't open reads as a grant here and is refused at
// the call. Like the capability check it rides on, the answer is advisory: the
// call checks again.
//
// Nothing here is written. A binding whose fingerprint no longer matches reads
// as `needs-reapproval` without being moved there; the call that is refused
// for it moves it and notifies its owner.
//
// A reader is told only an answer from the `KeyReadiness` list. A share's
// owner, its name and its limits never appear in one, and every way a share
// slot fails reads the same, `needs-admin`, to anyone but the owner of the
// share's key, who is told what they could fix themselves.

// The order slot answers are reported in: the first slot to need something
// further up the list decides the operation's answer. A slot only an
// administrator can fix stops the call whatever the caller does, so it comes
// first after signing in, which every other answer presupposes for a
// `{{userKey}}` slot. Connecting a key comes before approving one, since the
// approval names the key.
const PRECEDENCE: KeyReadiness[] = [
  'needs-sign-in',
  'needs-admin',
  'credential-rejected',
  'over-budget',
  'rate-limited',
  'needs-connect',
  'needs-reapproval',
  'needs-approval',
  'ready',
];

export async function keyReadiness(
  dbAdapter: DBAdapter,
  lookup: CallApiReadinessLookup,
): Promise<KeyReadiness> {
  let { request } = lookup;
  // A per-instance operation is approved card by card, so asked about on its
  // type it has no binding to find, as a call on the type has none.
  let instance =
    request.perInstance && lookup.instance
      ? lookup.instance.replace(/\.json$/, '')
      : null;
  let answers: KeyReadiness[] = [];
  for (let slot of request.slots) {
    answers.push(
      slot.key === 'userKey'
        ? await userKeyReadiness(dbAdapter, lookup, slot, instance)
        : await shareReadiness(dbAdapter, lookup, slot, instance),
    );
  }
  return answers.reduce<KeyReadiness>(
    (worst, answer) =>
      PRECEDENCE.indexOf(answer) < PRECEDENCE.indexOf(worst) ? answer : worst,
    'ready',
  );
}

// The binding a slot would be filled from, as a call finds it, with whether
// its grant is still there for its key (or its share's key).
async function bindingFor(
  dbAdapter: DBAdapter,
  lookup: CallApiReadinessLookup,
  slot: CallApiSlot,
  instance: string | null,
): Promise<Record<string, unknown> | undefined> {
  let [row] = await query(dbAdapter, [
    `SELECT b.approved_by, b.interactive, b.anonymous, b.fingerprint, b.state, s.state AS share_state, s.owner AS share_owner,
            g.id AS grant_id
       FROM key_bindings b
       LEFT JOIN key_shares s ON s.id = b.share_id
       LEFT JOIN user_key_grants g ON g.id = b.grant_id AND g.key_id = COALESCE(b.key_id, s.key_id)
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
          param(lookup.caller!),
        ]
      : [` AND b.share_id IS NOT NULL`]),
  ]);
  return row;
}

function needsReapproval(
  row: Record<string, unknown>,
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
  dbAdapter: DBAdapter,
  lookup: CallApiReadinessLookup,
  slot: CallApiSlot,
  instance: string | null,
): Promise<KeyReadiness> {
  if (!lookup.caller) {
    return 'needs-sign-in';
  }
  let row = await bindingFor(dbAdapter, lookup, slot, instance);
  // A binding whose grant is gone fills nothing, so it is as good as none.
  // Readiness for a grant the vendor rejected is answered here, from the
  // grant's own state, once grants carry one.
  if (row?.grant_id) {
    if (needsReapproval(row, lookup, slot)) {
      return 'needs-reapproval';
    }
    return row.interactive ? 'ready' : 'needs-approval';
  }
  return (await callerHasCoveringGrant(dbAdapter, lookup))
    ? 'needs-approval'
    : 'needs-connect';
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
async function shareReadiness(
  dbAdapter: DBAdapter,
  lookup: CallApiReadinessLookup,
  slot: CallApiSlot,
  instance: string | null,
): Promise<KeyReadiness> {
  let row = await bindingFor(dbAdapter, lookup, slot, instance);
  if (
    !row ||
    row.share_state !== 'active' ||
    row.state === 'suspended' ||
    !row.grant_id
  ) {
    return 'needs-admin';
  }
  let theirs = lookup.caller !== undefined && row.share_owner === lookup.caller;
  if (needsReapproval(row, lookup, slot)) {
    return theirs ? 'needs-reapproval' : 'needs-admin';
  }
  if (!row.interactive) {
    return theirs ? 'needs-approval' : 'needs-admin';
  }
  // A share serves a caller who isn't signed in only where its owner allowed
  // anonymous use of this binding.
  if (lookup.caller === undefined && !row.anonymous) {
    return 'needs-sign-in';
  }
  return 'ready';
}
