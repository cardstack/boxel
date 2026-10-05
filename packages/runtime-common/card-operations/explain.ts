import { isCodeRef } from '../card-document-shape.ts';
import type { CodeRef } from '../code-ref.ts';
import { urlNamesFile } from '../file-def-code-ref.ts';
import { ensureTrailingSlash } from '../paths.ts';
import { runWithSearchTimeBudget, SearchBoundError } from '../search-bounds.ts';
import {
  parseSearchEntryQueryFromPayload,
  wireFilterFromFilter,
  type SearchEntryWireFilter,
  type SearchEntryWireQuery,
} from '../search-entry.ts';
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
  GATE_FAULTED,
  GATE_REFUSED,
  gateRefusal,
  matchingGrants,
  namesPolicyCard,
  pendingWriteHolds,
  type GateDecision,
  type MatchedGrant,
} from './gate.ts';
import { resolveNamedQuery, searchInvocation } from './named-query.ts';
import type { CompiledRealmPolicy } from './policy.ts';
import { policyQueryScope, type PolicyQueryScope } from './policy-query.ts';
import type { PolicyRoute } from './telemetry.ts';
import {
  EXPLAIN_CAP,
  OperationFailure,
  isDefinitionFreeBaseOperation,
  isOperationFailure,
  isWrite,
  refusalForNonReader,
  type ExplainedGrantOutcome,
  type ExplainedIndexLag,
  type ExplainedRule,
  type ExplainedSearch,
  type OperationError,
  type OperationExplainListingResult,
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
// either way. So a caller refused because they may not read the target's
// realm cannot ask why, since the answer would say what the refusal did not.
// A caller who reads both realms can ask about any actor, themselves
// included. The caller is judged in the target's realm by a session that
// realm would accept as theirs, so a revoked session, or one delegated to the
// policy card's realm alone, asks as nobody.
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
//
// Three further forms answer what a single triple against the policy in force
// cannot.
//
// A draft. An administrator about to widen a rule wants to know what the
// widening would do before it is live. The question may carry a policy
// document, which the target's realm compiles as it would compile the card its
// key names were the card to hold it, and the gate answers against that
// instead. The draft rides the explain of the card in force, so the card that
// has something to explain is still the one the realm names, and the draft is
// read on exactly the authority the live form is. It is compiled for this
// answer alone: no cache holds it, and the policy in force is untouched. A
// draft names its own types, and they resolve as the live policy's do,
// through the target realm's definition lookup, which reads a module in any
// realm this server serves as that realm's owner. What compiling records
// describes those types, down to which of their fields a search filter can
// read, so a draft is answered only to a caller who may read every such realm
// compiling read from.
//
// A search. A search is not decided by the gate: the search engine composes
// the grants that admit it into its filter, and it reads the index, so it is
// only as fresh as the index. Answering one with the gate's decision would say
// nothing true about it. So a question about a search is answered from the
// search lane itself: the fragment `policyQueryScope` composes, which is what
// `_search` composes for the same caller, and how far behind its source the
// index the search reads is.
//
// A listing. Who can read a card is every actor, and what an actor can reach
// is every card, so the default shape stays a single triple and the listing is
// bounded: one page of the target realm's cards, each explained as its own
// triple. A request explains at most `EXPLAIN_CAP` triples, a listing's page
// and a batch's explain entries alike, so no number of entries lifts the
// bound.
// ============================================================================

// The realm a target belongs to, as an explain reaches it. It is found without
// being mounted, so what the explain asks of it first, whether its caller may
// read it, is answered before the server pays to mount a realm the caller may
// be told nothing about.
export interface TargetRealm {
  // Where the target the explain was asked about resolves, in this realm.
  url: URL;
  // What the realm's ACL allows this caller, read from the permissions a
  // request from them is checked against. Read and write are kept apart
  // because a request is judged on one of them: the one its method needs.
  aclFor(caller: ScopeCaller): Promise<Acl>;
  // The realm's operation core, whose policy gate the explain runs. Reaching
  // it mounts the realm if it is not mounted. A realm this process has already
  // published may still be starting, and until it has indexed, a target there
  // is told of as a missing one. Undefined for a realm that will not mount.
  core(): Promise<OperationCore | undefined>;
  // How far behind its source the realm's index is (see `indexLag`).
  indexLag(): Promise<ExplainedIndexLag>;
}

interface Acl {
  read: boolean;
  write: boolean;
}

// The question, as the payload carries it.
interface Question {
  // Empty for a caller who presents no credentials.
  actor: string;
  // A card or file, or for a search or a listing, the realm it runs in.
  target: string;
  operation: string;
  // A policy document to answer against in place of the policy in force.
  draft?: Record<string, unknown>;
  search?: SearchQuestion;
  list?: ListQuestion;
}

// A search, as its request would name it: a named query by the type that
// declares it and the params it is invoked with, or an ad-hoc one by its
// filter.
type SearchQuestion =
  | { on: CodeRef; params?: Record<string, unknown> }
  | { filter: SearchEntryWireFilter };

// One page of the target realm's cards, of one type or of every type.
interface ListQuestion {
  on?: CodeRef;
  page: { number: number; size: number };
}

export async function explainOperation(
  core: OperationCore,
  request: OperationRequest,
): Promise<OperationExplainResult | OperationExplainListingResult> {
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
  // is, before anything else about the target is read. The first two are
  // answered before the realm is mounted, so a caller cannot make the server
  // mount a realm by asking about it unless they may read it.
  if (!realm || !(await realm.aclFor(asker)).read) {
    throw noSuchTarget();
  }
  let targetCore = await realm.core();
  if (!targetCore) {
    throw noSuchTarget();
  }
  let asksOfRealm = Boolean(question.search || question.list);
  let target: OperationTarget | undefined;
  if (asksOfRealm) {
    // A search and a listing run in a realm rather than on a card, so their
    // target names the realm. Refused only once the caller may read it, since
    // it says nothing the caller is not entitled to.
    if (
      ensureTrailingSlash(realm.url.href) !==
      ensureTrailingSlash(targetCore.realmURL)
    ) {
      throw invalidQuestion(
        request,
        `to ask about a ${question.search ? 'search' : 'listing'}, use the realm it runs in as the \`target\`, and ${question.target} is a card in ${targetCore.realmURL}, not a realm`,
      );
    }
  } else {
    target = canonicalizeTarget(
      targetCore,
      { kind: 'instance', url: realm.url.href },
      {
        rootNamesIndexCard: !isDefinitionFreeBaseOperation(question.operation),
      },
    );
    if (target.kind !== 'instance' || !(await exists(targetCore, target))) {
      throw noSuchTarget();
    }
  }
  if (
    !targetCore.policy ||
    !(await namesPolicyCard(targetCore.policy, policyCard))
  ) {
    throw new OperationFailure({
      id: policyCard.href,
      status: 422,
      code: 'policy-not-in-force',
      title: 'Policy not in force',
      detail:
        `${target?.kind === 'instance' ? target.url : targetCore.realmURL} ` +
        `is in a realm that doesn't use the policy ${policyCard.href}, so ` +
        `that policy has no say over it`,
    });
  }
  let governing = question.draft
    ? await draftGoverned(targetCore, policyCard, question.draft)
    : { core: targetCore };
  // What compiling a draft records describes the definitions it read, and a
  // draft names its own types, in any realm this server serves. So a draft is
  // answered only to a caller who may read every such realm compiling read
  // from, and is refused whole otherwise.
  if (
    'reads' in governing &&
    (await readsUnreadable(core, asker, governing.reads))
  ) {
    throw new OperationFailure({
      id: policyCard.href,
      status: 403,
      code: 'operation-not-permitted',
      title: 'Operation not permitted',
      detail:
        `this draft uses card types from a realm you can't read, so what it ` +
        `would decide can't be shown to you`,
    });
  }
  let actor = scopeCallerFor(question.actor);
  let acl = await realm.aclFor(actor);
  let draft = 'draft' in governing ? governing.draft : undefined;
  let answered = (explanation: PolicyExplanation): PolicyExplanation =>
    draft ? { ...explanation, draft: { issues: draft.issues } } : explanation;
  if (question.search) {
    return {
      explanation: answered(
        await explainSearch(
          governing.core,
          realm,
          question.search,
          question,
          actor,
          acl,
        ),
      ),
    };
  }
  if (question.list) {
    let { cards, total } = await listedCards(targetCore, question.list);
    let explanations: PolicyExplanation[] = [];
    // One at a time: each runs the gate, and a predicate reads the card it
    // judges, so a page costs its realm one gate at a time however large it
    // is.
    for (let url of cards) {
      try {
        explanations.push(
          await explain(
            governing.core,
            { kind: 'instance', url },
            question,
            actor,
            acl,
          ),
        );
      } catch (e: unknown) {
        // A card removed since the page was read is no longer on it. It is
        // left out rather than failing the page, as the page read a moment
        // later would leave it out.
        if (isOperationFailure(e) && e.error.code === 'target-not-found') {
          continue;
        }
        throw e;
      }
    }
    return {
      listing: {
        explanations,
        page: { ...question.list.page, total },
        ...(draft ? { draft: { issues: draft.issues } } : {}),
      },
    };
  }
  let explanation = await explain(
    governing.core,
    target as OperationTarget & { kind: 'instance' },
    question,
    actor,
    acl,
  );
  return { explanation: answered(explanation) };
}

// The core the target's realm would decide with were its policy card to hold
// `document`: the realm's own core, answering the draft wherever its compiled
// policy is read, which is the gate, the search lane and the pending-write
// check alike. Everything else is the realm's own, the pointer included, so the
// card its key names is still the one no grant reaches.
//
// The draft is compiled against the card the key names, as the card itself
// would be, so a relative `targetType` module resolves against that card.
async function draftGoverned(
  core: OperationCore,
  policyCard: URL,
  document: Record<string, unknown>,
): Promise<{
  core: OperationCore;
  draft: CompiledRealmPolicy;
  reads: string[];
}> {
  let access = core.policy!;
  let card = (await access.policyCard()) ?? policyCard.href;
  let { compiled: draft, reads } = await access.compileDraft(card, document);
  return {
    core: {
      ...core,
      policy: { ...access, compiledPolicy: async () => draft },
    },
    draft,
    reads,
  };
}

// Whether any of these URLs is in a realm this server serves that the asker
// may not read, judged as the target's realm is: by a session vouched for as
// their own, and without mounting the realm. A URL no realm here serves is
// read as the owner of the realm that looked it up, as every card in that
// realm reads it, so it discloses nothing that realm does not already disclose
// to its readers.
async function readsUnreadable(
  core: OperationCore,
  asker: ScopeCaller,
  urls: string[],
): Promise<boolean> {
  for (let url of new Set(urls)) {
    let served = await core.targetRealm?.(url);
    if (served && !(await served.aclFor(asker)).read) {
      return true;
    }
  }
  return false;
}

// What a search asked of the target's realm would compose, for the actor, and
// how fresh an answer from it can be.
//
// Asked of the search lane itself: the search's invocation as `_search` reads
// it off the same request, a named query resolved as `_search` resolves it,
// and the grants `policyQueryScope` composes, which is the lookup every search
// composes through. So the fragment is the one the search runs for the actor,
// for as long as nothing it read changes. It is asked for a user, never as a
// realm-authority principal, which no policy scopes.
async function explainSearch(
  core: OperationCore,
  realm: TargetRealm,
  search: SearchQuestion,
  question: Question,
  actor: ScopeCaller,
  acl: Acl,
): Promise<PolicyExplanation> {
  let payload: Record<string, unknown> =
    'filter' in search
      ? { filter: search.filter }
      : {
          operation: question.operation,
          on: search.on,
          ...(search.params ? { params: search.params } : {}),
        };
  // Defined for both shapes `searchQuestionIn` admits: a named query carries
  // its operation and a code ref, and an ad-hoc one is always an invocation.
  let invocation = searchInvocation(payload)!;
  let answer: ExplainedSearch = {
    operation: invocation.operation,
    types: invocation.types,
    ...('filter' in search ? { filter: search.filter } : {}),
    index: await realm.indexLag(),
  };
  let base: PolicyExplanation = {
    actor: actor.kind === 'user' ? actor.actor : null,
    target: core.realmURL,
    operation: question.operation,
    acl,
    decision: 'denied',
    reason: 'acl',
    rules: [],
    search: answer,
  };
  // A named query is resolved before anything consults a policy, for every
  // caller, and a request naming one that does not resolve is refused as it
  // is sent. So is an ad-hoc filter the search grammar does not accept.
  if ('filter' in search) {
    try {
      parseSearchEntryQueryFromPayload({ filter: search.filter });
    } catch {
      return refused(base, 'not-resolved', {
        status: 400,
        code: 'invalid-params',
      });
    }
  } else {
    try {
      let resolved = await resolveNamedQuery(core, payload, {
        principal:
          actor.kind === 'user'
            ? { kind: 'user', user: actor.actor }
            : undefined,
        realms: [core.realmURL],
      });
      if (resolved.query.filter) {
        answer.filter = resolved.query.filter;
      }
    } catch (e: unknown) {
      if (!isOperationFailure(e)) {
        throw e;
      }
      return refused(base, 'not-resolved', {
        status: e.error.status,
        code: e.error.code,
      });
    }
  }
  // A caller who reads the realm searches it unscoped: a policy widens what
  // the ACL refused, and has nothing to add to what it allowed.
  if (acl.read) {
    return { ...base, decision: 'allowed', reason: 'acl' };
  }
  if (actor.kind !== 'user') {
    return refused(base, 'actor-required', {
      status: 401,
      code: 'actor-required',
    });
  }
  // A policy that did not compile as a whole cannot say what it grants. The
  // gate refuses every caller it judges with a 500 for it, and this answers
  // the search lane the same way rather than as a policy granting nothing.
  if ((await core.policy?.compiledPolicy())?.uncompilable) {
    return refused(
      base,
      'policy-unloadable',
      { status: 500, code: 'internal-error' },
      'failed',
    );
  }
  let scope: PolicyQueryScope;
  try {
    scope = await policyQueryScope(core, {
      operation: invocation.operation,
      types: invocation.types,
      principal: { kind: 'user', user: actor.actor },
      transport: 'explain',
      hypothetical: true,
    });
  } catch (e: unknown) {
    if (!isOperationFailure(e) || e.error.status < 500) {
      throw e;
    }
    return refused(
      base,
      'policy-unloadable',
      { status: e.error.status, code: e.error.code },
      'failed',
    );
  }
  let rules = await searchRules(core, invocation);
  if (scope.kind === 'scoped') {
    return {
      ...base,
      decision: 'allowed',
      reason: 'granted',
      rules,
      search: {
        ...answer,
        fragment: wireFilterFromFilter({ any: scope.filters }),
      },
    };
  }
  // A grant that compiled a filter and composed nothing was kept out of the
  // search by a declaration: the query is non-grantable on its type or one it
  // descends from. Without one, nothing grants the search.
  let kept = rules.some(({ grants }) =>
    grants.some(({ filterable }) => filterable),
  );
  return {
    ...base,
    decision: 'denied',
    reason: kept ? 'non-grantable' : 'no-grant',
    rules,
  };
}

// The rules governing the types a search is judged by, each with its grants
// for the search's operation, matched as `policyQueryScope` matches them:
// against the adoption chain the definition cache records beside each type. A
// rule governing several of the types is listed once.
async function searchRules(
  core: OperationCore,
  invocation: { operation: string; types: readonly CodeRef[] },
): Promise<ExplainedRule[]> {
  let policy = await core.policy?.compiledPolicy();
  if (!policy || !core.policy) {
    return [];
  }
  let trace = new GateTrace();
  for (let on of invocation.types) {
    let resolved = core.resolveCodeRef(on, new URL(core.realmURL));
    if (!resolved) {
      continue;
    }
    let entry: { types: string[] } | undefined;
    try {
      entry = await core.definitionLookup.lookupDefinitionEntry(resolved);
    } catch {
      entry = undefined;
    }
    if (entry?.types) {
      await matchingGrants(
        policy,
        entry.types,
        invocation.operation,
        core.policy,
        trace,
      );
    }
  }
  let seen = new Set<unknown>();
  return trace.rules
    .filter(({ rule }) => !seen.has(rule) && Boolean(seen.add(rule)))
    .map(({ rule, grants }) => ({
      targetType: {
        module: rule.targetType.module,
        name: rule.targetType.name,
      },
      path: rule.path,
      grants: grants.map((grant) => ({
        path: grant.path,
        ...(grant.where
          ? {
              where: grant.where.source,
              tier: grant.where.snapshot ? 'snapshot' : 'stored',
            }
          : {}),
        outcome: grant.where ? 'not-evaluated' : 'unconditional',
        filterable: grant.filter !== undefined,
      })),
    }));
}

// One page of the realm's cards, of `on` or of every type, in the order of
// their URLs so the pages of a listing do not overlap. Read from the realm's
// own index, which is what a reader of the realm could search for themselves.
async function listedCards(
  core: OperationCore,
  list: ListQuestion,
): Promise<{ cards: string[]; total: number }> {
  let wire: SearchEntryWireQuery = {
    ...(list.on ? { filter: { 'item.on': list.on } } : {}),
    scope: 'cards',
    fields: { entry: ['item.id'] },
    sort: [{ by: 'item.cardURL' }],
    page: list.page,
  };
  let query = parseSearchEntryQueryFromPayload(wire);
  // Under the wall-clock budget every search runs under, whatever door it
  // reaches the engine by.
  let doc: Awaited<ReturnType<typeof core.indexQueryEngine.searchEntries>>;
  try {
    doc = await runWithSearchTimeBudget((signal) =>
      core.indexQueryEngine.searchEntries(query, { signal }),
    );
  } catch (err: unknown) {
    if (err instanceof SearchBoundError) {
      throw new OperationFailure({
        status: err.status,
        code: 'invalid-params',
        title: 'Listing not read',
        detail: `the realm couldn't read the page of cards this listing asks for: ${err.message}`,
      });
    }
    throw err;
  }
  return {
    cards: doc.data.map((match) => match.id),
    total: doc.meta.page.total,
  };
}

// Whether the realm's policy opens `operation` to callers who aren't signed in,
// as the realm reads it to admit one.
async function opensToAnonymous(
  core: OperationCore,
  operation: string,
): Promise<boolean> {
  let policy = await core.policy?.compiledPolicy();
  return (
    !policy?.uncompilable &&
    (policy?.anonymous?.operations.includes(operation) ?? false)
  );
}

// What an explain's gate decisions are recorded as having arrived on.
const EXPLAIN_ROUTE: PolicyRoute = Object.freeze({
  transport: 'explain' as const,
  route: 'explain',
});

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
  // declines them that its policy opens nothing to, so nothing about the
  // target is read. One its policy opens the operation to is judged by the
  // gate as such a caller, against the grants that opt in to them.
  if (
    actor.kind !== 'user' &&
    coarseDeclined !== 'none' &&
    !(await opensToAnonymous(core, question.operation))
  ) {
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
    route: EXPLAIN_ROUTE,
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
    let refusal = gateRefusal(
      core,
      threw ? GATE_FAULTED : GATE_REFUSED,
      target,
      question.operation,
    ).error;
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
    case 'query-lane':
      return 'query-lane';
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
    path: rule.path,
    grants: grants.map((grant) => ({
      path: grant.path,
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
  let invalid = (detail: string) => invalidQuestion(request, detail);
  let { actor, target, operation, draft, search, list } = params as Record<
    string,
    unknown
  >;
  if (actor !== undefined && actor !== null && typeof actor !== 'string') {
    throw invalid(
      `operation "${request.name}" explains a decision for \`actor\`, a user id, or an empty string for a caller who presents no credentials`,
    );
  }
  if (typeof target !== 'string' || target.length === 0) {
    throw invalid(
      `operation "${request.name}" explains a decision about \`target\`, the URL of a card or file, or of the realm a search or a listing runs in`,
    );
  }
  if (typeof operation !== 'string' || operation.length === 0) {
    throw invalid(
      `operation "${request.name}" explains a decision about \`operation\`, the name an invocation would invoke`,
    );
  }
  // A draft is read the way a policy card's attributes are, so one with no
  // `rules` would compile to a policy granting nothing, and nothing would say
  // it was the wrong shape: a card's whole document, say, whose rules sit
  // under `data.attributes`.
  if (
    draft != null &&
    (!isPlainRecord(draft) ||
      !Object.prototype.hasOwnProperty.call(draft, 'rules'))
  ) {
    throw invalid(
      `operation "${request.name}" answers against a \`draft\` that is a policy document: an object holding the \`rules\` a RealmPolicy card holds`,
    );
  }
  if (search != null && list != null) {
    throw invalid(
      `operation "${request.name}" explains a search or a listing, not both at once`,
    );
  }
  return {
    actor: actor ?? '',
    target,
    operation,
    ...(draft != null ? { draft: draft as Record<string, unknown> } : {}),
    ...(search != null
      ? { search: searchQuestionIn(search, operation, invalid) }
      : {}),
    ...(list != null ? { list: listQuestionIn(list, invalid) } : {}),
  };
}

// A search as its request would name it. An ad-hoc search runs under the
// reserved name `query` and carries its filter; a named one runs under its own
// name, on the type that declares it, with its params.
function searchQuestionIn(
  search: unknown,
  operation: string,
  invalid: (detail: string) => OperationFailure,
): SearchQuestion {
  if (!isPlainRecord(search)) {
    throw invalid(
      `\`search\` names the search to explain: \`{ on, params }\` for a named query, or \`{ filter }\` for an ad-hoc one`,
    );
  }
  let { on, params, filter, ...rest } = search;
  let extra = Object.keys(rest);
  if (extra.length > 0) {
    throw invalid(
      `\`search\` carries only \`on\` and \`params\` for a named query, or \`filter\` for an ad-hoc one, and not ${extra.map((key) => `\`${key}\``).join(', ')}`,
    );
  }
  if (operation === 'query') {
    if (!isPlainRecord(filter) || on !== undefined || params !== undefined) {
      throw invalid(
        `an ad-hoc search runs as \`query\` on the types its filter anchors to, so \`search\` carries its \`filter\` and nothing else`,
      );
    }
    return { filter: filter as SearchEntryWireFilter };
  }
  if (!isCodeRef(on) || filter !== undefined) {
    throw invalid(
      `a named query runs on the type that declares it, so \`search\` carries that type as \`on\`, and its \`params\` where it takes any`,
    );
  }
  if (params !== undefined && !isPlainRecord(params)) {
    throw invalid(
      `\`search.params\` is an object keyed the way operation "${operation}" declares them`,
    );
  }
  return {
    on,
    ...(params !== undefined ? { params } : {}),
  };
}

// A page of the realm's cards. Its size defaults to the cap and may not
// exceed it.
function listQuestionIn(
  list: unknown,
  invalid: (detail: string) => OperationFailure,
): ListQuestion {
  let shape = `\`list\` asks for one page of the realm's cards: \`{ on?, page?: { number?, size? } }\`, where \`on\` is the type to list and \`size\` is at most ${EXPLAIN_CAP}`;
  if (!isPlainRecord(list)) {
    throw invalid(shape);
  }
  let { on, page } = list;
  if (on !== undefined && !isCodeRef(on)) {
    throw invalid(shape);
  }
  if (page !== undefined && !isPlainRecord(page)) {
    throw invalid(shape);
  }
  let number = page?.number ?? 0;
  let size = page?.size ?? EXPLAIN_CAP;
  if (
    typeof number !== 'number' ||
    !Number.isInteger(number) ||
    number < 0 ||
    typeof size !== 'number' ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > EXPLAIN_CAP
  ) {
    throw invalid(shape);
  }
  return { ...(on !== undefined ? { on } : {}), page: { number, size } };
}

function invalidQuestion(
  request: OperationRequest,
  detail: string,
): OperationFailure {
  return new OperationFailure({
    ...(request.target.kind === 'instance' ? { id: request.target.url } : {}),
    status: 400,
    code: 'invalid-params',
    title: 'Invalid params',
    detail,
  });
}

// How many triples one explain's params ask to have explained: a listing's
// page, and one for anything else. Read off the params as sent, so a batch is
// bounded before any of it is explained, and a listing whose page does not
// parse counts as the largest page it could ask for: it is refused either way.
function triplesAsked(params: Record<string, unknown> | undefined): number {
  let list = params?.list;
  if (list == null) {
    return 1;
  }
  let size =
    isPlainRecord(list) && isPlainRecord(list.page)
      ? list.page.size
      : undefined;
  return typeof size === 'number' && Number.isInteger(size) && size > 0
    ? size
    : EXPLAIN_CAP;
}

// Refuses a request whose explains together ask for more than `EXPLAIN_CAP`
// triples, whole, before any of them is explained. A batch is where this
// matters: each entry is within the cap on its own, and ten thousand of them
// are an enumeration of every actor or every card all the same.
export function assertWithinExplainCap(
  explains: { params?: Record<string, unknown> }[],
): void {
  let asked = explains.reduce(
    (sum, { params }) => sum + triplesAsked(params),
    0,
  );
  if (asked > EXPLAIN_CAP) {
    throw new OperationFailure({
      status: 400,
      code: 'invalid-params',
      title: 'Too many explanations',
      detail:
        `one request can ask about at most ${EXPLAIN_CAP} decisions, counting ` +
        `every card on a listing's page and every explain in a batch, and ` +
        `this one asks about ${asked}. Ask about the rest in another request`,
    });
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
