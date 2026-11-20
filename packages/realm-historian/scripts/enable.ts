// Turns recording on or off for one realm.
//
//   node scripts/enable.ts <realm url> on|off
//
// The realm is the `realm_registry` row with that URL; a URL without its
// trailing slash names the same realm. `on` sets the realm's
// `realm_history_state.enabled`, creating its row when it has none. `off`
// clears the flag and keeps the row, so turning recording back on carries on
// in the same repo; a realm with no row is already off and gets none. Neither
// the realm server nor a running realm-historian needs a restart: the journal
// checks the flag on every append, and realm-historian loads a realm it
// doesn't know when that realm's first event arrives.
//
// The script says when the realm is stalled, since a stalled realm records
// nothing whatever its setting. A published realm is refused, since its
// source realm's history covers it, and so is a URL no realm is registered
// at. The database comes from the
// `PG*` environment variables. The script exits 0 when the realm's recording
// is as asked, 1 when the realm is refused or the database fails, and 2 on a
// usage error.

import '../setup-logger.ts';
import { PgAdapter } from '@cardstack/postgres';

// How long the script may take in all before it gives up on the database.
const TIMEOUT_MS = 30_000;

function usage(message: string): never {
  console.error(message);
  console.error('usage: node scripts/enable.ts <realm url> on|off');
  process.exit(2);
}

let [realmArg, setting, ...extra] = process.argv.slice(2);
if (!realmArg || !setting || extra.length > 0) {
  usage('expected a realm URL and on or off');
}
if (setting !== 'on' && setting !== 'off') {
  usage(`expected on or off, not ${setting}`);
}
let enable = setting === 'on';

let realmURL: string;
try {
  realmURL = new URL(realmArg).href;
} catch {
  usage(`${realmArg} is not a URL`);
}
// Realm URLs are registered with their trailing slash.
if (!realmURL.endsWith('/')) {
  realmURL += '/';
}

setTimeout(() => {
  console.error(`gave up after ${TIMEOUT_MS} ms waiting for the database`);
  process.exit(1);
}, TIMEOUT_MS).unref();

function describe(enabled: boolean | null): string {
  return enabled === null ? 'off (no state row)' : enabled ? 'on' : 'off';
}

let db = new PgAdapter();
let failed = false;

try {
  let [realm] = await db.execute(
    `SELECT registry.id, registry.kind, registry.source_url, state.enabled,
            state.status, state.stalled_reason
     FROM realm_registry registry
     LEFT JOIN realm_history_state state ON state.realm_id = registry.id
     WHERE registry.url = $1`,
    { bind: [realmURL] },
  );
  if (!realm) {
    failed = true;
    console.error(`no realm is registered at ${realmURL}`);
  } else if (realm.kind === 'published') {
    failed = true;
    console.error(
      `${realmURL} is a published realm, and published realms record no ` +
        `history. Turn recording on for its source realm instead` +
        (realm.source_url ? `: ${realm.source_url}` : '.'),
    );
  } else {
    let id = realm.id as string;
    let before = (realm.enabled as boolean | null) ?? null;
    let after: boolean | null;
    if (enable) {
      await db.execute(
        `INSERT INTO realm_history_state (realm_id, enabled) VALUES ($1, true)
         ON CONFLICT (realm_id) DO UPDATE SET enabled = true`,
        { bind: [id] },
      );
      after = true;
    } else if (before !== null) {
      await db.execute(
        `UPDATE realm_history_state SET enabled = false WHERE realm_id = $1`,
        { bind: [id] },
      );
      after = false;
    } else {
      after = null;
    }
    console.log(
      before === after
        ? `recording for ${realmURL} (${id}) is already ${describe(after)}`
        : `recording for ${realmURL} (${id}) was ${describe(before)}, now ${describe(after)}`,
    );
    if (realm.status === 'stalled') {
      console.warn(
        `${realmURL} is stalled, so nothing is recorded` +
          (realm.stalled_reason ? `: ${realm.stalled_reason}` : '') +
          `. Setting its realm_history_state.status back to 'ok' resumes ` +
          `recording when a realm-historian task next starts or takes over ` +
          `its shard.`,
      );
    }
  }
} catch (error: unknown) {
  failed = true;
  console.error(`could not set recording for ${realmURL}`, error);
} finally {
  await db.close();
}
process.exit(failed ? 1 : 0);
