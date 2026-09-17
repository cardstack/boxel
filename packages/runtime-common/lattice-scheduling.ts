import {
  latticeInterleaveStale,
  latticeReserveAcrossTypes,
} from './lattice-kernel.ts';

export type LatticeDemandPriority = 1 | 2; // recent read / explicit waiter

// Priority travels along the same unresolved edges used for readiness. It
// changes order only: missing inputs, cycles and publication fences still
// belong to the registry. Bound traversal even for a very deep authored graph.
export function latticePropagateDemand(
  demand: ReadonlyMap<string, LatticeDemandPriority>,
  inputs: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, LatticeDemandPriority> {
  const result = new Map<string, LatticeDemandPriority>();
  const queue = [...demand].map(([id, priority]) => ({
    id,
    priority,
    depth: 0,
  }));
  for (let i = 0; i < queue.length && i < 8192; i++) {
    const { id, priority, depth } = queue[i];
    if (!inputs.has(id) || (result.get(id) ?? 0) >= priority) continue;
    result.set(id, priority);
    if (depth >= 32) continue;
    for (const input of inputs.get(id)!) {
      if (queue.length >= 8192) break;
      queue.push({ id: input, priority, depth: depth + 1 });
    }
  }
  return result;
}

// Alternate priority slots and background slots, starting with a waiter.
// Interleave at the owner boundary, not halfway through a 32-owner wave: a
// short time slice must still serve both classes. Each class retains the
// existing stale/type fairness. Without demand, keep the ordinary ordering.
export function latticeOrderWave<
  T extends {
    ownerURL: string;
    stale?: true;
    demand?: LatticeDemandPriority;
    pendingInputCount?: number;
  },
>(ready: readonly T[], reserve: number, backgroundFirst = false): T[] {
  // A partial aggregate does not settle its unfinished inputs. Reserving one
  // slot per card type made several board types crowd out hundreds of leaves.
  // Infer this distinction from the dependency frontier, never URL/type names.
  // With both classes present, spend 3/4 of admissions on input progress and
  // 1/4 on intermediate refreshes. Rotate the leading class for one-owner
  // slices; within each class demand/background fairness remains unchanged.
  const refresh = ready.filter(
    (row) => row.stale && (row.pendingInputCount ?? 0) > 0,
  );
  if (refresh.length && refresh.length < ready.length) {
    const refreshSet = new Set(refresh);
    const progress = ready.filter((row) => !refreshSet.has(row));
    const advancing = orderDemand(progress, reserve, backgroundFirst);
    const updating = orderDemand(refresh, reserve, backgroundFirst);
    const result: T[] = [];
    let p = 0;
    let r = 0;
    while (p < advancing.length || r < updating.length) {
      if (backgroundFirst && r < updating.length) result.push(updating[r++]);
      for (let i = 0; i < 3 && p < advancing.length; i++)
        result.push(advancing[p++]);
      if (!backgroundFirst && r < updating.length) result.push(updating[r++]);
    }
    return result;
  }
  return orderDemand(ready, reserve, backgroundFirst);
}

function orderDemand<
  T extends { ownerURL: string; stale?: true; demand?: LatticeDemandPriority },
>(ready: readonly T[], reserve: number, backgroundFirst: boolean): T[] {
  const fair = (rows: readonly T[]) =>
    latticeReserveAcrossTypes(latticeInterleaveStale(rows), reserve);
  const urgent = fair(ready.filter((row) => row.demand === 2));
  const viewed = fair(ready.filter((row) => row.demand === 1));
  const background = fair(ready.filter((row) => !row.demand));
  const priority = [...urgent, ...viewed];
  if (!priority.length) return background;
  const result: T[] = [];
  for (let i = 0; i < Math.max(priority.length, background.length); i++) {
    const pair = backgroundFirst
      ? [background[i], priority[i]]
      : [priority[i], background[i]];
    for (const row of pair) if (row) result.push(row);
  }
  return result;
}

// Cooperative admission budget. Already running owners finish and publish;
// unstarted owners stay dirty for the durable successor job. Always allow one
// owner, including when batch setup has consumed the budget. No timer races a
// transaction and no computation is abandoned halfway through a publication.
export class LatticeWaveBudget {
  #started = 0;
  #deadline: number;
  readonly maxOwners: number;
  private now: () => number;
  constructor(
    maxOwners: number,
    budgetMs: number,
    now: () => number = () => performance.now(),
  ) {
    this.maxOwners = maxOwners;
    this.now = now;
    this.#deadline = now() + budgetMs;
  }
  take(): boolean {
    if (
      this.#started >= this.maxOwners ||
      (this.#started > 0 && this.now() >= this.#deadline)
    )
      return false;
    this.#started++;
    return true;
  }
}
