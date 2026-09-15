import { v4 as uuidv4 } from '@lukeed/uuid';
import { param, query } from '../expression.ts';
import type { Expression } from '../expression.ts';
import type { DBAdapter } from '../db.ts';

// A lease that keeps one concurrency group's jobs un-claimable. Held jobs stay
// `unfulfilled` and so remain coalesce candidates: an incoming publish merges
// into one rather than inserting alongside it.
//
// This is the lever for the case coalescing cannot reach on its own. Merging
// only ever targets a job no worker has claimed yet, which means it helps most
// when the queue is backed up and not at all when workers are free — the
// opposite of what a bulk import needs. Holding the group for as long as the
// work keeps arriving restores the merge target.
//
// The lease is a deadline, not a flag, because the holder can die mid-hold. A
// holder refreshes while it still has work; one that stops refreshing frees
// the group when its lease runs out. Holds compose: the group is held while
// any live lease names it, and `release` only ever drops the caller's own.

export class JobClaimHold {
  readonly concurrencyGroup: string;
  readonly #holderId = uuidv4();
  readonly #dbAdapter: DBAdapter;
  // A realm running on the browser-side index has no worker queue behind it —
  // no `jobs` table, and no `job_claim_holds` either. There is nothing to hold
  // back there, so the hold is inert rather than an error, the same way
  // `awaitRealmIndexSettled` reports settled without a query.
  readonly #enabled: boolean;
  // Set once a release begins, so a later refresh cannot resurrect the row.
  #released = false;
  #inFlightRefresh: Promise<void> | undefined;

  private constructor(dbAdapter: DBAdapter, concurrencyGroup: string) {
    this.#dbAdapter = dbAdapter;
    this.concurrencyGroup = concurrencyGroup;
    this.#enabled = dbAdapter.kind === 'pg';
  }

  static async acquire(
    dbAdapter: DBAdapter,
    concurrencyGroup: string,
    leaseMs: number,
  ): Promise<JobClaimHold> {
    let hold = new JobClaimHold(dbAdapter, concurrencyGroup);
    if (!hold.#enabled) {
      return hold;
    }
    // A holder that died mid-hold leaves a row behind: expired, so it holds
    // nothing, but nothing deletes it either. Sweeping this group's dead rows
    // as we take a lease on it keeps that bounded without a separate reaper.
    await query(dbAdapter, [
      `DELETE FROM job_claim_holds
        WHERE concurrency_group =`,
      param(concurrencyGroup),
      `AND expires_at <= NOW()`,
    ] as Expression);
    await hold.refresh(leaseMs);
    return hold;
  }

  async refresh(leaseMs: number): Promise<void> {
    if (!this.#enabled || this.#released) {
      return;
    }
    // Tracked so a release can wait for it. A refresh still in flight when the
    // row is deleted would otherwise re-insert it, and the lane would look
    // held again moments after being freed.
    let pending = this.#writeRow(leaseMs);
    this.#inFlightRefresh = pending;
    try {
      await pending;
    } finally {
      if (this.#inFlightRefresh === pending) {
        this.#inFlightRefresh = undefined;
      }
    }
  }

  async #writeRow(leaseMs: number): Promise<void> {
    await query(this.#dbAdapter, [
      `INSERT INTO job_claim_holds (concurrency_group, holder_id, expires_at)
       VALUES (`,
      param(this.concurrencyGroup),
      `,`,
      param(this.#holderId),
      `, NOW() + make_interval(secs =>`,
      param(leaseMs / 1000),
      `))
       ON CONFLICT (concurrency_group, holder_id) DO UPDATE
         SET expires_at = EXCLUDED.expires_at`,
    ] as Expression);
  }

  // Frees this holder's claim on the group and wakes the workers. Without the
  // notify the release would only take effect on a worker's next poll, which
  // would hand back much of what the hold saved.
  async release(): Promise<void> {
    if (!this.#enabled) {
      return;
    }
    // Ordering, not just bookkeeping: the flag stops a refresh that has not
    // started, and the await drains one that has. Deleting the row while an
    // upsert is in flight re-creates the holder for another lease, and the
    // `NOTIFY` below would then wake workers to a lane that is held again.
    this.#released = true;
    try {
      await this.#inFlightRefresh;
    } catch {
      // A failed refresh leaves nothing to drain; the delete below is what
      // matters and it runs either way.
    }
    await query(this.#dbAdapter, [
      `DELETE FROM job_claim_holds
        WHERE concurrency_group =`,
      param(this.concurrencyGroup),
      `AND holder_id =`,
      param(this.#holderId),
    ] as Expression);
    await query(this.#dbAdapter, [`NOTIFY jobs`] as Expression);
  }
}
