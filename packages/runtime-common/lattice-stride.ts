import {
  latticeOrderWave,
  type LatticeDemandPriority,
} from './lattice-scheduling.ts';

interface Account {
  pass: number;
  estimateMs: number;
  serviceMs: number;
  attempts: number;
  typeCursor?: string;
  // At most 64 recently served type cursors per service class.
  cursors?: Array<[string, string]>;
}
interface Pool {
  clock: number;
  active: string[];
  accounts: Record<string, Account>;
}
export interface LatticeServiceState {
  version: 1;
  pools: Record<string, Pool>;
  // Readiness probes rotate independently; they are not execution service.
  frontier?: LatticeServiceState;
  visibleServed?: Array<[string, number]>;
  frontierReady?: string[];
}
interface Candidate {
  ownerURL: string;
  stale?: true;
  demand?: LatticeDemandPriority;
  pendingInputCount?: number;
  visible?: true;
}
const phase = (row: Candidate) =>
  row.stale && (row.pendingInputCount ?? 0) > 0 ? 'refresh' : 'progress';
const priority = (row: Candidate) => String(row.demand ?? 0);
const ownerType = (row: Candidate) =>
  row.ownerURL.slice(0, row.ownerURL.lastIndexOf('/'));
const weights: Record<string, number> = {
  progress: 3,
  refresh: 1,
  '2': 4,
  '1': 2,
  '0': 1,
};

// Hierarchical Stride: charge occupied worker-slot time, not job count.
// In-flight estimates reserve service but are replaced by actual elapsed time.
// The state is bounded (two phases, three demand classes each), portable and
// advisory. The queue adapter owns persistence and reservation fencing.
export class LatticeStride<T extends Candidate> {
  readonly state: LatticeServiceState;
  #queues = new Map<string, T[]>();
  #reserved = new Map<string, number>();
  #remaining: number;
  private now: () => number;

  constructor(
    rows: readonly T[],
    state?: LatticeServiceState,
    now: () => number = Date.now,
  ) {
    this.now = now;
    this.state = state ? structuredClone(state) : { version: 1, pools: {} };
    this.#remaining = rows.length;
    // Existing type/age ordering is only the tie order within a service class.
    for (const row of latticeOrderWave(rows, 4)) {
      const key = `${phase(row)}/${priority(row)}`;
      const queue = this.#queues.get(key) ?? [];
      queue.push(row);
      this.#queues.set(key, queue);
    }
    this.#activate(
      'root',
      ['progress', 'refresh'].filter((p) =>
        [...this.#queues.keys()].some((key) => key.startsWith(p + '/')),
      ),
    );
    for (const p of ['progress', 'refresh']) {
      // Waiters win equal-service ties, but cannot reset their consumed share.
      this.#activate(
        p,
        ['2', '1', '0'].filter((d) => this.#queues.has(`${p}/${d}`)),
      );
      for (const d of this.state.pools[p].active) {
        const queue = this.#queues.get(`${p}/${d}`)!;
        const cursors = new Map(this.state.pools[p].accounts[d].cursors);
        const groups = new Map<string, T[]>();
        for (const row of queue) {
          const type = ownerType(row);
          const group = groups.get(type) ?? [];
          group.push(row);
          groups.set(type, group);
        }
        queue.length = 0;
        for (const [type, group] of groups) {
          const i = group.findIndex(
            (row) => row.ownerURL === cursors.get(type),
          );
          if (i >= 0) group.push(...group.splice(0, i + 1));
          queue.push(...group);
        }
      }
    }
  }

  get remaining() {
    return this.#remaining;
  }

  take(): { row: T; complete: (elapsedMs: number) => void } | undefined {
    const phases = this.state.pools.root.active.filter((p) =>
      this.state.pools[p].active.some(
        (d) => this.#queues.get(`${p}/${d}`)?.length,
      ),
    );
    if (!phases.length) return;
    const p = this.#choose('root', phases);
    const d = this.#choose(
      p,
      this.state.pools[p].active.filter(
        (key) => this.#queues.get(`${p}/${key}`)?.length,
      ),
    );
    const queue = this.#queues.get(`${p}/${d}`)!;
    const account = this.state.pools[p].accounts[d];
    // Preserve the existing type reservation inside a service share. A flat
    // owner cursor would put a board behind hundreds of same-type siblings.
    const types = [...new Set(queue.map(ownerType))].sort();
    const type =
      types[(types.indexOf(account.typeCursor ?? '') + 1) % types.length];
    // Deadlines choose within the earned service share, never bypass it.
    // A directly viewed aggregate must not sit behind all its donated inputs.
    const served = new Map(this.state.visibleServed);
    const due = queue
      .filter(
        (row) =>
          ownerType(row) === type &&
          row.visible &&
          this.now() - (served.get(row.ownerURL) ?? 0) >= 2000,
      )
      .sort(
        (a, b) => (served.get(a.ownerURL) ?? 0) - (served.get(b.ownerURL) ?? 0),
      )[0];
    const [row] = queue.splice(
      due
        ? queue.indexOf(due)
        : queue.findIndex((candidate) => ownerType(candidate) === type),
      1,
    );
    const cursors = new Map(account.cursors);
    cursors.delete(ownerType(row));
    cursors.set(ownerType(row), row.ownerURL);
    account.cursors = [...cursors].slice(-64);
    account.typeCursor = ownerType(row);
    this.#remaining--;
    const estimate = account.estimateMs;
    const keys = [
      ['root', p],
      [p, d],
    ];
    for (const [pool, key] of keys) {
      const id = `${pool}/${key}`;
      this.#reserved.set(id, (this.#reserved.get(id) ?? 0) + estimate);
    }
    let completed = false;
    return {
      row,
      complete: (elapsedMs) => {
        if (completed) throw new Error('Lattice service charged twice');
        completed = true;
        if (!Number.isFinite(elapsedMs) || elapsedMs < 0)
          throw new Error('Invalid Lattice service duration');
        if (this.state.frontierReady) {
          this.state.frontierReady = this.state.frontierReady.filter(
            (id) => id !== row.ownerURL,
          );
        }
        if (row.visible) {
          const served = new Map(this.state.visibleServed);
          served.delete(row.ownerURL);
          served.set(row.ownerURL, this.now());
          this.state.visibleServed = [...served].slice(-512);
        }
        const actual = Math.max(1, elapsedMs);
        for (const [pool, key] of keys) {
          const id = `${pool}/${key}`;
          this.#reserved.set(id, (this.#reserved.get(id) ?? 0) - estimate);
          const a = this.state.pools[pool].accounts[key];
          a.pass += actual / weights[key];
          a.serviceMs += actual;
          a.attempts++;
          a.estimateMs =
            a.attempts === 1 ? actual : 0.75 * a.estimateMs + 0.25 * actual;
          const group = this.state.pools[pool];
          group.clock = Math.max(
            group.clock,
            Math.min(...group.active.map((k) => group.accounts[k].pass)),
          );
        }
      },
    };
  }

  #activate(name: string, active: string[]) {
    const pool = (this.state.pools[name] ??= {
      clock: 0,
      active: [],
      accounts: {},
    });
    for (const key of active) {
      const account = (pool.accounts[key] ??= {
        pass: pool.clock,
        estimateMs: 100,
        serviceMs: 0,
        attempts: 0,
      });
      // A sleeper gets no unbounded accumulated credit on rejoining.
      if (!pool.active.includes(key))
        account.pass = Math.max(account.pass, pool.clock);
    }
    pool.active = active;
  }

  #choose(pool: string, keys: string[]) {
    const score = (key: string) =>
      this.state.pools[pool].accounts[key].pass +
      (this.#reserved.get(`${pool}/${key}`) ?? 0) / weights[key];
    return keys.reduce((best, key) => (score(key) < score(best) ? key : best));
  }
}
