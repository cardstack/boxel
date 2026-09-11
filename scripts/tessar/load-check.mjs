import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { buildRealmToken } from '../../packages/realm-test-harness/src/index.ts';
import { generate, expectedSummary, validateSummary } from './generate.mjs';
import { waitForDisplay, waitForTessarInteractive } from './browser-oracle.mjs';

const { values } = parseArgs({
  options: {
    dataset: { type: 'string' },
    runtime: { type: 'string' },
    output: { type: 'string' },
    'matrix-url': { type: 'string' },
    readers: { type: 'string', default: '1,10,50' },
    'duration-ms': { type: 'string', default: '10000' },
    writes: { type: 'boolean', default: false },
  },
});
if (
  !values.dataset ||
  !values.runtime ||
  !values.output ||
  !values['matrix-url']
)
  throw new Error(
    '--dataset, --runtime, --output and --matrix-url are required',
  );
const runtime = JSON.parse(await readFile(values.runtime, 'utf8'));
const manifest = JSON.parse(
  await readFile(join(values.dataset, 'manifest.json'), 'utf8'),
);
const realm = new URL(runtime.realmURL),
  server = new URL(runtime.realmServerURL),
  matrix = new URL(values['matrix-url']);
for (const url of [realm, server, matrix])
  if (!['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Tessar load checks require local services');
if (
  realm.pathname !== '/tessar/' ||
  manifest.synthetic !== true ||
  manifest.variant === 'get-cards'
)
  throw new Error('A synthetic materialized Tessar dataset is required');
const readers = values.readers.split(',').map(Number),
  durationMs = Number(values['duration-ms']);
if (
  readers.some((n) => !Number.isSafeInteger(n) || n < 1 || n > 50) ||
  !Number.isSafeInteger(durationMs) ||
  durationMs < 1000 ||
  durationMs > 60000
)
  throw new Error('Readers must be 1–50 and duration 1000–60000 ms');
const { records } = generate(manifest),
  ownerId = 'DaySummary/00000',
  ownerURL = new URL(ownerId, realm).href;
const token = buildRealmToken(realm, server);
const cardHeaders = { Accept: 'application/vnd.card+json' };
const cases = [];

async function sourceWrite(id, data) {
  const response = await fetch(new URL(`${id}.json`, realm), {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.card+source',
      'Content-Type': 'application/vnd.card+source',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(`Tessar source write failed: ${response.status}`);
  await response.arrayBuffer();
}

// Browser-check mutations are known synthetic records. Restore them before
// each load case; setup costs are separate from the measured workload.
async function reset() {
  for (const id of [
    'Observation/00000',
    'Reference/00000',
    `Reference/${String(manifest.counts.Reference - 1).padStart(5, '0')}`,
  ])
    await sourceWrite(id, records.get(id));
  const response = await fetch(ownerURL, {
    headers: cardHeaders,
    signal: AbortSignal.timeout(60000),
  });
  const doc = await response.json();
  validateSummary(doc.data.attributes, expectedSummary(records, ownerId));
  if (doc.data.meta.tessar?.state !== 'ready')
    throw new Error('Tessar setup did not settle');
}

process.env.TEST_HARNESS_BROWSER_MATRIX_URL = matrix.href;
const { buildBrowserState, installBrowserState } =
  await import('../../packages/software-factory/tests/helpers/browser-auth.ts');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await installBrowserState(
  context,
  await buildBrowserState(realm.href, server.href),
);
const page = await context.newPage();
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

function distribution(values) {
  values.sort((a, b) => a - b);
  const quantile = (q) => values[Math.max(0, Math.ceil(values.length * q) - 1)];
  return {
    n: values.length,
    min: values[0],
    median: quantile(0.5),
    p95: quantile(0.95),
    max: values.at(-1),
  };
}

try {
  for (const concurrency of readers) {
    await reset();
    const expected = expectedSummary(records, ownerId),
      originalScore = records.get('Observation/00000').data.attributes.score;
    const otherScores = expected.scoreTotal - originalScore;
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await waitForTessarInteractive(page, realm.href);
    await waitForDisplay(page, expected, 30000);
    const startedAt = Date.now(),
      until = startedAt + durationMs;
    const result = {
      readers: concurrency,
      durationMs,
      startedAt,
      readyReads: 0,
      pendingReads: 0,
      failures: [],
      writes: [],
      latenciesMs: [],
      responseBytes: 0,
      browserInputRequests: 0,
    };
    const onRequest = (request) => {
      if (
        (request.url().startsWith(realm.href) &&
          /\/(Student|Staff|Slot|Observation|Report|Reference|Activity)\//.test(
            request.url(),
          )) ||
        /\/_(federated-)?search(?:[?/#]|$)/.test(request.url())
      )
        result.browserInputRequests++;
    };
    page.on('request', onRequest);
    let publishedVersion = 0;
    const lastAcknowledgedVersion = (at) =>
      result.writes.filter((w) => w.ackAt !== undefined && w.ackAt <= at).at(-1)
        ?.version ?? 0;
    async function reader() {
      while (Date.now() < until) {
        const readAt = Date.now(),
          start = performance.now(),
          minimumVersion = lastAcknowledgedVersion(readAt);
        try {
          const response = await fetch(ownerURL, {
            headers: cardHeaders,
            signal: AbortSignal.timeout(10000),
          });
          const text = await response.text();
          result.responseBytes += Buffer.byteLength(text);
          if (!response.ok) throw new Error(`Read HTTP ${response.status}`);
          const doc = JSON.parse(text);
          if (doc.data.meta.tessar?.state === 'pending') {
            result.pendingReads++;
            continue;
          }
          if (doc.data.meta.tessar?.state !== 'ready')
            throw new Error('Missing materialization');
          const score = doc.data.attributes.scoreTotal - otherScores;
          const version = score === originalScore ? 0 : score - 500;
          if (
            !Number.isSafeInteger(version) ||
            version < minimumVersion ||
            version > publishedVersion
          )
            throw new Error(
              `Stale or unknown score version ${version}; minimum ${minimumVersion}`,
            );
          validateSummary(doc.data.attributes, {
            ...expected,
            scoreTotal: otherScores + score,
          });
          result.readyReads++;
          result.latenciesMs.push(performance.now() - start);
        } catch (error) {
          result.failures.push({
            at: Date.now(),
            kind: 'read',
            message: error.message,
          });
        }
      }
    }
    async function writer() {
      if (!values.writes) return;
      while (Date.now() + 1500 < until) {
        await delay(1000);
        const version = ++publishedVersion,
          startedAt = Date.now();
        const write = { version, startedAt, valid: false };
        result.writes.push(write);
        try {
          const source = structuredClone(records.get('Observation/00000'));
          source.data.attributes.score = 500 + version;
          await sourceWrite('Observation/00000', source);
          write.ackAt = Date.now();
          write.ackMs = write.ackAt - startedAt;
          await waitForDisplay(page, {
            ...expected,
            scoreTotal: otherScores + 500 + version,
          });
          write.observedAt = Date.now();
          write.ackToDisplayMs = write.observedAt - write.ackAt;
          write.valid = write.ackToDisplayMs <= 10000;
        } catch (error) {
          result.failures.push({
            at: Date.now(),
            kind: 'write',
            message: error.message,
          });
        }
      }
    }
    await Promise.all([
      ...Array.from({ length: concurrency }, reader),
      writer(),
    ]);
    page.off('request', onRequest);
    result.elapsedMs = Date.now() - startedAt;
    result.latency = distribution([...result.latenciesMs]);
    result.readyReadsPerSecond = result.readyReads / (result.elapsedMs / 1000);
    result.valid =
      result.failures.length === 0 &&
      result.writes.every((w) => w.valid) &&
      result.browserInputRequests === 0;
    cases.push(result);
    console.log(
      JSON.stringify({
        readers: concurrency,
        valid: result.valid,
        readyReads: result.readyReads,
        pendingReads: result.pendingReads,
        throughput: result.readyReadsPerSecond,
        latency: result.latency,
        writes: result.writes.map(({ ackMs, ackToDisplayMs, valid }) => ({
          ackMs,
          ackToDisplayMs,
          valid,
        })),
        failures: result.failures.slice(0, 3),
      }),
    );
  }
} finally {
  await writeFile(
    values.output,
    JSON.stringify(
      {
        version: 2,
        readiness: 'subscribed-client-with-server-markup-removed',
        manifest,
        note: 'Concurrent HTTP readers plus one already-open Chromium dashboard; this does not simulate the client CPU of 50 browsers.',
        cases,
      },
      null,
      2,
    ) + '\n',
  );
  await browser.close();
}
if (cases.some((result) => !result.valid)) process.exitCode = 1;
