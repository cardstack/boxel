import { OperationsError } from '@cardstack/base/operations';

import type { StaffMember } from './staff-member';

// The Matrix ids a list of linked staff carries, in roster order.
//
// A policy predicate reads the card it judges as stored, and a stored link is
// a URL, so the policy cannot compare `actor()` against linked staff. A card
// that links to staff therefore also stores their ids in a plain list — the
// mirror the policy reads — and these helpers keep the two in step. A linked
// card the viewer cannot load contributes nothing, which is why only someone
// who reads the roster can tell whether a mirror is current.
export function rosterIds(staff: (StaffMember | undefined)[] | undefined) {
  return (staff ?? [])
    .map((member) => member?.matrixUserId?.trim())
    .filter((id): id is string => Boolean(id));
}

// Whether a mirror holds exactly the ids its links name, ignoring order.
export function mirrors(
  mirror: string[] | undefined,
  linked: string[],
): boolean {
  let stored = new Set(mirror ?? []);
  return (
    stored.size === new Set(linked).size && linked.every((id) => stored.has(id))
  );
}

// What a refused or failed operation says to the person who caused it.
export function refusalMessage(err: unknown): string {
  if (err instanceof OperationsError) {
    return err.detail ?? err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
