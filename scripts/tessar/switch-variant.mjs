import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { buildRealmToken } from '../../packages/realm-test-harness/src/index.ts';
import { generate, expectedSummary, validateSummary } from './generate.mjs';

const { values } = parseArgs({
  options: {
    dataset: { type: 'string' },
    runtime: { type: 'string' },
    variant: { type: 'string' },
    'manifest-output': { type: 'string' },
  },
});
if (
  !values.dataset ||
  !values.runtime ||
  !values['manifest-output'] ||
  !['materialized', 'get-cards'].includes(values.variant)
)
  throw new Error(
    '--dataset, --runtime, --variant and --manifest-output are required',
  );
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
    'Only an isolated synthetic Tessar realm can change variants',
  );
const token = buildRealmToken(realm, server);
const { records } = generate({ ...manifest, variant: values.variant });
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
  if (!response.ok)
    throw new Error(
      `Tessar variant write failed at ${path}: HTTP ${response.status}`,
    );
  await response.arrayBuffer();
}
if (values.variant === 'get-cards')
  await post(
    'get-cards.gts',
    await readFile(new URL('./realm/get-cards.gts', import.meta.url), 'utf8'),
  );
// Restore the known mutation fixtures without reindexing all unchanged inputs.
for (const id of [
  'Observation/00000',
  'Reference/00000',
  `Reference/${String(manifest.counts.Reference - 1).padStart(5, '0')}`,
])
  await post(`${id}.json`, JSON.stringify(records.get(id)));
const owners = [...records.keys()].filter((id) => id.startsWith('DaySummary/'));
for (const id of owners)
  await post(`${id}.json`, JSON.stringify(records.get(id)));
const deadline = Date.now() + 300000;
for (const id of owners) {
  let ready = false;
  while (Date.now() < deadline && !ready) {
    const response = await fetch(new URL(id, realm), {
      headers: { Accept: 'application/vnd.card+json' },
      signal: AbortSignal.timeout(60000),
    });
    const document = await response.json();
    ready =
      response.ok &&
      document.data?.meta?.adoptsFrom?.name ===
        (values.variant === 'get-cards' ? 'TessarGetCardsPage' : 'DaySummary');
    if (ready && values.variant === 'materialized') {
      ready = document.data.meta.tessar?.state === 'ready';
      if (ready)
        validateSummary(document.data.attributes, expectedSummary(records, id));
    }
    if (!ready) await delay(250);
  }
  if (!ready) throw new Error(`Tessar variant did not settle: ${id}`);
}
// This metadata describes only the changed dashboard definition. Input count,
// distribution and seed remain the same. The browser check is still required.
const recordHash = createHash('sha256');
for (const [id, document] of records)
  recordHash
    .update(id)
    .update('\0')
    .update(JSON.stringify(document) + '\n');
await writeFile(
  values['manifest-output'],
  JSON.stringify(
    {
      ...manifest,
      sourceDatasetRecordsSha256: manifest.recordsSha256,
      recordsSha256: recordHash.digest('hex'),
      variant: values.variant,
      variantSwitchedInPlace: true,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    variant: values.variant,
    owners: owners.length,
    manifest: values['manifest-output'],
  }),
);
