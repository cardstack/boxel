import type { ResolvedCodeRef } from '../code-ref.ts';
import type { OperationErrorCode } from './types.ts';

// ============================================================================
// What a capability check says on the wire.
//
// Kept apart from the check itself so both ends can read it. The decision runs
// in the realm and reaches the operation core (and through it bxl); a card
// module asking `@context.canInvoke` or `@context.keyReadiness` only ever holds
// these shapes, and has to
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
//
// A pair that also asks for `readiness` is asked whether the call would get
// the credentials it sends, and what would fix it if not (`KeyReadiness`).
export interface CapabilityCheck {
  target: string | ResolvedCodeRef;
  operation: string;
  readiness?: true;
}

// Whether a `callApi` would have the credentials it sends when this caller
// invokes it from a card, and if not, what would fix it. It names what to show
// rather than why: a reader is never told who owns a share, a budget or the
// names of a realm's shares, so none of those is in an answer.
//
// - `ready`: every slot would be filled. An operation that sends no key, or
//   that is not a `callApi`, is ready as far as keys go.
// - `needs-connect`: a `{{userKey}}` slot has no approval, and none of the
//   caller's keys has a grant covering the operation's destination.
// - `needs-approval`: the caller has a key that could fill it, but the
//   operation isn't approved here, or not for interactive use.
// - `needs-reapproval`: what the operation sends changed since it was
//   approved.
// - `needs-admin`: a slot the realm fills from a share has no share approved
//   for it, or one that is suspended or not approved for this use, and the
//   caller isn't the one who could approve it.
// - `needs-sign-in`: the caller isn't signed in, and a slot takes their own
//   key.
// - `rate-limited`, `over-budget`, `credential-rejected`: the caller's limit,
//   the share's budget, or the vendor refusing the key.
export type KeyReadiness =
  | 'ready'
  | 'needs-connect'
  | 'needs-approval'
  | 'needs-reapproval'
  | 'needs-admin'
  | 'needs-sign-in'
  | 'rate-limited'
  | 'over-budget'
  | 'credential-rejected';

// One answer, in the position its question was asked in.
export interface CapabilityAnswer {
  // Echoed from the question, so an answer read on its own says what it is
  // about and a client that reorders its own list cannot misread one.
  operation: string;
  target: string | ResolvedCodeRef;
  // Whether the gate would admit the invocation. For a caller who may not read
  // the realm this is the whole answer.
  allowed: boolean;
  // Set where a grant matched but its predicate has still to run against a
  // document this check does not hold: the card a create against a type would
  // mint. The control is worth rendering and the call may still be refused.
  // Never set for a stored card, whose predicate is judged against the card as
  // it is stored now. Never set for a caller who may not read the realm, who
  // is told `allowed` alone.
  conditional?: true;
  // Why the gate refused, as the code the invocation itself would carry.
  // Withheld from a caller who may not read the realm, for whom every refusal
  // reads the same.
  reason?: OperationErrorCode;
  // For a pair that asked for it, where `allowed` is true: a caller the realm
  // won't let invoke the operation has no credentials to be ready with. The
  // one refusal that carries it is `actor-required` to a caller who may read
  // the realm, since signing in is what would fix it, and what they would
  // need after that is what the card shows. Absent where the realm can't
  // tell, such as one that sends no request to an outside service.
  readiness?: KeyReadiness;
}
