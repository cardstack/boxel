import type { ResolvedCodeRef } from '../code-ref.ts';
import type { OperationErrorCode } from './types.ts';

// ============================================================================
// What a capability check says on the wire.
//
// Kept apart from the check itself so both ends can read it. The decision runs
// in the realm and reaches the operation core (and through it bxl); a card
// module asking `@context.canInvoke` only ever holds these shapes, and has to
// be able to import them from the barrel without taking that typecheck program
// on.
// ============================================================================

// The most pairs one request may carry. A fixed part of the contract rather
// than a deployment knob, because an uncapped check is an enumeration
// primitive and a caller has to be able to know where the boundary is.
//
// Sized off what a view asks: a default search page holds 100 cards, and a
// template gating a handful of controls on each of them coalesces into one
// request under this ceiling. A view larger than that sends more than one,
// which is the client's business and costs the realm nothing extra — the work
// is bounded per request either way, which is the point of the cap.
export const CAPABILITY_CHECK_CAP = 100;

// One question: may this caller invoke this operation on this target?
//
// A target names either a stored card, by URL, or a type, by code ref — the
// second being what a "New Classroom" button asks about, where the card it
// would create does not exist yet.
export interface CapabilityCheck {
  target: string | ResolvedCodeRef;
  operation: string;
}

// One answer, in the position its question was asked in.
export interface CapabilityAnswer {
  // Echoed from the question, so an answer read on its own says what it is
  // about and a client that reorders its own list cannot misread one.
  operation: string;
  target: string | ResolvedCodeRef;
  // Whether the gate would admit the invocation. For a caller who may not read
  // the realm this is the whole answer.
  allowed: boolean;
  // Set where a grant matched but its predicate has still to run against
  // something this check does not hold: the document a create would stage, or
  // the state a write's predicate is judged against under the write lock. The
  // control is worth rendering and the call may still be refused.
  conditional?: true;
  // Why the gate refused, as the code the invocation itself would carry.
  // Withheld from a caller who may not read the realm, for whom every refusal
  // reads the same.
  reason?: OperationErrorCode;
}
