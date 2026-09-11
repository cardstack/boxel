// Read-only memory probe over the actual synthetic dependency index. The
// definition-cache sink is inert: this isolates candidate collection from
// module rendering and does not change the preserved failed builder.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { getHeapStatistics } from 'node:v8';
import { PgAdapter } from '../../packages/postgres/index.ts';
import {
  IndexWriter,
  VirtualNetwork,
  logger,
} from '../../packages/runtime-common/index.ts';
import { query, param } from '../../packages/runtime-common/expression.ts';
const { values } = parseArgs({
  options: {
    database: { type: 'string' },
    dataset: { type: 'string' },
    output: { type: 'string' },
    before: { type: 'string' },
  },
});
if (
  !/^sf_bld_[a-z0-9_]+$/.test(values.database ?? '') ||
  !values.dataset ||
  !values.output
)
  throw new Error(
    '--database (synthetic builder), --dataset and --output are required',
  );
const manifest = JSON.parse(
  await readFile(`${values.dataset}/manifest.json`, 'utf8'),
);
if (manifest.synthetic !== true) throw new Error('Synthetic manifest required');
process.env.PGHOST = '127.0.0.1';
process.env.PGPORT = process.env.TEST_HARNESS_PGPORT ?? '55437';
process.env.PGUSER = 'postgres';
process.env.PGDATABASE = values.database;
process.env.PGOPTIONS = '-c default_transaction_read_only=on';
const { preWarmModulesTable } = await import(
  values.before
    ? pathToFileURL(values.before).href
    : '../../packages/runtime-common/index-runner/prewarm-modules.ts'
);
const db = new PgAdapter(),
  network = new VirtualNetwork();
const realmURL = new URL('http://localhost:53776/tessar/');
network.addURLMapping(
  new URL('https://cardstack.com/base/'),
  new URL('http://localhost:53776/base/'),
);
network.addRealmMapping('@cardstack/base/', 'http://localhost:53776/base/');
const warmed = new Set(),
  reads = [];
let result = {
  valid: false,
  implementation: values.before ? 'before' : 'bounded',
  heapLimitBytes: getHeapStatistics().heap_size_limit,
};
try {
  const [job] = await query(db, [
    "SELECT args FROM jobs WHERE job_type='prerender_html' AND args->>'realmURL'=",
    param(realmURL.href),
    'ORDER BY id DESC LIMIT 1',
  ]);
  const batch = await new IndexWriter(db).createBatch(realmURL, network, null, {
    prerenderHtmlOnly: true,
    generation: 2,
  });
  const started = performance.now();
  const log = logger('tessar-prewarm-probe');
  await preWarmModulesTable({
    realmURL,
    invalidations: job.args.changes.map((c) => new URL(c.url)),
    allRealmCardModules: [new URL('tessar.gts', realmURL).href],
    definitionLookup: {
      populateDefinitionCacheEntry: async ({ moduleURL }) => {
        warmed.add(moduleURL);
      },
    },
    virtualNetwork: network,
    reader: {
      readFile: async (url) => ({
        content: await readFile(
          `${values.dataset}/realm/${url.href.slice(realmURL.href.length)}`,
          'utf8',
        ),
      }),
    },
    getDependencyRows: async (urls) => {
      const rows = await batch.getDependencyRows(urls);
      reads.push({
        urls: urls.length,
        rows: rows.length,
        heapBytes: process.memoryUsage().heapUsed,
      });
      return rows;
    },
    getModuleCacheContext: async () => ({
      resolvedRealmURL: realmURL.href,
      cacheScope: 'public',
      authUserId: '',
    }),
    prerenderUserId: 'tessar',
    jobPriority: 0,
    jobInfo: { jobId: 0, reservationId: 0, priority: 0, queueWaitMs: null },
    log,
    perfLog: log,
  });
  result = {
    ...result,
    valid: true,
    elapsedMs: performance.now() - started,
    maxRSSKiB: process.resourceUsage().maxRSS,
    warmed: [...warmed].sort(),
    reads,
  };
} catch (error) {
  result.error = error.message;
  process.exitCode = 1;
} finally {
  await db.close();
  await writeFile(values.output, JSON.stringify(result, null, 2) + '\n');
  console.log(
    JSON.stringify({
      ...result,
      warmed: result.warmed?.length,
      reads: result.reads?.length,
    }),
  );
}
