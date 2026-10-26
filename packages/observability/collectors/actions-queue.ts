// Samples the GitHub Actions queue and emits one JSON log line per observation,
// which Alloy (local) or FireLens (hosted) ships to Loki for the "GitHub Actions
// Queue" dashboard to read with `| json`.
//
// Why a poller rather than webhooks: the questions this answers are about
// *standing* state — how deep is the queue right now, how long has this job been
// waiting, which branches are holding runners. Webhooks deliver transitions, so
// reconstructing depth from them means keeping state and healing missed
// deliveries. A periodic snapshot is inherently self-correcting.
//
// This must not run as a scheduled GitHub Actions workflow: it would queue
// behind the very backlog it measures and go blind during the incident it
// exists for.
//
// Each sample also decides whether host CI spills onto RunsOn (see spill.ts),
// and sets the repo variable that the host workflow reads when the App
// credentials for it are configured (see github-app.ts).

import {
  decideSpill,
  isGithubHosted,
  thresholdsFromEnv,
  type PoolSample,
  type SpillState,
  type SpillThresholds,
} from './spill.ts';
import { RepoVariable, githubAppFromEnv } from './github-app.ts';

const CHANNEL = 'boxel:actions-queue';

// One sample costs three run-list requests plus one per active run, so the
// hourly spend scales with how busy the repository is, against the 5,000
// requests an hour a token is allowed. Measured over this collector's own
// history: 4 active runs at the median, 43 at p95, 51 at peak.
//
//   active runs   at 60s      at 30s
//             4    420/hr      840/hr
//            43   2,760/hr   5,520/hr
//            51   3,240/hr   6,480/hr
//
// A minute is comfortable across that range and doubles the resolution. Thirty
// seconds exceeds the budget above roughly forty concurrent runs — which is
// exactly when the queue is worth watching — so it needs the per-sample cost
// reduced first, not the interval shortened.
const DEFAULT_INTERVAL_SECONDS = 60;

// Requests deliberately left unspent, so a burst of runs can never take the
// token to zero and lock out other consumers.
const RATE_LIMIT_RESERVE = 750;

interface Job {
  id: number;
  run_id: number;
  run_attempt: number;
  workflow_name: string | null;
  head_branch: string | null;
  name: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  started_at: string | null;
  runner_name: string | null;
  labels: string[];
  steps?: { name: string; status: string; started_at: string | null }[];
}

interface Run {
  id: number;
  name: string | null;
  head_branch: string | null;
  run_attempt: number;
  created_at: string;
  status: string;
  actor?: { login?: string } | null;
  triggering_actor?: { login?: string } | null;
  event?: string;
}

interface Options {
  repo: string;
  token: string;
  intervalMs: number;
  once: boolean;
  // Other repositories whose jobs share GitHub's runner pool with `repo`.
  // They count toward the spill decision only, and emit no lines of their
  // own, so the dashboard keeps describing `repo` alone.
  poolRepos: string[];
  spillVariable: string;
  // Decide and log, but never write the variable.
  dryRun: boolean;
}

function usage(): never {
  console.error(
    `usage: node actions-queue.ts [--repo owner/name] [--interval seconds] [--once] [--dry-run]

  --repo      Repository to sample. Default $GITHUB_REPOSITORY, else cardstack/boxel.
  --interval  Seconds between samples. Default ${DEFAULT_INTERVAL_SECONDS}.
  --once      Take a single sample and exit, rather than looping.
  --dry-run   Log the spill decision without writing the repo variable.

  Requires a token only to raise the API rate limit from 60 to 5,000 requests
  an hour. Against a public repository it needs no permissions at all; against
  a private one it needs Actions: Read-only.

  The spill variable is written only when SPILL_APP_ID,
  SPILL_APP_INSTALLATION_ID and SPILL_APP_PRIVATE_KEY are set; without them
  every sample runs as --dry-run. See packages/observability/README.md for
  the other SPILL_* settings.`,
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  let repo = process.env.GITHUB_REPOSITORY || 'cardstack/boxel';
  let intervalSeconds = Number(
    process.env.ACTIONS_QUEUE_INTERVAL || DEFAULT_INTERVAL_SECONDS,
  );
  let once = false;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--once') {
      once = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--repo') {
      repo = argv[++i] ?? usage();
    } else if (arg === '--interval') {
      intervalSeconds = Number(argv[++i]);
    } else {
      usage();
    }
  }

  // The hosted task reads a dedicated parameter rather than a bare
  // GITHUB_TOKEN, because its SSM path is shared with every other boxel
  // service and a generic name there would be ambiguous. Locally the plain
  // name is the convenient one, so both are accepted.
  const token =
    process.env.ACTIONS_COLLECTOR_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN ||
    '';
  if (!token) {
    console.error(
      'set ACTIONS_COLLECTOR_GITHUB_TOKEN or GITHUB_TOKEN — any token raises the\n' +
        'rate limit from 60 to 5,000 requests an hour; see --help',
    );
    process.exit(2);
  }
  if (!/^[^/]+\/[^/]+$/.test(repo)) {
    console.error(`--repo must be owner/name, got "${repo}"`);
    process.exit(2);
  }
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 10) {
    console.error('--interval must be a number of seconds, at least 10');
    process.exit(2);
  }
  const poolRepos = (process.env.SPILL_POOL_REPOS ?? 'cardstack/boxel-catalog')
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r && r !== repo);
  for (const r of poolRepos) {
    if (!/^[^/]+\/[^/]+$/.test(r)) {
      console.error(`SPILL_POOL_REPOS entries must be owner/name, got "${r}"`);
      process.exit(2);
    }
  }
  const spillVariable = process.env.SPILL_VARIABLE || 'HOST_TEST_SPILL';

  return {
    repo,
    token,
    intervalMs: intervalSeconds * 1000,
    once,
    poolRepos,
    spillVariable,
    dryRun,
  };
}

// Emitted on its own line so a log-shipping pipeline sees one JSON object per
// line. Anything non-serialisable would corrupt the stream, so values are kept
// to primitives and arrays of primitives by construction.
function emit(record: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ channel: CHANNEL, ...record }) + '\n');
}

let rateLimitRemaining: number | null = null;

async function gh<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'boxel-actions-queue-collector',
    },
  });
  const remaining = res.headers.get('x-ratelimit-remaining');
  if (remaining !== null) {
    rateLimitRemaining = Number(remaining);
  }
  if (!res.ok) {
    // GitHub distinguishes its refusals only in the response body: a rejected
    // credential, a token whose repository access omits this one, and an
    // exhausted rate limit are all 403. Carrying the body and the remaining
    // budget into the error means the emitted collector-error line says which,
    // rather than leaving it to be inferred.
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 300).replace(/\s+/g, ' ').trim();
    } catch {
      // A body that cannot be read is not worth failing over; the status still
      // carries most of the signal.
    }
    const err = new Error(
      `GET ${url} → ${res.status} ${res.statusText}` +
        (detail ? ` — ${detail}` : '') +
        ` (rate limit remaining: ${res.headers.get('x-ratelimit-remaining') ?? 'unknown'})`,
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

// The REST list endpoints cap at 100 per page. Callers here are bounded by how
// much work is in flight, not by repository history, so a small page cap is a
// backstop against a runaway loop rather than a real limit.
async function paginate<T>(
  url: string,
  token: string,
  extract: (page: any) => T[],
  maxPages = 10,
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const body = await gh<any>(
      `${url}${url.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
      token,
    );
    const batch = extract(body);
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}

function seconds(from: string | null | undefined, to: number): number | null {
  if (!from) return null;
  const t = Date.parse(from);
  return Number.isFinite(t) ? Math.max(0, Math.round((to - t) / 1000)) : null;
}

function emptyPool(): PoolSample {
  return { running: 0, queued: 0, oldestQueuedSeconds: null };
}

// Adds one job to the GitHub-hosted pool count. Only `queued` jobs wait for a
// runner: a `pending` job is held by a concurrency group, which says nothing
// about the pool.
function countInPool(pool: PoolSample, job: Job, observedAt: number): void {
  if (!isGithubHosted(job.labels ?? [])) return;
  if (job.status === 'in_progress') {
    pool.running++;
  } else if (job.status === 'queued') {
    pool.queued++;
    const waited = seconds(job.created_at, observedAt) ?? 0;
    pool.oldestQueuedSeconds = Math.max(pool.oldestQueuedSeconds ?? 0, waited);
  }
}

// The pool count for a repository that is not sampled for the dashboard. Any
// failure other than a reaped run throws, because a count with a repository's
// jobs missing would understate the pool.
async function samplePool(
  repo: string,
  token: string,
  observedAt: number,
): Promise<PoolSample> {
  const base = `https://api.github.com/repos/${repo}/actions`;
  const pool = emptyPool();
  for (const status of ['queued', 'in_progress']) {
    const runs = await paginate<Run>(
      `${base}/runs?status=${status}`,
      token,
      (b) => b.workflow_runs ?? [],
    );
    for (const run of runs) {
      let jobs: Job[];
      try {
        jobs = await paginate<Job>(
          `${base}/runs/${run.id}/jobs`,
          token,
          (b) => b.jobs ?? [],
        );
      } catch (e) {
        if ((e as { status?: number }).status === 404) continue;
        throw e;
      }
      for (const job of jobs) countInPool(pool, job, observedAt);
    }
  }
  return pool;
}

// Returns the GitHub-hosted pool count for `opts.repo`, or null when the
// sample was abandoned and the count is unknown.
async function sample(opts: Options): Promise<PoolSample | null> {
  const base = `https://api.github.com/repos/${opts.repo}/actions`;
  const observedAt = Date.now();
  const observed_at = new Date(observedAt).toISOString();

  // Only queued, pending and in_progress runs can hold or want a runner, so
  // completed history is deliberately not fetched — it would dominate the
  // request budget without informing the queue.
  const runs: Run[] = [];
  for (const status of ['queued', 'in_progress', 'pending']) {
    runs.push(
      ...(await paginate<Run>(
        `${base}/runs?status=${status}`,
        opts.token,
        (b) => b.workflow_runs ?? [],
      )),
    );
  }

  const runById = new Map<number, Run>(runs.map((r) => [r.id, r]));

  // Fetching one job list per run is the expensive half of a sample. Skipping
  // the whole sample keeps the series honest: a partial sample would understate
  // queue depth, which is worse than a visible gap.
  if (
    rateLimitRemaining !== null &&
    rateLimitRemaining - runs.length < RATE_LIMIT_RESERVE
  ) {
    emit({
      event_type: 'collector-throttled',
      observed_at,
      repo: opts.repo,
      active_runs: runs.length,
      rate_limit_remaining: rateLimitRemaining,
    });
    return null;
  }

  const pool = emptyPool();
  let queuedJobs = 0;
  let runningJobs = 0;
  // GitHub reports a job as pending while a concurrency group holds it, and as
  // queued while it waits for a runner. The two are counted apart so a
  // self-imposed hold never reads as pool saturation.
  let pendingJobs = 0;
  // Grouped depth is emitted as its own lines rather than as nested objects on
  // the snapshot, because LogQL flattens nested JSON into one label per key —
  // which for dynamic keys like branch names yields an unqueryable label per
  // branch instead of a series grouped by branch.
  const groups: Record<
    string,
    Map<string, { queued: number; running: number; pending: number }>
  > = {
    workflow: new Map(),
    branch: new Map(),
    actor: new Map(),
  };

  for (const run of runs) {
    let jobs: Job[];
    try {
      jobs = await paginate<Job>(
        `${base}/runs/${run.id}/jobs`,
        opts.token,
        (b) => b.jobs ?? [],
      );
    } catch (e) {
      const status = (e as { status?: number }).status;
      emit({
        event_type: 'collector-error',
        observed_at,
        repo: opts.repo,
        run_id: run.id,
        message: e instanceof Error ? e.message : String(e),
      });
      // A run that completed and was reaped between the listing and this fetch
      // answers 404, and has no jobs left to count — omitting it understates
      // nothing, so the sample continues.
      if (status === 404) continue;
      // Anything else means this run's jobs are unknown rather than absent.
      // Publishing the totals anyway would put a confidently low queue depth
      // on the dashboard at precisely the moment the API is failing, which is
      // worse than the visible gap a skipped sample leaves — the same reason
      // the rate-limit reserve above abandons the sample rather than trimming
      // it.
      emit({
        event_type: 'collector-aborted',
        observed_at,
        repo: opts.repo,
        active_runs: runs.length,
        reason: `job listing failed for run ${run.id} with status ${status ?? 'unknown'}`,
      });
      return null;
    }

    for (const job of jobs) {
      if (
        job.status !== 'queued' &&
        job.status !== 'in_progress' &&
        job.status !== 'pending'
      ) {
        continue;
      }

      const meta = runById.get(job.run_id);
      const actor = meta?.triggering_actor?.login ?? meta?.actor?.login ?? null;
      const branch = job.head_branch ?? meta?.head_branch ?? null;
      const workflow = job.workflow_name ?? meta?.name ?? null;

      // While a job is queued GitHub reports started_at equal to created_at, so
      // it cannot be used to tell waiting from running. Wait is therefore
      // measured from created_at, and only a job that has actually left the
      // queue reports a running duration. A pending job has not started either,
      // so its wait is still open-ended.
      const waiting = job.status === 'queued' || job.status === 'pending';
      const queued_seconds = waiting
        ? seconds(job.created_at, observedAt)
        : seconds(job.created_at, Date.parse(job.started_at ?? job.created_at));
      const running_seconds =
        job.status === 'in_progress'
          ? seconds(job.started_at, observedAt)
          : null;

      const step = job.steps?.find((s) => s.status === 'in_progress');

      if (job.status === 'queued') queuedJobs++;
      else if (job.status === 'pending') pendingJobs++;
      else runningJobs++;
      countInPool(pool, job, observedAt);

      const bump = (dimension: string, key: string | null) => {
        if (!key) return;
        const m = groups[dimension];
        const entry = m.get(key) ?? { queued: 0, running: 0, pending: 0 };
        if (job.status === 'queued') entry.queued++;
        else if (job.status === 'pending') entry.pending++;
        else entry.running++;
        m.set(key, entry);
      };
      bump('workflow', workflow);
      bump('branch', branch);
      bump('actor', actor);

      emit({
        event_type: 'job',
        observed_at,
        repo: opts.repo,
        workflow,
        run_id: job.run_id,
        run_attempt: job.run_attempt,
        job_id: job.id,
        job: job.name,
        status: job.status,
        head_branch: branch,
        actor,
        event: meta?.event ?? null,
        runner_name: job.runner_name || null,
        runner_labels: job.labels ?? [],
        created_at: job.created_at,
        started_at: job.started_at,
        queued_seconds,
        running_seconds,
        current_step: step?.name ?? null,
        current_step_seconds: seconds(step?.started_at ?? null, observedAt),
      });
    }
  }

  for (const [dimension, m] of Object.entries(groups)) {
    for (const [key, counts] of m) {
      emit({
        event_type: 'group',
        observed_at,
        repo: opts.repo,
        dimension,
        key,
        queued: counts.queued,
        running: counts.running,
        pending: counts.pending,
        total: counts.queued + counts.running + counts.pending,
      });
    }
  }

  // A standalone total, so queue depth is one field rather than a count over
  // the per-job lines — the per-job series is subject to Loki's retention and
  // to sampling gaps, and depth should survive both.
  emit({
    event_type: 'snapshot',
    observed_at,
    repo: opts.repo,
    active_runs: runs.length,
    queued_jobs: queuedJobs,
    running_jobs: runningJobs,
    pending_jobs: pendingJobs,
    total_jobs: queuedJobs + runningJobs + pendingJobs,
    github_hosted_running_jobs: pool.running,
    github_hosted_queued_jobs: pool.queued,
    rate_limit_remaining: rateLimitRemaining,
  });
  return pool;
}

interface Spill {
  // Null in dry-run mode: the decision is logged and never written.
  variable: RepoVariable | null;
  thresholds: SpillThresholds;
  // In dry-run mode this is also the only record of the spill value. With a
  // variable, the variable is the record, read again on every sample, so a
  // restart or a change by hand cannot leave this process out of step.
  state: SpillState;
}

// Combines `repoPool` with the pool repositories' counts, decides, and writes
// the variable when the decision changes it. Any failure skips this sample's
// decision: a later sample decides again from a full count.
async function steerSpill(
  opts: Options,
  spill: Spill,
  repoPool: PoolSample,
  observedAt: number,
): Promise<void> {
  const observed_at = new Date(observedAt).toISOString();
  const pool = { ...repoPool };
  try {
    for (const repo of opts.poolRepos) {
      if (
        rateLimitRemaining !== null &&
        rateLimitRemaining < RATE_LIMIT_RESERVE
      ) {
        throw new Error(
          `rate limit remaining ${rateLimitRemaining} is below the reserve`,
        );
      }
      const other = await samplePool(repo, opts.token, observedAt);
      pool.running += other.running;
      pool.queued += other.queued;
      if (other.oldestQueuedSeconds !== null) {
        pool.oldestQueuedSeconds = Math.max(
          pool.oldestQueuedSeconds ?? 0,
          other.oldestQueuedSeconds,
        );
      }
    }
  } catch (e) {
    emit({
      event_type: 'collector-error',
      observed_at,
      repo: opts.repo,
      message: `spill decision skipped, pool count failed: ${e instanceof Error ? e.message : String(e)}`,
    });
    return;
  }

  let current = spill.state.spill;
  let exists = true;
  if (spill.variable) {
    try {
      const value = await spill.variable.read();
      exists = value !== null;
      current = value === 'true';
    } catch (e) {
      emit({
        event_type: 'collector-error',
        observed_at,
        repo: opts.repo,
        message: `spill decision skipped, reading ${spill.variable.name} failed: ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }
  }

  const decision = decideSpill(
    { spill: current, quietSamples: spill.state.quietSamples },
    pool,
    spill.thresholds,
  );

  let written = false;
  if (spill.variable && decision.spill !== current) {
    try {
      await spill.variable.write(String(decision.spill), exists);
      written = true;
    } catch (e) {
      emit({
        event_type: 'collector-error',
        observed_at,
        repo: opts.repo,
        message: `writing ${spill.variable.name}=${decision.spill} failed: ${e instanceof Error ? e.message : String(e)}`,
      });
      // The variable still holds `current`. Keep the quiet count, so the next
      // sample can retry the same decision.
      spill.state = { spill: current, quietSamples: decision.quietSamples };
      return;
    }
  }
  spill.state = { spill: decision.spill, quietSamples: decision.quietSamples };

  emit({
    event_type: 'spill',
    observed_at,
    repo: opts.repo,
    pool_repos: [opts.repo, ...opts.poolRepos],
    github_hosted_running_jobs: pool.running,
    github_hosted_queued_jobs: pool.queued,
    oldest_queued_seconds: pool.oldestQueuedSeconds,
    spill_before: current,
    spill: decision.spill,
    changed: decision.spill !== current,
    reason: decision.reason,
    quiet_samples: decision.quietSamples,
    mode: spill.variable ? 'active' : 'dry-run',
    written,
  });
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  // A misconfiguration here stops the collector at startup, where a failed
  // deploy shows it, rather than on every sample.
  const app = githubAppFromEnv(process.env);
  const spill: Spill = {
    variable:
      app && !opts.dryRun
        ? new RepoVariable(app, opts.repo, opts.spillVariable)
        : null,
    thresholds: thresholdsFromEnv(process.env),
    state: { spill: false, quietSamples: 0 },
  };
  let stopping = false;
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      stopping = true;
    });
  }

  for (;;) {
    const startedAt = Date.now();
    try {
      const pool = await sample(opts);
      if (pool) await steerSpill(opts, spill, pool, startedAt);
    } catch (e) {
      // One failed sample should not end a long-running collector; the next tick
      // re-reads the whole state anyway.
      emit({
        event_type: 'collector-error',
        observed_at: new Date().toISOString(),
        repo: opts.repo,
        message: e instanceof Error ? e.message : String(e),
      });
      if (opts.once) process.exitCode = 1;
    }
    if (opts.once || stopping) return;
    const elapsed = Date.now() - startedAt;
    await new Promise((r) =>
      setTimeout(r, Math.max(0, opts.intervalMs - elapsed)),
    );
    if (stopping) return;
  }
}

await main();
