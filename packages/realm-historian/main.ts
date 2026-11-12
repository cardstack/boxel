// The realm-historian service: one Node process that takes a shard lease,
// consumes the change journal and reports its health.
//
//   node main.ts --historyRoot=<dir> --realmsRoot=<dir> --port=<port>
//
// The database comes from the `PG*` environment variables. The process exits
// rather than run degraded: an uncaught exception, an unhandled rejection, a
// lost lease or a failed query logs the reason and exits non-zero. SIGTERM
// and SIGINT finish the turn in progress, release the lease and exit 0.

import './setup-logger.ts';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { PgAdapter } from '@cardstack/postgres';
import { logger } from '@cardstack/runtime-common';
import { Historian } from './src/historian.ts';
import { Heartbeat, startHealthServer } from './src/health.ts';
import { DEFAULT_BACKGROUND_CONCURRENCY } from './src/background.ts';
import { probeGit } from './src/git-capabilities.ts';

const log = logger('realm-historian');

const HEALTH_STALE_AFTER_MS = 30_000;

let { values: args } = parseArgs({
  options: {
    historyRoot: { type: 'string' },
    realmsRoot: { type: 'string' },
    port: { type: 'string' },
    shardCount: { type: 'string', default: '1' },
    taskCount: { type: 'string', default: '1' },
    leaseRenewMs: { type: 'string', default: '10000' },
    leaseExpiryMs: { type: 'string', default: '30000' },
    backgroundConcurrency: {
      type: 'string',
      default: String(DEFAULT_BACKGROUND_CONCURRENCY),
    },
  },
  strict: true,
});

function required(name: 'historyRoot' | 'realmsRoot' | 'port'): string {
  let value = args[name];
  if (!value) {
    console.error(`--${name} is required`);
    process.exit(2);
  }
  return value;
}

function integer(name: keyof typeof args, min: number): number {
  let value = Number(args[name]);
  if (!Number.isInteger(value) || value < min) {
    console.error(`--${name} must be an integer of at least ${min}`);
    process.exit(2);
  }
  return value;
}

let historyRoot = required('historyRoot');
let realmsRoot = required('realmsRoot');
required('port');
let port = integer('port', 0);
let shardCount = integer('shardCount', 1);
let taskCount = integer('taskCount', 1);
let leaseRenewMs = integer('leaseRenewMs', 1);
let leaseExpiryMs = integer('leaseExpiryMs', 1);
let backgroundConcurrency = integer('backgroundConcurrency', 1);
if (leaseExpiryMs <= leaseRenewMs) {
  console.error('--leaseExpiryMs must be greater than --leaseRenewMs');
  process.exit(2);
}

let holder = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

process.on('uncaughtException', (error) => {
  log.error('uncaught exception, exiting', error);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  log.error('unhandled rejection, exiting', reason);
  process.exit(1);
});

let db = new PgAdapter();
let heartbeat = new Heartbeat();
let historian = new Historian({
  db,
  historyRoot,
  realmsRoot,
  heartbeat,
  lease: {
    shardCount,
    taskCount,
    renewMs: leaseRenewMs,
    expiryMs: leaseExpiryMs,
    holder,
  },
  background: { concurrency: backgroundConcurrency },
});

let health = await startHealthServer({
  port,
  heartbeat,
  staleAfterMs: HEALTH_STALE_AFTER_MS,
});
log.info(
  `realm-historian started: pid=${process.pid} holder=${holder} port=${health.port} historyRoot=${historyRoot}`,
);

// What the git on PATH can do for path-filtered history reads. Recording and
// maintenance don't depend on the answer, so a probe that fails is only
// logged.
probeGit().then(
  ({ version, bloomWithOnePath, bloomWithSeveralPaths }) =>
    log.info(
      `git ${version}: changed-path Bloom filters serve ${
        bloomWithSeveralPaths
          ? 'several path filters'
          : bloomWithOnePath
            ? 'one path filter only'
            : 'no path filter'
      }`,
    ),
  (error) => log.warn(`probing git failed: ${String(error)}`),
);

for (let signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    log.info(`${signal} received, stopping`);
    historian.stop();
  });
}

let exitCode = 0;
try {
  await historian.run();
} catch (error) {
  log.error('realm-historian failed, exiting', error);
  exitCode = 1;
} finally {
  await health.close();
  await db.close();
}
process.exit(exitCode);
