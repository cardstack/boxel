import type { LatticeWorkClaim, LatticeWorkReason } from './lattice-kernel.ts';

// Internal scheduling outcome. It must not become a persisted card error or
// spend a computation-failure retry. Publication fences remain mandatory.
export interface LatticeReadScope {
  realmURL: string;
  actor: string;
}

// Internal receipt for selected work. Never supplied by authored card JSON or
// a browser request, and never a replacement for the adapter's queue lease.
export interface LatticeScheduledWork extends LatticeReadScope {
  claim: LatticeWorkClaim;
  inputGeneration: number;
  definitionRevision: string;
  // Existing file-owned code work version, independent of the realm epoch.
  codeVersion?: string;
  // Present for a durable queue attempt. The PostgreSQL adapter owns this
  // lease; the portable kernel's obligation is a separate computation fact.
  reservation?: { jobId: number; reservationId: number };
}

export const latticeWorkReasons: Record<LatticeWorkReason, string> = {
  'authority-changed': 'read authority changed',
  'source-pending': 'new source work has priority',
  'owner-retired': 'owner retired or removed',
  'already-satisfied': 'owner is already satisfied',
  'inputs-changed': 'input or module revision changed',
  'code-changed': 'input or module revision changed',
  'obligation-changed': 'a newer owner obligation exists',
};

export class LatticeWorkSuperseded extends Error {
  readonly reason: string;
  readonly waitForRead?: LatticeReadScope;
  constructor(reason: string, waitForRead?: LatticeReadScope) {
    super(`Lattice work superseded: ${reason}`);
    this.name = 'LatticeWorkSuperseded';
    this.reason = reason;
    this.waitForRead = waitForRead;
  }
}

// An input has no usable publication yet. Defer only its consumer; other
// independent owners in the wave can publish, without spending a retry.
export class LatticeInputsPending extends LatticeWorkSuperseded {}

export interface LatticeWorkScope {
  signal: AbortSignal;
  close(): Promise<void>;
}

// Computation failure already recorded with a guarded durable successor.
// Infrastructure/publication errors retain the existing job-level retry path.
export class LatticeWorkFailed extends Error {}
