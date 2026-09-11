// Interrupt only a verified worker belonging to this synthetic local harness.
// The publication lock makes the crash point deterministic without adding
// production fault-injection hooks or changing the freshness deadline.
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { buildRealmToken } from '../../packages/realm-test-harness/src/index.ts';
import { hashRealmUrlForAdvisoryLock } from '../../packages/postgres/pg-adapter.ts';
import { generate, expectedSummary, validateSummary } from './generate.mjs';
import { waitForDisplay, waitForTessarInteractive } from './browser-oracle.mjs';

const require = createRequire(
  new URL('../../packages/realm-server/package.json', import.meta.url),
);
const { Client } = require('pg');
const { values } = parseArgs({
  options: {
    dataset: { type: 'string' },
    runtime: { type: 'string' },
    output: { type: 'string' },
    'matrix-url': { type: 'string' },
    phase: { type: 'string', default: 'before-publication' },
  },
});
for (const key of ['dataset', 'runtime', 'output', 'matrix-url'])
  if (!values[key]) throw new Error(`--${key} is required`);
if (!['before-publication', 'after-source-publication'].includes(values.phase))
  throw new Error('Unknown Tessar crash phase');
const runtime = JSON.parse(await readFile(values.runtime, 'utf8'));
const manifest = JSON.parse(
  await readFile(join(values.dataset, 'manifest.json'), 'utf8'),
);
const realm = new URL(runtime.realmURL),
  server = new URL(runtime.realmServerURL),
  matrix = new URL(values['matrix-url']);
const pgHost = process.env.TEST_HARNESS_PGHOST ?? '127.0.0.1';
if (
  manifest.synthetic !== true ||
  manifest.variant === 'get-cards' ||
  realm.pathname !== '/tessar/' ||
  !/^sf_run_[a-z0-9_]+$/.test(runtime.databaseName) ||
  ![realm.hostname, server.hostname, matrix.hostname, pgHost].every((host) =>
    ['localhost', '127.0.0.1'].includes(host),
  )
)
  throw new Error('Tessar restart checks require a synthetic local runtime');
function processInfo(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) throw new Error('Invalid PID');
  return execFileSync('ps', ['-p', String(pid), '-o', 'ppid=', '-o', 'args='], {
    encoding: 'utf8',
  }).trim();
}
const managerPid = runtime.childPids.find((pid) =>
  processInfo(pid).includes('worker-manager.ts'),
);
if (!managerPid) throw new Error('The recorded harness manager is not alive');
const { records } = generate(manifest);
const ownerId = 'DaySummary/00000',
  ownerURL = new URL(ownerId, realm).href;
const token = buildRealmToken(realm, server);
async function sourceWrite(id, source) {
  const response = await fetch(new URL(`${id}.json`, realm), {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.card+source',
      'Content-Type': 'application/vnd.card+source',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(source),
    signal: AbortSignal.timeout(30000),
  });
  await response.arrayBuffer();
  if (!response.ok) throw new Error(`Source write: HTTP ${response.status}`);
}
const config = {
  host: pgHost,
  port: Number(process.env.TEST_HARNESS_PGPORT ?? '55436'),
  user: process.env.TEST_HARNESS_PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD,
  database: runtime.databaseName,
};
const db = new Client(config),
  barrier = new Client(config);
let browser,
  context,
  lockHeld = false;
const result = { name: `worker crash ${values.phase}`, valid: false };
try {
  await db.connect();
  await barrier.connect();
  for (const id of [
    'Observation/00000',
    'Reference/00000',
    `Reference/${String(manifest.counts.Reference - 1).padStart(5, '0')}`,
  ])
    await sourceWrite(id, records.get(id));
  const before = await (
    await fetch(ownerURL, {
      headers: { Accept: 'application/vnd.card+json' },
      signal: AbortSignal.timeout(60000),
    })
  ).json();
  validateSummary(before.data.attributes, expectedSummary(records, ownerId));
  if (before.data.meta.tessar?.state !== 'ready')
    throw new Error('Setup is pending');
  process.env.TEST_HARNESS_BROWSER_MATRIX_URL = matrix.href;
  const { buildBrowserState, installBrowserState } =
    await import('../../packages/software-factory/tests/helpers/browser-auth.ts');
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
  await installBrowserState(
    context,
    await buildBrowserState(realm.href, server.href),
  );
  const page = await context.newPage();
  // Authenticate a second device during setup, then open its first page only
  // after the source acknowledgement. It must not receive stale initial HTML.
  const freshContext = await browser.newContext();
  await installBrowserState(
    freshContext,
    await buildBrowserState(realm.href, server.href),
  );
  const freshPage = await freshContext.newPage();
  const errors = [],
    inputRequests = [];
  for (const observedPage of [page, freshPage]) {
    observedPage.on('pageerror', (error) => errors.push(error.message));
    observedPage.on('request', (request) => {
      if (
        (request.url().startsWith(realm.href) &&
          /\/(Student|Staff|Slot|Observation|Report|Reference|Activity)\//.test(
            request.url(),
          )) ||
        /\/_(federated-)?search(?:[?/#]|$)/.test(request.url())
      )
        inputRequests.push(request.url());
    });
  }
  const url = new URL(ownerURL);
  url.searchParams.set(
    'operatorModeState',
    JSON.stringify({
      aiAssistantOpen: false,
      stacks: [[{ format: 'isolated', id: ownerURL }]],
      submode: 'interact',
      workspaceChooserOpened: false,
    }),
  );
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await waitForTessarInteractive(page, realm.href);
  await waitForDisplay(page, expectedSummary(records, ownerId), 30000);
  await page.evaluate((realmURL) => {
    window.__tessarCrashRealmEvents = [];
    const messages = window._CARDSTACK_REALM_SUBSCRIBE;
    window.__tessarCrashConnection = messages?.isTessarConnected;
    messages?.subscribe(realmURL, (event) => {
      window.__tessarCrashRealmEvents.push({
        name: event.eventName,
        at: Date.now(),
        origin: event.origin_server_ts,
      });
    });
    window.__tessarCrashPending = false;
    window.__tessarCrashTransitions = [];
    new MutationObserver(() => {
      let state = document
        .querySelector('[data-tessar-state]')
        ?.getAttribute('data-tessar-state');
      let visibleStats = document.querySelectorAll('[data-tessar-stat]').length;
      if (window.__tessarCrashTransitions.at(-1)?.state !== state)
        window.__tessarCrashTransitions.push({
          state,
          visibleStats,
          at: Date.now(),
          text: document.querySelector('main')?.textContent?.slice(0, 1000),
        });
      if (
        document.querySelector('[data-tessar-state="pending"]') &&
        document.querySelectorAll('[data-tessar-stat]').length === 0
      )
        window.__tessarCrashPending = true;
    }).observe(document.body, {
      subtree: true,
      attributes: true,
      childList: true,
    });
  }, realm.href);
  let barrierPid;
  if (values.phase === 'before-publication') {
    await barrier.query('BEGIN');
    await barrier.query('SELECT pg_advisory_xact_lock($1::bigint)', [
      hashRealmUrlForAdvisoryLock(`tessar:index:${realm.href}`),
    ]);
    lockHeld = true;
    barrierPid = (await barrier.query('SELECT pg_backend_pid() AS pid')).rows[0]
      .pid;
  }
  const floor = (await db.query('SELECT coalesce(max(id), 0) AS id FROM jobs'))
    .rows[0].id;
  records.get('Observation/00000').data.attributes.score += 23;
  const expected = expectedSummary(records, ownerId);
  const started = Date.now();
  await sourceWrite('Observation/00000', records.get('Observation/00000'));
  const ack = Date.now(),
    deadline = ack + 10000;
  result.ackMs = ack - started;
  if (values.phase === 'before-publication') {
    const navigation = await freshPage.goto(url.href, {
      waitUntil: 'domcontentloaded',
      timeout: Math.max(1, deadline - Date.now()),
    });
    const initialHTML = await navigation.text();
    result.initialHTMLHasOldStats = initialHTML.includes('data-tessar-stat=');
    result.initialHTMLCacheControl = navigation.headers()['cache-control'];
    if (
      result.initialHTMLHasOldStats ||
      result.initialHTMLCacheControl !== 'no-store'
    )
      throw new Error(
        'A new client received cacheable or stale ready-looking initial HTML',
      );
  }
  let reservation;
  while (Date.now() < deadline) {
    const active = await db.query(
      `
      SELECT j.id AS job_id, r.id AS reservation_id, r.worker_id
      FROM jobs j JOIN job_reservations r ON r.job_id = j.id
      WHERE j.id > $1 AND j.args->>'realmURL' = $2
        AND j.job_type = 'incremental-index' AND j.status = 'unfulfilled'
        AND r.completed_at IS NULL ORDER BY j.id DESC LIMIT 1`,
      [floor, realm.href],
    );
    let reached = false;
    if (values.phase === 'before-publication') {
      reached =
        (
          await db.query(
            'SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))',
            [barrierPid],
          )
        ).rows.length > 0;
    } else {
      const dirty = await db.query(
        'SELECT dirty_generation FROM tessar_owners WHERE realm_url = $1 AND owner_url = $2 AND dirty_generation > $3',
        [
          realm.href,
          ownerURL + '.json',
          before.data.meta.tessar.publishedGeneration,
        ],
      );
      reached = dirty.rows.length > 0;
      if (reached)
        result.committedDirtyGeneration = Number(
          dirty.rows[0].dirty_generation,
        );
    }
    if (active.rows.length && reached) {
      reservation = active.rows[0];
      break;
    }
    await delay(20);
  }
  if (!reservation) throw new Error(`No active worker reached ${values.phase}`);
  const match = /^worker-pid-(\d+)$/.exec(reservation.worker_id);
  if (!match) throw new Error('Only a local harness worker can be interrupted');
  const pid = Number(match[1]),
    info = processInfo(pid);
  if (
    Number(info.split(/\s+/)[0]) !== managerPid ||
    !/\bworker\.ts\b/.test(info)
  )
    throw new Error('Worker does not belong to the recorded harness manager');
  result.interruptedReservation = reservation;
  result.ackToCrashMs = Date.now() - ack;
  process.kill(pid, 'SIGKILL');
  if (lockHeld) {
    await barrier.query('ROLLBACK');
    lockHeld = false;
  }
  if (values.phase === 'after-source-publication') {
    const dirty = (
      await db.query(
        'SELECT dirty_generation FROM tessar_owners WHERE realm_url = $1 AND owner_url = $2',
        [realm.href, ownerURL + '.json'],
      )
    ).rows[0];
    if (dirty?.dirty_generation == null)
      throw new Error('The crash missed the durable dirty interval');
  }
  await waitForDisplay(page, expected, Math.max(1, deadline - Date.now()));
  result.ackToDisplayMs = Date.now() - ack;
  if (values.phase === 'before-publication') {
    await waitForTessarInteractive(
      freshPage,
      realm.href,
      Math.max(1, deadline - Date.now()),
    );
    await waitForDisplay(
      freshPage,
      expected,
      Math.max(1, deadline - Date.now()),
    );
    result.newClientAckToDisplayMs = Date.now() - ack;
  }
  const after = await (
    await fetch(ownerURL, {
      headers: { Accept: 'application/vnd.card+json' },
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    })
  ).json();
  validateSummary(after.data.attributes, expected);
  if (after.data.meta.tessar?.state !== 'ready')
    throw new Error('Recovered view is pending');
  result.ownerRevision = after.data.meta.tessar.publishedGeneration;
  result.reservations = (
    await db.query(
      'SELECT worker_id, completion_reason, completed_at FROM job_reservations WHERE job_id = $1 ORDER BY id',
      [reservation.job_id],
    )
  ).rows;
  if (
    !result.reservations.some(
      (r) =>
        r.worker_id === reservation.worker_id &&
        r.completion_reason === 'interrupted',
    ) ||
    !result.reservations.some(
      (r) =>
        r.worker_id !== reservation.worker_id &&
        r.completion_reason === 'completed',
    )
  )
    throw new Error('The interrupted job was not completed by a replacement');
  result.explicitPending = await page.evaluate(
    () => window.__tessarCrashPending,
  );
  result.transitions = await page.evaluate(
    () => window.__tessarCrashTransitions,
  );
  result.realmEvents = await page.evaluate(
    () => window.__tessarCrashRealmEvents,
  );
  result.initialConnection = await page.evaluate(
    () => window.__tessarCrashConnection,
  );
  result.pageErrors = errors;
  result.inputRequests = inputRequests;
  if (!result.explicitPending || errors.length || inputRequests.length)
    throw new Error(
      'Recovered browser violated pending, error or graph-fetch gates',
    );
  result.valid = true;
} catch (error) {
  result.error = error.message;
  process.exitCode = 1;
} finally {
  if (lockHeld) await barrier.query('ROLLBACK').catch(() => {});
  await barrier.end().catch(() => {});
  await db.end().catch(() => {});
  await context?.close();
  await browser?.close();
  await writeFile(
    values.output,
    JSON.stringify(
      {
        version: 2,
        readiness: 'subscribed-client-with-server-markup-removed',
        manifest,
        result,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify(result));
}
