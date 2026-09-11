import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { buildRealmToken } from '../../packages/realm-test-harness/src/index.ts';
import { generate, expectedSummary } from './generate.mjs';

const { values } = parseArgs({
  options: {
    dataset: { type: 'string' },
    runtime: { type: 'string' },
    output: { type: 'string' },
  },
});
if (!values.dataset || !values.runtime || !values.output)
  throw new Error('--dataset, --runtime and --output are required');
const manifest = JSON.parse(
  await readFile(join(values.dataset, 'manifest.json'), 'utf8'),
);
const runtime = JSON.parse(await readFile(values.runtime, 'utf8'));
const realm = new URL(runtime.realmURL),
  server = new URL(runtime.realmServerURL);
if (
  manifest.synthetic !== true ||
  realm.pathname !== '/tessar/' ||
  ![realm, server].every((url) =>
    ['localhost', '127.0.0.1'].includes(url.hostname),
  )
)
  throw new Error(
    'Tessar lifecycle checks require isolated synthetic services',
  );
const token = buildRealmToken(realm, server);
const { records } = generate(manifest);
const results = [];
async function post(path, bytes) {
  const response = await fetch(new URL(path, realm), {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.card+source',
      'Content-Type': 'application/vnd.card+source',
      Authorization: `Bearer ${token}`,
    },
    body: bytes,
    signal: AbortSignal.timeout(60000),
  });
  await response.arrayBuffer();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
}
async function awaitScore(id, expected, deadline) {
  let last;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL(id, realm), {
        headers: { Accept: 'application/vnd.card+json' },
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
      last = await response.json();
      if (
        response.ok &&
        last.data?.meta?.tessar?.state === 'ready' &&
        last.data.attributes.scoreTotal === expected
      )
        return {
          id,
          revision: last.data.meta.tessar.publishedGeneration,
          scoreTotal: expected,
        };
    } catch (error) {
      last = { error: error.message };
    }
    await delay(100);
  }
  throw new Error(
    `Tessar lifecycle deadline exceeded for ${id}: ${JSON.stringify(last)}`,
  );
}

try {
  const source = structuredClone(records.get('Observation/00000'));
  await post('Observation/00000.json', JSON.stringify(source));
  const expected = expectedSummary(records, 'DaySummary/00000').scoreTotal;
  await awaitScore('DaySummary/00000', expected, Date.now() + 60000);
  await post(
    'feeder-chain.gts',
    await readFile(
      new URL('./realm/feeder-chain.gts', import.meta.url),
      'utf8',
    ),
  );
  // A new unrelated module changes the loader epoch. Existing views must
  // return to ready even though none depended on this new module beforehand.
  const epochAck = Date.now();
  await awaitScore('DaySummary/00000', expected, epochAck + 10000);
  results.push({
    name: 'unrelated module epoch',
    valid: true,
    ackToReadyMs: Date.now() - epochAck,
  });
  const owner = records.get('DaySummary/00000').data.attributes;
  for (let stage = 0; stage < 5; stage++)
    await post(
      `TessarStage${stage}/00000.json`,
      JSON.stringify({
        data: {
          type: 'card',
          attributes: { classroomKey: owner.classroomKey, day: owner.day },
          meta: {
            adoptsFrom: {
              module: '../feeder-chain',
              name: `TessarStage${stage}`,
            },
          },
        },
      }),
    );
  const setupDeadline = Date.now() + 60000;
  await awaitScore('TessarStage4/00000', expected, setupDeadline);
  source.data.attributes.score += 9;
  const start = Date.now();
  await post('Observation/00000.json', JSON.stringify(source));
  const ack = Date.now();
  const snapshots = [];
  for (const id of [
    'DaySummary/00000',
    ...Array.from({ length: 5 }, (_, i) => `TessarStage${i}/00000`),
  ])
    snapshots.push(await awaitScore(id, expected + 9, ack + 10000));
  results.push({
    name: 'five downstream feeder stages',
    valid: true,
    ackMs: ack - start,
    ackToReadyMs: Date.now() - ack,
    snapshots,
  });
} catch (error) {
  results.push({
    name: 'lifecycle failure',
    valid: false,
    error: error.message,
  });
  process.exitCode = 1;
} finally {
  await writeFile(
    values.output,
    JSON.stringify({ version: 1, manifest, results }, null, 2) + '\n',
  );
  console.log(JSON.stringify(results));
}
