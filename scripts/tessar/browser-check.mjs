import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { buildRealmToken } from '../../packages/realm-test-harness/src/index.ts';
import { generate, expectedSummary, validateSummary } from './generate.mjs';
import {
  readDisplay,
  validateDisplay,
  waitForDisplay,
} from './browser-oracle.mjs';

const { values } = parseArgs({
  options: {
    dataset: { type: 'string' },
    runtime: { type: 'string' },
    'matrix-url': { type: 'string' },
    output: { type: 'string' },
    iterations: { type: 'string', default: '5' },
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
    '--dataset, --runtime, --matrix-url and --output are required',
  );
const runtime = JSON.parse(await readFile(values.runtime, 'utf8'));
const manifest = JSON.parse(
  await readFile(join(resolve(values.dataset), 'manifest.json'), 'utf8'),
);
const realm = new URL(runtime.realmURL);
const matrix = new URL(values['matrix-url']);
for (const url of [realm, matrix, new URL(runtime.realmServerURL)])
  if (!['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Tessar browser checks require isolated local services');
if (manifest.synthetic !== true || realm.pathname !== '/tessar/')
  throw new Error('Only a synthetic Tessar fixture realm may be tested');
const iterations = Number(values.iterations);
if (!Number.isSafeInteger(iterations) || iterations < 1)
  throw new Error('Invalid iterations');
const { records } = generate(manifest);
const ownerId = 'DaySummary/00000';
const ownerURL = new URL(ownerId, realm).href;
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
process.env.TEST_HARNESS_BROWSER_MATRIX_URL = matrix.href;
const { buildBrowserState, installBrowserState } =
  await import('../../packages/software-factory/tests/helpers/browser-auth.ts');
const state = await buildBrowserState(realm.href, runtime.realmServerURL);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await installBrowserState(context, state);
const page = await context.newPage();
const reads = [];
const writes = [];
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(error.message));
let requests = [];
page.on('request', (request) => {
  if (['fetch', 'xhr'].includes(request.resourceType()))
    requests.push({ url: request.url(), method: request.method() });
});
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');

function inputRequests() {
  return requests.filter(
    (request) =>
      (request.url.startsWith(realm.href) &&
        /\/(Student|Staff|Slot|Observation|Report|Reference|Activity)\//.test(
          request.url,
        )) ||
      (request.url.startsWith(runtime.realmServerURL) &&
        /\/_(federated-)?search(?:[?/#]|$)/.test(request.url)),
  );
}

try {
  for (let iteration = 0; iteration < iterations; iteration++) {
    requests = [];
    const beforeMetrics = Object.fromEntries(
      (await cdp.send('Performance.getMetrics')).metrics.map((m) => [
        m.name,
        m.value,
      ]),
    );
    const started = performance.now();
    let result = {
      iteration,
      cache: iteration === 0 ? 'new-browser-context' : 'warm-reload',
      valid: false,
    };
    try {
      if (iteration === 0)
        await page.goto(url.href, { waitUntil: 'domcontentloaded' });
      else await page.reload({ waitUntil: 'domcontentloaded' });
      await page
        .locator('[data-tessar-stat="scoreTotal"]')
        .waitFor({ timeout: 30_000 });
      validateDisplay(
        await readDisplay(page),
        expectedSummary(records, ownerId),
      );
      result.displayMs = performance.now() - started;
      // Keep the readiness timestamp separate from the observation window;
      // delayed eager work after the first render still counts as input work.
      await page.waitForTimeout(250);
      result.valid = true;
      result.inputRequests = inputRequests();
      if (manifest.variant !== 'get-cards' && result.inputRequests.length)
        throw new Error(
          'Tessar materialized display loaded input cards or searched',
        );
      result.fetchRequests = requests.length;
      result.metrics = Object.fromEntries(
        (await cdp.send('Performance.getMetrics')).metrics
          .filter((m) =>
            [
              'JSHeapUsedSize',
              'Nodes',
              'TaskDuration',
              'ScriptDuration',
            ].includes(m.name),
          )
          .map((m) => [
            m.name,
            ['TaskDuration', 'ScriptDuration'].includes(m.name)
              ? m.value - (beforeMetrics[m.name] ?? 0)
              : m.value,
          ]),
      );
    } catch (error) {
      result.valid = false;
      result.failure = error.message;
      result.visibleFailure = (await page.locator('body').innerText()).slice(
        0,
        3000,
      );
    }
    reads.push(result);
    console.log(
      JSON.stringify({
        iteration,
        valid: result.valid,
        displayMs: result.displayMs,
        failure: result.failure,
      }),
    );
  }
  if (values.writes && reads.every((read) => read.valid)) {
    const token = buildRealmToken(realm, new URL(runtime.realmServerURL));
    const trials = [
      {
        id: 'Observation/00000',
        patch: { score: 80 },
        name: 'matching content edit',
      },
      {
        id: 'Reference/00000',
        patch: { label: 'Tessar reference updated' },
        name: 'transitive row label edit',
      },
      {
        id: 'Observation/00000',
        patch: { day: '2026-01-13' },
        name: 'query exit',
      },
      {
        id: 'Observation/00000',
        patch: { day: '2026-01-12' },
        name: 'query entry',
      },
      {
        id: 'Observation/00000',
        patch: { score: 81 },
        name: 'asynchronous source write',
        source: true,
      },
      {
        id: `Reference/${String(manifest.counts.Reference - 1).padStart(5, '0')}`,
        patch: { label: 'Tessar unrelated reference updated' },
        name: 'unrelated write',
        unrelated: true,
      },
      {
        id: 'Observation/99999',
        patch: {
          score: 5,
          sequence: 99999,
          label: 'Tessar inserted observation',
        },
        name: 'matching insertion',
        source: true,
        insert: true,
      },
      { id: 'Observation/99999', name: 'matching deletion', delete: true },
      {
        id: 'Observation/00000',
        patch: { score: 82 },
        name: 'reconnect after missed notification',
        source: true,
        offline: true,
      },
    ];
    for (const trial of trials) {
      if (trial.insert)
        records.set(
          trial.id,
          structuredClone(records.get('Observation/00000')),
        );
      const source = records.get(trial.id);
      if (trial.delete) records.delete(trial.id);
      else Object.assign(source.data.attributes, trial.patch);
      const expected = expectedSummary(records, ownerId);
      const previousOwner = await (
        await fetch(ownerURL, {
          headers: { Accept: 'application/vnd.card+json' },
        })
      ).json();
      await page.evaluate(() => {
        window.__tessarTransitions = [];
        window.__tessarObserver?.disconnect();
        window.__tessarObserver = new MutationObserver(() => {
          const state = document
            .querySelector('[data-tessar-state]')
            ?.getAttribute('data-tessar-state');
          const events = window.__tessarTransitions;
          if (!events.length || events.at(-1).state !== state)
            events.push({
              at: Date.now(),
              state,
              visibleStats:
                document.querySelectorAll('[data-tessar-stat]').length,
            });
        });
        window.__tessarObserver.observe(document.body, {
          attributes: true,
          childList: true,
          characterData: true,
          subtree: true,
        });
      });
      requests = [];
      const startedAt = Date.now();
      let result = { name: trial.name, startedAt, valid: false };
      try {
        if (trial.offline) await context.setOffline(true);
        const mime = trial.source
          ? 'application/vnd.card+source'
          : 'application/vnd.card+json';
        const response = await fetch(
          new URL(trial.id + (trial.source ? '.json' : ''), realm),
          {
            method: trial.delete ? 'DELETE' : trial.source ? 'POST' : 'PATCH',
            headers: {
              Accept: mime,
              'Content-Type': mime,
              Authorization: `Bearer ${token}`,
            },
            body: trial.delete
              ? undefined
              : JSON.stringify(
                  trial.source
                    ? source
                    : {
                        data: {
                          type: 'card',
                          attributes: trial.patch,
                          meta: source.data.meta,
                        },
                      },
                ),
            signal: AbortSignal.timeout(30_000),
          },
        );
        result.ackAt = Date.now();
        result.ackMs = result.ackAt - startedAt;
        result.status = response.status;
        if (!response.ok)
          throw new Error(
            `Write HTTP ${response.status}: ${await response.text()}`,
          );
        await response.arrayBuffer();
        if (manifest.variant !== 'get-cards') {
          const ownerResponse = await fetch(ownerURL, {
            headers: { Accept: 'application/vnd.card+json' },
            signal: AbortSignal.timeout(10_000),
          });
          const document = await ownerResponse.json();
          validateSummary(document.data.attributes, expected);
          if (document.data.meta.tessar?.state !== 'ready')
            throw new Error('Owner is pending');
          result.ownerRevision = document.data.meta.tessar.publishedGeneration;
          if (
            trial.unrelated &&
            result.ownerRevision !==
              previousOwner.data.meta.tessar.publishedGeneration
          )
            throw new Error('An unrelated write reindexed the selected owner');
        }
        if (trial.offline) {
          await page.waitForTimeout(250);
          await context.setOffline(false);
        }
        // Observe the already-open client; a reload would hide lost invalidation.
        await waitForDisplay(
          page,
          expected,
          Math.max(1, 10_000 - (Date.now() - result.ackAt)),
        );
        result.observedAt = Date.now();
        result.ackToDisplayMs = result.observedAt - result.ackAt;
        result.inputRequests = inputRequests();
        result.transitions = await page.evaluate(
          () => window.__tessarTransitions,
        );
        if (
          trial.source &&
          !result.transitions.some(
            (event) => event.state === 'pending' && event.visibleStats === 0,
          )
        )
          throw new Error(
            'The asynchronous write did not expose an explicit pending view',
          );
        result.valid =
          result.ackToDisplayMs <= 10_000 &&
          (manifest.variant === 'get-cards' ||
            result.inputRequests.length === 0);
      } catch (error) {
        result.failure = error.message;
      }
      writes.push(result);
      if (!result.valid) break;
    }
  }
} finally {
  await writeFile(
    values.output,
    JSON.stringify(
      { version: 1, manifest, runtime, reads, writes, browserErrors },
      null,
      2,
    ) + '\n',
  );
  await browser.close();
}
console.log(
  JSON.stringify({
    output: values.output,
    validReads: reads.filter((r) => r.valid).length,
    totalReads: reads.length,
    validWrites: writes.filter((w) => w.valid).length,
    totalWrites: writes.length,
  }),
);
if (
  reads.some((r) => !r.valid) ||
  writes.some((w) => !w.valid) ||
  browserErrors.length
)
  process.exitCode = 1;
