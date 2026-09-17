// Portable rules only: no SQL, module execution, network, clock or card objects.
// A storage adapter must capture these facts coherently and check them again
// atomically with publication. This predicate alone is not commit authority.
export type LatticeRevision = string | number;

export interface LatticeInputReceipt {
  id: string;
  revision: LatticeRevision;
}

export interface LatticeInputState extends LatticeInputReceipt {
  complete: boolean;
  pending: boolean;
}

export function latticeInputReady(
  input: { complete: boolean; pending: boolean } | undefined,
): boolean {
  return input?.complete === true && input.pending === false;
}

// Revisions are opaque and belong to their identity, never a global ordering.
// The caller owns realm/representation scoping and canonical identity resolution.
// Repeated aliases of one input are allowed; missing coverage is never empty data.
export function latticeReadSetCurrent(
  receipts: Iterable<LatticeInputReceipt>,
  current: (id: string) => LatticeInputState | undefined,
): boolean {
  for (let receipt of receipts) {
    let input = current(receipt.id);
    if (
      !input ||
      input.id !== receipt.id ||
      input.revision !== receipt.revision ||
      !latticeInputReady(input)
    ) {
      return false;
    }
  }
  return true;
}

// This is an obligation receipt, not a worker reservation or an authorization
// credential. The adapter retains ownership of its queue lease/claim handle.
export interface LatticeWorkClaim {
  id: string;
  obligation: LatticeRevision;
  // The owner is past its staleness deadline: this attempt runs over its
  // feeders' last published bodies, is not superseded by pending source work
  // or by a newer obligation, and publishes without clearing the obligation.
  stale?: true;
}

export interface LatticeWorkState {
  id: string;
  obligation: LatticeRevision | null;
  authorized: boolean;
  sourcePending: boolean;
  active: boolean;
  inputsCurrent: boolean;
  codeCurrent: boolean;
  // `lattice_owners.stale_after` has passed while the owner is still obliged.
  overdue?: boolean;
}

export type LatticeWorkReason =
  | 'authority-changed'
  | 'source-pending'
  | 'owner-retired'
  | 'already-satisfied'
  | 'inputs-changed'
  | 'code-changed'
  | 'obligation-changed';

export type LatticeWorkDecision =
  | { status: 'ready'; claim: LatticeWorkClaim }
  | { status: 'withheld'; reason: LatticeWorkReason };

export function latticeWorkDecision(
  state: LatticeWorkState,
  claim?: LatticeWorkClaim,
): LatticeWorkDecision {
  let reason: LatticeWorkReason | undefined;
  // Past its deadline an owner runs regardless of pending source work, moving
  // inputs or a newer obligation: the value it publishes is true at its input
  // generation, and the obligation it keeps covers whatever arrived since.
  // Authority, retirement, an obligation at all and code currency still hold.
  // An attempt claimed as ordinary is not promoted by the row turning overdue
  // under it: it read its inputs the ordinary way and publishes clean.
  const stale =
    Boolean(state.overdue) &&
    state.obligation !== null &&
    (!claim || Boolean(claim.stale));
  if (!state.authorized) reason = 'authority-changed';
  else if (state.sourcePending && !stale) reason = 'source-pending';
  else if (!state.active) reason = 'owner-retired';
  else if (state.obligation === null) reason = 'already-satisfied';
  else if (!state.inputsCurrent && !stale) reason = 'inputs-changed';
  else if (!state.codeCurrent) reason = 'code-changed';
  else if (
    claim &&
    (claim.id !== state.id || (claim.obligation !== state.obligation && !stale))
  ) {
    reason = 'obligation-changed';
  }
  return reason
    ? { status: 'withheld', reason }
    : {
        status: 'ready',
        claim: {
          id: state.id,
          obligation: state.obligation!,
          ...(stale ? { stale: true as const } : {}),
        },
      };
}

// A retry belongs to one owner obligation and code revision, not the realm's
// moving publication clock. Independent publications cannot renew this budget.
export const latticeWorkAttemptLimit = 3;
export interface LatticeWorkFailure {
  obligation: LatticeRevision;
  definitionRevision: string;
  codeVersion?: string;
  attempts: number;
}
export function latticeWorkFailureAttempts(
  previous: LatticeWorkFailure | undefined,
  obligation: LatticeRevision,
  definitionRevision: string,
  codeVersion?: string,
): number {
  const attempts =
    previous?.obligation === obligation &&
    previous.definitionRevision === definitionRevision &&
    previous.codeVersion === codeVersion
      ? previous.attempts
      : 0;
  return Math.min(attempts + 1, latticeWorkAttemptLimit);
}

// Wave composition. A wave is cut from the head of the ready list, and the
// ready list sorts ordinary owners by attempts and URL. An owner past its
// staleness deadline is the one with a promise to keep: alternate stale
// attempts with ordinary ones so a bulk drain (thousands of games ahead of
// a few hundred seasons in URL order) still republishes the upper tiers
// every window, at half a wave's worth of throughput.
export function latticeInterleaveStale<
  T extends { stale?: true; [key: string]: unknown },
>(ready: readonly T[]): T[] {
  const stale = ready.filter((item) => item.stale);
  if (!stale.length || stale.length === ready.length) return [...ready];
  const ordinary = ready.filter((item) => !item.stale);
  const out: T[] = [];
  for (let i = 0; i < Math.max(stale.length, ordinary.length); i++) {
    if (i < stale.length) out.push(stale[i]);
    if (i < ordinary.length) out.push(ordinary[i]);
  }
  return out;
}

export interface LatticePendingWork {
  id: string;
  // Only unsettled inputs, at canonical identities supplied by the adapter.
  pendingInputs: readonly string[];
  // A code/authority/source barrier is not a dependency cycle. Its old input
  // set may be replaced when the barrier clears.
  runnable: boolean;
}

// Select the current frontier, not a speculative ordering of future work.
// Publication can change membership and edges, so the adapter must replan.
// This hint never grants a claim or relaxes an input/publication fence.
export function latticeWorkFrontier(work: readonly LatticePendingWork[]): {
  ready: string[];
  cycle: string[];
} {
  const ready = work
    .filter((item) => item.runnable && item.pendingInputs.length === 0)
    .map((item) => item.id);
  if (ready.length) return { ready, cycle: [] };

  // Iterative DFS avoids a JS stack limit on highly compositional graphs.
  // Unknown or externally blocked inputs remain blockers, never cycle edges.
  const byId = new Map(work.map((item) => [item.id, item]));
  const visited = new Set<string>();
  const path = new Map<string, number>();
  for (const root of work) {
    if (!root.runnable || visited.has(root.id)) continue;
    const stack = [{ item: root, next: 0 }];
    path.set(root.id, 0);
    visited.add(root.id);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.next === frame.item.pendingInputs.length) {
        path.delete(frame.item.id);
        stack.pop();
        continue;
      }
      const id = frame.item.pendingInputs[frame.next++];
      const input = byId.get(id);
      if (!input?.runnable) continue;
      const start = path.get(id);
      if (start !== undefined) {
        return {
          ready: [],
          cycle: [...stack.slice(start).map(({ item }) => item.id), id],
        };
      }
      if (visited.has(id)) continue;
      visited.add(id);
      path.set(id, stack.length);
      stack.push({ item: input, next: 0 });
    }
  }
  return { ready: [], cycle: [] };
}

// These sequences share ONE adapter's publication clock (realm transaction
// generations on PostgreSQL; logical ticks in the lab). They are not input
// revision tokens or per-value versions and cannot be compared across scopes.
export interface LatticePublicationWindow {
  publishedAt: number;
  validatedThrough: number;
  kind: 'publish' | 'register' | 'retire';
  // The adapter proved complete output/code equality inside this publication.
  retainOutputAt?: number;
  // A stale attempt's publication (LatticeWorkClaim.stale): valid at its
  // input generation even though a newer obligation exists, which it keeps.
  stale?: true;
}

export interface LatticePublicationState {
  publishedAt: number;
  dirtyAt: number | null;
}

export type LatticePublicationDecision =
  | { status: 'publish' }
  | {
      status: 'reject';
      reason:
        | 'invalid-window'
        | 'newer-publication'
        | 'newer-input'
        | 'invalid-retention';
    };

export function latticePublicationDecision(
  window: LatticePublicationWindow,
  previous?: LatticePublicationState,
): LatticePublicationDecision {
  if (
    !Number.isSafeInteger(window.publishedAt) ||
    window.publishedAt < 1 ||
    !Number.isSafeInteger(window.validatedThrough) ||
    window.validatedThrough < 0 ||
    window.validatedThrough > window.publishedAt
  ) {
    return { status: 'reject', reason: 'invalid-window' };
  }
  if (previous && previous.publishedAt > window.publishedAt)
    return { status: 'reject', reason: 'newer-publication' };
  if (
    window.kind === 'publish' &&
    !window.stale &&
    previous?.dirtyAt != null &&
    previous.dirtyAt > window.validatedThrough
  ) {
    return { status: 'reject', reason: 'newer-input' };
  }
  if (
    window.retainOutputAt !== undefined &&
    (window.kind !== 'publish' ||
      !previous ||
      window.retainOutputAt !== previous.publishedAt ||
      !Number.isSafeInteger(window.retainOutputAt) ||
      window.retainOutputAt < 1)
  )
    return { status: 'reject', reason: 'invalid-retention' };
  // Registration records an obligation; retirement removes it. Neither
  // operation claims that an uncomputed value is current.
  return { status: 'publish' };
}
