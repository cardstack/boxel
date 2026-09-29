import { urlNamesFile } from '../file-def-code-ref.ts';
import {
  canonicalizeTarget,
  instanceTargetURL,
  localPathFor,
  newOperationScope,
  resolveGatedOperation,
  resolveOperation,
  scopeCallerFor,
  type CoarseDeclined,
  type OperationCore,
  type ScopeCaller,
} from './dispatch.ts';
import { GateTrace } from './gate-trace.ts';
import {
  namesPolicyCard,
  pendingWriteHolds,
  type GateDecision,
  type MatchedGrant,
} from './gate.ts';
import {
  OperationFailure,
  isDefinitionFreeBaseOperation,
  isOperationFailure,
  isWrite,
  refusalForNonReader,
  type ExplainedGrantOutcome,
  type ExplainedRule,
  type OperationError,
  type OperationExplainResult,
  type OperationRequest,
  type OperationTarget,
  type PolicyExplanation,
  type PolicyExplanationReason,
} from './types.ts';

// ============================================================================
// The explain operation.
//
// A realm owner cannot tell whether a policy works by watching it not fail. A
// policy narrower than its author meant produces refusals that someone has to
// report, and one wider than they meant produces nothing at all. An explain
// answers the question directly: given an actor, a target and an operation, it
// runs the target realm's policy gate the way that invocation would, stops at
// the decision, and reports how the gate reached it.
//
// It is an operation on the policy card, invoked like any other, so it rides
// both transports and the gate that guards every operation. The target is
// commonly in another realm: the worked example keeps a school's policy card in
// its Org realm and the classrooms it governs in its Education realm. So the
// explain runs in the policy card's realm and asks the gate of the realm that
// holds the target, which has to name this card as its policy. A card that a
// realm does not name governs nothing there, and has nothing to explain.
//
// What an explain answers is exactly what a refusal withholds. A caller the
// target realm's ACL does not let read that realm is told a card they may not
// touch is not there, so that they cannot learn which cards exist, and an
// explain would tell them otherwise. So the caller asking must be able to read
// both realms: the policy card's, which the gate checks, since no grant ever
// reaches an explain, and the target's, which this checks. A caller missing
// either is told what a target that does not exist is told, the same bytes
// either way. That also means there is no asking about yourself: a caller
// refused an operation cannot ask why, since the answer would say what the
// refusal did not. The caller is judged in the target's realm by a session
// that realm would accept as theirs, so a revoked session, or one delegated to
// the policy card's realm alone, asks as nobody.
//
// Read on both realms is the whole gate, not realm ownership. So a reader of
// both learns, for any actor they name, what the target realm's ACL allows
// that actor, which the realm's permissions listing tells only its owners.
// That is the first half of the question an explain answers.
//
// Nothing here decides. The decision is `resolveGatedOperation`'s, reached
// through the same code the invocation runs, with a trace attached to the
// scope for the gate to record into. A write whose grants all carry a
// predicate is decided under the write lock when it runs, and this answers it
// the way `pendingWriteHolds` does: against the card as it is stored now.
// ============================================================================

// The realm a target belongs to, as an explain reaches it.
export interface TargetRealm {
  // Where the target the explain was asked about resolves, in this realm.
  url: URL;
  // The realm's operation core, whose policy gate the explain runs.
  core: OperationCore;
  // What the realm's ACL allows this caller, read from the permissions a
  // request from them is checked against. Read and write are kept apart
  // because a request is judged on one of them: the one its method needs.
  aclFor(caller: ScopeCaller): Promise<Acl>;
}

interface Acl {
  read: boolean;
  write: boolean;
}

// The question, as the payload carries it.
interface Question {
  // Empty for a caller who presents no credentials.
  actor: string;
  target: string;
  operation: string;
}

export async function explainOperation(
  core: OperationCore,
  request: OperationRequest,
): Promise<OperationExplainResult> {
  let policyCard = instanceTargetURL(request);
  let question = questionIn(request);
  // The caller is judged in the target's realm as that realm would judge
  // them: by a session vouched for as their own, never by an identity
  // another realm merely recorded. A request with no such session is judged
  // as nobody.
  let asker = scopeCallerFor(request.principal ?? '');
  let realm = await core.targetRealm?.(question.target);
  // Whether the target's realm is served here, whether the caller may read
  // it, and whether the target is there are all answered as a missing target
  // is, before anything else about the target is read.
  if (!realm || !(await realm.aclFor(asker)).read) {
    throw noSuchTarget();
  }
  let target: OperationTarget = canonicalizeTarget(
    realm.core,
    { kind: 'instance', url: realm.url.href },
    { rootNamesIndexCard: !isDefinitionFreeBaseOperation(question.operation) },
  );
  if (target.kind !== 'instance' || !(await exists(realm.core, target))) {
    throw noSuchTarget();
  }
  if (
    !realm.core.policy ||
    !(await namesPolicyCard(realm.core.policy, policyCard))
  ) {
    throw new OperationFailure({
      id: policyCard.href,
      status: 422,
      code: 'policy-not-in-force',
      title: 'Policy not in force',
      detail:
        `${target.url} is in a realm whose policy is not ` +
        `${policyCard.href}, so that card decides nothing about it`,
    });
  }
  let actor = scopeCallerFor(question.actor);
  let acl = await realm.aclFor(actor);
  let explanation = await explain(realm.core, target, question, actor, acl);
  return { explanation };
}

// The gate's decision for the question, and how it got there.
async function explain(
  core: OperationCore,
  target: OperationTarget & { kind: 'instance' },
  question: Question,
  actor: ScopeCaller,
  acl: Acl,
): Promise<PolicyExplanation> {
  let base: PolicyExplanation = {
    actor: actor.kind === 'user' ? actor.actor : null,
    target: target.url,
    operation: question.operation,
    acl,
    decision: 'denied',
    reason: 'acl',
    rules: [],
  };
  let coarseDeclined = await coarseDeclinedFor(
    core,
    target,
    question,
    actor,
    acl,
  );
  // A realm that names a policy answers a caller who presented no credentials
  // with a 401 before the request is routed, for every request its ACL
  // declines them, so nothing about the target is read.
  if (actor.kind !== 'user' && coarseDeclined !== 'none') {
    return refused(base, 'actor-required', {
      status: 401,
      code: 'actor-required',
    });
  }
  let trace = new GateTrace();
  let scope = newOperationScope(core, {
    caller: actor,
    coarseDeclined,
    trace,
  });
  let decision: GateDecision | undefined;
  let failure: OperationFailure | undefined;
  try {
    ({ decision } = await resolveGatedOperation(
      core,
      target,
      question.operation,
      scope,
    ));
  } catch (e: unknown) {
    if (!isOperationFailure(e)) {
      throw e;
    }
    failure = e;
  }
  if (failure || !decision) {
    let error = failure?.error ?? {
      status: 500,
      code: 'internal-error' as const,
      title: '',
      detail: '',
    };
    // The gate found no row for the target. It had one when this began, so
    // it went while this ran, and is told of as any missing target is.
    if (!trace.resolutionFailure && error.code === 'target-not-found') {
      throw noSuchTarget();
    }
    return withRules(
      refused(
        base,
        refusalReason(trace, error.status),
        seenBy(coarseDeclined, error),
        error.status >= 500 ? 'failed' : 'denied',
      ),
      trace,
    );
  }
  if (decision.kind === 'coarse') {
    return { ...base, decision: 'allowed', reason: 'acl' };
  }
  let admitting: MatchedGrant | undefined;
  if (decision.kind === 'granted') {
    admitting = decision.grant;
  } else {
    let holds = await pendingWriteHolds(core, {
      target,
      name: question.operation,
      decision,
      scope,
    });
    if (holds) {
      admitting = decision.grants.find(
        ({ grant }) => trace.outcomes.get(grant) === 'held',
      );
    }
  }
  let explained = withRules(base, trace);
  if (!admitting) {
    // A pending write refused under the lock is refused as the gate refuses:
    // a 500 where a predicate threw and none held, and otherwise the gate's
    // own refusal.
    let threw = [...trace.outcomes.values()].includes('threw');
    let refusal: OperationError = threw
      ? { status: 500, code: 'internal-error', title: '', detail: '' }
      : { status: 403, code: 'operation-not-permitted', title: '', detail: '' };
    return refused(
      explained,
      refusalReason(trace, refusal.status),
      seenBy(coarseDeclined, refusal),
      threw ? 'failed' : 'denied',
    );
  }
  return {
    ...explained,
    decision: 'allowed',
    reason: 'granted',
    ...admittedBy(explained, trace, admitting),
  };
}

// What the realm's ACL declines for the request that would carry this
// invocation. A write travels on a `POST`, which the ACL judges as a write, and
// everything else on a request it judges as a read. So a caller the ACL lets
// write and not read is allowed a write and declined a read, and which one
// this is follows from the behavior the operation resolves to. That is
// resolved first, as a caller the ACL allows would resolve it. An operation
// that does not resolve travels as a read would.
async function coarseDeclinedFor(
  core: OperationCore,
  target: OperationTarget,
  question: Question,
  actor: ScopeCaller,
  acl: Acl,
): Promise<CoarseDeclined> {
  let writes = false;
  try {
    let { base } = await resolveOperation(
      core,
      target,
      question.operation,
      newOperationScope(core, { caller: actor, coarseDeclined: 'none' }),
    );
    writes = isWrite(base);
  } catch {
    writes = false;
  }
  if (writes ? acl.write : acl.read) {
    return 'none';
  }
  return acl.read ? 'writes' : 'all';
}

function refused(
  explanation: PolicyExplanation,
  reason: PolicyExplanationReason,
  refusal: { status: number; code: OperationError['code'] },
  decision: 'denied' | 'failed' = 'denied',
): PolicyExplanation {
  return { ...explanation, decision, reason, refusal };
}

// The refusal as the actor would receive it. A caller who may not read the
// realm is told that a card they were refused is not there.
function seenBy(
  coarseDeclined: CoarseDeclined,
  error: OperationError,
): { status: number; code: OperationError['code'] } {
  let seen = coarseDeclined === 'all' ? refusalForNonReader(error) : error;
  return { status: seen.status, code: seen.code };
}

// Why the gate refused, in the terms an explanation reports.
function refusalReason(
  trace: GateTrace,
  status: number,
): PolicyExplanationReason {
  if (trace.resolutionFailure) {
    return 'not-resolved';
  }
  if (status >= 500) {
    return [...trace.outcomes.values()].includes('threw')
      ? 'predicate-threw'
      : 'policy-unloadable';
  }
  switch (trace.refusal) {
    case 'non-grantable':
      return 'non-grantable';
    case 'authorization-infrastructure':
      return 'authorization-infrastructure';
    case 'unmatchable-target':
      return 'unmatchable-target';
    case 'no-grant':
      return 'no-grant';
    default:
      return trace.rules.some(({ grants }) => grants.length > 0)
        ? 'predicate-false'
        : 'no-grant';
  }
}

// The rules the gate matched, each with its grants for the operation and what
// each grant's predicate said.
function withRules(
  explanation: PolicyExplanation,
  trace: GateTrace,
): PolicyExplanation {
  let rules: ExplainedRule[] = trace.rules.map(({ rule, grants }) => ({
    targetType: { module: rule.targetType.module, name: rule.targetType.name },
    grants: grants.map((grant) => ({
      ...(grant.where
        ? {
            where: grant.where.source,
            tier: grant.where.snapshot ? 'snapshot' : 'stored',
          }
        : {}),
      outcome: grantOutcome(trace, grant),
    })),
  }));
  return { ...explanation, rules };
}

function grantOutcome(
  trace: GateTrace,
  grant: MatchedGrant['grant'],
): ExplainedGrantOutcome {
  if (!grant.where) {
    return 'unconditional';
  }
  return trace.outcomes.get(grant) ?? 'not-evaluated';
}

// Where the admitting grant sits in the explanation's own rules.
function admittedBy(
  explanation: PolicyExplanation,
  trace: GateTrace,
  { rule, grant }: MatchedGrant,
): Pick<PolicyExplanation, 'admittedBy'> {
  let ruleIndex = trace.rules.findIndex((matched) => matched.rule === rule);
  let grantIndex =
    ruleIndex === -1 ? -1 : trace.rules[ruleIndex].grants.indexOf(grant);
  return ruleIndex === -1 || grantIndex === -1 || !explanation.rules[ruleIndex]
    ? {}
    : { admittedBy: { rule: ruleIndex, grant: grantIndex } };
}

// Whether the target is there to explain. A card is there when the index
// holds a row for it, a row recording that it failed to index included: that
// card exists, and the gate refuses it for the row it has. A file is there when
// its bytes are.
async function exists(
  core: OperationCore,
  target: OperationTarget & { kind: 'instance' },
): Promise<boolean> {
  let url = new URL(target.url);
  if (urlNamesFile(url)) {
    try {
      return (await core.openStoredFile(localPathFor(core, url))) !== undefined;
    } catch {
      return false;
    }
  }
  let row = await core.indexQueryEngine.instance(url, { includeErrors: true });
  return row !== undefined;
}

// What a caller is told of a target they may not be told about: the answer a
// caller who may not read a realm gets for a card that is not there, which is
// also what they get for one that is and that they were refused.
function noSuchTarget(): OperationFailure {
  return new OperationFailure(
    refusalForNonReader({
      status: 404,
      code: 'target-not-found',
      title: 'Not found',
      detail: '',
    }),
  );
}

function questionIn(request: OperationRequest): Question {
  let params = request.params ?? {};
  let invalid = (detail: string) =>
    new OperationFailure({
      ...(request.target.kind === 'instance' ? { id: request.target.url } : {}),
      status: 400,
      code: 'invalid-params',
      title: 'Invalid params',
      detail,
    });
  let { actor, target, operation } = params as Record<string, unknown>;
  if (actor !== undefined && actor !== null && typeof actor !== 'string') {
    throw invalid(
      `operation "${request.name}" explains a decision for \`actor\`, a user id, or an empty string for a caller who presents no credentials`,
    );
  }
  if (typeof target !== 'string' || target.length === 0) {
    throw invalid(
      `operation "${request.name}" explains a decision about \`target\`, the URL of a card or file`,
    );
  }
  if (typeof operation !== 'string' || operation.length === 0) {
    throw invalid(
      `operation "${request.name}" explains a decision about \`operation\`, the name an invocation would invoke`,
    );
  }
  return { actor: actor ?? '', target, operation };
}
