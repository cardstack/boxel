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
const { startFactoryRealmServer, startFactorySupportServices } =
  await import('../../packages/realm-test-harness/src/index.ts');

let { values } = parseArgs({
  options: {
    dataset: { type: 'string' },
    output: { type: 'string' },
    iterations: { type: 'string', default: '5' },
    serve: { type: 'boolean', default: false },
    'realm-server-url': { type: 'string' },
    'resume-index': { type: 'string' },
    'skip-html-replay': { type: 'boolean', default: false },
  },
});
if (values['skip-html-replay'] && !values['resume-index'])
  throw new Error(
    '--skip-html-replay requires an explicit committed index clone',
  );
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
let hostDir = process.env.TEST_HARNESS_HOST_DIST_PACKAGE_DIR
  ? resolve(process.env.TEST_HARNESS_HOST_DIST_PACKAGE_DIR)
  : resolve(import.meta.dirname, '../../packages/host');
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
    'packages/realm-test-harness',
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
// A tooling-only edit or commit must not force a fresh 12,550-record index.
// Runtime source and built-host contents still invalidate the template; the
// harness separately hashes every fixture module and synthetic source record.
process.env.TEST_HARNESS_CACHE_SALT = `tessar:${hostHash}:${runtimeHash}`;
let started = performance.now();
let realm;
let support;
let resumedHtml;
if (
  values['resume-index'] &&
  !/^sf_bld_[a-z0-9_]+$/.test(values['resume-index'])
)
  throw new Error(
    '--resume-index must name an isolated synthetic builder database',
  );
let realmServerURL = values['realm-server-url']
  ? new URL(values['realm-server-url'])
  : undefined;
if (
  realmServerURL &&
  !['localhost', '127.0.0.1'].includes(realmServerURL.hostname)
)
  throw new Error('Tessar benchmarks require a local realm server');
try {
  if (values['resume-index']) support = await startFactorySupportServices();
  realm = await startFactoryRealmServer({
    realmServerURL,
    realms: [{ dir: join(dataset, 'realm'), path: 'tessar/' }],
    ...(support
      ? {
          context: support.context,
          templateDatabaseName: values['resume-index'],
          templateRealmServerURL: realmServerURL,
        }
      : {}),
  });
  await writeFile(
    `${output}.runtime.json`,
    JSON.stringify({
      realmURL: realm.realmURL.href,
      realmServerURL: realm.realmServerURL.href,
      databaseName: realm.databaseName,
      childPids: realm.childPids,
      matrixURL: support?.context.matrixURL,
    }),
    { mode: 0o600 },
  );
  if (support && !values['skip-html-replay']) {
    // Preserve the failed builder; repair only this disposable clone. Reuse
    // the committed JSON index explicitly, never report this as a cold build.
    const { resumeTessarHtml } = await import('./resume-html.mjs');
    resumedHtml = await resumeTessarHtml({
      sourceDatabase: values['resume-index'],
      runtimeDatabase: realm.databaseName,
      realmURL: realm.realmURL.href,
    });
  }
  let startupMs = performance.now() - started;
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
      if (
        manifest.variant !== 'get-cards' &&
        body.data.meta.tessar?.state !== 'ready'
      )
        throw new Error('Tessar view is not ready');
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
        workers: {
          allPriority: 1,
          userIndex: Number(process.env.TEST_HARNESS_USER_INDEX_WORKERS ?? 0),
        },
        startupMs,
        setupMode: values['skip-html-replay']
          ? 'committed-json-index-only'
          : support
            ? 'resumed-html-from-committed-index'
            : 'cold-or-template-cache',
        resumedHtml,
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
} catch (error) {
  await writeFile(
    `${output}.failure.json`,
    JSON.stringify(
      {
        commit,
        hostHash,
        runtimeHash,
        manifest,
        elapsedMs: performance.now() - started,
        error: error.message,
        details: error.tessarDetails,
      },
      null,
      2,
    ) + '\n',
  );
  throw error;
} finally {
  await realm?.stop();
  await support?.stop();
}
