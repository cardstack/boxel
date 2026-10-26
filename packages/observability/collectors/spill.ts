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
  // Spill when this many GitHub-hosted jobs are running. Queue wait rises at
  // about 50 running jobs: below that, the median wait is 2 s.
  onRunning: number;
  // Or when a GitHub-hosted job has waited this long for a runner.
  onQueuedSeconds: number;
  // Stop spilling only when fewer than this many are running...
  offRunning: number;
  // ...no job has waited longer than this...
  offQueuedSeconds: number;
  // ...for this many samples in a row. GitHub reads the variable when each job
  // is queued, so a flip reaches only jobs queued after it. A quiet period
  // keeps the variable from flipping on every sample at the edge.
  offQuietSamples: number;
}

export const DEFAULT_THRESHOLDS: SpillThresholds = {
  onRunning: 48,
  onQueuedSeconds: 60,
  offRunning: 35,
  offQueuedSeconds: 15,
  offQuietSamples: 5,
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

  if (sample.running >= thresholds.onRunning) {
    return { spill: true, quietSamples: 0, reason: 'busy-running' };
  }
  if (waited >= thresholds.onQueuedSeconds) {
    return { spill: true, quietSamples: 0, reason: 'busy-queued' };
  }
  if (!previous.spill) {
    return { spill: false, quietSamples: 0, reason: 'idle' };
  }

  const quiet =
    sample.running < thresholds.offRunning &&
    waited < thresholds.offQueuedSeconds;
  const quietSamples = quiet ? previous.quietSamples + 1 : 0;
  if (quietSamples >= thresholds.offQuietSamples) {
    return { spill: false, quietSamples: 0, reason: 'drained' };
  }
  return { spill: true, quietSamples, reason: 'cooling' };
}

// A job runs on GitHub's pool when one of its labels names a GitHub-hosted
// image. A RunsOn job carries a single `runs-on=…` label instead. Matching the
// hosted images, rather than "anything that isn't RunsOn", keeps a job whose
// label no runner serves from holding the spill on forever.
const GITHUB_HOSTED_LABEL = /^(ubuntu|windows|macos)-/;

export function isGithubHosted(labels: readonly string[]): boolean {
  return labels.some((label) => GITHUB_HOSTED_LABEL.test(label));
}

export function thresholdsFromEnv(
  env: Record<string, string | undefined>,
): SpillThresholds {
  const read = (name: string, fallback: number): number => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${name} must be a non-negative number, got "${raw}"`);
    }
    return value;
  };
  const t = {
    onRunning: read('SPILL_ON_RUNNING', DEFAULT_THRESHOLDS.onRunning),
    onQueuedSeconds: read(
      'SPILL_ON_QUEUED_SECONDS',
      DEFAULT_THRESHOLDS.onQueuedSeconds,
    ),
    offRunning: read('SPILL_OFF_RUNNING', DEFAULT_THRESHOLDS.offRunning),
    offQueuedSeconds: read(
      'SPILL_OFF_QUEUED_SECONDS',
      DEFAULT_THRESHOLDS.offQueuedSeconds,
    ),
    offQuietSamples: read(
      'SPILL_OFF_QUIET_SAMPLES',
      DEFAULT_THRESHOLDS.offQuietSamples,
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
  return t;
}
