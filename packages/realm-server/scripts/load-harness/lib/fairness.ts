// Does a write wait on somebody else's indexing?
//
// Indexing runs one lane per realm: `indexingConcurrencyGroup(realmURL)`
// returns a group keyed on the realm alone, and the queue will not claim a job
// whose group already holds a live reservation. So two people editing
// unrelated cards in one realm serialize, and the second one's write pays the
// first one's fan-out. Whether that is worth splitting per writer turns on one
// number: of the index passes that waited, how many waited behind a *different*
// person's pass rather than their own.
//
// WHERE THIS READING COMES FROM, because it bounds what it can be quoted for.
// The number lives in `jobs` rows, which means an AWS session and a SQL
// prompt. This harness has neither and must not grow either — it is copied
// into a CloudShell session and run with `fetch` as its whole dependency set.
// So the reading is taken from what the driver itself saw: every write's
// identity, block, start and end.
//
// That is a usable substitute because a card write waits on its own index
// pass. The realm enqueues the pass and blocks the response on it (`enqueue`,
// then `awaitIndex`), so a write's HTTP window contains its lane wait. Two
// relations fall out of the windows:
//
//   * OVERLAPPED — two write windows intersect. Necessary for lane contention
//     and nothing more: both writes were outstanding at once.
//   * BEHIND — a write started inside another's window AND finished no
//     earlier than it. Under one lane per realm that is forced, because the
//     second pass cannot be claimed until the first releases its reservation.
//     Under a per-writer lane it is not forced at all. So this is the relation
//     that moves when the lane splits, which is why it is the one reported.
//
// Each split by whether the other write came from the same identity (the
// self-contention case) or a different one (the case that decides whether the
// lane should be keyed on the writer).
//
// WHAT IT IS NOT. These are HTTP windows, not queue rows. "Behind" is a
// consequence of a serial lane rather than a direct sighting of one — a write
// can finish after another for reasons of its own. The rendered section says
// so, and names the join that settles it: each write carries an
// `x-boxel-logging-correlation-id`, which the realm server logs on the write
// path beside the `enqueue` / `awaitIndex` split.

import { percentile } from './common.ts';

// One completed write, as the driver saw it. Failed writes are not recorded:
// their latency is a refusal, not an index wait.
export interface WriteRecord {
  // The workload block this write came from, so an expensive block and a cheap
  // one are never averaged together.
  block: string;
  // The Matrix ID that made it. This is the axis the whole question is about.
  userId: string;
  startedAt: number;
  endedAt: number;
}

// Which of the three states a write ended up in. `clear` is the baseline the
// other two are read against.
export type Blocking = 'clear' | 'behind-self' | 'behind-other';

export interface BlockReading {
  block: string;
  // Latencies by state, so each bucket can be summarized and, more
  // importantly, so an empty one is visibly empty.
  clear: number[];
  behindSelf: number[];
  behindOther: number[];
  // Windows that merely intersected, reported next to the stricter relation so
  // the gap between the two is legible.
  overlappedOther: number;
  // The identities that drove this block. More than one means the block itself
  // was shared, which changes how its own rows read.
  writers: Set<string>;
}

export interface FairnessReading {
  blocks: BlockReading[];
  // The headline: writes that finished no earlier than a different identity's
  // overlapping write. This is the count the lane question turns on.
  behindOther: number;
  behindSelf: number;
  overlappedOther: number;
  writes: number;
  // Every identity that wrote during the run. One means the run could not have
  // produced a cross-writer reading whatever its numbers say.
  writers: Set<string>;
}

function overlaps(a: WriteRecord, b: WriteRecord): boolean {
  return a.startedAt < b.endedAt && b.startedAt < a.endedAt;
}

// `subject` started while `other` was outstanding and did not finish first.
// The second clause is what separates this from a plain overlap: it is the
// ordering a serial lane forces on the two passes.
//
// Two windows that are identical to the millisecond carry no ordering at all,
// and the bounds below would otherwise read each as behind the other — one
// pair of writes counted twice, in a figure whose whole job is to be counted
// honestly. The driver cannot tell which ran first, so it says neither.
function behind(subject: WriteRecord, other: WriteRecord): boolean {
  if (
    subject.startedAt === other.startedAt &&
    subject.endedAt === other.endedAt
  ) {
    return false;
  }
  return (
    other.startedAt <= subject.startedAt &&
    subject.startedAt < other.endedAt &&
    subject.endedAt >= other.endedAt
  );
}

export function classify(
  subject: WriteRecord,
  all: readonly WriteRecord[],
): Blocking {
  let behindSelf = false;
  for (let other of all) {
    if (other === subject) {
      continue;
    }
    if (!behind(subject, other)) {
      continue;
    }
    // A different identity settles it outright; a same-identity blocker is
    // only the answer if no different one turns up.
    if (other.userId !== subject.userId) {
      return 'behind-other';
    }
    behindSelf = true;
  }
  return behindSelf ? 'behind-self' : 'clear';
}

export function readFairness(records: readonly WriteRecord[]): FairnessReading {
  let byBlock = new Map<string, BlockReading>();
  let reading: FairnessReading = {
    blocks: [],
    behindOther: 0,
    behindSelf: 0,
    overlappedOther: 0,
    writes: records.length,
    writers: new Set(records.map((r) => r.userId)),
  };
  for (let record of records) {
    let block = byBlock.get(record.block);
    if (!block) {
      block = {
        block: record.block,
        clear: [],
        behindSelf: [],
        behindOther: [],
        overlappedOther: 0,
        writers: new Set(),
      };
      byBlock.set(record.block, block);
    }
    block.writers.add(record.userId);
    let latency = record.endedAt - record.startedAt;
    switch (classify(record, records)) {
      case 'behind-other':
        block.behindOther.push(latency);
        reading.behindOther++;
        break;
      case 'behind-self':
        block.behindSelf.push(latency);
        reading.behindSelf++;
        break;
      default:
        block.clear.push(latency);
    }
    if (
      records.some(
        (other) =>
          other !== record &&
          other.userId !== record.userId &&
          overlaps(record, other),
      )
    ) {
      block.overlappedOther++;
      reading.overlappedOther++;
    }
  }
  reading.blocks = [...byBlock.values()].sort((a, b) =>
    a.block.localeCompare(b.block),
  );
  return reading;
}

// How much a block paid for being behind another identity, as a ratio of what
// the same block cost with the lane to itself. 1.00 means being blocked cost
// nothing; below 1.00 means the block paid somebody else's pass.
//
// `undefined` when either side has no samples, and the renderer prints that as
// `not measured`. This is the whole point of the exercise: a run with no
// contention scoring a perfect 1.00 is a statement about the workload, not
// about the lane, and it is exactly the reading that made a staging window of
// 107 passes look like a clean bill of health when it was a null result.
export function fairnessScore(block: BlockReading): number | undefined {
  if (block.clear.length === 0 || block.behindOther.length === 0) {
    return undefined;
  }
  let blocked = median(block.behindOther);
  if (blocked === 0) {
    return undefined;
  }
  return median(block.clear) / blocked;
}

function median(samples: number[]): number {
  return percentile(
    [...samples].sort((a, b) => a - b),
    50,
  );
}

function describeScore(block: BlockReading): string {
  let score = fairnessScore(block);
  if (score === undefined) {
    // Say which half is missing, because the two call for different fixes: no
    // blocked writes means the run never produced contention, and no clear
    // ones means it never produced a baseline.
    if (block.behindOther.length === 0) {
      return 'not measured (no write of this block ran behind another identity)';
    }
    if (block.clear.length === 0) {
      return 'not measured (no write of this block had the lane to itself)';
    }
    return 'not measured';
  }
  return `${score.toFixed(2)}`;
}

function bucket(label: string, samples: number[]): string {
  if (samples.length === 0) {
    return `${label.padEnd(14)} n=  0        —`;
  }
  return (
    `${label.padEnd(14)} n=${String(samples.length).padStart(3)}  ` +
    `p50 ${String(Math.round(median(samples))).padStart(6)}ms`
  );
}

// The section as it appears in the run summary.
export function describeFairness(reading: FairnessReading): string {
  let out: string[] = [];
  out.push(`\nfairness — did a write wait on somebody else's indexing?`);
  if (reading.writes === 0) {
    out.push(
      `  no writes completed, so there is nothing to read. A read-only run\n` +
        `  (--writers 0) cannot answer this question.`,
    );
    return out.join('\n');
  }
  if (reading.writers.size < 2) {
    // The failure this whole capability exists to make impossible: one
    // identity cannot produce cross-writer contention, and a table of zeroes
    // from such a run must not read as "the lane was fair".
    out.push(
      `  ⚠  all ${reading.writes} writes came from one identity ` +
        `(${[...reading.writers][0] ?? 'unknown'}), so no\n` +
        `     cross-writer contention was possible. The counts below are a\n` +
        `     property of the run's shape, not of the indexing lane. Give the\n` +
        `     workload a second "writes" block pinned to a different username,\n` +
        `     and grant that account write access to the realm.`,
    );
  }
  out.push(
    `  cross-writer blocked: ${reading.behindOther} of ${reading.writes} writes ` +
      `finished no earlier than a\n` +
      `    different identity's overlapping write`,
  );
  out.push(
    `  same-writer blocked:  ${reading.behindSelf}` +
      `   ·   overlapped another identity: ${reading.overlappedOther}`,
  );
  for (let block of reading.blocks) {
    out.push(
      `\n  ${block.block}  (${[...block.writers].join(', ')})` +
        `\n    ${bucket('lane to itself', block.clear)}` +
        `\n    ${bucket('behind self', block.behindSelf)}` +
        `\n    ${bucket('behind other', block.behindOther)}` +
        `\n    fairness      ${describeScore(block)}`,
    );
  }
  out.push(
    `\n  1.00 means being blocked behind another identity cost this block\n` +
      `  nothing; lower means it paid that identity's index pass. A bucket\n` +
      `  with no samples reads "not measured" rather than 1.00 — a run that\n` +
      `  produced no contention has not shown the lane to be fair.`,
  );
  out.push(
    `  These are the driver's own write windows, not queue rows. A write that\n` +
      `  started inside another's window and finished no earlier could not have\n` +
      `  had its index pass complete first, which one lane per realm forces and\n` +
      `  a per-writer lane would not. Each write carries an\n` +
      `  x-boxel-logging-correlation-id, so a specific one joins to the realm\n` +
      `  server's own write timing by its corr= id, where enqueue and awaitIndex\n` +
      `  are reported apart.`,
  );
  return out.join('\n');
}
