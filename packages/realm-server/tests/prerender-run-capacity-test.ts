import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runCapacityOf } from '../prerender/run-capacity.ts';

// A prerender server's automation run capacity, read from its pool snapshot:
// the run affinities' tabs, the runs holding them, and the runs queued behind
// them. Other affinities and a tab's lease holder never count as runs.
module(basename(import.meta.filename), function () {
  const RUN = 'realm:https://realms.example/team/a/#run:@payer:example';
  const OTHER_RUN = 'realm:https://realms.example/team/b/#run:@other:example';
  const INDEX = 'realm:https://realms.example/team/a/#@payer:example';

  function affinity(
    affinityKey: string,
    {
      tabCount = 1,
      command = 0,
      file = 0,
      queued = {},
      pendingTotal = 0,
    }: {
      tabCount?: number;
      command?: number;
      file?: number;
      queued?: Record<number, number>;
      pendingTotal?: number;
    } = {},
  ) {
    return {
      affinityKey,
      tabCount,
      pendingTotal,
      maxPending: pendingTotal,
      idle: command + file === 0,
      byQueue: { file, module: 0, command },
      admission: { pending: 0, cap: 0 },
      tabQueuedByPriority: queued,
      admissionQueuedByPriority: {},
    };
  }

  test('counts the runs running on run tabs and the runs queued behind them', function (assert) {
    assert.deepEqual(
      runCapacityOf({
        affinities: [
          affinity(RUN, { command: 1, queued: { 5: 2 }, pendingTotal: 3 }),
          affinity(OTHER_RUN, { command: 1, pendingTotal: 1 }),
          affinity(INDEX, { tabCount: 3, file: 3, queued: { 1: 7 } }),
        ],
      }),
      { runTabs: 2, runningRuns: 2, queuedRuns: 2 },
      "an index render's tabs and waiters aren't runs",
    );
  });

  test("a run tab being closed isn't a queued run", function (assert) {
    // Closing an idle tab holds its lease without serving a command, so the
    // tab's pending count includes it and its waiters don't.
    assert.deepEqual(
      runCapacityOf({
        affinities: [affinity(RUN, { command: 0, pendingTotal: 1 })],
      }),
      { runTabs: 1, runningRuns: 0, queuedRuns: 0 },
    );
  });

  test('a pool with no run tabs has no run capacity in use', function (assert) {
    assert.deepEqual(
      runCapacityOf({ affinities: [affinity(INDEX, { file: 1 })] }),
      { runTabs: 0, runningRuns: 0, queuedRuns: 0 },
    );
  });
});
