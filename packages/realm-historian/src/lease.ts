// The shard leases. Realms are divided by a hash of their registry id into a
// fixed number of virtual shards, each with one row in
// `realm_historian_leases`, and a task records only the realms of the shards
// it holds. A lease is taken with an insert that updates an expired row, and
// kept by renewing its expiry; a holder whose renewal finds the row taken by
// someone else has lost the lease and must stop recording.
//
// The tasks of one service share the shards evenly: each claims free shards
// until it holds `ceil(shardCount / taskCount)`. With one shard and one task,
// the launch configuration, a second task waits for the first to release or
// to expire.

import { logger, type DBAdapter } from '@cardstack/runtime-common';

const log = logger('realm-historian:lease');

export interface LeaseOptions {
  // The number of virtual shards the realms are divided into.
  shardCount: number;
  // The number of tasks the service runs, which sets each task's share.
  taskCount: number;
  // How often each held lease is renewed.
  renewMs: number;
  // How long a renewal keeps the lease; a holder that stops renewing loses it
  // this long after its last renewal.
  expiryMs: number;
  // Identifies this task in the lease rows.
  holder: string;
}

export class LeaseLostError extends Error {
  shards: number[];
  constructor(shards: number[], options?: { cause: unknown }) {
    super(
      options
        ? `lease renewal failed on shard(s) ${shards.join(', ')}: ${String(options.cause)}`
        : `lost the lease on shard(s) ${shards.join(', ')}`,
      options,
    );
    this.name = 'LeaseLostError';
    this.shards = shards;
  }
}

// The shard a realm belongs to: FNV-1a over its registry id, reduced to the
// shard count. The registry id is permanent, so a realm's shard changes only
// when the shard count does.
export function shardOf(realmId: string, shardCount: number): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < realmId.length; i++) {
    hash ^= realmId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % shardCount;
}

export class LeaseManager {
  #db: DBAdapter;
  #options: LeaseOptions;
  #held = new Set<number>();
  #timer: ReturnType<typeof setInterval> | undefined;
  #ticking: Promise<void> | undefined;
  #onLost: ((error: LeaseLostError) => void) | undefined;
  #onGain: (() => void) | undefined;

  constructor(db: DBAdapter, options: LeaseOptions) {
    this.#db = db;
    this.#options = options;
  }

  // The shards this task holds, in order.
  get held(): number[] {
    return [...this.#held].sort((a, b) => a - b);
  }

  // The shards one task of the service claims at most.
  get share(): number {
    return Math.ceil(this.#options.shardCount / this.#options.taskCount);
  }

  holds(shard: number): boolean {
    return this.#held.has(shard);
  }

  // Runs the first tick, then one every `renewMs`. `onLost` is called with the
  // error of a renewal that finds a held shard taken; the manager then holds
  // nothing and renews nothing further. `onGain` is called after a tick that
  // claimed a shard.
  async start(
    onLost: (error: LeaseLostError) => void,
    onGain?: () => void,
  ): Promise<void> {
    this.#onLost = onLost;
    this.#onGain = onGain;
    await this.tick();
    this.#timer = setInterval(() => {
      if (this.#ticking) {
        return;
      }
      this.#ticking = this.tick()
        .catch((error) => {
          // A tick that fails after a stop or an abandon has nothing to
          // report: the task is no longer counting on the lease.
          if (this.#timer) {
            this.#lost(error);
          }
        })
        .finally(() => {
          this.#ticking = undefined;
        });
    }, this.#options.renewMs);
  }

  // Stops renewing and releases the held shards, so the next task takes them
  // without waiting for the expiry.
  async stop(): Promise<void> {
    this.#stopTimer();
    await this.#ticking;
    await this.release();
  }

  // Forgets the held shards without releasing them: what a task that dies
  // leaves behind. The shards free when their leases expire.
  async abandon(): Promise<void> {
    this.#stopTimer();
    try {
      await this.#ticking;
    } catch {
      // A tick cut short by the abandon has nothing to report.
    }
    this.#held.clear();
  }

  // Renews every held shard, then claims free shards up to the share. Throws
  // `LeaseLostError` when a held shard's renewal returns no row.
  async tick(): Promise<void> {
    if (this.#held.size > 0) {
      await this.#renew();
    }
    let gained = false;
    for (
      let shard = 0;
      shard < this.#options.shardCount && this.#held.size < this.share;
      shard++
    ) {
      if (!this.#held.has(shard) && (await this.#claim(shard))) {
        this.#held.add(shard);
        gained = true;
        log.info(`${this.#options.holder} holds shard ${shard}`);
      }
    }
    if (gained) {
      this.#onGain?.();
    }
  }

  async release(): Promise<void> {
    if (this.#held.size === 0) {
      return;
    }
    let shards = this.held;
    this.#held.clear();
    await this.#db.execute(
      `DELETE FROM realm_historian_leases
       WHERE shard = ANY($1::text[]) AND holder = $2`,
      { bind: [shards.map(String), this.#options.holder] },
    );
    log.info(`${this.#options.holder} released shard(s) ${shards.join(', ')}`);
  }

  async #claim(shard: number): Promise<boolean> {
    let rows = await this.#db.execute(
      `INSERT INTO realm_historian_leases (shard, holder, expires_at)
       VALUES ($1, $2, now() + ($3::int * interval '1 millisecond'))
       ON CONFLICT (shard) DO UPDATE
         SET holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at
         WHERE realm_historian_leases.expires_at < now()
       RETURNING shard`,
      { bind: [String(shard), this.#options.holder, this.#options.expiryMs] },
    );
    return rows.length > 0;
  }

  // A renewal moves the expiry of every row this holder still owns. A row
  // another holder has taken is not renewed, and its absence from the result
  // is the loss.
  async #renew(): Promise<void> {
    let shards = this.held;
    let rows = await this.#db.execute(
      `UPDATE realm_historian_leases
       SET expires_at = now() + ($3::int * interval '1 millisecond')
       WHERE shard = ANY($1::text[]) AND holder = $2
       RETURNING shard`,
      {
        bind: [
          shards.map(String),
          this.#options.holder,
          this.#options.expiryMs,
        ],
      },
    );
    let renewed = new Set(rows.map((row) => Number(row.shard)));
    let lost = shards.filter((shard) => !renewed.has(shard));
    if (lost.length > 0) {
      throw new LeaseLostError(lost);
    }
  }

  // A renewal that found a shard taken, or that failed outright, ends this
  // task's hold on every shard: it can't tell which it still owns.
  #lost(error: unknown): void {
    this.#stopTimer();
    let lost =
      error instanceof LeaseLostError
        ? error
        : new LeaseLostError(this.held, { cause: error });
    this.#held.clear();
    log.error(lost.message);
    this.#onLost?.(lost);
  }

  #stopTimer(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }
}
