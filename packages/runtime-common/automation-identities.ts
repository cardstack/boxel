// A person's Matrix id in what an automation's reads answer: who a run acts
// as, who canceled it, and the ids a run's error message names. ADR 011 §1.2
// shows an id only to the person themselves and to a viewer who shares a
// named realm grant with them, so every read that names a person passes the
// id through here.

import type { DBAdapter } from './db.ts';
import { shareARealmGrant } from './db-queries/realm-permission-queries.ts';

// A person's Matrix id as `viewer` may see it: shown to the person themselves
// and to a viewer who shares a named realm grant with them, and null to
// anyone else.
export async function shownIdentity(
  dbAdapter: DBAdapter,
  viewer: string,
  person: string | null,
): Promise<string | null> {
  if (person === null) {
    return null;
  }
  if (person === viewer) {
    return person;
  }
  return (await shareARealmGrant(dbAdapter, viewer, person)) ? person : null;
}

// A Matrix user id, as the run's messages spell one: `@localpart:server`.
const MATRIX_ID = /@[a-z0-9._=/+-]+:[a-z0-9.-]+(?::\d+)?/gi;

// `text` with every Matrix id in it that `viewer` may not see (see
// `shownIdentity`) replaced by "someone". A run's error message can name the
// person the run acts as or the automation's payer, whichever wrote it. A
// read that names many people passes its own `show`, one that remembers each
// person's answer, so a person named by many messages is looked up once.
export async function withHiddenIdentities(
  dbAdapter: DBAdapter,
  viewer: string,
  text: string | null,
  show: (person: string) => Promise<string | null> = (person) =>
    shownIdentity(dbAdapter, viewer, person),
): Promise<string | null> {
  if (text === null) {
    return null;
  }
  let hidden = new Set<string>();
  for (let id of new Set(text.match(MATRIX_ID) ?? [])) {
    if ((await show(id)) === null) {
      hidden.add(id);
    }
  }
  return hidden.size === 0
    ? text
    : text.replace(MATRIX_ID, (id) => (hidden.has(id) ? 'someone' : id));
}
