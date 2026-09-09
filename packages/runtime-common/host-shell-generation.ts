import type { DBAdapter } from './db.ts';
import { dbAdapterQuerier, param, type Querier } from './expression.ts';

// An ordering over host shells.
//
// A realm server can only identify the host bundle it serves by hashing the
// index HTML it fetches, and a hash answers "is this the same shell?" but never
// "is this shell older?". Repairing rows a deploy left behind needs the second
// question, so `host_shell_generation` carries a number that advances every
// time the served shell changes. A row stamped with a generation below the
// current one was rendered against a bundle that is no longer being served.
//
// The number is assigned here rather than by the deploy pipeline, because the
// host is not a container: it is static files in S3, with no environment to
// inject and no task definition to stamp. Assigning on first observation also
// makes a rollback behave — see `claimHostShellGeneration`.

// Generation 0 with an empty hash is what the migration seeds, and means no
// shell has been observed yet. No real hash can collide with it.
export const NO_HOST_SHELL_OBSERVED = 0;

export interface HostShellGeneration {
  generation: number;
  shellHash: string;
}

// Record `shellHash` as the shell now being served, and return the generation
// it belongs to. Idempotent: a server re-reporting the shell already recorded
// gets that shell's generation back without advancing anything.
//
// Concurrency is the whole reason this is one statement. A rolling deploy
// overlaps a task booting against the outgoing bundle with its neighbour on the
// new one, so two *different* shells are claimed at once. Two readers see the
// same starting generation, compute the same successor, and two distinct shells
// end up sharing one number — which destroys the ordering, because rows from
// either then carry the same generation and nothing can tell them apart.
//
// The `WHERE id = 1` is unconditional so the statement always takes the row
// lock and always returns the row it observed. A second claimant blocks; once
// the first commits, READ COMMITTED re-evaluates against the committed row, and
// the `CASE` decides from that value whether this claim is a transition to
// count or the shell already recorded. Advancing on a *transition* rather than
// per distinct hash is what makes a rollback correct: redeploying a bundle that
// ran before takes a new, higher generation than the one it replaces, because a
// row's generation records when it was rendered, not which artifact is
// semantically newer.
//
// Reading the idempotent answer back in a second query would reopen the gap
// this closes. That statement commits and releases the lock before the read
// runs, so a different-shell claim landing in between would make this return
// *that* shell's hash and generation — and a caller stamping its own render
// with the number would defeat the ordering during exactly the concurrency
// this exists to survive.
export async function claimHostShellGeneration(
  dbAdapter: DBAdapter,
  shellHash: string,
  observedAt: number,
  querier?: Querier,
): Promise<HostShellGeneration> {
  let q = querier ?? dbAdapterQuerier(dbAdapter);
  let claimed = await q([
    `UPDATE host_shell_generation SET shell_hash = `,
    param(shellHash),
    `, generation = CASE WHEN shell_hash <> `,
    param(shellHash),
    ` THEN generation + 1 ELSE generation END`,
    `, observed_at = CASE WHEN shell_hash <> `,
    param(shellHash),
    ` THEN `,
    param(observedAt),
    ` ELSE observed_at END`,
    ` WHERE id = 1 RETURNING generation, shell_hash`,
  ]);
  if (claimed.length === 0) {
    // The migration seeds the row, so its absence means this database predates
    // that migration or something removed it. Reporting "nothing observed"
    // keeps callers on their no-ordering-available path instead of throwing
    // into a boot sequence that must not fail for a diagnostic.
    return { generation: NO_HOST_SHELL_OBSERVED, shellHash: '' };
  }
  return rowToGeneration(claimed[0]);
}

// The generation of the shell currently being served, for comparing against
// the generation stamped on a row.
export async function currentHostShellGeneration(
  dbAdapter: DBAdapter,
  querier?: Querier,
): Promise<HostShellGeneration> {
  let q = querier ?? dbAdapterQuerier(dbAdapter);
  let rows = await q([
    `SELECT generation, shell_hash FROM host_shell_generation WHERE id = 1`,
  ]);
  if (rows.length === 0) {
    // The migration seeds the row, so its absence means this database predates
    // that migration or something removed it. Reporting "nothing observed"
    // keeps callers on their no-ordering-available path instead of throwing
    // into a boot sequence that must not fail for a diagnostic.
    return { generation: NO_HOST_SHELL_OBSERVED, shellHash: '' };
  }
  return rowToGeneration(rows[0]);
}

function rowToGeneration(row: Record<string, unknown>): HostShellGeneration {
  return {
    generation: Number(row.generation),
    shellHash: String(row.shell_hash ?? ''),
  };
}
