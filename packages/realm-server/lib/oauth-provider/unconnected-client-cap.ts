// The cap on clients registered by dynamic client registration that have
// never connected (ADR 021 §1.4). Registration needs no sign-in, so anyone
// can make the provider store a client. The new-client limit bounds how fast
// they arrive, and the daily cleanup deletes one that never connected 7 days
// after it registered (`cleanup.ts`), but neither bounds how many are kept:
// that depends on the cleanup running and on the limit staying as set. The
// cap does. Once the provider holds `cap` of them, registration is refused
// for everyone until the cleanup deletes some or some connect.
//
// It refuses and never deletes a client to make room: deleting the oldest
// would let a caller registering clients in a loop delete a real app between
// its registration and its user's consent.
//
// The default sits above what the new-client limit's overall bucket can
// register in the 7 days the cleanup keeps a client, plus the day between
// cleanups, so a flood within that limit never reaches it. It is reached only
// when the cleanup stops running or the limit is raised past it, and Boxel
// warns well before then.
//
// The count is a soft bound: registrations counted at the same moment can
// each be admitted, and a process reuses a count below the alert mark for up
// to a minute (`UnconnectedClientCap`), so the provider can hold a few more
// than `cap`.

import { logger, type DBAdapter } from '@cardstack/runtime-common';
import { OperatorAlert } from './caller-limit.ts';
import { UNCONNECTED_CLIENT_RETENTION_SECONDS } from './cleanup.ts';
import { EXCHANGED_GRANT } from './grants.ts';
import type { NewClientLimit } from './new-client-limit.ts';

const log = logger('boxel:oauth-provider');

export const OAUTH_UNCONNECTED_CLIENT_CAP_VAR =
  'BOXEL_OAUTH_UNCONNECTED_CLIENT_CAP';

export const DEFAULT_UNCONNECTED_CLIENT_CAP = 500_000;

// The cleanup runs once a day, so the cap frees up no sooner than that; an
// hour keeps a client from retrying in a loop without making it wait a day.
export const UNCONNECTED_CLIENT_RETRY_AFTER_SECONDS = 60 * 60;

// Boxel warns once this share of the cap is taken.
const ALERT_SHARE = 0.8;

// How long a process reuses a count it read below the alert mark.
const COUNT_REUSE_MS = 60_000;

export type UnconnectedClientOutcome =
  // `busy` once the alert mark is passed.
  | { admitted: true; busy: boolean }
  | { admitted: false; reason: 'full' }
  // The count couldn't be read: refused rather than let through uncounted.
  | { admitted: false; reason: 'unavailable' };

// Whether the provider has room for another client that hasn't connected,
// read from the database every time.
export async function checkUnconnectedClientCap(
  dbAdapter: DBAdapter,
  cap: number,
): Promise<UnconnectedClientOutcome> {
  let count = await countUnconnectedClients(dbAdapter, cap);
  return count === undefined
    ? { admitted: false, reason: 'unavailable' }
    : outcomeFor(count, cap);
}

// The cap as one process checks it on each registration. Below the alert mark
// it reuses the count it last read for up to a minute, adding the clients it
// has admitted since, so a flood within the new-client limit doesn't recount
// the table on every registration. Past the mark, where the cap is near, it
// counts every time. Other processes' registrations go unseen for up to that
// minute, and the new-client limit admits far fewer in a minute than the gap
// between the mark and the cap.
export class UnconnectedClientCap {
  #dbAdapter: DBAdapter;
  #cap: number;
  #now: () => number;
  #lastCount: { count: number; at: number } | undefined;
  #admittedSince = 0;

  constructor(
    dbAdapter: DBAdapter,
    cap: number,
    { now = Date.now }: { now?: () => number } = {},
  ) {
    this.#dbAdapter = dbAdapter;
    this.#cap = cap;
    this.#now = now;
  }

  async check(): Promise<UnconnectedClientOutcome> {
    let now = this.#now();
    if (
      this.#lastCount &&
      now - this.#lastCount.at < COUNT_REUSE_MS &&
      this.#lastCount.count + this.#admittedSince + 1 <= alertMark(this.#cap)
    ) {
      this.#admittedSince++;
      return { admitted: true, busy: false };
    }
    let count = await countUnconnectedClients(this.#dbAdapter, this.#cap);
    if (count === undefined) {
      this.#lastCount = undefined;
      return { admitted: false, reason: 'unavailable' };
    }
    let outcome = outcomeFor(count, this.#cap);
    this.#lastCount = { count, at: now };
    this.#admittedSince = outcome.admitted ? 1 : 0;
    return outcome;
  }
}

// How many clients the new-client limit's overall bucket can register while
// the cleanup keeps one that never connected: a full bucket at once, then its
// refill over the retention and the longest gap between cleanups. Answers a
// warning when the cap is no more than that, since a flood within the limit
// could then fill it and refuse registration for everyone until the cleanup
// frees room.
export function unconnectedClientCapWarning(
  cap: number,
  limit: NewClientLimit,
  cleanupGapSeconds: number,
): string | undefined {
  let seconds = UNCONNECTED_CLIENT_RETENTION_SECONDS + cleanupGapSeconds;
  let reachable =
    limit.overall.requests +
    Math.floor(
      (limit.overall.requests * seconds) / limit.overall.windowSeconds,
    );
  if (cap > reachable) {
    return undefined;
  }
  return (
    `${OAUTH_UNCONNECTED_CLIENT_CAP_VAR} is ${cap}, but the new-client limit can register ` +
    `${reachable} OAuth clients while the cleanup keeps one that never connected: ` +
    `a flood within the limit can fill the cap and refuse registration for everyone`
  );
}

// How many clients have never connected, counted up to `cap`, or undefined
// when the count can't be read. A client counts as never connected when it has
// no `last_connected_at` and no exchanged grant, the clients the cleanup
// deletes 7 days after they register. Counting stops at the cap, so a full
// table is never read whole.
async function countUnconnectedClients(
  dbAdapter: DBAdapter,
  cap: number,
): Promise<number | undefined> {
  try {
    let [row] = await dbAdapter.execute(
      `SELECT count(*)::int AS count FROM (
         SELECT 1 FROM oauth_provider_dynamic_clients AS c
          WHERE c.last_connected_at IS NULL
            AND NOT EXISTS (
                  SELECT 1 FROM oauth_provider_grants AS g
                   WHERE g.client_id = c.client_id
                     AND ${EXCHANGED_GRANT}
                )
          LIMIT $1
       ) AS unconnected`,
      { bind: [cap] },
    );
    return Number(row.count);
  } catch (e) {
    log.warn(
      `couldn't count the OAuth clients that never connected, refusing registration: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return undefined;
  }
}

function outcomeFor(count: number, cap: number): UnconnectedClientOutcome {
  if (count >= cap) {
    return { admitted: false, reason: 'full' };
  }
  return { admitted: true, busy: count + 1 > alertMark(cap) };
}

// Parses the cap from its environment variable: a whole number of clients,
// at least one.
export function parseUnconnectedClientCap(spec: string): number | undefined {
  if (!/^[1-9][0-9]*$/.test(spec)) {
    return undefined;
  }
  let cap = Number(spec);
  return Number.isSafeInteger(cap) ? cap : undefined;
}

// Warns operators while registration is past the alert mark or refused at the
// cap. The message carries the cap's numbers only.
export class UnconnectedClientAlert {
  #cap: number;
  #alert: OperatorAlert;

  constructor(
    cap: number,
    options: { now?: () => number; warn?: (message: string) => void } = {},
  ) {
    this.#cap = cap;
    this.#alert = new OperatorAlert(options);
  }

  note(outcome: UnconnectedClientOutcome): void {
    if (outcome.admitted ? outcome.busy : outcome.reason === 'full') {
      this.#alert.raise(
        `more than ${alertMark(this.#cap)} OAuth clients registered by dynamic client registration have never connected; ` +
          `registration is refused for everyone at ${this.#cap} (${OAUTH_UNCONNECTED_CLIENT_CAP_VAR}) ` +
          `until the daily cleanup deletes some: check that it runs`,
      );
    }
  }
}

function alertMark(cap: number): number {
  return Math.floor(cap * ALERT_SHARE);
}
