import { param, query, type DBAdapter } from '@cardstack/runtime-common';
import { ANONYMOUS_ACTOR } from '@cardstack/runtime-common/card-operations/anonymous-actor';
import {
  destinationCovers,
  type CallApiReadinessLookup,
  type KeyReadiness,
} from '@cardstack/runtime-common/card-operations';
import {
  bindingInstance,
  checkSlots,
  limitSubjectOf,
  type SlotCheck,
} from './key-bindings.ts';
import { limitReadiness } from './key-limits.ts';
import { DEFAULT_PROBE_INTERVAL_MS } from './key-grant-rejection.ts';

// Readiness: what a card can learn before it invokes a `callApi`, so it can
// show "Connect", "Allow" or "Review" instead of a refusal after the click.
//
// Each slot is checked by `checkSlots` in `key-bindings.ts`, the check a call
// makes, for a caller invoking from a card, and the answer is what would fix
// the slot furthest from filling. A check the call gains is a check readiness
// answers. It opens no key, so a grant whose copy wouldn't open reads as a
// grant here and is refused at the call. Like the capability check it rides
// on, the answer is advisory: the call checks again.
//
// Nothing here is written. A binding whose fingerprint no longer matches reads
// as `needs-reapproval` without being moved there; the call that is refused
// for it moves it and notifies its owner. A grant the vendor rejected reads as
// `credential-rejected` until its next probe is due, and then as the call
// would treat it: sent, as that probe. A rejected key, such as a
// service-account key Google refused, reads as `credential-rejected` whether
// or not its probe is due: what brings it back is its owner replacing it.
//
// Slots that would be filled are then asked about the limits of the share or
// key filling them, without counting anything: `over-budget` when a budget is
// used up, `rate-limited` when the caller's bucket is empty.
//
// A caller who isn't signed in is asked about only where every slot takes a
// shared key and the realm admitted them from an address: a share whose key
// doesn't allow anonymous use answers `needs-sign-in`, and so does anything
// with a `{{userKey}}` slot. Their limits are their address's bucket and the
// key's anonymous cap.
//
// A reader is told only an answer from the `KeyReadiness` list. A share's
// owner, its name and its limits never appear in one, and every way a share
// slot falls short reads the same, `needs-admin`, to anyone but the owner of
// the share's key, who is told what they could fix themselves. A caller with
// an active share of their own in the realm is told `needs-approval` for a
// share slot nothing fills, or one whose share is suspended: the approve page
// offers them their shares for it, and approving one fills it. The one
// exception is a key the vendor rejected, at a grant or as a whole, which the
// call itself refuses `credential-rejected` to everyone.
//
// `needs-connect` and `needs-approval` differ only in whether one of the
// caller's grants covers the destination, so any card can learn that about
// the viewer for a destination it names. That tells a card nothing it can't
// already read: card code holds the app session, and `GET /_user-keys` lists
// every key's grants to it. A change that moves that listing behind a secure
// session has to fold these two answers into one as well.

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

// Answers `undefined` where no answer can be given: a per-instance operation
// asked about on its type, which no approval names.
export async function keyReadiness(
  dbAdapter: DBAdapter,
  lookup: CallApiReadinessLookup,
  {
    probeIntervalMs = DEFAULT_PROBE_INTERVAL_MS,
  }: { probeIntervalMs?: number } = {},
): Promise<KeyReadiness | undefined> {
  let { request } = lookup;
  if (request.slots.length === 0) {
    return 'ready';
  }
  // A caller who isn't signed in is served only by shares whose keys allow
  // anonymous use, and only where the realm admitted them from an address it
  // can count. Otherwise the call is refused before any binding is looked at,
  // so signing in is what fixes it, whatever the slot is.
  let anonymous = lookup.caller ? undefined : lookup.anonymous;
  if (
    !lookup.caller &&
    (!anonymous || request.slots.some(({ key }) => key === 'userKey'))
  ) {
    return 'needs-sign-in';
  }
  let caller = lookup.caller ?? ANONYMOUS_ACTOR;
  let instance = bindingInstance(request, lookup.instance);
  if (instance === undefined) {
    return undefined;
  }
  let checks = await checkSlots(
    dbAdapter,
    { ...lookup, caller, instance, mode: 'interactive' },
    { probeIntervalMs },
  );
  // Read once, and only where a `{{userKey}}` slot has no binding to fill it.
  let covering: Promise<boolean> | undefined;
  let callerCovers = () =>
    (covering ??= callerHasCoveringGrant(dbAdapter, lookup, caller));
  // Read once, and only where an `{{apiKey}}` slot has no share to fill it.
  let sharing: Promise<boolean> | undefined;
  let callerShares = () =>
    (sharing ??= lookup.caller
      ? callerHasActiveShare(dbAdapter, lookup.realmURL, lookup.caller)
      : Promise.resolve(false));
  let answers: KeyReadiness[] = [];
  for (let check of checks) {
    answers.push(
      check.slot.key === 'userKey'
        ? await userKeyReadiness(check, callerCovers)
        : await shareReadiness(check, caller, callerShares),
    );
  }
  let filled = checks.filter(
    (check) => check.refused === undefined && !keyRejected(check),
  );
  if (filled.length > 0) {
    answers.push(
      await limitReadiness(dbAdapter, {
        caller,
        ...(anonymous ? { anonymous } : {}),
        subjects: filled.map((check) => limitSubjectOf(check.binding!)),
      }),
    );
  }
  return answers.reduce<KeyReadiness>(
    (worst, answer) =>
      PRECEDENCE.indexOf(answer) < PRECEDENCE.indexOf(worst) ? answer : worst,
    'ready',
  );
}

// The vendor refused the key itself, such as Google's token endpoint refusing
// a service-account key or an OAuth connection its service won't refresh, so
// every grant of it is refused until its owner replaces or reconnects it, or a
// periodic retry is accepted.
function keyRejected(check: SlotCheck): boolean {
  return check.binding?.key_state === 'rejected';
}

// A `{{userKey}}` slot is filled only from the caller's own binding, so every
// way it falls short is the caller's to fix.
async function userKeyReadiness(
  check: SlotCheck,
  callerCovers: () => Promise<boolean>,
): Promise<KeyReadiness> {
  switch (check.refused) {
    case undefined:
      return keyRejected(check) ? 'credential-rejected' : 'ready';
    case 'binding-needs-reapproval':
      return 'needs-reapproval';
    case 'interactive-use-not-approved':
      return 'needs-approval';
    case 'anonymous-use-not-approved':
      return 'needs-sign-in';
    case 'credential-rejected':
    case 'key-rejected':
      return 'credential-rejected';
    case 'share-suspended':
    case 'binding-not-approved':
      // No binding, or one whose grant is gone: approving one is what fixes
      // it, once a key may be sent where the operation sends.
      return (await callerCovers()) ? 'needs-approval' : 'needs-connect';
  }
}

// Whether any of the caller's keys may already be sent where the operation
// sends, by the rule sending applies (`destinationCovers`).
async function callerHasCoveringGrant(
  dbAdapter: DBAdapter,
  lookup: CallApiReadinessLookup,
  caller: string,
): Promise<boolean> {
  let rows = await query(dbAdapter, [
    `SELECT destination FROM user_key_grants WHERE owner = `,
    param(caller),
  ]);
  return rows.some(({ destination }) =>
    destinationCovers(destination as string, lookup.request.destination),
  );
}

// Whether the caller has an active share in the realm: the shares the approve
// page offers for an `{{apiKey}}` slot, whatever their keys' grants cover,
// since approving one writes the grant it lacks.
async function callerHasActiveShare(
  dbAdapter: DBAdapter,
  realmURL: string,
  caller: string,
): Promise<boolean> {
  let rows = await query(dbAdapter, [
    `SELECT 1 FROM key_shares WHERE realm_url = `,
    param(realmURL),
    ` AND owner = `,
    param(caller),
    ` AND state = 'active' LIMIT 1`,
  ]);
  return rows.length > 0;
}

// An `{{apiKey}}` slot is filled from the realm's share, for every caller. Only
// the owner of the share's key can approve it, and only someone with a share
// of their own in the realm can approve one for a slot nothing fills, so
// anyone else is told an administrator needs to set it up, however it falls
// short.
async function shareReadiness(
  check: SlotCheck,
  caller: string,
  callerShares: () => Promise<boolean>,
): Promise<KeyReadiness> {
  if (check.refused === undefined) {
    return keyRejected(check) ? 'credential-rejected' : 'ready';
  }
  let theirs = check.binding?.share_owner === caller;
  switch (check.refused) {
    case 'binding-needs-reapproval':
      return theirs ? 'needs-reapproval' : 'needs-admin';
    case 'interactive-use-not-approved':
      return theirs ? 'needs-approval' : 'needs-admin';
    // Only people who aren't signed in reach this, and signing in is what
    // serves them.
    case 'anonymous-use-not-approved':
      return 'needs-sign-in';
    case 'credential-rejected':
    case 'key-rejected':
      // Every caller is refused `credential-rejected` at the call, so telling
      // them here gives away nothing more about the share.
      return 'credential-rejected';
    case 'share-suspended':
    case 'binding-not-approved':
      // No binding, or one whose share is suspended: approving one of the
      // caller's own shares replaces it.
      return (await callerShares()) ? 'needs-approval' : 'needs-admin';
  }
}
