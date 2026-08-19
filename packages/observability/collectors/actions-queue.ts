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

const CHANNEL = 'boxel:actions-queue';

// One sample costs two run-list requests plus one per active run. A busy hour
// on this repository has ~60 runs in flight, so a 60-second interval would spend
// ~3,800 of the 5,000 hourly REST requests a token is allowed — enough to
// starve anything else using the same token. Two minutes halves that, and the
// reserve below stops a spike from consuming the rest.
const DEFAULT_INTERVAL_SECONDS = 120;

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
}

function usage(): never {
  console.error(
    `usage: node actions-queue.ts [--repo owner/name] [--interval seconds] [--once]

  --repo      Repository to sample. Default $GITHUB_REPOSITORY, else cardstack/boxel.
  --interval  Seconds between samples. Default ${DEFAULT_INTERVAL_SECONDS}.
  --once      Take a single sample and exit, rather than looping.

  Requires a token only to raise the API rate limit from 60 to 5,000 requests
  an hour. Against a public repository it needs no permissions at all; against
  a private one it needs Actions: Read-only.`,
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  let repo = process.env.GITHUB_REPOSITORY || 'cardstack/boxel';
  let intervalSeconds = Number(
    process.env.ACTIONS_QUEUE_INTERVAL || DEFAULT_INTERVAL_SECONDS,
  );
  let once = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--once') {
      once = true;
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
  return { repo, token, intervalMs: intervalSeconds * 1000, once };
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
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
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

async function sample(opts: Options): Promise<void> {
  const base = `https://api.github.com/repos/${opts.repo}/actions`;
  const observedAt = Date.now();
  const observed_at = new Date(observedAt).toISOString();

  // Only queued and in_progress runs can hold or want a runner, so completed
  // history is deliberately not fetched — it would dominate the request budget
  // without informing the queue.
  const runs: Run[] = [];
  for (const status of ['queued', 'in_progress']) {
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
    return;
  }

  let queuedJobs = 0;
  let runningJobs = 0;
  // Grouped depth is emitted as its own lines rather than as nested objects on
  // the snapshot, because LogQL flattens nested JSON into one label per key —
  // which for dynamic keys like branch names yields an unqueryable label per
  // branch instead of a series grouped by branch.
  const groups: Record<
    string,
    Map<string, { queued: number; running: number }>
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
      // A run can complete and be reaped between listing and this fetch. That is
      // ordinary, so it must not abort the whole sample.
      emit({
        event_type: 'collector-error',
        observed_at,
        repo: opts.repo,
        run_id: run.id,
        message: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    for (const job of jobs) {
      if (job.status !== 'queued' && job.status !== 'in_progress') continue;

      const meta = runById.get(job.run_id);
      const actor = meta?.triggering_actor?.login ?? meta?.actor?.login ?? null;
      const branch = job.head_branch ?? meta?.head_branch ?? null;
      const workflow = job.workflow_name ?? meta?.name ?? null;

      // While a job is queued GitHub reports started_at equal to created_at, so
      // it cannot be used to tell waiting from running. Queue wait is therefore
      // measured from created_at, and only a job that has actually left the
      // queue reports a running duration.
      const queued_seconds =
        job.status === 'queued'
          ? seconds(job.created_at, observedAt)
          : seconds(
              job.created_at,
              Date.parse(job.started_at ?? job.created_at),
            );
      const running_seconds =
        job.status === 'in_progress'
          ? seconds(job.started_at, observedAt)
          : null;

      const step = job.steps?.find((s) => s.status === 'in_progress');

      if (job.status === 'queued') queuedJobs++;
      else runningJobs++;

      const bump = (dimension: string, key: string | null) => {
        if (!key) return;
        const m = groups[dimension];
        const entry = m.get(key) ?? { queued: 0, running: 0 };
        if (job.status === 'queued') entry.queued++;
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
        total: counts.queued + counts.running,
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
    total_jobs: queuedJobs + runningJobs,
    rate_limit_remaining: rateLimitRemaining,
  });
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  let stopping = false;
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      stopping = true;
    });
  }

  for (;;) {
    const startedAt = Date.now();
    try {
      await sample(opts);
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
