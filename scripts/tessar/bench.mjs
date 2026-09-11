import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { validateSummary } from './generate.mjs';

// Import the harness only after removing ambient hosted-environment routing.
// Tessar always starts its own local servers and disposable database.
for (let name of [
  'BOXEL_ENVIRONMENT',
  'ENV_SLUG',
  'ENV_MODE',
  'ICONS_URL',
  'REALM_BASE_URL',
  'REALM_TEST_URL',
  'HOST_URL',
  'MATRIX_URL_VAL',
  'PRERENDER_MGR_URL',
  'REALM_SERVER_TLS_CERT_FILE',
  'REALM_SERVER_TLS_KEY_FILE',
])
  delete process.env[name];
const { startFactoryRealmServer } =
  await import('../../packages/realm-test-harness/src/index.ts');

let { values } = parseArgs({
  options: {
    dataset: { type: 'string' },
    output: { type: 'string' },
    iterations: { type: 'string', default: '5' },
    serve: { type: 'boolean', default: false },
  },
});
if (!values.dataset || !values.output)
  throw new Error('--dataset and --output are required');
let dataset = resolve(values.dataset);
let output = resolve(values.output);
let iterations = Number(values.iterations);
if (!Number.isSafeInteger(iterations) || iterations < 1)
  throw new Error('Invalid iterations');
let manifest = JSON.parse(
  await readFile(join(dataset, 'manifest.json'), 'utf8'),
);
if (
  manifest.synthetic !== true ||
  !['smoke', '1x', '10x'].includes(manifest.preset)
)
  throw new Error('A Tessar synthetic manifest is required');
let expected = JSON.parse(
  await readFile(join(dataset, 'expected.json'), 'utf8'),
);
let hostDir = resolve(import.meta.dirname, '../../packages/host');
process.env.TEST_HARNESS_HOST_DIST_PACKAGE_DIR = hostDir;
let hostHash = createHash('sha256')
  .update(await readFile(join(hostDir, 'dist/index.html')))
  .digest('hex');
let commit = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
let repository = resolve(import.meta.dirname, '../..');
let sourcePaths = execFileSync(
  'git',
  [
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
    '--',
    'packages/base',
    'packages/runtime-common',
    'packages/host',
    'packages/postgres',
    'packages/realm-server',
    'scripts/tessar',
  ],
  { cwd: repository, encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
let sourceHash = createHash('sha256');
for (let path of [...new Set(sourcePaths)].sort()) {
  try {
    sourceHash
      .update(path)
      .update('\0')
      .update(await readFile(join(repository, path)));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    sourceHash.update(`deleted:${path}`);
  }
}
let runtimeHash = sourceHash.digest('hex');
process.env.TEST_HARNESS_CACHE_SALT = `tessar:${commit}:${hostHash}:${runtimeHash}`;
let started = performance.now();
let realm;
try {
  realm = await startFactoryRealmServer({
    realms: [{ dir: join(dataset, 'realm'), path: 'tessar/' }],
  });
  let startupMs = performance.now() - started;
  await writeFile(
    `${output}.runtime.json`,
    JSON.stringify({
      realmURL: realm.realmURL.href,
      realmServerURL: realm.realmServerURL.href,
      databaseName: realm.databaseName,
      childPids: realm.childPids,
    }),
    { mode: 0o600 },
  );
  console.log(`Tessar ready: ${realm.realmURL.href}`);
  let results = [];
  for (let iteration = 0; iteration < iterations; iteration++) {
    let start = performance.now();
    let response = await fetch(realm.cardURL('DaySummary/00000'), {
      headers: { Accept: 'application/vnd.card+json' },
      signal: AbortSignal.timeout(60_000),
    });
    let bytes = await response.text();
    let elapsedMs = performance.now() - start;
    let body = JSON.parse(bytes);
    let valid = response.ok;
    let failure;
    try {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      validateSummary(body.data.attributes, expected['DaySummary/00000']);
    } catch (error) {
      valid = false;
      failure = error.message;
    }
    results.push({
      iteration,
      elapsedMs,
      responseBytes: Buffer.byteLength(bytes),
      status: response.status,
      valid,
      failure,
    });
    if (iteration === 0)
      await writeFile(`${output}.response.json`, JSON.stringify(body, null, 2));
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        version: 1,
        commit,
        hostHash,
        runtimeHash,
        manifest,
        startupMs,
        results,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({
      output,
      startupMs,
      validReads: results.filter((r) => r.valid).length,
      totalReads: results.length,
      browserReady: values.serve,
    }),
  );
  if (values.serve)
    await new Promise((done) => {
      process.once('SIGINT', done);
      process.once('SIGTERM', done);
    });
  else if (results.some((r) => !r.valid)) process.exitCode = 1;
} finally {
  await realm?.stop();
}
