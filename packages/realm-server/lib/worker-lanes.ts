import {
  automationInitiatedPriority,
  systemInitiatedPrerenderHtmlPriority,
  userInitiatedPrerenderHtmlPriority,
  userInitiatedPriority,
} from '@cardstack/runtime-common';

// How many workers the worker manager starts in each lane.
export interface WorkerLaneCounts {
  userIndexCount: number;
  highPriorityCount: number;
  automationCount: number;
  allPriorityCount: number;
}

export type WorkerLaneName =
  | 'user-index'
  | 'high-priority'
  | 'automation'
  | 'all-priority';

// One worker to start: the lane it belongs to, the priority floor it claims
// jobs at, and whether it registers only the indexing job types.
export interface WorkerSpec {
  lane: WorkerLaneName;
  priority: number;
  indexJobsOnly: boolean;
}

// The lanes, highest floor first. Each lane's floor is a dequeue floor: its
// workers claim only jobs at or above it, oldest-first among those (see the
// tier table in runtime-common's queue.ts).
//
// - user-index floors at the user-initiated indexing tier and registers only
//   the indexing job types, giving index jobs a lane no prerender-html sweep
//   can hold. Both guards carry weight: the floor keeps out ordinary user
//   prerender-html (one tier below), and the job-type filter keeps out a
//   publish-awaited render (co-equal at the indexing tier).
// - high-priority floors at the user-initiated prerender-html tier, so it
//   serves all user-initiated work and nothing below it.
// - automation floors at the automation tier, so it serves automation runs
//   and all user-initiated work, and never system-tier jobs.
// - all-priority floors at the lowest tier and serves everything.
const LANES: {
  lane: WorkerLaneName;
  count: keyof WorkerLaneCounts;
  priority: number;
  indexJobsOnly: boolean;
}[] = [
  {
    lane: 'user-index',
    count: 'userIndexCount',
    priority: userInitiatedPriority,
    indexJobsOnly: true,
  },
  {
    lane: 'high-priority',
    count: 'highPriorityCount',
    priority: userInitiatedPrerenderHtmlPriority,
    indexJobsOnly: false,
  },
  {
    lane: 'automation',
    count: 'automationCount',
    priority: automationInitiatedPriority,
    indexJobsOnly: false,
  },
  {
    lane: 'all-priority',
    count: 'allPriorityCount',
    priority: systemInitiatedPrerenderHtmlPriority,
    indexJobsOnly: false,
  },
];

// Every worker the manager starts, in start order. A lane whose count is 0
// (or not a positive whole number) contributes none.
export function workerSpecs(counts: WorkerLaneCounts): WorkerSpec[] {
  let specs: WorkerSpec[] = [];
  for (let { lane, count, priority, indexJobsOnly } of LANES) {
    let n = Math.max(0, Math.floor(counts[count] || 0));
    for (let i = 0; i < n; i++) {
      specs.push({ lane, priority, indexJobsOnly });
    }
  }
  return specs;
}
