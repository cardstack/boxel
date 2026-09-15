#!/usr/bin/env node
// Drive a realm the way a cohort of users does: many readers holding unbounded
// dashboard queries open while a few writers commit cards into the same realm.
//
//   node run-load.ts --csv ./accounts.csv --realm https://…/owner/load-test/ \
//     --workload ./workload.example.json
//
// WHAT THIS REPRODUCES, AND WHAT IT DOES NOT
//
// The load being modelled is write-driven, which is the part most easily got
// wrong. Opening a dashboard issues a set of whole-table searches and then
// writes cards back. Every write invalidates the index, the realm broadcasts
// it, and each connected client re-runs its live searches — an index event
// carries invalidated URLs and a generation, so a client cannot tell whether
// its query's membership changed without asking again.
//
// That last hop lives in the host's live-search resources, in a browser. This
// harness has no browser, so by default it MODELS the hop: when a writer
// finishes a write, every reader re-runs its whole query set, which is what the
// host would do. That reproduces what the SERVER experiences and is the right
// tool for admission control, per-search heap, and write latency under read
// load. It cannot validate a fix to the fan-out itself, because such a fix
// changes the very client code the model stands in for.
//
// `--subscribe` replaces the model with the realm's own event stream and the
// host's skip test, which measures the fan-out instead of assuming it. Read the
// caveat on `eventCannotMatch` in `lib/realm-events.ts` before quoting the
// re-run counts as the host's behaviour.

import { authenticate, realmAuthHeader, type Session } from './lib/auth.ts';
import {
  DEFAULTS,
  ensureTrailingSlash,
  exitIfProduction,
  parseArgs,
  readCredentials,
  summarize,
} from './lib/common.ts';
import {
  eventCannotMatch,
  initialSyncToken,
  joinInvitedRooms,
  streamRealmEvents,
  type RealmEvent,
} from './lib/realm-events.ts';
import {
  loadWorkload,
  writeAttributes,
  type QuerySpec,
} from './lib/workload.ts';

let args = parseArgs(process.argv.slice(2), {
  csv: '',
  realm: '',
  workload: '',
  matrixUrl: DEFAULTS.matrixUrl,
  realmServerUrl: DEFAULTS.realmServerUrl,
  readers: 12,
  writers: 2,
  minutes: 10,
  // One write per writer per interval. Pick it from the cadence of the
  // behaviour being modelled, not from a round number: the write rate is what
  // sets the invalidation rate, and the invalidation rate is the load.
  writeEveryMs: 20000,
  // Floor, so readers still poll on a realm nobody is writing to.
  idleReRunMs: 60000,
  // Every Nth reader also opens the workload's secondary screen.
  secondaryEvery: 3,
  extraQueries: false,
  // Generate before saving, the way a card that calls a model does. The call
  // goes through `_request-forward`, which holds a per-user lock for its whole
  // duration, so two calls from one user serialize and the second waits out
  // the first. That queueing is invisible to a driver that only writes.
  modelCalls: false,
  // Re-run on the realm's own invalidation events, the way a browser does,
  // rather than on every write this driver happens to make. Without it the
  // harness models the fan-out; with it, it measures it — and a change that
  // makes clients skip re-runs is invisible under the model and visible here.
  subscribe: false,
});

if (!args.csv || !args.realm || !args.workload) {
  console.error(
    'Usage: node run-load.ts --csv <accounts.csv> --realm <url> --workload <workload.json>',
  );
  process.exit(1);
}
exitIfProduction(args.matrixUrl, args.realmServerUrl, args.realm);

let realmUrl = ensureTrailingSlash(args.realm);
let searchUrl = `${args.realmServerUrl.replace(/\/$/, '')}/_federated-search`;
let creds = readCredentials(args.csv);
let workload = loadWorkload(args.workload, realmUrl);

let stats = {
  search: [] as number[],
  headers: [] as number[],
  body: [] as number[],
  bytes: 0,
  write: [] as number[],
  model: [] as number[],
  modelCalls: 0,
  modelErrors: 0,
  modelStatuses: new Map<number, number>(),
  events: 0,
  subscribeErrors: 0,
  sessionsWithoutRooms: 0,
  eventsSkipped: 0,
  eventsMatched: 0,
  searchErrors: 0,
  writeErrors: 0,
  searches: 0,
  writes: 0,
  byLabel: new Map<
    string,
    { total: number; headersMs: number; bodyMs: number; bytes: number }[]
  >(),
};

// `fetch` resolves when the response HEADERS arrive; reading the body is a
// separate wait. Splitting them separates the realm server's own work from the
// bytes crossing the network, and that distinction decides whether a slow
// number is the platform's problem or the observer's. Run from a laptop against
// a remote region, the body leg dominates and a single end-to-end figure says
// almost nothing about the server.
function record(
  label: string,
  headersMs: number,
  bodyMs: number,
  bytes: number,
) {
  let total = headersMs + bodyMs;
  stats.search.push(total);
  stats.headers.push(headersMs);
  stats.body.push(bodyMs);
  stats.bytes += bytes;
  stats.searches++;
  let bucket = stats.byLabel.get(label) ?? [];
  bucket.push({ total, headersMs, bodyMs, bytes });
  stats.byLabel.set(label, bucket);
}

// Stamped on every search so a line here can be joined to the realm server's
// own timing for the same request, which it logs as `corr=<id>`.
function correlationId(): string {
  return `harness-${Math.random().toString(36).slice(2, 10)}`;
}

// One `_federated-search`. The verb is QUERY with the query in the body, which
// is why this load leaves no query string in ALB access logs and has to be read
// off the cards instead.
async function search(session: Session, spec: QuerySpec): Promise<void> {
  let started = Date.now();
  try {
    let response = await fetch(searchUrl, {
      method: 'QUERY',
      headers: {
        Accept: 'application/vnd.card+json',
        'Content-Type': 'application/json',
        Authorization: realmAuthHeader(session, realmUrl),
        'x-boxel-logging-correlation-id': correlationId(),
      },
      body: JSON.stringify({ ...spec.query, realms: [realmUrl] }),
    });
    // Headers are in hand: everything up to here is the server deciding what to
    // send, plus one round trip.
    let headersMs = Date.now() - started;
    let bodyStarted = Date.now();
    let text = await response.text();
    let bodyMs = Date.now() - bodyStarted;
    if (!response.ok) {
      stats.searchErrors++;
      if (stats.searchErrors <= 3) {
        console.error(
          `  search ${spec.label} → ${response.status} ${text.slice(0, 160)}`,
        );
      }
      return;
    }
    record(spec.label, headersMs, bodyMs, text.length);
  } catch (e) {
    stats.searchErrors++;
    if (stats.searchErrors <= 3) {
      console.error(`  search ${spec.label} failed: ${errorMessage(e)}`);
    }
  }
}

// One card write. The payload is deliberately small: what the run is measuring
// is the invalidation the write causes, not the cost of the bytes going up.
async function writeCard(session: Session, n: number): Promise<boolean> {
  let started = Date.now();
  let body = {
    data: {
      type: 'card',
      attributes: writeAttributes(workload.write, n),
      meta: { adoptsFrom: workload.write.adoptsFrom },
    },
  };
  try {
    let response = await fetch(
      `${realmUrl}${workload.write.path.replace(/^\//, '')}/`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.card+json',
          'Content-Type': 'application/vnd.card+json',
          Authorization: realmAuthHeader(session, realmUrl),
        },
        body: JSON.stringify(body),
      },
    );
    let text = await response.text();
    let ms = Date.now() - started;
    if (!response.ok) {
      stats.writeErrors++;
      if (stats.writeErrors <= 3) {
        console.error(`  write → ${response.status} ${text.slice(0, 200)}`);
      }
      return false;
    }
    stats.write.push(ms);
    stats.writes++;
    return true;
  } catch (e) {
    stats.writeErrors++;
    if (stats.writeErrors <= 3) {
      console.error(`  write failed: ${errorMessage(e)}`);
    }
    return false;
  }
}

// One model call, as a card that generates before saving makes it. The
// destination is one the realm server refuses, because the contended resource
// is the lock and not the generation, and a real call would cost tokens and
// minutes per run.
//
// A 400 or 403 here is the expected shape: the request reached the handler,
// passed auth, and was rejected at the destination allowlist. Everything before
// that point still ran — including `withUserCostLock`, which is where a user's
// second write waits out their first.
async function modelCall(session: Session): Promise<void> {
  let started = Date.now();
  try {
    let response = await fetch(
      `${args.realmServerUrl.replace(/\/$/, '')}/_request-forward`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: session.serverToken,
        },
        body: JSON.stringify({
          url: 'https://load-harness.invalid/v1/chat/completions',
          method: 'POST',
          requestBody: JSON.stringify({ model: 'harness', messages: [] }),
        }),
      },
    );
    await response.text();
    stats.model.push(Date.now() - started);
    stats.modelCalls++;
    stats.modelStatuses.set(
      response.status,
      (stats.modelStatuses.get(response.status) ?? 0) + 1,
    );
  } catch (e) {
    stats.modelErrors++;
    if (stats.modelErrors <= 3) {
      console.error(`  model call failed: ${errorMessage(e)}`);
    }
  }
}

// One Matrix long-poll per session, fanned out to that session's reader. The
// realm broadcasts into each user's own DM session room, so every simulated
// user needs its own stream — which is also what makes the event volume here
// comparable to the cohort's.
let subscriptions = new Map<string, ((event: RealmEvent) => void)[]>();
let subscribeAbort = new AbortController();

function subscribeSession(
  session: Session,
  cb: (event: RealmEvent) => void,
): () => void {
  let listeners = subscriptions.get(session.userId);
  if (!listeners) {
    listeners = [];
    subscriptions.set(session.userId, listeners);
    let own = listeners;
    void (async () => {
      try {
        let since = await initialSyncToken({
          matrixUrl: args.matrixUrl,
          accessToken: session.accessToken,
        });
        // `_realm-auth` creates this user's DM session room and invites them to
        // it, but an invited user is not in the room and receives nothing. A
        // browser joins as part of its Matrix startup; do the same here, or the
        // run reports a silence that says nothing about the change under test.
        let { joined } = await joinInvitedRooms({
          matrixUrl: args.matrixUrl,
          accessToken: session.accessToken,
        });
        if (joined === 0) {
          stats.sessionsWithoutRooms++;
          console.error(
            `  ${session.username} has no realm session room, so it will receive\n` +
              `  no events — a low re-run count would mean nothing.`,
          );
        }
        await streamRealmEvents({
          matrixUrl: args.matrixUrl,
          accessToken: session.accessToken,
          since,
          signal: subscribeAbort.signal,
          onEvent: (event) => {
            if (event.realmURL && event.realmURL !== realmUrl) {
              return;
            }
            stats.events++;
            for (let listener of own) {
              listener(event);
            }
          },
          onError: (e) => {
            if (stats.subscribeErrors++ < 3) {
              console.error(`  sync for ${session.username}: ${e.message}`);
            }
          },
        });
      } catch (e) {
        console.error(
          `  could not subscribe ${session.username}: ${errorMessage(e)}`,
        );
      }
    })();
  }
  listeners.push(cb);
  return () => {
    let i = listeners.indexOf(cb);
    if (i >= 0) {
      listeners.splice(i, 1);
    }
  };
}

let running = true;
// Readers wake on this when a write lands, standing in for the realm event that
// would reach a browser.
let invalidationWaiters: (() => void)[] = [];
function announceInvalidation() {
  let waiters = invalidationWaiters;
  invalidationWaiters = [];
  for (let resolve of waiters) {
    resolve();
  }
}
function nextInvalidation(timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    invalidationWaiters.push(resolve);
    setTimeout(resolve, timeoutMs);
  });
}

async function readerLoop(session: Session, index: number): Promise<void> {
  let specs = [
    ...workload.queries,
    ...(args.secondaryEvery > 0 && index % args.secondaryEvery === 0
      ? workload.secondaryQueries
      : []),
    ...(args.extraQueries ? workload.extraQueries : []),
  ];

  // Subscribe before the first render, not after. A browser's subscription is
  // live while its initial queries are in flight, and that first render is
  // seconds of concurrent searches — an event landing in that window would be
  // missed, which on a short run is most of them.
  let queue: RealmEvent[] = [];
  let wake: (() => void) | undefined;
  let unsubscribe = args.subscribe
    ? subscribeSession(session, (event) => {
        queue.push(event);
        wake?.();
      })
    : undefined;

  // First render: the screen fires its whole set at once.
  await Promise.all(specs.map((spec) => search(session, spec)));

  if (!args.subscribe) {
    // Modelled invalidation: re-run everything on any write this driver made.
    while (running) {
      await nextInvalidation(args.idleReRunMs);
      if (!running) {
        break;
      }
      await Promise.all(specs.map((spec) => search(session, spec)));
    }
    return;
  }

  // Measured invalidation: re-run the queries an event could actually have
  // changed, which is the decision a browser makes.
  try {
    while (running) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, args.idleReRunMs);
        });
        wake = undefined;
        if (!running) {
          break;
        }
      }
      let batch = queue.splice(0, queue.length);
      if (batch.length === 0) {
        continue;
      }
      let due = specs.filter((spec) =>
        batch.some((event) => !eventCannotMatch(event, spec.typeKeys)),
      );
      stats.eventsSkipped += batch.length * (specs.length - due.length);
      stats.eventsMatched += batch.length * due.length;
      if (due.length) {
        await Promise.all(due.map((spec) => search(session, spec)));
      }
    }
  } finally {
    unsubscribe?.();
  }
}

async function writerLoop(session: Session, index: number): Promise<void> {
  let n = index * 1000;
  while (running) {
    await new Promise((r) => setTimeout(r, args.writeEveryMs));
    if (!running) {
      break;
    }
    // The generation runs before the save and holds this user's cost lock for
    // its duration. Ordering them this way is what puts a user's own next write
    // behind their current one, which is the queueing a write-only driver never
    // sees.
    if (args.modelCalls) {
      await modelCall(session);
    }
    if (await writeCard(session, n++)) {
      announceInvalidation();
    }
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

let needed = args.readers + args.writers;
if (creds.length < needed) {
  console.error(`Credential file has ${creds.length} rows, need ${needed}`);
  process.exit(1);
}

console.log(`Authenticating ${needed} sessions…`);
let sessions: Session[] = [];
for (let row of creds.slice(0, needed)) {
  try {
    sessions.push(
      await authenticate({
        matrixUrl: args.matrixUrl,
        realmServerUrl: args.realmServerUrl,
        username: row.username,
        password: row.password,
      }),
    );
    process.stdout.write('.');
  } catch (e) {
    console.error(`\n  ${row.username}: ${errorMessage(e)}`);
  }
}
console.log(`\n${sessions.length} sessions authenticated.`);
if (sessions.length < 2) {
  console.error('Need at least one reader and one writer.');
  process.exit(1);
}

// Each simulated user authenticates as itself. Searches authorize per realm,
// and the per-user cost lock is keyed by Matrix user, so one shared account
// would reproduce neither the authorization work nor the lock contention.
let writerSessions = sessions.slice(
  0,
  Math.min(args.writers, sessions.length - 1),
);
let readerSessions = sessions.slice(writerSessions.length);
console.log(
  `${readerSessions.length} readers, ${writerSessions.length} writers, ${args.minutes} min. ` +
    `Ctrl-C to stop early.\n`,
);

let reportTimer = setInterval(() => {
  console.log(
    `[${new Date().toISOString().slice(11, 19)}] ` +
      `searches=${stats.searches} (${stats.searchErrors} err)  ` +
      `writes=${stats.writes} (${stats.writeErrors} err)  ` +
      `${summarize('search', stats.search.slice(-200))}`,
  );
}, 30000);

function finish() {
  if (!running) {
    return;
  }
  running = false;
  clearInterval(reportTimer);
  subscribeAbort.abort();
  announceInvalidation();
  console.log(`\n───── run summary ─────`);
  console.log(`searches: ${stats.searches} (${stats.searchErrors} errors)`);
  console.log(`writes:   ${stats.writes} (${stats.writeErrors} errors)`);
  console.log(summarize('end-to-end ', stats.search));
  console.log(
    summarize('  headers  ', stats.headers) + '   ← server work + 1 RTT',
  );
  console.log(
    summarize('  body     ', stats.body) + '   ← bytes crossing the network',
  );
  console.log(summarize('write      ', stats.write));
  if (stats.modelCalls || stats.modelErrors) {
    console.log(
      summarize('model call ', stats.model) + '   ← incl. per-user cost lock',
    );
    let statuses = [...stats.modelStatuses]
      .sort((a, b) => b[1] - a[1])
      .map(([code, n]) => `${code}×${n}`)
      .join(' ');
    console.log(
      `  model responses: ${statuses}${stats.modelErrors ? `  (${stats.modelErrors} failed)` : ''}`,
    );
    console.log(
      `  a rejected destination is the expected shape — the call still passes\n` +
        `  auth and takes the per-user cost lock, which is the contended resource.`,
    );
  }

  let headerShare = stats.search.length
    ? stats.headers.reduce((a, b) => a + b, 0) /
      Math.max(
        1,
        stats.search.reduce((a, b) => a + b, 0),
      )
    : 0;
  let mb = stats.bytes / (1024 * 1024);
  let bodySec = stats.body.reduce((a, b) => a + b, 0) / 1000;
  console.log(
    `\ntransferred: ${mb.toFixed(1)} MB` +
      (bodySec > 0 ? ` at ~${(mb / bodySec).toFixed(1)} MB/s` : ''),
  );

  console.log(`\nper query shape (end-to-end / headers / body, median):`);
  for (let [label, rows] of [...stats.byLabel].sort()) {
    let med = (pick: (r: (typeof rows)[number]) => number) => {
      let v = rows.map(pick).sort((a, b) => a - b);
      return v[Math.floor(v.length / 2)] ?? 0;
    };
    let kb = Math.round(med((r) => r.bytes) / 1024);
    console.log(
      `  ${label.padEnd(20)} n=${String(rows.length).padStart(3)} ` +
        `${String(Math.round(med((r) => r.total))).padStart(6)}ms / ` +
        `${String(Math.round(med((r) => r.headersMs))).padStart(5)}ms / ` +
        `${String(Math.round(med((r) => r.bodyMs))).padStart(6)}ms  ` +
        `${String(kb).padStart(4)} KB`,
    );
  }

  if (args.subscribe) {
    let considered = stats.eventsMatched + stats.eventsSkipped;
    let pct = considered
      ? Math.round((stats.eventsSkipped / considered) * 100)
      : 0;
    if (stats.sessionsWithoutRooms) {
      console.log(
        `\n⚠  ${stats.sessionsWithoutRooms} session(s) had no realm session room, so they\n` +
          `   received no events. A low re-run count below is that, not a change working.`,
      );
    }
    console.log(
      `\nrealm events: ${stats.events} received` +
        (stats.subscribeErrors
          ? `  (${stats.subscribeErrors} sync errors)`
          : ''),
    );
    console.log(
      `  query re-runs: ${stats.eventsMatched} performed, ${stats.eventsSkipped} skipped (${pct}%)`,
    );
    console.log(
      `  a skip is an event whose invalidated types could not change that\n` +
        `  query's membership — the decision a browser makes for itself. The\n` +
        `  harness matches type keys literally where the host resolves them\n` +
        `  through its module loader, so treat these counts as indicative.`,
    );
  } else {
    console.log(
      `\n(no --subscribe: readers re-ran on this driver's own writes, which\n` +
        ` models the fan-out rather than measuring it — a client-side change\n` +
        ` that skips re-runs cannot show up in these numbers.)`,
    );
  }

  let minutes = args.minutes || 1;
  console.log(`\nrate: ${Math.round(stats.searches / minutes)} searches/min`);

  // The distinction this harness exists to protect. Measured from outside the
  // region, the body leg is the observer's connection and says nothing about
  // the platform: a run whose end-to-end p50 was 6.1 s covered 225 ms of actual
  // server time, so reporting the former as a platform number would have been
  // wrong by a factor of twenty-seven. Byte counts are trustworthy wherever the
  // driver runs; latency is not.
  if (headerShare < 0.5 && stats.search.length >= 10) {
    console.log(
      `\n⚠  ${Math.round((1 - headerShare) * 100)}% of the end-to-end time was body transfer,\n` +
        `   not server work. These numbers describe THIS MACHINE'S LINK to the realm\n` +
        `   server more than they describe the realm server. Re-run from inside the\n` +
        `   same AWS region before drawing conclusions about platform latency — see\n` +
        `   "Run it where the numbers mean something" in the README.`,
    );
  }

  console.log(
    `\nNow read the server side: inFlightSearch / heapMB / eventLoopLagMs from the\n` +
      `realm-server health sampler over this window. Those, not these numbers, are\n` +
      `what admission control and per-search heap have to move. Each search was\n` +
      `stamped with an x-boxel-logging-correlation-id, so a slow one here can be\n` +
      `joined to the server's own timing by its corr= id.`,
  );
  process.exit(0);
}

process.on('SIGINT', finish);
setTimeout(finish, args.minutes * 60000);

readerSessions.forEach((s, i) => void readerLoop(s, i));
writerSessions.forEach((s, i) => void writerLoop(s, i));
