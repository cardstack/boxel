// Does a write wait on somebody else's indexing?
//
// A realm's indexing runs in one lane family, named by
// `indexingConcurrencyGroup(realmURL)`. Work published to the family's
// exclusive lane runs with nothing else in the family, and the queue runs one
// job per lane, so while a realm's index passes all publish there, two people
// editing unrelated cards in one realm serialize, and the second one's write
// pays the first one's fan-out. Passes in per-writer lanes of the family run
// side by side instead. Whether that split pays turns on one number: of the
// index passes that waited, how many waited behind a *different* person's pass
// rather than their own.
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
//   * BEHIND — a write started strictly inside another's window AND finished
//     no earlier than it. Under one lane per realm the second pass cannot be
//     claimed until the first releases its reservation, so a blocked write
//     tends to land here; under a per-writer lane it does not. So this is the
//     relation that moves when the lane splits, which is why it is the one
//     reported.
//
// Each split by whether the other write came from the same identity (the
// self-contention case) or a different one (the case that decides whether the
// lane should be keyed on the writer).
//
// WHAT IT IS NOT, IN BOTH DIRECTIONS. These are HTTP windows, not queue rows,
// and a window ends well after the index pass does: `awaitIndex` closes at the
// top of the invalidation callback, and the realm then clears its caches,
// serializes the card and sends the body, which the driver reads before
// stamping the end. So these are the ends of response TAILS, not of passes,
// and the count errs both ways — a genuinely blocked write whose blocker had
// the longer tail ends first and is scored clear, and a slow tail can put a
// write behind one it never waited on. It is an estimate of lane contention,
// not a sighting of it. What settles any particular write is the server's own
// timing: each carries an `x-boxel-logging-correlation-id`, which the realm
// logs on the write path beside the `enqueue` / `awaitIndex` split.

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
// EQUAL STARTS ARE UNORDERED, and this is load-bearing rather than tidiness.
// Two writer timers can fire in the same millisecond, and neither write was
// outstanding when the other began. Ordering them by which finished later
// would score the more expensive block as behind the cheaper one — and it
// would do so under per-writer lanes too, since an expensive write still ends
// last when nothing blocked it. That is a false positive the lane split cannot
// clear, which would cost this count the one property it is reported for.
function behind(subject: WriteRecord, other: WriteRecord): boolean {
  if (subject.startedAt === other.startedAt) {
    return false;
  }
  return (
    other.startedAt < subject.startedAt &&
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
  // `overlappedOther` is a strict superset of `behindOther` — being behind
  // implies overlapping — while `behindSelf` is disjoint from `behindOther`
  // alone, since `classify` returns one state. It is NOT disjoint from
  // `overlappedOther`, which asks a different question and is counted
  // separately: a write behind an earlier write of its own, which also merely
  // overlaps a stranger's, lands in both. Printed flat these three read as a
  // partition that does not add up, so the nesting is spelled rather than left
  // to be inferred.
  out.push(
    `  same-writer blocked:  ${reading.behindSelf}` +
      `  (a write behind an earlier write of its own)`,
  );
  out.push(
    `  overlapped another identity: ${reading.overlappedOther}` +
      `, of which ${reading.behindOther} finished no earlier` +
      `\n    (the rest overlapped but finished first, which a serial lane does` +
      ` not forbid)`,
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
    `  These are the driver's own write windows, not queue rows, and they bound\n` +
      `  the answer rather than give it. A window ends when the response body\n` +
      `  has been read, which is some way past the index pass: the realm still\n` +
      `  clears its caches, serializes the card and sends the bytes. So the\n` +
      `  ordering here is the ordering of response tails, and it errs in both\n` +
      `  directions — a blocked write whose blocker had the longer tail ends\n` +
      `  first and is scored clear, and a slow tail can put a write behind one\n` +
      `  it never waited on. Read the count as an estimate. Each write carries\n` +
      `  an x-boxel-logging-correlation-id, so the realm server's own write\n` +
      `  timing settles any particular one by its corr= id, where enqueue and\n` +
      `  awaitIndex are reported apart.`,
  );
  return out.join('\n');
}
