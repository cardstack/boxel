import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_THRESHOLDS,
  decideSpill,
  isGithubHosted,
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
): PoolSample {
  return { running, queued, oldestQueuedSeconds };
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
  assert.equal(isGithubHosted(['self-hosted', 'linux']), false);
  assert.equal(isGithubHosted([]), false);
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
});
