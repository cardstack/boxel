import { PgAdapter, PgQueuePublisher } from '../../packages/postgres/index.ts';
import { query, param } from '../../packages/runtime-common/expression.ts';

// Diagnostic continuation after source indexing succeeded and HTML failed.
// The source builder remains unchanged, including its failed job history.
export async function resumeTessarHtml({
  sourceDatabase,
  runtimeDatabase,
  realmURL,
}) {
  if (
    !/^sf_bld_[a-z0-9_]+$/.test(sourceDatabase) ||
    !/^sf_run_[a-z0-9_]+$/.test(runtimeDatabase) ||
    !['localhost', '127.0.0.1'].includes(new URL(realmURL).hostname) ||
    new URL(realmURL).pathname !== '/tessar/'
  )
    throw new Error('Only an isolated Tessar builder may be resumed');
  process.env.PGHOST = process.env.TEST_HARNESS_PGHOST ?? '127.0.0.1';
  process.env.PGPORT = process.env.TEST_HARNESS_PGPORT ?? '55436';
  process.env.PGUSER = process.env.TEST_HARNESS_PGUSER ?? 'postgres';
  if (!['localhost', '127.0.0.1'].includes(process.env.PGHOST))
    throw new Error('Tessar recovery requires local Postgres');
  process.env.PGDATABASE = sourceDatabase;
  let source = new PgAdapter();
  let prior;
  try {
    [prior] = await query(source, [
      "SELECT args, timeout, priority FROM jobs WHERE job_type = 'prerender_html' AND status = 'rejected' AND args->>'realmURL' =",
      param(realmURL),
      'ORDER BY id DESC LIMIT 1',
    ]);
    let [index] = await query(source, [
      "SELECT status, result->'stats' AS stats FROM jobs WHERE job_type = 'from-scratch-index' AND args->>'realmURL' =",
      param(realmURL),
      'ORDER BY id DESC LIMIT 1',
    ]);
    if (
      !prior ||
      index?.status !== 'resolved' ||
      index.stats.instanceErrors ||
      index.stats.fileErrors
    )
      throw new Error(
        'The builder must have successful source indexing and failed HTML',
      );
  } finally {
    await source.close();
  }
  process.env.PGDATABASE = runtimeDatabase;
  const target = new PgAdapter(),
    queue = new PgQueuePublisher(target);
  try {
    const [revision] = await query(target, [
      'SELECT current_generation, loader_epoch FROM realm_generations WHERE realm_url =',
      param(realmURL),
    ]);
    const started = performance.now();
    const job = await queue.publish({
      jobType: 'prerender_html',
      concurrencyGroup: `prerender-html:${realmURL}`,
      timeout: prior.timeout,
      priority: prior.priority,
      args: {
        ...prior.args,
        generation: Number(revision.current_generation),
        loaderEpoch: revision.loader_epoch,
        spawningJobId: null,
      },
    });
    console.log('Tessar: replaying HTML against the committed synthetic index');
    const result = await job.done;
    console.log(
      JSON.stringify({
        tessarHtmlMs: performance.now() - started,
        stats: result.stats,
      }),
    );
    if (result.stats.instanceErrors || result.stats.fileErrors) {
      const failures = await query(target, [
        "SELECT url, error_doc->>'message' AS message FROM prerendered_html WHERE realm_url =",
        param(realmURL),
        'AND error_doc IS NOT NULL',
      ]);
      const error = new Error('Resumed HTML has render errors');
      error.tessarDetails = {
        elapsedMs: performance.now() - started,
        stats: result.stats,
        failures,
      };
      throw error;
    }
    return {
      elapsedMs: performance.now() - started,
      stats: result.stats,
      phaseTimings: result.phaseTimings,
    };
  } finally {
    await queue.destroy();
    await target.close();
  }
}
