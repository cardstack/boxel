// Appends a `scan` event to the change journal for each realm a deploy wrote
// to directly, so realm-historian records what the deploy changed as one
// revision attributed to the deploy, rather than as unattributed changes.
// The realm server's start scripts run it after their rsync steps.
//
//   node scripts/scan.ts --realm=<directory>[:<bot username>] ...
//     [--matrixServerName=<name>] [--source=<repository>] [--commit=<sha>]
//
// Each `--realm` names a bootstrap realm by the directory its realm server
// mounts (its `--path`), which is the `disk_id` of its `realm_registry` row.
// The event is authored by the realm's Matrix bot,
// `@<bot username>:<matrixServerName>`, or by `boxel-system` for a realm
// named without one. `--source` and `--commit` are the repository and the
// commit the deploy came from, carried on the event's intent. The database
// comes from the `PG*` environment variables.
//
// A realm gets an event only while its recording is on: the journal writes
// none for a realm whose recording is off, nor for a published realm. A
// directory with no bootstrap realm registered at it, such as a realm
// deployed for the first time, gets none either. The script exits 0 when it
// handled every realm, whether or not each got an event, and 1 when an append
// failed or the database didn't answer in time. The start scripts log that
// and carry on, so history never holds up the realm server.

import '../setup-logger.ts';
import { parseArgs } from 'node:util';
import { PgAdapter, PostgresChangeJournal } from '@cardstack/postgres';
import {
  logger,
  query,
  SYSTEM_AUTHOR,
  type Expression,
  type Querier,
} from '@cardstack/runtime-common';
import { emitChangeJournal } from '@cardstack/runtime-common/card-operations/telemetry';

const log = logger('realm-historian:scan');

// How long the script may take in all before it gives up, so a database that
// never answers can't hold up the deploy that runs it.
const TIMEOUT_MS = 30_000;

interface ScannedRealm {
  directory: string;
  botUsername?: string;
}

let { values: args } = parseArgs({
  options: {
    realm: { type: 'string', multiple: true },
    matrixServerName: { type: 'string' },
    source: { type: 'string' },
    commit: { type: 'string' },
  },
  strict: true,
});

function usage(message: string): never {
  console.error(message);
  process.exit(2);
}

// `<directory>` or `<directory>:<bot username>`. A Matrix localpart can't hold
// a colon, so the last one separates the two.
function parseRealm(value: string): ScannedRealm {
  let separator = value.lastIndexOf(':');
  let directory = separator === -1 ? value : value.slice(0, separator);
  let botUsername = separator === -1 ? '' : value.slice(separator + 1);
  if (!directory) {
    usage(`--realm=${value} names no directory`);
  }
  return botUsername ? { directory, botUsername } : { directory };
}

let realms = (args.realm ?? []).map(parseRealm);
if (realms.length === 0) {
  usage('--realm is required');
}
let matrixServerName = args.matrixServerName;
if (!matrixServerName && realms.some((realm) => realm.botUsername)) {
  usage('--matrixServerName is required for a realm named with its bot');
}
// An empty value, such as a commit the start script couldn't find, is the
// same as none.
let source = args.source || undefined;
let commit = args.commit || undefined;

setTimeout(() => {
  log.error(`gave up after ${TIMEOUT_MS} ms waiting for the database`);
  process.exit(1);
}, TIMEOUT_MS).unref();

let db = new PgAdapter();
let querier: Querier = (expression: Expression) => query(db, expression);
let journal = new PostgresChangeJournal();
let failed = false;

try {
  for (let { directory, botUsername } of realms) {
    // Bootstrap rows are upserted by URL, so a realm whose URL changed leaves
    // its old row on the same directory. The row the last boot upserted is
    // the realm the directory holds now.
    let [row] = await db.execute(
      `SELECT url FROM realm_registry WHERE kind = 'bootstrap' AND disk_id = $1
       ORDER BY updated_at DESC LIMIT 1`,
      { bind: [directory] },
    );
    if (!row) {
      log.info(
        `no bootstrap realm is registered at ${directory}, so it gets no scan event`,
      );
      continue;
    }
    let realmURL = row.url as string;
    let author = botUsername
      ? `@${botUsername}:${matrixServerName}`
      : SYSTEM_AUTHOR;
    let started = performance.now();
    try {
      let written = await journal.append(querier, {
        realmURL,
        author,
        channel: 'deploy',
        intent: {
          kind: 'scan',
          ...(source ? { source } : {}),
          ...(commit ? { commit } : {}),
        },
        changes: [],
      });
      emitChangeJournal({
        realm: realmURL,
        outcome: written ? 'written' : 'skipped',
        durationMs: Math.round(performance.now() - started),
        paths: 0,
        partial: false,
      });
      log.info(
        written
          ? `appended a scan event for ${realmURL} by ${author}`
          : `recording is off for ${realmURL}, so it gets no scan event`,
      );
    } catch (error: unknown) {
      failed = true;
      emitChangeJournal({
        realm: realmURL,
        outcome: 'failed',
        durationMs: Math.round(performance.now() - started),
        paths: 0,
        partial: false,
        error: error instanceof Error ? error.message : String(error),
      });
      log.error(`could not append the scan event for ${realmURL}`, error);
    }
  }
} catch (error: unknown) {
  failed = true;
  log.error('could not read the realm registry', error);
} finally {
  await db.close();
}
process.exit(failed ? 1 : 0);
