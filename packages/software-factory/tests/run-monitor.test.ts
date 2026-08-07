import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

import { RunMonitor } from '../src/run-monitor.ts';
import type { RunLogWriter, RunLogEntryInput } from '../src/run-log.ts';

function makeRunLogStub(): {
  runLog: RunLogWriter;
  entries: RunLogEntryInput[];
} {
  let entries: RunLogEntryInput[] = [];
  let runLog = {
    append: async (batch: RunLogEntryInput[]) => {
      entries.push(...batch);
    },
  } as unknown as RunLogWriter;
  return { runLog, entries };
}

test('endTurn posts telemetry with budget, stats, and usage', async () => {
  let { runLog, entries } = makeRunLogStub();
  let monitor = new RunMonitor({ runLog, level: 'normal' });

  monitor.beginTurn({
    issueTitle: 'Garment card',
    turnType: 'build',
    iteration: 1,
    maxIterations: 8,
    model: 'claude-sonnet-5',
    effort: 'medium',
  });
  monitor.noteToolEvent({ tool: 'Write', args: { file_path: 'garment.gts' } });
  monitor.noteToolEvent({
    tool: 'mcp__factory__run_lint',
    args: { path: 'garment.gts' },
  });
  monitor.endTurn({
    status: 'done',
    durationMs: 272_000,
    usage: { inputTokens: 42_000, outputTokens: 9_100, costUsd: 1.23 },
  });
  // append is fire-and-forget inside the monitor; let it settle.
  await new Promise((r) => setImmediate(r));

  assert.equal(entries.length, 1);
  let entry = entries[0];
  assert.equal(entry.kind, 'telemetry');
  assert.equal(entry.who, 'orchestrator');
  assert.match(entry.headline, /finished in 4m 32s/);
  assert.match(entry.headline, /2 tool events/);
  assert.match(entry.body ?? '', /claude-sonnet-5 @ medium/);
  assert.match(entry.body ?? '', /1 file touched/);
  assert.match(entry.body ?? '', /42k in \/ 9k out/);
  assert.match(entry.body ?? '', /\$1\.23/);
});

test('quiet level suppresses telemetry and scheduler notes', async () => {
  let { runLog, entries } = makeRunLogStub();
  let monitor = new RunMonitor({ runLog, level: 'quiet' });

  monitor.beginTurn({ issueTitle: 'x', turnType: 'build' });
  monitor.endTurn({ status: 'done', durationMs: 1000 });
  monitor.noteScheduler('Queue: picked "x"');
  await new Promise((r) => setImmediate(r));

  assert.equal(entries.length, 0);
});

test('stall check posts after the silence threshold, then respects the repeat gap', async () => {
  let { runLog, entries } = makeRunLogStub();
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  try {
    let monitor = new RunMonitor({
      runLog,
      level: 'normal',
      stallAfterMs: 90_000,
      stallRepeatMs: 240_000,
      checkIntervalMs: 15_000,
    });
    monitor.start();
    monitor.beginTurn({ issueTitle: 'Garment card', turnType: 'build' });
    monitor.noteToolEvent({
      tool: 'Write',
      args: { file_path: 'garment.gts' },
    });

    // 60s of silence — under the threshold, nothing posts.
    mock.timers.tick(60_000);
    await new Promise((r) => setImmediate(r));
    assert.equal(entries.length, 0);

    // Cross 90s — one stall post.
    mock.timers.tick(45_000);
    await new Promise((r) => setImmediate(r));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].kind, 'monitor');
    assert.match(entries[0].headline, /Still working/);
    assert.match(entries[0].body ?? '', /Write garment\.gts/);

    // Another 60s of continued silence — inside the repeat gap, no new post.
    mock.timers.tick(60_000);
    await new Promise((r) => setImmediate(r));
    assert.equal(entries.length, 1);

    // Past the 4-minute repeat gap — a second stall post.
    mock.timers.tick(200_000);
    await new Promise((r) => setImmediate(r));
    assert.equal(entries.length, 2);

    // Activity resets the clock; no further posts inside the threshold.
    monitor.noteActivity('tool_use(Write)');
    mock.timers.tick(60_000);
    await new Promise((r) => setImmediate(r));
    assert.equal(entries.length, 2);

    monitor.stop();
  } finally {
    mock.timers.reset();
  }
});

test('watchdog failures post at normal level and rate-limit per class', async () => {
  let { runLog, entries } = makeRunLogStub();
  let monitor = new RunMonitor({ runLog, level: 'normal' });

  monitor.noteWatchdog('sync-failed', 'sync failed', { failure: true });
  monitor.noteWatchdog('sync-failed', 'sync failed again', { failure: true });
  // Non-failure watchdog events (heals) stay off the log at normal level.
  monitor.noteWatchdog('heal', 'healed run log');
  await new Promise((r) => setImmediate(r));

  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'blocked');
  assert.equal(entries[0].headline, 'sync failed');
});
