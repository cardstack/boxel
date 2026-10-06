import type { CodeRef, ResolvedCodeRef } from '../code-ref.ts';
import { rri } from '../realm-identifiers.ts';
import {
  CAPABILITY_CHECK_CAP,
  type CapabilityAnswer,
  type CapabilityCheck,
} from './capability-wire.ts';
import { settledWithin, STAGING_WIDTH } from './coordinator.ts';
import {
  canonicalizeTarget,
  newOperationScope,
  resolveGatedOperation,
  type CoarseDeclined,
  type GatedOperation,
  type OperationCore,
  type OperationScope,
  type ScopeCaller,
} from './dispatch.ts';
import { GateTrace } from './gate-trace.ts';
import { storedWriteRefusal } from './gate.ts';
import { principalQueryScope, type SearchPrincipal } from './policy-query.ts';
import {
  OperationFailure,
  isOperationFailure,
  isWrite,
  type OperationErrorCode,
  type OperationTarget,
} from './types.ts';

// ============================================================================
// The capability check: what the gate would decide, asked ahead of the call.
//
// A permission framework that cannot drive a UI gets worked around, and the
// workaround is to render every control and let the refusal arrive after the
// click. So a caller may ask, for a bounded list of `{ target, operation }`
// pairs, whether the gate would admit each — and hide the controls it would
// not.
//
// Three things keep the answer honest.
//
// It is the gate's own decision, not a second reading of the policy. A check
// resolves the operation exactly as an invocation does and stops where the
// gate answers, so there is no parallel implementation to drift. What it
// cannot do is anything past that point: it never reaches the coordinator, so
// it stages nothing, takes no lock, enqueues no index job and broadcasts no
// event. That is a property of which function it calls rather than of a flag
// it sets, because a flag meaning "do not actually do it" is one refactor
// away from being dropped on a mutation.
//
// It is advisory, and nothing may treat it as authorization. The gate decides
// again at invocation, against the state as it is then — so a `true` here is
// what the answer was a moment ago, not a promise about the call. The data a
// predicate reads can change in between, which is the window every consumer of
// a permission lives with. Skipping the server check on the strength of one of
// these answers is always available and always wrong.
//
// It tells a caller nothing the realm would not otherwise tell them. A caller
// the realm ACL would not let read the realm gets a bare boolean: no reason,
// no rule, and the same answer for a card no grant admits as for a card that
// is not there — the rule the refusal table already holds, so a check cannot
// be turned into an oracle for which cards exist. A caller who may read the
// realm can list it anyway, so they are told why.
//
// A query is the one operation the gate does not decide. It is not invoked on
// a card: a search names it with the type that declares it, and the search
// authorizes it by composing into the query it runs the filter of each grant
// the caller holds on it (`policyQueryScope`). The gate refuses every query
// for that reason, and a check that stopped at the gate would call a query
// refused that the search serves. So a query pair is answered by the search's
// own judgment, the same call the search makes (`principalQueryScope`), and
// the check still has no reading of the policy of its own.
//
// That judgment is a weaker one than the gate's. A query grant does not admit
// or refuse a target, and it names no caller: its predicate narrows the rows
// the search returns by who is asking. So `true` for a query says the policy
// holds a grant on it for this type that compiled a search filter, and it is
// the same answer for every signed-in caller the ACL declines. It does not say
// any row will match for this one: a caller the filter matches nothing for is
// told `true` too, and their search returns no rows. Only a caller the ACL
// would not let read the realm is judged this way, since one who may read it
// runs the query unscoped. They are told a bare `true`, which reveals what a
// create's bare `true` does: that the policy grants this operation on this
// type. It says nothing about which cards exist.
//
// A query pair's target is that type. A card target names no search a query
// could run in, and is refused the way invoking the query on the card is.
// ============================================================================

// What the realm supplies about the caller for a whole request: who they are,
// and what the realm ACL declined them. One value covers every pair, because
// `CoarseDeclined` already distinguishes the read lane from the write lane —
// which is exactly what a request carrying both kinds of question needs.
export interface CapabilityCaller {
  caller: ScopeCaller;
  // Who a search this caller sent would run for. A query pair is judged as
  // that search is, so it is judged for the same principal: a request a
  // render sends runs under a realm's own authority, which no policy grants
  // anything.
  searchPrincipal: SearchPrincipal | undefined;
  coarseDeclined: CoarseDeclined;
  // Set where the realm ACL refuses this caller's writes in a way no policy
  // may judge: nobody signed in, a session that may only read, a realm that
  // names no policy. Such a write is refused before it is routed, so it never
  // reaches the gate, and neither does its pair here. The code is the one its
  // refusal comes closest to: `actor-required` for the 401 a caller who
  // authenticated nobody is given, `operation-not-permitted` for the 403.
  writesRefused?: 'actor-required' | 'operation-not-permitted';
}

// Answer every pair, in order.
//
// The pairs are decided on one scope, so the invocations of one request cost
// one read of each index row between them, and a pair sent twice is decided
// once. Bounded at the width staging is bounded at, and for the same reason:
// deciding a pair reads the target's index row, and how many pairs arrive is
// the caller's number — so resolving them all at once would put the whole
// request's reads on the pool together.
//
// No pair's answer is another's problem. A pair the realm cannot decide
// answers as itself, denied, and the request still answers every other one.
export async function checkCapabilities(
  core: OperationCore,
  checks: readonly CapabilityCheck[],
  who: CapabilityCaller,
): Promise<CapabilityOutcome> {
  let scope = newOperationScope(core, {
    caller: who.caller,
    advisory: true,
    // A caller who may read the realm and whose writes are refused outright
    // has nothing for the policy to decide: their reads are the ACL's, and
    // their writes are refused below whatever a grant says. So the gate is not
    // asked about either, and no policy is loaded for them.
    coarseDeclined:
      who.writesRefused && who.coarseDeclined === 'writes'
        ? 'none'
        : who.coarseDeclined,
  });
  let distinct = new Map<string, CapabilityCheck>();
  let keys = checks.map((check) => {
    let key = `${check.operation}\u0000${targetKey(check.target)}`;
    if (!distinct.has(key)) {
      distinct.set(key, check);
    }
    return key;
  });
  let asked = [...distinct];
  let outcomes = await settledWithin(STAGING_WIDTH, asked, ([, check]) =>
    decide(core, check, who, scope),
  );
  let decided = new Map<string, PairDecision>();
  asked.forEach(([key], index) => {
    let outcome = outcomes[index];
    decided.set(
      key,
      outcome.status === 'fulfilled'
        ? outcome.value
        : // `decide` answers its own faults, so a rejection here is the check
          // itself failing rather than the gate refusing. Denied, like every
          // other way a decision cannot be reached.
          { answer: { allowed: false }, admitted: false },
    );
  });
  return {
    // The echo comes from the question this position asked, so two spellings
    // of one target each answer in their own terms.
    answers: checks.map((check, index) => ({
      ...decided.get(keys[index])!.answer,
      operation: check.operation,
      target: check.target,
    })),
    admitsAny: [...decided.values()].some(({ admitted }) => admitted),
  };
}

// What a check answers, and whether the gate admitted any of its pairs
// outright. A pair answered `true` on a predicate the check could not run is
// not one it admitted: whether that grant would admit the caller is not known
// until the call.
export interface CapabilityOutcome {
  answers: CapabilityAnswer[];
  admitsAny: boolean;
}

// One answer without the question echoed back onto it, which is what the
// positions do.
type CapabilityDecision = Omit<CapabilityAnswer, 'operation' | 'target'>;

// One pair's answer, and whether the gate admitted the pair outright rather
// than leaving it to a predicate the check cannot run.
interface PairDecision {
  answer: CapabilityDecision;
  admitted: boolean;
}

async function decide(
  core: OperationCore,
  check: CapabilityCheck,
  who: CapabilityCaller,
  scope: OperationScope,
): Promise<PairDecision> {
  // A non-reader is told one thing however the answer was reached, so the
  // reason is dropped rather than computed and discarded — and `conditional`
  // with it, since that would say a grant names the target's type.
  let bare = who.coarseDeclined === 'all';
  let refused = (reason: OperationErrorCode): PairDecision => ({
    answer: bare ? { allowed: false } : { allowed: false, reason },
    admitted: false,
  });
  let admitted: PairDecision = { answer: { allowed: true }, admitted: true };
  try {
    let target = targetFor(core, check.target);
    // A caller the ACL lets read the realm runs a query unscoped, and the gate
    // answers them from the ACL. Anyone else's query the gate refuses, and
    // records why in the trace a scope carries, so the pair is asked of the
    // search instead. That is the gate's own word for why it refused, read
    // off the resolution the pair makes anyway.
    let trace = bare ? new GateTrace() : undefined;
    let gated: GatedOperation;
    try {
      gated = await resolveGatedOperation(
        core,
        target,
        check.operation,
        trace ? scope.derive({ trace }) : scope,
      );
    } catch (e: unknown) {
      if (trace?.refusal !== 'query-lane') {
        throw e;
      }
      return target.kind === 'type'
        ? await searchDecision(core, target.codeRef, check.operation, who)
        : refused('wrong-entry-point');
    }
    let { definition, decision } = gated;
    if (definition.base === 'query' && target.kind === 'instance') {
      return refused('wrong-entry-point');
    }
    if (who.writesRefused && isWrite(definition.base)) {
      return refused(who.writesRefused);
    }
    if (decision.kind !== 'pending') {
      return admitted;
    }
    // A write the gate matched a grant for and left to its predicate. The
    // write lock decides it against the card as the lock holds it, and a
    // check holds no lock, so it asks the same question of the card as it is
    // stored now: the answer the lock would give if nothing changes before the
    // call takes it. A refusal is reported in the lock's own words, so a
    // reader is told a predicate that threw as the fault the invocation
    // answers, not as a refusal.
    if (target.kind === 'instance') {
      let refusal = await storedWriteRefusal(core, {
        target,
        name: check.operation,
        decision,
        scope,
      });
      return refusal ? refused(refusal.error.code) : admitted;
    }
    // A create against a type is judged by the card it would mint, which does
    // not exist while the control that would mint it is being rendered. So
    // the most the check can say is that a grant matched and its predicate is
    // still to run. A non-reader is told that as `true`: the control is worth
    // showing, and what it reveals — that the realm's policy grants creates
    // of this type — is what the create itself would reveal, and is no answer
    // about which cards exist.
    return {
      answer: bare ? { allowed: true } : { allowed: true, conditional: true },
      admitted: false,
    };
  } catch (e: unknown) {
    // Anything that is not a refusal is a fault rather than an answer, and the
    // check fails closed on it — one pair the realm could not decide, reported
    // as itself, rather than a request the caller cannot read at all.
    return refused(isOperationFailure(e) ? e.error.code : 'internal-error');
  }
}

// A query pair, answered as the search that runs the query would authorize it:
// `true` where the realm's policy composes a grant into it, `false` where the
// realm contributes no rows. It is never counted as admitted. Whether an
// archived realm answers such a search with its seal turns on whether the
// search would return a row, and a check runs no search to know.
async function searchDecision(
  core: OperationCore,
  on: CodeRef,
  operation: string,
  who: CapabilityCaller,
): Promise<PairDecision> {
  let scope = await principalQueryScope(
    core,
    { operation, types: [on], advisory: true },
    who.searchPrincipal,
  );
  return {
    answer: { allowed: scope.kind === 'scoped' },
    admitted: false,
  };
}

// The target as resolution reads it. An instance is canonicalized first, the
// same way and in the same place an envelope entry is, so a trailing slash or
// a query string names the card it hangs off here exactly as it does on the
// call this check is asked ahead of.
function targetFor(
  core: OperationCore,
  target: string | ResolvedCodeRef,
): OperationTarget {
  return typeof target === 'string'
    ? canonicalizeTarget(core, { kind: 'instance', url: target })
    : { kind: 'type', codeRef: target, realm: core.realmURL };
}

function targetKey(target: string | ResolvedCodeRef): string {
  return typeof target === 'string'
    ? target
    : `${target.module}\u0000${target.name}`;
}

// The request body, read into the pairs the check answers.
//
// Refused as a whole where the body is not a list of pairs or carries more
// than the cap. Neither is one pair's problem: a caller that sent a malformed
// list gets to see that rather than a list of denials, and a caller over the
// cap has to send fewer rather than have the tail silently dropped — a
// truncated answer would read as "these are all denied" to the view driving
// off it.
export function parseCapabilityChecks(body: unknown): CapabilityCheck[] {
  let checks = (body as { checks?: unknown } | null)?.checks;
  if (!Array.isArray(checks)) {
    throw invalidCapabilityRequest(
      `a capability check carries its pairs as "checks", an array of ` +
        `{ target, operation }`,
    );
  }
  if (checks.length > CAPABILITY_CHECK_CAP) {
    throw invalidCapabilityRequest(
      `a capability check carries at most ${CAPABILITY_CHECK_CAP} pairs, ` +
        `and this one carries ${checks.length}`,
    );
  }
  return checks.map((check, index) => parseCheck(check, index));
}

function parseCheck(check: unknown, index: number): CapabilityCheck {
  let { target, operation } = (check ?? {}) as {
    target?: unknown;
    operation?: unknown;
  };
  if (typeof operation !== 'string' || !operation) {
    throw invalidCapabilityRequest(
      `pair ${index} names no operation; each pair carries an operation name`,
    );
  }
  if (typeof target === 'string' && target) {
    return { target, operation };
  }
  let { module, name } = (target ?? {}) as { module?: unknown; name?: unknown };
  if (
    typeof module === 'string' &&
    module &&
    typeof name === 'string' &&
    name
  ) {
    return { target: { module: rri(module), name }, operation };
  }
  throw invalidCapabilityRequest(
    `pair ${index} names no target; a target is a card's URL or a type's ` +
      `{ module, name }`,
  );
}

function invalidCapabilityRequest(detail: string): OperationFailure {
  return new OperationFailure({
    status: 400,
    code: 'invalid-params',
    title: 'Invalid capability check',
    detail,
  });
}
