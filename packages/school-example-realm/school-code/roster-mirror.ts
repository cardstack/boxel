import {
  getRelationshipMembershipState,
  type CardDef,
} from '@cardstack/base/card-api';
import { OperationsError } from '@cardstack/base/operations';

import type { StaffMember } from './staff-member';

// A policy predicate reads the card it judges as stored, and a stored link is
// a URL, so the policy cannot compare `actor()` against linked staff. A card
// that links to staff therefore also stores their ids in a plain list — the
// mirror the policy reads — and these helpers keep the two in step.

// The Matrix ids a staff link field names, once every linked card has loaded.
//
// A mirror written from a partly loaded roster would silently drop whoever
// had not loaded yet and revoke their access, so the answer is the ids only
// when every link is present and carries an id. Otherwise it says why not:
// still loading, or a link the viewer cannot load or that names nobody with an
// id. Only someone who reads the roster ever gets ids back.
export type RosterIds =
  | { state: 'ready'; ids: string[] }
  | { state: 'loading' }
  | { state: 'unusable'; reason: string };

export function rosterIds(card: CardDef, fieldName: string): RosterIds {
  // Reading the field is what starts its lazy load.
  void (card as unknown as Record<string, unknown>)[fieldName];
  let status = getRelationshipMembershipState<StaffMember>(card, fieldName);
  if (status.isLoading || !status.membership) {
    return { state: 'loading' };
  }
  let ids: string[] = [];
  for (let member of status.membership) {
    switch (member.kind) {
      case 'not-set':
        continue;
      case 'not-loaded':
        return { state: 'loading' };
      case 'present': {
        let id = member.value.matrixUserId?.trim();
        if (!id) {
          return {
            state: 'unusable',
            reason: `${member.value.fullName ?? member.reference} has no Matrix user id on the roster`,
          };
        }
        ids.push(id);
        continue;
      }
      default:
        return {
          state: 'unusable',
          reason: `the roster card ${member.reference} could not be loaded`,
        };
    }
  }
  return { state: 'ready', ids };
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
