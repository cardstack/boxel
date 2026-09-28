import type { CompiledOperationGrant, CompiledPolicyRule } from './policy.ts';
import type { OperationFailure } from './types.ts';

// ============================================================================
// What the policy gate did on the way to one decision.
//
// The gate decides and says nothing about how: a refusal is written to carry
// nothing, and an admission carries only the grant that admitted it. An
// explain has to report the rest, and reporting it from anything but the gate
// itself would be a second implementation of the gate that could drift from
// the first. So the gate records into a trace when the operation scope it is
// handed carries one, at the points where it decides, and an explain reads the
// trace back. Only an explain makes a scope that carries one, so every other
// invocation records nothing and pays nothing for it.
// ============================================================================

// Why the gate refused, where it refused before any predicate said so.
export type GateTraceRefusal =
  // An operation no policy may grant: declared `nonGrantable` on the target's
  // type or one it descends from, or a behavior no grant reaches here.
  | 'non-grantable'
  // A write to the realm's policy card or to its config card.
  | 'authorization-infrastructure'
  // The target has no row the gate can match a rule against: no index row,
  // an error row, or a target that is not a card.
  | 'unindexed-target'
  // No rule governing the target's type has a grant for the operation.
  | 'no-grant';

// What a predicate said when the gate evaluated it.
export type GateTraceOutcome = 'held' | 'did-not-hold' | 'threw';

export class GateTrace {
  // Every rule whose type is in the target's adoption chain, in policy order,
  // each with the grants in it that name the operation.
  readonly rules: {
    rule: CompiledPolicyRule;
    grants: CompiledOperationGrant[];
  }[] = [];
  readonly outcomes = new Map<CompiledOperationGrant, GateTraceOutcome>();
  refusal: GateTraceRefusal | undefined;
  // How resolving the operation refused, before the gate was reached: no such
  // operation on the target's type, one its type does not carry, or one that
  // did not lower. A caller the ACL declined outright is told the gate's
  // refusal instead, so this is the only place the reason survives.
  resolutionFailure: OperationFailure | undefined;

  resolutionRefused(failure: OperationFailure) {
    this.resolutionFailure ??= failure;
  }

  ruleMatched(rule: CompiledPolicyRule, grants: CompiledOperationGrant[]) {
    this.rules.push({ rule, grants });
  }

  evaluated(grant: CompiledOperationGrant, outcome: GateTraceOutcome) {
    this.outcomes.set(grant, outcome);
  }

  // The first refusal is the one the gate acted on. A later one would be a
  // path the gate did not reach.
  refused(refusal: GateTraceRefusal) {
    this.refusal ??= refusal;
  }
}
