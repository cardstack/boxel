import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_THRESHOLDS,
  countJob,
  decideSpill,
  isGithubHosted,
  stateAfterFailedWrite,
  thresholdsFromEnv,
  type PoolSample,
  type SpillState,
} from './spill.ts';

const off: SpillState = { spill: false, quietSamples: 0 };
const on: SpillState = { spill: true, quietSamples: 0 };

function pool(
  running: number,
  queued = 0,
  oldestQueuedSeconds: number | null = null,
  extra: Partial<PoolSample> = {},
): PoolSample {
  return {
    running,
    queued,
    oldestQueuedSeconds,
    diverted: 0,
    partial: false,
    ...extra,
  };
}

test('stays off while the pool has room', () => {
  assert.deepEqual(decideSpill(off, pool(47, 3, 5)), {
    spill: false,
    quietSamples: 0,
    reason: 'idle',
  });
});

test('turns on at the running threshold', () => {
  assert.deepEqual(decideSpill(off, pool(48)), {
    spill: true,
    quietSamples: 0,
    reason: 'busy-running',
  });
});

test('turns on when a job has waited long enough, however few run', () => {
  assert.deepEqual(decideSpill(off, pool(10, 1, 60)), {
    spill: true,
    quietSamples: 0,
    reason: 'busy-queued',
  });
});

test('stays on between the off and on levels', () => {
  let state: SpillState = on;
  for (let i = 0; i < 10; i++) {
    const d = decideSpill(state, pool(40));
    assert.equal(d.spill, true);
    assert.equal(d.quietSamples, 0);
    state = d;
  }
});

test('turns off only after enough quiet samples in a row', () => {
  let state: SpillState = on;
  for (let i = 1; i < DEFAULT_THRESHOLDS.offQuietSamples; i++) {
    const d = decideSpill(state, pool(20, 2, 3));
    assert.deepEqual(d, { spill: true, quietSamples: i, reason: 'cooling' });
    state = d;
  }
  assert.deepEqual(decideSpill(state, pool(20, 2, 3)), {
    spill: false,
    quietSamples: 0,
    reason: 'drained',
  });
});

test('a busy sample restarts the quiet count', () => {
  let state: SpillState = { spill: true, quietSamples: 4 };
  state = decideSpill(state, pool(40));
  assert.deepEqual(state, { spill: true, quietSamples: 0, reason: 'cooling' });
});

test('a job waiting past the off level is not quiet', () => {
  const d = decideSpill({ spill: true, quietSamples: 3 }, pool(10, 1, 15));
  assert.deepEqual(d, { spill: true, quietSamples: 0, reason: 'cooling' });
});

test('jobs moved to RunsOn still count as demand, so the spill does not oscillate', () => {
  // 20 jobs left on GitHub's pool would be quiet alone, but 30 more wait to
  // come back when the spill turns off.
  const d = decideSpill(on, pool(20, 0, null, { diverted: 30 }));
  assert.deepEqual(d, { spill: true, quietSamples: 0, reason: 'busy-running' });
  assert.deepEqual(
    decideSpill(
      { spill: true, quietSamples: 2 },
      pool(20, 0, null, { diverted: 20 }),
    ),
    { spill: true, quietSamples: 0, reason: 'cooling' },
  );
});

test('a partial count can turn the spill on but never off', () => {
  assert.equal(
    decideSpill(off, pool(48, 0, null, { partial: true })).spill,
    true,
  );
  const d = decideSpill(
    { spill: true, quietSamples: 4 },
    pool(0, 0, null, { partial: true }),
  );
  assert.deepEqual(d, { spill: true, quietSamples: 0, reason: 'cooling' });
});

test('a failed turn-off write is retried on the next quiet sample', () => {
  const held = stateAfterFailedWrite(true);
  assert.deepEqual(decideSpill(held, pool(10)), {
    spill: false,
    quietSamples: 0,
    reason: 'drained',
  });
  assert.deepEqual(stateAfterFailedWrite(false), {
    spill: false,
    quietSamples: 0,
  });
});

test('jobs are counted by where they run', () => {
  const p = pool(0);
  const job = (
    status: string,
    labels: string[],
    waitedSeconds: number | null = 0,
    divertible = true,
  ) => countJob(p, { status, labels, waitedSeconds, divertible });
  const runsOn = ['runs-on=1-host-test-1/cpu=4'];

  job('in_progress', ['ubuntu-latest']);
  job('queued', ['ubuntu-24.04'], 40);
  job('pending', ['ubuntu-latest']);
  job('completed', ['ubuntu-latest']);
  // Stuck behind a label no runner serves.
  job('queued', ['ubuntu-20.04'], DEFAULT_THRESHOLDS.staleQueuedSeconds + 1);
  job('in_progress', runsOn);
  job('queued', runsOn);
  // A push to main uses RunsOn whatever the spill says.
  job('in_progress', runsOn, 0, false);

  assert.deepEqual(p, {
    running: 1,
    queued: 1,
    oldestQueuedSeconds: 40,
    diverted: 2,
    partial: false,
  });
});

test('GitHub-hosted labels are told apart from RunsOn ones', () => {
  assert.equal(isGithubHosted(['ubuntu-latest']), true);
  assert.equal(isGithubHosted(['ubuntu-24.04']), true);
  assert.equal(isGithubHosted(['macos-15']), true);
  assert.equal(
    isGithubHosted([
      'runs-on=123-host-test-1/cpu=4/ram=16/image=ubuntu24-full-x64',
    ]),
    false,
  );
  assert.equal(isGithubHosted(['ubuntu-24.04-arm']), true);
  assert.equal(isGithubHosted(['windows-11-arm']), true);
  assert.equal(isGithubHosted(['ubuntu-slim']), true);
  assert.equal(isGithubHosted(['self-hosted', 'linux']), false);
  assert.equal(isGithubHosted([]), false);
  // Paid larger runners run in a separate pool.
  assert.equal(isGithubHosted(['macos-15-xlarge']), false);
  assert.equal(isGithubHosted(['ubuntu-latest-8-cores']), false);
  // A typo matches no runner.
  assert.equal(isGithubHosted(['ubuntu-lates']), false);
});

test('thresholds come from the environment, with defaults', () => {
  assert.deepEqual(thresholdsFromEnv({}), DEFAULT_THRESHOLDS);
  assert.deepEqual(
    thresholdsFromEnv({ SPILL_ON_RUNNING: '60', SPILL_OFF_RUNNING: '40' }),
    { ...DEFAULT_THRESHOLDS, onRunning: 60, offRunning: 40 },
  );
});

test('thresholds that would flip on every sample are refused', () => {
  assert.throws(
    () => thresholdsFromEnv({ SPILL_OFF_RUNNING: '50' }),
    /SPILL_OFF_RUNNING/,
  );
  assert.throws(
    () => thresholdsFromEnv({ SPILL_OFF_QUEUED_SECONDS: '90' }),
    /SPILL_OFF_QUEUED_SECONDS/,
  );
  assert.throws(
    () => thresholdsFromEnv({ SPILL_ON_RUNNING: 'lots' }),
    /SPILL_ON_RUNNING/,
  );
  assert.throws(
    () => thresholdsFromEnv({ SPILL_OFF_QUIET_SAMPLES: '0' }),
    /SPILL_OFF_QUIET_SAMPLES/,
  );
  assert.throws(
    () => thresholdsFromEnv({ SPILL_OFF_QUIET_SAMPLES: '2.5' }),
    /SPILL_OFF_QUIET_SAMPLES/,
  );
  assert.throws(
    () => thresholdsFromEnv({ SPILL_STALE_QUEUED_SECONDS: '60' }),
    /SPILL_STALE_QUEUED_SECONDS/,
  );
});
