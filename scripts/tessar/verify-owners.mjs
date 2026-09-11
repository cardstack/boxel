import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { validateSummary } from './generate.mjs';

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
  await readFile(`${values.dataset}/manifest.json`, 'utf8'),
);
const expected = JSON.parse(
  await readFile(`${values.dataset}/expected.json`, 'utf8'),
);
const runtime = JSON.parse(await readFile(values.runtime, 'utf8'));
const realm = new URL(runtime.realmURL);
if (
  manifest.synthetic !== true ||
  realm.pathname !== '/tessar/' ||
  !['localhost', '127.0.0.1'].includes(realm.hostname)
)
  throw new Error('Only local synthetic Tessar fixtures may be verified');
const owners = Object.entries(expected),
  results = [];
let next = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let i = next++; i < owners.length; i = next++) {
      const [id, oracle] = owners[i],
        result = { id, valid: false };
      try {
        const response = await fetch(new URL(id, realm), {
          headers: { Accept: 'application/vnd.card+json' },
          signal: AbortSignal.timeout(10000),
        });
        const doc = await response.json();
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (doc.data.meta.tessar?.state !== 'ready')
          throw new Error('View is not ready');
        validateSummary(doc.data.attributes, oracle);
        result.valid = true;
        result.revision = doc.data.meta.tessar.publishedGeneration;
      } catch (error) {
        result.error = error.message;
      }
      results.push(result);
    }
  }),
);
results.sort((a, b) => a.id.localeCompare(b.id));
await writeFile(
  values.output,
  JSON.stringify({ manifest, results }, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    owners: results.length,
    passed: results.filter((r) => r.valid).length,
    failures: results.filter((r) => !r.valid),
  }),
);
if (results.some((r) => !r.valid)) process.exitCode = 1;
