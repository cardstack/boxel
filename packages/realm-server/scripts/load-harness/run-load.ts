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

import { writeFileSync } from 'node:fs';

import { authenticate, realmAuthHeader, type Session } from './lib/auth.ts';
import {
  DEFAULTS,
  ensureTrailingSlash,
  exitIfProduction,
  parseArgsOrExit,
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
  describeConnectionSetup,
  measureConnectionSetup,
  yieldSocketToPool,
  type ConnectionSetup,
} from './lib/connection.ts';
import {
  DEFAULT_LOAD_HALF_LIFE_MS,
  describeInFlight,
  InFlightReading,
  inFlightProgressLabel,
} from './lib/in-flight.ts';
import {
  DEFAULT_FIELDSET,
  describeFieldset,
  fieldsetOptionsHelp,
  fieldsetWireMembers,
  isFieldsetName,
  type FieldsetName,
} from './lib/fieldset.ts';
import {
  fetchCardTypeSummary,
  readOnlyReason,
  workloadFromCardTypeSummary,
} from './lib/derive-workload.ts';
import {
  loadWorkload,
  parseWorkload,
  queryForPass,
  writeAttributes,
  type QuerySpec,
  type Workload,
  type WriteSpec,
} from './lib/workload.ts';

let args = parseArgsOrExit(process.argv.slice(2), {
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
  // Which document the searches ask for, and so which code path is measured.
  // Empty means "whatever the workload file says, else the default" — the
  // distinction matters because an explicit flag has to beat a committed file.
  fieldset: '',
  // Build the workload from the realm under test instead of from a file, by
  // ranking its own `_types` summary by instance count. This is how two people
  // run the same test without exchanging a config: the target defines it.
  deriveWorkload: false,
  deriveTop: 8,
  // Page size for every derived query. 0 leaves them unbounded.
  derivePageSize: 20,
  // Write the derived workload here and exit without running, so it can be
  // committed and re-run verbatim. `-` writes to stdout.
  emitWorkload: '',
  // Open the connections a batch of searches will use BEFORE the clock starts.
  // Without this, `headers` silently includes a TCP and TLS handshake on every
  // sample whose socket had gone cold, which on a quiet realm is most of them.
  // `--prime-connections=false` turns it off.
  primeConnections: true,
  // Precede each write with a `_request-forward` call, the way a card that
  // generates before saving does. It adds a second authenticated round trip
  // per write without spending tokens; see `modelCall` for exactly how far
  // into the handler it reaches, which is less far than the name suggests.
  modelCalls: false,
  // The window the TARGET smooths its in-flight reading over, so the
  // concurrency this run reports is the same measurement the server's
  // link-shape policy takes. Only change it when the deployment sets
  // LINK_SHAPE_LOAD_HALF_LIFE_MS; the default is the value the server ships.
  loadHalfLifeMs: DEFAULT_LOAD_HALF_LIFE_MS,
  // Re-run on the realm's own invalidation events, the way a browser does,
  // rather than on every write this driver happens to make. Without it the
  // harness models the fan-out; with it, it measures it — and a change that
  // makes clients skip re-runs is invisible under the model and visible here.
  subscribe: false,
});

if (!args.csv || !args.realm || (!args.workload && !args.deriveWorkload)) {
  console.error(
    `Usage: node run-load.ts --csv <accounts.csv> --realm <url> \\\n` +
      `         (--workload <workload.json> | --derive-workload)\n\n` +
      `  --workload         a committed workload file; workload.experiments.json\n` +
      `                     is the standard one, and gives numbers comparable to\n` +
      `                     anyone else's run against the same target\n` +
      `  --derive-workload  rank the realm's own /_types by instance count and\n` +
      `                     query the top --derive-top (${args.deriveTop}) types\n` +
      `  --emit-workload P  write the derived workload to P ('-' for stdout) and\n` +
      `                     exit, so it can be committed and re-run verbatim\n` +
      `  --fieldset F       which path to measure: ${fieldsetOptionsHelp()}.\n` +
      `                     'item' is the query-backed-field path; the default\n` +
      `                     'entries' is what a grid fetches and costs several\n` +
      `                     times as much for the same filter`,
  );
  process.exit(1);
}
if (args.fieldset && !isFieldsetName(args.fieldset)) {
  console.error(
    `--fieldset must be one of: ${fieldsetOptionsHelp()} (got "${args.fieldset}")`,
  );
  process.exit(1);
}
if (args.workload && args.deriveWorkload) {
  console.error(
    '--workload and --derive-workload both name the queries to run; pass one.',
  );
  process.exit(1);
}
if (args.emitWorkload && !args.deriveWorkload) {
  console.error(
    '--emit-workload only has something to emit with --derive-workload.',
  );
  process.exit(1);
}
exitIfProduction(args.matrixUrl, args.realmServerUrl, args.realm);

let realmUrl = ensureTrailingSlash(args.realm);
let searchUrl = `${args.realmServerUrl.replace(/\/$/, '')}/_federated-search`;
let creds = readCredentials(args.csv);
// Assigned before any loop starts. A committed workload is validated before any
// login, so a typo costs a second rather than a round of authentication. A
// derived one cannot be: reading `_types` needs a realm token, so it waits
// until the first session is up.
let workload!: Workload;
// Resolved once the workload is known, since a committed file can pin it.
let fieldset!: FieldsetName;

// An explicit flag beats a workload's own member, which beats the default.
function resolveFieldset(pinned: FieldsetName | undefined): FieldsetName {
  return isFieldsetName(args.fieldset)
    ? args.fieldset
    : (pinned ?? DEFAULT_FIELDSET);
}

if (!args.deriveWorkload) {
  workload = loadWorkload(args.workload, realmUrl);
  // A workload file is a deliberate artifact, and the path its queries ask for
  // decides what the run measures — the same filter costs several times as much
  // on the entries path as on the item path. So a file has to say which, rather
  // than inheriting a default nothing in the file records. `--fieldset` states
  // it just as well, which is what keeps a one-off run cheap.
  if (workload.fieldset === undefined && !isFieldsetName(args.fieldset)) {
    console.error(
      `${args.workload} pins no "fieldset", so the path its numbers would\n` +
        `describe is not stated anywhere. Add a "fieldset" member to the file,\n` +
        `or pass --fieldset (${fieldsetOptionsHelp()}) for this run.`,
    );
    process.exit(1);
  }
  fieldset = resolveFieldset(workload.fieldset);
}

// The concurrency this driver holds, in the two forms the realm server's own
// thresholds are written in. Searches only: a write is not what either the
// admission gate or the link-shape policy counts.
let inFlight = new InFlightReading({ halfLifeMs: args.loadHalfLifeMs });

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

// A cold socket costs a TCP handshake and a TLS handshake before the request is
// even written, and `fetch` resolves only once the response headers arrive — so
// a timed search that had to open a connection reports all of that as if it
// were the server thinking. Readers re-run on an interval far longer than
// undici's keep-alive (a few seconds), so on a realm nobody is writing to,
// which is what `--writers 0` makes normal, nearly every sample would pay it.
//
// Priming has to match the batch's concurrency. A batch of N concurrent
// requests opens N sockets when the pool is cold, and undici hands a request to
// an already-free client in preference to opening another — so priming with a
// single request would funnel the whole batch down one socket and change the
// concurrency under measurement, while priming with N leaves N free clients for
// the N searches to take.
//
// The primer is a CORS preflight. `@koa/cors` answers it ahead of the router,
// so it costs the server nothing beyond the connection it exists to open, and
// it is traffic the server already sees from browsers. A failed preflight is
// ignored: an unhappy response still leaves a warm socket, which is the point.
async function primeConnections(count: number): Promise<void> {
  if (!args.primeConnections || count < 1) {
    return;
  }
  await Promise.all(
    Array.from({ length: count }, () =>
      fetch(searchUrl, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://load-harness.invalid',
          'Access-Control-Request-Method': 'QUERY',
        },
      })
        // The body must be consumed or the socket is never returned to the
        // pool, which would leave the batch opening fresh connections anyway.
        .then((response) => response.text())
        .then(() => undefined)
        .catch(() => undefined),
    ),
  );
  // Without this the last primed connection is still checked out when the batch
  // dispatches, and one search opens a fresh one anyway. See `connection.ts`.
  await yieldSocketToPool();
}

// One preflight, timed. The sampling around it — which call is cold, how the
// warm figure is chosen — lives in `connection.ts`, because getting it wrong is
// silent.
async function timedPreflight(): Promise<number> {
  let started = Date.now();
  let response = await fetch(searchUrl, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://load-harness.invalid',
      'Access-Control-Request-Method': 'QUERY',
    },
  });
  await response.text();
  return Date.now() - started;
}

// Stamped on every search so a line here can be joined to the realm server's
// own timing for the same request, which it logs as `corr=<id>`.
function correlationId(): string {
  return `harness-${Math.random().toString(36).slice(2, 10)}`;
}

// One `_federated-search`. The verb is QUERY with the query in the body, which
// is why this load leaves no query string in ALB access logs and has to be read
// off the cards instead.
async function search(
  session: Session,
  spec: QuerySpec,
  readerIndex: number,
  pass: number,
): Promise<void> {
  let query = queryForPass(spec, readerIndex, pass);
  let started = Date.now();
  // Open before the request and close in `finally`, so the span counted here
  // is the whole time the realm server has this search outstanding — including
  // the body, which the server has already let go of. That asymmetry is why
  // the summary reads this as a bound rather than as the server's own figure.
  let closeInFlight = inFlight.open();
  try {
    let response = await fetch(searchUrl, {
      method: 'QUERY',
      headers: {
        Accept: 'application/vnd.card+json',
        'Content-Type': 'application/json',
        Authorization: realmAuthHeader(session, realmUrl),
        'x-boxel-logging-correlation-id': correlationId(),
      },
      // Fieldset members first, so a query that carries its own `fields` — the
      // escape hatch for a shape neither named value covers — wins for itself.
      body: JSON.stringify({
        ...fieldsetWireMembers(fieldset),
        ...query,
        realms: [realmUrl],
      }),
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
  } finally {
    closeInFlight();
  }
}

// One card write. The payload is deliberately small: what the run is measuring
// is the invalidation the write causes, not the cost of the bytes going up.
async function writeCard(
  session: Session,
  write: WriteSpec,
  n: number,
): Promise<boolean> {
  let started = Date.now();
  let body = {
    data: {
      type: 'card',
      attributes: writeAttributes(write, n),
      meta: { adoptsFrom: write.adoptsFrom },
    },
  };
  try {
    let response = await fetch(`${realmUrl}${write.path.replace(/^\//, '')}/`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.card+json',
        'Content-Type': 'application/vnd.card+json',
        Authorization: realmAuthHeader(session, realmUrl),
      },
      body: JSON.stringify(body),
    });
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

// One forwarded request, as a card that generates before saving makes it. The
// destination is one the realm server refuses, because a real generation would
// cost tokens and minutes per run.
//
// HOW FAR THIS ACTUALLY GETS, which bounds what it can show. A 400 is the
// expected shape: `handleRequestForward` verifies the JWT, parses the body, and
// looks the destination up in `AllowedProxyDestinations` — a `proxy_endpoints`
// read, cached for five seconds per replica — and rejects there. That lookup
// precedes `withUserCostLock`, so a refused destination never takes the
// per-user cost lock and this flag does NOT reproduce the serialization where
// one user's second generation waits out their first. Reaching the lock takes
// an allowlisted destination, which means real spend; the harness declines.
//
// What it does add is a second authenticated round trip per write, at the
// realm server and at the database, in the position a generation occupies.
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

  // Which re-run this is, so a shape with variants walks through them rather
  // than asking its first one every time.
  let pass = 0;

  // First render: the screen fires its whole set at once.
  await primeConnections(specs.length);
  await Promise.all(specs.map((spec) => search(session, spec, index, pass)));

  if (!args.subscribe) {
    // Modelled invalidation: re-run everything on any write this driver made.
    while (running) {
      await nextInvalidation(args.idleReRunMs);
      if (!running) {
        break;
      }
      pass++;
      await primeConnections(specs.length);
      await Promise.all(
        specs.map((spec) => search(session, spec, index, pass)),
      );
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
        await primeConnections(due.length);
        pass++;
        await Promise.all(
          due.map((spec) => search(session, spec, index, pass)),
        );
      }
    }
  } finally {
    unsubscribe?.();
  }
}

async function writerLoop(
  session: Session,
  write: WriteSpec,
  index: number,
): Promise<void> {
  let n = index * 1000;
  while (running) {
    await new Promise((r) => setTimeout(r, args.writeEveryMs));
    if (!running) {
      break;
    }
    // A card that generates does so before it saves, so the forwarded request
    // goes first and its latency lands between this writer's writes.
    if (args.modelCalls) {
      await modelCall(session);
    }
    if (await writeCard(session, write, n++)) {
      announceInvalidation();
    }
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Emitting a derived workload only needs a session that can read `_types`.
let needed = args.emitWorkload ? 1 : args.readers + args.writers;
if (creds.length < needed) {
  console.error(`Credential file has ${creds.length} rows, need ${needed}`);
  process.exit(1);
}

// Before anything else reaches this origin, so the first request is genuinely
// cold.
let connectionSetup: ConnectionSetup | undefined;
if (!args.emitWorkload) {
  try {
    connectionSetup = await measureConnectionSetup(timedPreflight);
    console.log(
      describeConnectionSetup(new URL(searchUrl).host, connectionSetup),
    );
    if (!args.primeConnections) {
      console.log(
        `  --prime-connections=false: that cost lands inside "headers" on every\n` +
          `  sample whose socket had gone cold.`,
      );
    }
  } catch {
    // Not worth failing a run over; the summary simply says less.
  }
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
if (sessions.length === 0) {
  console.error('No sessions authenticated.');
  process.exit(1);
}

if (args.deriveWorkload) {
  let entries = await fetchCardTypeSummary({
    realmUrl,
    // The realm's own JWT. A server token gets a 401 here.
    authorization: realmAuthHeader(sessions[0], realmUrl),
  });
  let raw = workloadFromCardTypeSummary(entries, {
    realmUrl,
    top: args.deriveTop,
    pageSize: args.derivePageSize,
  });
  if (!raw.write) {
    console.error(`\n${readOnlyReason(raw, args.deriveTop)}\n`);
  }
  // A derived workload pins nothing of its own, so the default still applies
  // here — the flag, else `entries`. Resolved before the emit below, which
  // writes the answer into the file so a re-run of it is the same run.
  fieldset = resolveFieldset(undefined);
  if (args.emitWorkload) {
    // Carry the path this run resolved into the file. Without it the emitted
    // workload pins nothing, and re-running it would silently fall back to the
    // default — a different document, several times the bytes, and not the path
    // it was derived under. `--workload` refuses a file that pins none, so an
    // emitted file has to state it to be loadable at all.
    let json = `${JSON.stringify({ fieldset, ...raw }, null, 2)}\n`;
    if (args.emitWorkload === '-') {
      process.stdout.write(json);
    } else {
      writeFileSync(args.emitWorkload, json);
      console.log(`Wrote ${args.emitWorkload}`);
      console.log(
        `Re-run it verbatim with --workload ${args.emitWorkload}. Check the\n` +
          `"write" block before committing: attributes are left empty because\n` +
          `the type summary reports counts, not field schemas.`,
      );
    }
    process.exit(0);
  }
  workload = parseWorkload(raw, realmUrl, `${realmUrl}_types`);
  console.log(
    `Derived ${workload.queries.length} queries from ${realmUrl}_types: ` +
      `${workload.queries.map((q) => q.label).join(', ')}`,
  );
}

console.log(`Modelling the ${describeFieldset(fieldset)}.`);

// Each simulated user authenticates as itself. Searches authorize per realm and
// realm events are broadcast into each user's own session room, so one shared
// account would reproduce neither the authorization work nor the event volume.
//
// A shortfall in authenticated sessions takes writers before readers: the
// searches are what the run is about, and `--writers 0` is a legitimate
// read-only run against a realm nobody wants dirtied.
// A workload with no write block is read-only, and starting writers against it
// would mean inventing a target. Say which workload, so the fix is obvious.
if (args.writers > 0 && !workload.write) {
  console.error(
    `This workload has no "write" block, so it cannot drive writes.\n` +
      `  Re-run with --writers 0, or use a workload whose "write" names a type\n` +
      `  you can create in ${realmUrl}.`,
  );
  process.exit(1);
}

let writerCount = Math.min(args.writers, sessions.length);
if (args.readers > 0 && writerCount >= sessions.length) {
  writerCount = sessions.length - 1;
}
let writerSessions = sessions.slice(0, writerCount);
let readerSessions = sessions.slice(writerCount);
console.log(
  `${readerSessions.length} readers, ${writerSessions.length} writers, ${args.minutes} min. ` +
    `Ctrl-C to stop early.\n`,
);

let reportTimer = setInterval(() => {
  console.log(
    `[${new Date().toISOString().slice(11, 19)}] ` +
      `searches=${stats.searches} (${stats.searchErrors} err)  ` +
      `writes=${stats.writes} (${stats.writeErrors} err)  ` +
      // The number to steer a run by: readers can be added while it is still
      // running, and the rate alone will not say whether that helped. It names
      // its own window, because a line read off a scrolling terminal is
      // separated from the summary and the flags that would otherwise say
      // which window it was taken over.
      `load=${inFlightProgressLabel(inFlight)}  ` +
      `${summarize('search', stats.search.slice(-200))}`,
  );
}, 30000);

// The distinct questions a run asked: shapes that name variants multiply the
// set, shapes that do not contribute one apiece. Reported so a reader can tell
// a run that exercised a realm's answering from one that mostly re-read a
// cached answer.
function describeSpread(): string {
  let specs = [
    ...workload.queries,
    ...workload.secondaryQueries,
    ...(args.extraQueries ? workload.extraQueries : []),
  ];
  let withVariants = specs.filter((s) => s.variants);
  let distinct = specs.reduce(
    (total, s) => total + (s.variants ? s.variants.length : 1),
    0,
  );
  if (withVariants.length === 0) {
    return (
      `${specs.length} shapes, no variants — each asks one question every ` +
      `re-run, which the realm's live-search cache answers after the first`
    );
  }
  return (
    `${specs.length} shapes across ${distinct} distinct questions ` +
    `(${withVariants.length} carry variants), cycled per re-run and offset ` +
    `per reader`
  );
}

function finish() {
  if (!running) {
    return;
  }
  running = false;
  clearInterval(reportTimer);
  subscribeAbort.abort();
  announceInvalidation();
  console.log(`\n───── run summary ─────`);
  // Which path these numbers describe. The same filter costs several times as
  // much on the entries path as on the item path, so a figure quoted without
  // its path is not interpretable.
  console.log(`path:     ${describeFieldset(fieldset)}`);
  // How many distinct questions the run asked, for the same reason the path is
  // printed: a realm answers a repeated query from its live-search cache, so a
  // run whose shapes carry no variants reports what a cache hit costs for most
  // of its searches rather than what answering costs.
  console.log(`spread:   ${describeSpread()}`);
  console.log(`searches: ${stats.searches} (${stats.searchErrors} errors)`);
  console.log(`writes:   ${stats.writes} (${stats.writeErrors} errors)`);
  console.log(summarize('end-to-end ', stats.search));
  console.log(
    summarize('  headers  ', stats.headers) +
      (args.primeConnections
        ? '   ← server work + 1 RTT'
        : '   ← server work + 1 RTT + connection setup'),
  );
  console.log(
    summarize('  body     ', stats.body) + '   ← bytes crossing the network',
  );
  console.log(summarize('write      ', stats.write));
  if (stats.modelCalls || stats.modelErrors) {
    console.log(
      summarize('forwarded  ', stats.model) + '   ← auth + allowlist lookup',
    );
    let statuses = [...stats.modelStatuses]
      .sort((a, b) => b[1] - a[1])
      .map(([code, n]) => `${code}×${n}`)
      .join(' ');
    console.log(
      `  forward responses: ${statuses}${stats.modelErrors ? `  (${stats.modelErrors} failed)` : ''}`,
    );
    console.log(
      `  400 is the expected shape: the request passed auth and was rejected at\n` +
        `  the destination allowlist, which sits in front of the per-user cost\n` +
        `  lock. These calls do not reproduce that lock's contention.`,
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

  // What `headers` does and does not contain, stated with this run's own
  // numbers rather than left for the reader to infer.
  if (connectionSetup) {
    let setup =
      `${Math.round(connectionSetup.setupMs)}ms TCP+TLS setup ` +
      `(cold ${Math.round(connectionSetup.coldMs)}ms vs warm ` +
      `${Math.round(connectionSetup.warmMs)}ms)`;
    if (args.primeConnections) {
      console.log(
        `connections were opened before each timed batch, so "headers" excludes\n` +
          `  this link's ${setup}. It is still one round trip away from the\n` +
          `  server's own duration — compare runs from one place.`,
      );
    } else {
      console.log(
        `⚠  "headers" above INCLUDES this link's ${setup}\n` +
          `   on every sample whose socket had gone cold, which on a quiet realm is\n` +
          `   most of them. Drop --prime-connections=false to measure server work.`,
      );
    }
  }
  console.log(
    `  "headers" also rises with --readers: more searches in flight is the\n` +
      `  server under load, which is the thing being measured, not an artifact.`,
  );

  console.log(`\nper query shape (end-to-end / headers / body, median):`);
  let shapes: { label: string; headersMs: number; bytes: number }[] = [];
  for (let [label, rows] of [...stats.byLabel].sort()) {
    let med = (pick: (r: (typeof rows)[number]) => number) => {
      let v = rows.map(pick).sort((a, b) => a - b);
      return v[Math.floor(v.length / 2)] ?? 0;
    };
    let headersMs = med((r) => r.headersMs);
    let bytes = med((r) => r.bytes);
    shapes.push({ label, headersMs, bytes });
    console.log(
      `  ${label.padEnd(20)} n=${String(rows.length).padStart(3)} ` +
        `${String(Math.round(med((r) => r.total))).padStart(6)}ms / ` +
        `${String(Math.round(headersMs)).padStart(5)}ms / ` +
        `${String(Math.round(med((r) => r.bodyMs))).padStart(6)}ms  ` +
        `${String(Math.round(bytes / 1024)).padStart(4)} KB`,
    );
  }

  // Two things the table above contains but does not say out loud, and both
  // change what a run means.
  if (shapes.length > 1) {
    // One render fires the whole set at once, so the sum is what a screen costs
    // to open — not any single row.
    let perRender = shapes.reduce((a, s) => a + s.bytes, 0) / 1024;
    console.log(
      `\n  one pass over these ${shapes.length} shapes transfers ` +
        `${perRender >= 1024 ? `${(perRender / 1024).toFixed(1)} MB` : `${Math.round(perRender)} KB`}` +
        `, which is what opening the screen costs.`,
    );

    // A wide spread means the realm's cost is concentrated in a few types, so
    // an average over shapes describes none of them.
    let ranked = [...shapes].sort((a, b) => a.headersMs - b.headersMs);
    let fastest = ranked[0];
    let slowest = ranked[ranked.length - 1];
    if (fastest.headersMs > 0 && slowest.headersMs / fastest.headersMs >= 3) {
      console.log(
        `  server time spans ${(slowest.headersMs / fastest.headersMs).toFixed(1)}× across shapes ` +
          `(${slowest.label} ${Math.round(slowest.headersMs)}ms vs ` +
          `${fastest.label} ${Math.round(fastest.headersMs)}ms) — the cost sits\n` +
          `  in particular types, so read the rows rather than the aggregate.`,
      );
    }
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

  // Rate is not the load. In-flight is rate multiplied by service time, and
  // service time is the term that moves — so the two lines have to be read
  // together, and only the second one is comparable to a server-side
  // threshold.
  console.log(describeInFlight(inFlight));

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
    `\nNow read the server side. heapMB and eventLoopLagMs come from the realm-\n` +
      `server health sampler over this window; the concurrency the policies act on\n` +
      `does not, because the sampler reports an instantaneous count on a cadence\n` +
      `coarser than the bursts it is trying to catch. Take that from the per-request\n` +
      `boxel:search-shape records (linkMode / linkShapeLevel / linkShapeLoad) and\n` +
      `from the boxel:link-shape-policy heartbeat, which is the one line that\n` +
      `separates a policy that declined from one that is not running. Each search\n` +
      `was stamped with an x-boxel-logging-correlation-id, so a slow one here can\n` +
      `be joined to the server's own timing by its corr= id.`,
  );
  process.exit(0);
}

process.on('SIGINT', finish);
setTimeout(finish, args.minutes * 60000);

readerSessions.forEach((s, i) => void readerLoop(s, i));
let writeSpec = workload.write;
if (writeSpec) {
  writerSessions.forEach((s, i) => void writerLoop(s, writeSpec, i));
}
