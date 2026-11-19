import { isRunAffinityKey } from './affinity.ts';
import type { PagePool } from './page-pool.ts';

export interface RunCapacity {
  runTabs: number;
  runningRuns: number;
  queuedRuns: number;
}

// The automation runs in a pool snapshot. A run holds one tab of its run
// affinity for its whole script, so the run affinities' tabs serving a
// command are the runs running at once, and the waiters queued on those tabs
// are the runs waiting behind them. A tab's lease holder is never counted as
// a waiter, so a tab being closed counts as neither.
export function runCapacityOf(
  snapshot: Pick<ReturnType<PagePool['getQueueDepthSnapshot']>, 'affinities'>,
): RunCapacity {
  let capacity: RunCapacity = { runTabs: 0, runningRuns: 0, queuedRuns: 0 };
  for (let affinity of snapshot.affinities) {
    if (!isRunAffinityKey(affinity.affinityKey)) {
      continue;
    }
    capacity.runTabs += affinity.tabCount;
    capacity.runningRuns += affinity.byQueue.command;
    for (let waiters of Object.values(affinity.tabQueuedByPriority)) {
      capacity.queuedRuns += waiters;
    }
  }
  return capacity;
}
