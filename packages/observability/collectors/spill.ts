// Decides when host CI spills from GitHub's runners onto RunsOn.
//
// GitHub's hosted runners cost nothing for a public repository, and RunsOn's
// instances in our AWS account do not. So pull request host jobs use GitHub's
// runners, and take RunsOn only while a repo variable (HOST_TEST_SPILL) is
// `true`; see the `host-test` job in .github/workflows/ci-host.yaml. This
// module turns one sample of the GitHub-hosted pool into the value that
// variable should hold.
//
// The decision is a pure function of the previous state and the sample, so
// that it can be tested without the API.

export interface SpillThresholds {
  // Spill when the demand on GitHub's pool reaches this many jobs: the jobs
  // running there, plus the jobs the spill has moved to RunsOn. Queue wait
  // rises at about 50 running jobs: below that, the median wait is 2 s.
  onRunning: number;
  // Or when a GitHub-hosted job has waited this long for a runner.
  onQueuedSeconds: number;
  // Stop spilling only when the demand is below this...
  offRunning: number;
  // ...no job has waited longer than this...
  offQueuedSeconds: number;
  // ...for this many samples in a row. GitHub reads the variable when each job
  // is queued, so a flip reaches only jobs queued after it. A quiet period
  // keeps the variable from flipping on every sample at the edge.
  offQuietSamples: number;
  // A job queued longer than this is taken to be stuck, not waiting: a label
  // that no runner serves, such as a retired image. It is left out of the
  // count, so that it cannot hold the spill on.
  staleQueuedSeconds: number;
}

export const DEFAULT_THRESHOLDS: SpillThresholds = {
  onRunning: 48,
  onQueuedSeconds: 60,
  offRunning: 35,
  offQueuedSeconds: 15,
  offQuietSamples: 5,
  staleQueuedSeconds: 1800,
};

export interface PoolSample {
  // GitHub-hosted jobs that have a runner.
  running: number;
  // GitHub-hosted jobs that wait for a runner. A job that a concurrency group
  // holds is `pending`, not `queued`, and is not counted.
  queued: number;
  // How long the oldest queued GitHub-hosted job has waited, or null if none
  // waits.
  oldestQueuedSeconds: number | null;
  // RunsOn jobs, running or queued, that use GitHub's pool when the spill is
  // off. While the spill is on, this is the load it took off the pool. Without
  // it the off condition would measure only what is left, turn the spill off,
  // and bring the same load back.
  diverted: number;
  // True when a repository's jobs could not be counted. A partial count can
  // still show a busy pool, but it cannot show a quiet one.
  partial: boolean;
}

export interface SpillState {
  spill: boolean;
  // Consecutive quiet samples since the pool last looked busy.
  quietSamples: number;
}

export type SpillReason =
  | 'busy-running'
  | 'busy-queued'
  | 'cooling'
  | 'drained'
  | 'idle';

export interface SpillDecision extends SpillState {
  reason: SpillReason;
}

export function decideSpill(
  previous: SpillState,
  sample: PoolSample,
  thresholds: SpillThresholds = DEFAULT_THRESHOLDS,
): SpillDecision {
  const waited = sample.oldestQueuedSeconds ?? 0;
  const demand = sample.running + sample.diverted;

  if (demand >= thresholds.onRunning) {
    return { spill: true, quietSamples: 0, reason: 'busy-running' };
  }
  if (waited >= thresholds.onQueuedSeconds) {
    return { spill: true, quietSamples: 0, reason: 'busy-queued' };
  }
  if (!previous.spill) {
    return { spill: false, quietSamples: 0, reason: 'idle' };
  }

  const quiet =
    !sample.partial &&
    demand < thresholds.offRunning &&
    waited < thresholds.offQueuedSeconds;
  const quietSamples = quiet ? previous.quietSamples + 1 : 0;
  if (quietSamples >= thresholds.offQuietSamples) {
    return { spill: false, quietSamples: 0, reason: 'drained' };
  }
  return { spill: true, quietSamples, reason: 'cooling' };
}

// The state to keep when writing `decision` failed and the variable still
// holds `current`. A failed turn-off keeps the quiet count one short of the
// limit, so that the next quiet sample tries the write again. A failed turn-on
// needs nothing kept: the next busy sample decides the same.
export function stateAfterFailedWrite(
  current: boolean,
  thresholds: SpillThresholds = DEFAULT_THRESHOLDS,
): SpillState {
  return {
    spill: current,
    quietSamples: current ? Math.max(0, thresholds.offQuietSamples - 1) : 0,
  };
}

// A job runs on GitHub's free pool when one of its labels names a standard
// hosted image, such as `ubuntu-latest`, `ubuntu-24.04-arm` or `macos-15`. A
// RunsOn job carries a single `runs-on=…` label instead. The pattern leaves
// out labels that no runner serves, such as a typo, and GitHub's paid larger
// runners, such as `macos-15-xlarge` or an org's `ubuntu-latest-8-cores`,
// which run in a separate pool.
const GITHUB_HOSTED_LABEL =
  /^(ubuntu|windows|macos)-(latest|slim|\d+(\.\d+)?)(-arm|-intel)?$/;

export function isGithubHosted(labels: readonly string[]): boolean {
  return labels.some((label) => GITHUB_HOSTED_LABEL.test(label));
}

function isRunsOn(labels: readonly string[]): boolean {
  return labels.some((label) => label.startsWith('runs-on='));
}

export interface PoolJob {
  status: string;
  labels: readonly string[];
  // How long a queued job has waited, or null if unknown.
  waitedSeconds: number | null;
  // False for a job that uses RunsOn whatever the spill says: in
  // ci-host.yaml, a job of a push to `main`.
  divertible: boolean;
}

// Adds one job to the pool count. Only `queued` jobs wait for a runner: a
// `pending` job is held by a concurrency group, which says nothing about the
// pool.
export function countJob(
  pool: PoolSample,
  job: PoolJob,
  thresholds: SpillThresholds = DEFAULT_THRESHOLDS,
): void {
  if (job.status !== 'in_progress' && job.status !== 'queued') return;
  if (isGithubHosted(job.labels)) {
    if (job.status === 'in_progress') {
      pool.running++;
      return;
    }
    const waited = job.waitedSeconds ?? 0;
    if (waited > thresholds.staleQueuedSeconds) return;
    pool.queued++;
    pool.oldestQueuedSeconds = Math.max(pool.oldestQueuedSeconds ?? 0, waited);
  } else if (job.divertible && isRunsOn(job.labels)) {
    pool.diverted++;
  }
}

export function thresholdsFromEnv(
  env: Record<string, string | undefined>,
): SpillThresholds {
  const read = (name: string, fallback: number, min = 0): number => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min) {
      throw new Error(
        `${name} must be a number of at least ${min}, got "${raw}"`,
      );
    }
    return value;
  };
  // Job counts and sample counts are whole numbers. A quiet count of 0 would
  // turn the spill off on the first sample that is not busy.
  const readCount = (name: string, fallback: number, min = 0): number => {
    const value = read(name, fallback, min);
    if (!Number.isInteger(value)) {
      throw new Error(`${name} must be a whole number, got "${env[name]}"`);
    }
    return value;
  };
  const t = {
    onRunning: readCount('SPILL_ON_RUNNING', DEFAULT_THRESHOLDS.onRunning),
    onQueuedSeconds: read(
      'SPILL_ON_QUEUED_SECONDS',
      DEFAULT_THRESHOLDS.onQueuedSeconds,
    ),
    offRunning: readCount('SPILL_OFF_RUNNING', DEFAULT_THRESHOLDS.offRunning),
    offQueuedSeconds: read(
      'SPILL_OFF_QUEUED_SECONDS',
      DEFAULT_THRESHOLDS.offQueuedSeconds,
    ),
    offQuietSamples: readCount(
      'SPILL_OFF_QUIET_SAMPLES',
      DEFAULT_THRESHOLDS.offQuietSamples,
      1,
    ),
    staleQueuedSeconds: read(
      'SPILL_STALE_QUEUED_SECONDS',
      DEFAULT_THRESHOLDS.staleQueuedSeconds,
    ),
  };
  // With the off level at or above the on level, a sample could be busy and
  // quiet at once, and the variable would flip on every sample.
  if (t.offRunning > t.onRunning) {
    throw new Error(
      `SPILL_OFF_RUNNING (${t.offRunning}) must not exceed SPILL_ON_RUNNING (${t.onRunning})`,
    );
  }
  if (t.offQueuedSeconds > t.onQueuedSeconds) {
    throw new Error(
      `SPILL_OFF_QUEUED_SECONDS (${t.offQueuedSeconds}) must not exceed SPILL_ON_QUEUED_SECONDS (${t.onQueuedSeconds})`,
    );
  }
  // A stale limit at or below the on level would drop every job that waited
  // long enough to turn the spill on.
  if (t.staleQueuedSeconds <= t.onQueuedSeconds) {
    throw new Error(
      `SPILL_STALE_QUEUED_SECONDS (${t.staleQueuedSeconds}) must exceed SPILL_ON_QUEUED_SECONDS (${t.onQueuedSeconds})`,
    );
  }
  return t;
}
