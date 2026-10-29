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
  countJob,
  decideSpill,
  stateAfterFailedWrite,
  thresholdsFromEnv,
  type PoolJob,
  type PoolSample,
  type SpillState,
  type SpillThresholds,
} from './spill.ts';
import { RepoVariable, githubAppFromEnv } from './github-app.ts';
import { API, githubError, githubRequest } from './github-api.ts';

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
  const res = await githubRequest('GET', url, token);
  const remaining = res.headers.get('x-ratelimit-remaining');
  if (remaining !== null) {
    rateLimitRemaining = Number(remaining);
  }
  if (!res.ok) throw await githubError('GET', url, res);
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
  return {
    running: 0,
    queued: 0,
    oldestQueuedSeconds: null,
    diverted: 0,
    partial: false,
  };
}

// Only queued, pending and in_progress runs can hold or want a runner, so
// completed history is deliberately not fetched — it would dominate the
// request budget without informing the queue. A run that changes status
// between two of these listings is returned by both, so the runs are keyed by
// id, or its jobs would be counted twice.
async function activeRuns(repo: string, token: string): Promise<Run[]> {
  const runs = new Map<number, Run>();
  for (const status of ['queued', 'in_progress', 'pending']) {
    const page = await paginate<Run>(
      `${API}/repos/${repo}/actions/runs?status=${status}`,
      token,
      (b) => b.workflow_runs ?? [],
    );
    for (const run of page) runs.set(run.id, run);
  }
  return [...runs.values()];
}

// Fetching one job list per run is the expensive half of a sample, so it
// starts only if the budget still holds the reserve after those requests.
function withinBudget(requests: number): boolean {
  return (
    rateLimitRemaining === null ||
    rateLimitRemaining - requests >= RATE_LIMIT_RESERVE
  );
}

function runJobs(repo: string, runId: number, token: string): Promise<Job[]> {
  return paginate<Job>(
    `${API}/repos/${repo}/actions/runs/${runId}/jobs`,
    token,
    (b) => b.jobs ?? [],
  );
}

// A run that completed and was reaped between the listing and the job fetch
// answers 404, and has no jobs left to count.
function isReaped(e: unknown): boolean {
  return (e as { status?: number }).status === 404;
}

function poolJob(job: Job, run: Run | undefined, observedAt: number): PoolJob {
  return {
    status: job.status,
    labels: job.labels ?? [],
    waitedSeconds: seconds(job.created_at, observedAt),
    // ci-host.yaml sends the jobs of a push to `main` to RunsOn whatever the
    // spill says, so the spill did not move them.
    divertible: !(
      run?.event === 'push' && (job.head_branch ?? run?.head_branch) === 'main'
    ),
  };
}

// The pool count for a repository that is not sampled for the dashboard. Any
// failure other than a reaped run throws, because a count with a repository's
// jobs missing would understate the pool.
async function samplePool(
  repo: string,
  token: string,
  observedAt: number,
  thresholds: SpillThresholds,
): Promise<PoolSample> {
  const pool = emptyPool();
  const runs = await activeRuns(repo, token);
  if (!withinBudget(runs.length)) {
    throw new Error(
      `${runs.length} job listings would take the rate limit (${rateLimitRemaining} remaining) below the reserve`,
    );
  }
  for (const run of runs) {
    let jobs: Job[];
    try {
      jobs = await runJobs(repo, run.id, token);
    } catch (e) {
      if (isReaped(e)) continue;
      throw e;
    }
    for (const job of jobs) {
      countJob(pool, poolJob(job, run, observedAt), thresholds);
    }
  }
  return pool;
}

// Returns the GitHub-hosted pool count for `opts.repo`, or null when the
// sample was abandoned and the count is unknown.
async function sample(
  opts: Options,
  thresholds: SpillThresholds,
  observedAt: number,
): Promise<PoolSample | null> {
  const observed_at = new Date(observedAt).toISOString();

  const runs = await activeRuns(opts.repo, opts.token);
  const runById = new Map<number, Run>(runs.map((r) => [r.id, r]));

  // Skipping the whole sample keeps the series honest: a partial sample would
  // understate queue depth, which is worse than a visible gap.
  if (!withinBudget(runs.length)) {
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
      jobs = await runJobs(opts.repo, run.id, opts.token);
    } catch (e) {
      const status = (e as { status?: number }).status;
      emit({
        event_type: 'collector-error',
        observed_at,
        repo: opts.repo,
        run_id: run.id,
        message: e instanceof Error ? e.message : String(e),
      });
      // Omitting a reaped run understates nothing, so the sample continues.
      if (isReaped(e)) continue;
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
      countJob(pool, poolJob(job, meta, observedAt), thresholds);

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
// the variable when the decision changes it. Returns false when any part
// failed, after emitting a collector-error line for it.
async function steerSpill(
  opts: Options,
  spill: Spill,
  repoPool: PoolSample,
  observedAt: number,
): Promise<boolean> {
  const observed_at = new Date(observedAt).toISOString();
  const pool = { ...repoPool };
  let ok = true;
  const fail = (message: string) => {
    ok = false;
    emit({
      event_type: 'collector-error',
      observed_at,
      repo: opts.repo,
      message,
    });
  };

  // A repository that cannot be counted does not stop the decision: the
  // partial count can still turn the spill on, but not off. Thus a repository
  // that fails on every sample cannot leave the pool queueing with the spill
  // off.
  for (const repo of opts.poolRepos) {
    try {
      const other = await samplePool(
        repo,
        opts.token,
        observedAt,
        spill.thresholds,
      );
      pool.running += other.running;
      pool.queued += other.queued;
      pool.diverted += other.diverted;
      if (other.oldestQueuedSeconds !== null) {
        pool.oldestQueuedSeconds = Math.max(
          pool.oldestQueuedSeconds ?? 0,
          other.oldestQueuedSeconds,
        );
      }
    } catch (e) {
      pool.partial = true;
      fail(
        `pool count for ${repo} failed, so the spill cannot turn off: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  let current = spill.state.spill;
  let exists = true;
  if (spill.variable) {
    try {
      const value = await spill.variable.read();
      exists = value !== null;
      // The workflow's `==` ignores case, so this must too.
      current = value?.toLowerCase() === 'true';
    } catch (e) {
      fail(
        `spill decision skipped, reading ${spill.variable.name} failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return false;
    }
  }

  const decision = decideSpill(
    { spill: current, quietSamples: spill.state.quietSamples },
    pool,
    spill.thresholds,
  );
  spill.state = { spill: decision.spill, quietSamples: decision.quietSamples };

  let written = false;
  if (spill.variable && decision.spill !== current) {
    try {
      await spill.variable.write(String(decision.spill), exists);
      written = true;
    } catch (e) {
      fail(
        `writing ${spill.variable.name}=${decision.spill} failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      spill.state = stateAfterFailedWrite(current, spill.thresholds);
    }
  }

  emit({
    event_type: 'spill',
    observed_at,
    repo: opts.repo,
    pool_repos: [opts.repo, ...opts.poolRepos],
    pool_complete: !pool.partial,
    github_hosted_running_jobs: pool.running,
    github_hosted_queued_jobs: pool.queued,
    oldest_queued_seconds: pool.oldestQueuedSeconds,
    diverted_jobs: pool.diverted,
    spill_before: current,
    spill: decision.spill,
    changed: decision.spill !== current,
    reason: decision.reason,
    quiet_samples: spill.state.quietSamples,
    mode: spill.variable ? 'active' : 'dry-run',
    written,
  });
  return ok;
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
      const pool = await sample(opts, spill.thresholds, startedAt);
      if (pool && !(await steerSpill(opts, spill, pool, startedAt))) {
        if (opts.once) process.exitCode = 1;
      }
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
