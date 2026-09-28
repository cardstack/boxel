import type { ResolvedCodeRef } from '../code-ref.ts';
import type { Definition } from '../definitions.ts';
import { codeRefFromInternalKey } from '../index.ts';
import type { LocalPath } from '../paths.ts';
import { isCardResource } from '../card-document-shape.ts';
import type { CardResource } from '../resource-types.ts';
import { localPathFor, pathsFor } from './dispatch.ts';
import type { OperationCore, OperationScope } from './dispatch.ts';
import type { AdmissionSubject, BxlMutationModule } from './executors.ts';
import type {
  CompiledOperationGrant,
  CompiledPolicyPredicate,
  CompiledPolicyRule,
  CompiledRealmPolicy,
} from './policy.ts';
import { loadBxlTransform } from './transforms.ts';
import {
  OperationFailure,
  isWrite,
  type BaseOperation,
  type OperationDefinition,
  type OperationTarget,
  type PolicyIssueCode,
} from './types.ts';

// ============================================================================
// The policy gate.
//
// A realm's ACL answers "may this caller read the realm, or write it?". A
// realm's policy widens that answer for a caller the ACL declined. It is a
// list of rules, each naming a card type and granting operations on that
// type's instances, and each grant can carry a BXL predicate over the caller
// and the target. The question the gate asks is: may this caller invoke this
// operation on this target? The answer is yes when any matching rule has a
// grant for the invoked name whose predicate is absent or holds.
//
//   allow = ∃ rule ∈ policy
//             where rule.targetType is the target's type or an ancestor of it
//             ∧ ∃ grant ∈ rule.grants
//                  where grant.operation == the invoked name
//                  ∧ (grant.where is absent ∨ grant.where holds)
//
// Grants only union, so the order of rules and grants changes nothing.
//
// The gate runs only for a caller the ACL declined. A caller the ACL allowed
// is never judged by the policy. That is what keeps a policy from narrowing
// anything, and what keeps a realm writer editing their own realm from paying
// for a policy load or a predicate evaluation.
//
// Authorization infrastructure is outside the grant model. Were any of it
// grantable, one grant could be made into every grant. So these are refused to
// every caller the ACL declined, however the compiled policy came to grant
// them:
//
// - An operation declared `nonGrantable` on the target's type, refused before
//   any rule is matched, or on any type the target's type descends from,
//   refused before a matching grant admits anything.
// - Any write to the card the realm's policy key names.
// - Any write to the realm's config card, which holds that key and the
//   settings a predicate reads through `realmConfig()`.
//
// Every way the gate can fail denies. A compiled policy with no rule for the
// type, a predicate that answers anything but `true`, and a target whose type
// the index cannot vouch for are each a refusal, never an opening. A policy the
// realm names but cannot load, and a predicate that throws, are faults in the
// policy rather than answers from it, so each is a 500 as well as a refusal.
//
// What a refusal tells the caller follows from whether the realm ACL lets them
// read the realm. One who may can list the realm anyway, and is told the gate
// refused them. One who may not is told the target is not there, exactly as
// they are told of a target that is not (see `refusalForNonReader`). Two things
// still set those apart, and neither is closed here. Time: a refusal that
// evaluated a predicate takes longer than one that found no card, so a caller
// who measures carefully can tell the two apart. And the 500: a predicate only
// runs against a card that exists and whose type a rule names, and whether it
// throws depends on the card's stored values. So a predicate that throws tells
// any caller who reaches it that such a card is there, and something about what
// it holds: `(.title | tonumber) > 0` answers 500 for a card whose title is not
// a number and 404 for one whose title is a number no greater than zero.
//
// The gate never sees the target as the caller named it. It is handed the
// target as the realm resolved it, so a type is judged by the definition the
// realm's own index resolved and never by the ref in the request. That matters
// for a create, the one operation whose type comes from the caller: a caller
// who could have one type's grants consulted while creating another would have
// every grant the realm makes on any type.
//
// What a grant admits is the invocation, and the operation then runs as it
// runs for anyone. A granted `read` assembles the card's whole representation:
// its link closure, whatever the linked cards' types, and the results of its
// query-backed fields. So a grant on a type reaches every card that type's
// representation carries, and granting `read` on a type asserts that all of it
// is fit for every caller the grant admits. Nothing here narrows that reach. A
// response's shape never depends on how its caller was authorized, so a
// narrower one has to be declared on the operation, for every caller alike.
// ============================================================================

// What the gate reads for a caller the realm ACL declined. The realm supplies
// it bound to its own authority. The policy card commonly lives in a realm the
// caller cannot read, so it is never read through the caller's request.
export interface OperationPolicyAccess {
  // The realm's compiled policy. Undefined for a realm with no policy.
  compiledPolicy(): Promise<CompiledRealmPolicy | undefined>;
  // Every key an index row could record this type under in its adoption
  // chain: the spelling the ref names, and the canonical one of the definition
  // it resolves to, which differ when the ref reaches the type through a
  // module that re-exports it.
  typeKeys(codeRef: ResolvedCodeRef): Promise<string[]>;
  // A relationship link as the target's stored source spells it, resolved
  // against the file that holds it. A predicate compares card identities, so
  // it reads each link the way a mutation program does.
  resolvedLink(selfLink: string, relativeTo: URL): string;
  // The URL of the card the realm's `policy` key names, or undefined for a
  // realm with no policy. Only the pointer: reading it loads nothing.
  policyCard(): Promise<string | undefined>;
}

// The target as the gate judges it. It holds what the realm resolved, and
// nothing the caller named.
export type GateSubject =
  // A stored card, matched on the adoption chain its index row records.
  | { kind: 'card'; url: URL }
  // A type a create mints from, matched on the adoption chain the definition
  // cache records beside the definition the type resolved to: the type and
  // every type it descends from up to the root of its family, `CardDef` for a
  // card. A card's row goes one step further, to `BaseDef`, so a rule on
  // `BaseDef` matches every stored card and grants no create. A type the realm
  // cannot resolve never gets here. Resolution refuses it first, as not found.
  | { kind: 'type'; types: string[] }
  // A target no rule is matched against: a file, which is not a card, or a
  // URL that does not parse.
  | { kind: 'unmatched' };

// What the gate reads of an invocation's scope: who the caller is, what the
// realm ACL declined, and the index rows a card's chain comes from. A create's
// proposed document is not among them, because it names the type the caller
// claims.
export type GateScope = Pick<
  OperationScope,
  'caller' | 'coarseDeclined' | 'peekInstance'
>;

// The gate's refusal. It carries nothing, since what a refusal says is the
// caller's to build from the target it asked about, and the gate has no
// target to build one from.
export const GATE_REFUSED = Object.freeze({ kind: 'refused' as const });

// The index holds no row for the card the gate was asked about. A caller who
// may read the realm is told so, as the operation would have told them; one
// who may not is told the same thing they are told of a card the gate
// refuses.
export const GATE_MISSING = Object.freeze({ kind: 'missing' as const });

// No grant admitted the invocation, and a predicate threw while the gate was
// deciding. That is a fault in the policy rather than an answer from it.
export const GATE_FAULTED = Object.freeze({ kind: 'faulted' as const });

// The ways the gate declines an invocation.
export type GateRefusal =
  | typeof GATE_REFUSED
  | typeof GATE_MISSING
  | typeof GATE_FAULTED;

// One grant the gate matched, with the rule it came from.
export interface MatchedGrant {
  rule: CompiledPolicyRule;
  grant: CompiledOperationGrant;
}

// What the gate decided about one invocation.
export type GateDecision =
  // The realm ACL allowed the caller, or never judged the request. The policy
  // was not consulted.
  | { kind: 'coarse' }
  // A grant admits the invocation: a grant with no condition, or, for a read,
  // one whose predicate held against the target as it is stored now.
  | { kind: 'granted'; grant: MatchedGrant }
  // A write whose every matching grant carries a predicate. A write's
  // predicate has to judge the state the write will change, and only the
  // write lock holds that state still. So its predicates are not evaluated
  // here: they are carried to whatever takes the lock, which decides them
  // with `dischargePendingDecision`. Any one of them holding admits the write.
  | PendingDecision;

export interface PendingDecision {
  kind: 'pending';
  grants: MatchedGrant[];
  // The target type's definition-cache entry, which describes the source a
  // predicate reads.
  typeDefinition: Definition | undefined;
  // For a card target, the key the index records the card's own type under,
  // as it stood when the grants were matched. The grants hold for that type,
  // so a card stored as some other type by the time the lock is taken is not
  // one they admit.
  matchedType?: string;
}

// How often the gate loads a policy and evaluates a predicate, per core, and
// how many pending writes were decided under a write lock. A test asserts on
// these rather than on outcomes alone, since an outcome cannot show that a
// caller the ACL allowed never reached the policy, or that a read never
// reached a lock.
export interface PolicyGateStats {
  policyLoads: number;
  predicateEvaluations: number;
  pendingDischarges: number;
}

const statsByCore = new WeakMap<OperationCore, PolicyGateStats>();

export function policyGateStats(core: OperationCore): PolicyGateStats {
  let stats = statsByCore.get(core);
  if (!stats) {
    stats = { policyLoads: 0, predicateEvaluations: 0, pendingDischarges: 0 };
    statsByCore.set(core, stats);
  }
  return stats;
}

// The refusal the gate gives. It names the operation and the target as the
// caller named them, and nothing the realm knows: not whether the target
// exists, not its type, and not what the policy holds. A caller who may read
// the realm is told it as a 403. One who may not is told the target is not
// there, which the realm decides where it serializes the refusal.
export function notPermitted(
  target: OperationTarget,
  name: string,
): OperationFailure {
  return new OperationFailure({
    ...(target.kind === 'instance' ? { id: target.url } : {}),
    status: 403,
    code: 'operation-not-permitted',
    title: 'Operation not permitted',
    detail:
      `operation "${name}" is not permitted on ` +
      (target.kind === 'instance'
        ? target.url
        : JSON.stringify(target.codeRef)),
  });
}

// The failure for a gate refusal of `target`, built from the target the
// caller asked about.
export function gateRefusal(
  core: OperationCore,
  refusal: GateRefusal,
  target: OperationTarget,
  name: string,
): OperationFailure {
  let named =
    target.kind === 'instance' ? target.url : JSON.stringify(target.codeRef);
  let id = target.kind === 'instance' ? { id: target.url } : {};
  switch (refusal.kind) {
    case 'missing':
      return new OperationFailure({
        ...id,
        status: 404,
        code: 'target-not-found',
        title: 'Not found',
        detail: `${named} does not exist in realm ${core.realmURL}`,
      });
    case 'faulted':
      return new OperationFailure({
        ...id,
        status: 500,
        code: 'internal-error',
        title: 'Policy predicate failed',
        detail:
          `a predicate in the realm's policy failed while deciding whether ` +
          `operation "${name}" is permitted on ${named}`,
      });
    default:
      return notPermitted(target, name);
  }
}

// The realm's compiled policy, as the gate reads it. Undefined for a realm with
// no policy, or a core that cannot read one.
export interface LoadedPolicy {
  policy: CompiledRealmPolicy | undefined;
}

// What a policy that recorded one of these can grant is unknown rather than
// nothing: the realm names a policy and could not read it as one.
const UNAVAILABLE_POLICY: ReadonlySet<PolicyIssueCode> = new Set([
  'policy-card-missing',
  'policy-card-unloadable',
  'not-a-policy',
]);

// Load the realm's compiled policy for a caller the realm ACL declined, and
// refuse with a 500 when the realm names a policy it cannot load.
//
// For a caller who may not read the realm, this runs before the target
// resolves. That keeps the 500 independent of the target: answered only once a
// card had been found, it would tell such a caller which cards exist.
export async function loadPolicy(core: OperationCore): Promise<LoadedPolicy> {
  if (!core.policy) {
    return { policy: undefined };
  }
  policyGateStats(core).policyLoads++;
  let policy = await core.policy.compiledPolicy();
  if (
    policy?.issues.some(
      (issue) => issue.path === '' && UNAVAILABLE_POLICY.has(issue.code),
    )
  ) {
    throw new OperationFailure({
      status: 500,
      code: 'internal-error',
      title: 'Policy unavailable',
      detail: `the realm's policy could not be loaded`,
    });
  }
  return { policy };
}

// Decide whether a caller the realm ACL declined may invoke `name`, which
// resolved to `definition`, on `subject`. `typeDefinition` is the target
// type's definition-cache entry, which describes the stored source a predicate
// reads. `loaded` is the policy, where the caller already loaded it.
export async function gateOperation(
  core: OperationCore,
  subject: GateSubject,
  name: string,
  definition: OperationDefinition,
  typeDefinition: Definition | undefined,
  scope: GateScope,
  loaded?: LoadedPolicy,
): Promise<GateDecision | GateRefusal> {
  let { base } = definition;
  if (!declines(scope, base)) {
    return { kind: 'coarse' };
  }
  // An operation kept out of every policy's reach. This and the two checks
  // for authorization infrastructure below refuse before any rule is matched,
  // so a grant for it that a compiled policy holds is never consulted,
  // however that grant came to be there.
  if (definition.nonGrantable) {
    return GATE_REFUSED;
  }
  // A stored-bytes read resolves before any definition, and a query is planned
  // and run on the search engine. Neither is granted here.
  if (base === 'readSource' || base === 'query') {
    return GATE_REFUSED;
  }
  if (subject.kind === 'unmatched' || !core.policy) {
    return GATE_REFUSED;
  }
  // A type is only what a create mints from. Every other behavior runs
  // against a stored card, and is judged by that card's row or not at all.
  if (subject.kind === 'type' && base !== 'create') {
    return GATE_REFUSED;
  }
  // The realm's config card and the card its policy key names together
  // decide every grant, so no grant writes either, whatever their types
  // declare. A type marks only the operations it declares, and the policy
  // card's own type may leave one unmarked, so the rule follows the cards'
  // identities rather than their types.
  if (
    subject.kind === 'card' &&
    isWrite(base) &&
    (namesRealmConfigCard(core, subject.url) ||
      (await namesPolicyCard(core.policy, subject.url)))
  ) {
    return GATE_REFUSED;
  }
  let types =
    subject.kind === 'card'
      ? await cardAdoptionChain(scope, subject.url)
      : subject.types;
  if (!types) {
    return GATE_REFUSED;
  }
  if (!Array.isArray(types)) {
    return GATE_MISSING;
  }
  let { policy } = loaded ?? (await loadPolicy(core));
  if (!policy) {
    return GATE_REFUSED;
  }
  let matched = await matchingGrants(policy, types, name, core.policy);
  if (matched.length === 0) {
    return GATE_REFUSED;
  }
  // Once a grant would admit the invocation, and not before, so an
  // invocation that nothing grants pays no definition reads for a refusal it
  // was getting anyway. The chain starts at the target's own type, which is
  // left out only when its entry was read: the name then resolved against
  // that entry, whose flag was read above. An entry that could not be read
  // left the name to the built-in, which carries no flag, so that type is
  // asked again with the rest.
  if (
    await nonGrantableInChain(core, types.slice(typeDefinition ? 1 : 0), name)
  ) {
    return GATE_REFUSED;
  }
  let unconditional = matched.find(({ grant }) => !grant.where);
  if (unconditional) {
    return { kind: 'granted', grant: unconditional };
  }
  if (base !== 'read') {
    return {
      kind: 'pending',
      grants: matched,
      typeDefinition,
      ...(subject.kind === 'card' && types[0] ? { matchedType: types[0] } : {}),
    };
  }
  // A read has one state to judge, and nothing to wait for, so its predicate
  // is evaluated here, against the target as it is stored now. Only a stored
  // card has a state.
  if (subject.kind !== 'card') {
    return GATE_REFUSED;
  }
  let content = await core.readFileAsText(
    `${localPathFor(core, subject.url)}.json` as LocalPath,
  );
  let resource = content === undefined ? undefined : cardResourceIn(content);
  let stored = resource
    ? await storedSubject(core, subject.url, typeDefinition, resource)
    : undefined;
  let granted = stored
    ? await firstHolding(core, matched, stored, scope)
    : undefined;
  if (granted === 'threw') {
    return GATE_FAULTED;
  }
  return granted ? { kind: 'granted', grant: granted } : GATE_REFUSED;
}

// A write the gate left pending, and what deciding it reads.
export interface PendingWrite {
  target: OperationTarget;
  // The name the operation was invoked under, which a refusal names.
  name: string;
  decision: PendingDecision;
  // The write's own scope, which says who the caller is.
  scope: OperationScope;
}

// Decide a pending write under the write lock it holds.
//
// A write's predicate judges the state the write changes, and only the lock
// holds that still: between the gate matching a write's grants and the write
// taking its lock, another writer can change the very field a predicate reads.
// So whatever takes the lock hands in the card the write is judged by, as it
// holds it where the write stages, and the predicates are evaluated against
// that rather than against anything read before the lock.
//
// Only the predicates run again. The grants, and the compiled predicates on
// them, were matched at the gate from the policy it loaded, and they travel
// here on the decision, so nothing loads the policy a second time.
//
// What a predicate judges is the target the grants were matched on. A write to
// a card judges the card it changes. That includes a named create anchored on
// a card: the grants were matched on the card's type, and its predicates read
// that card's fields. A create against a type has nothing stored to judge, so
// its predicates read the card it would mint, as its template or its resource
// leaves it, which is what it writes. The payload it was sent is not: a
// template writes the fields it fills, not the members the caller named.
//
// Refuses by throwing the gate's refusal, so a write refused here is refused
// in the same words as one refused at the gate.
export async function dischargePendingDecision(
  core: OperationCore,
  pending: PendingWrite,
  // The card the write is judged by: its target as the lock holds it, or, for
  // a create against a type, the card it would mint. Undefined where there is
  // no such card.
  judged: AdmissionSubject | undefined,
): Promise<void> {
  policyGateStats(core).pendingDischarges++;
  let admitted = await admits(core, pending, judged);
  if (admitted === 'threw') {
    throw gateRefusal(core, GATE_FAULTED, pending.target, pending.name);
  }
  if (!admitted) {
    throw notPermitted(pending.target, pending.name);
  }
}

// Whether a pending write would be admitted against its target card as stored
// now, outside any lock. This never admits anything: the write is still
// decided under the lock. It answers only what a caller may be told when a
// batch fails before the write was decided. A create against a type has no
// card to judge until it is staged, so it is never taken as admitted here.
export async function pendingWriteHolds(
  core: OperationCore,
  pending: PendingWrite,
): Promise<boolean> {
  let { target } = pending;
  let url = target.kind === 'instance' ? parseURL(target.url) : undefined;
  if (!url) {
    return false;
  }
  let source = await core.readFileAsText(
    `${localPathFor(core, url)}.json` as LocalPath,
  );
  return (
    (await admits(
      core,
      pending,
      source === undefined ? undefined : { id: url.href, source },
    )) === true
  );
}

async function admits(
  core: OperationCore,
  { target, decision, scope }: PendingWrite,
  judged: AdmissionSubject | undefined,
): Promise<boolean | 'threw'> {
  let subject =
    target.kind === 'instance'
      ? await lockedSubject(core, target.url, decision, judged?.source)
      : await mintedSubject(core, judged);
  if (subject === undefined) {
    return false;
  }
  let holding = await firstHolding(core, decision.grants, subject, scope);
  return holding === 'threw' ? 'threw' : holding !== undefined;
}

// The first grant whose predicate holds for this caller against `subject`,
// or `threw` where none held and a predicate threw while the gate looked. A
// predicate that throws is a fault in the policy, but another grant can still
// hold. Grants union, so the fault is reported only when none does, and the
// answer is the same whatever order the grants are in.
async function firstHolding(
  core: OperationCore,
  grants: MatchedGrant[],
  subject: PredicateSubject,
  scope: GateScope,
): Promise<MatchedGrant | 'threw' | undefined> {
  let stats = policyGateStats(core);
  let actor = scope.caller.kind === 'user' ? scope.caller.actor : undefined;
  let threw = false;
  for (let candidate of grants) {
    let where = candidate.grant.where;
    if (!where) {
      return candidate;
    }
    // A predicate annotated as reading a snapshot tier asks for computed or
    // linked values, and the gate reads the stored source alone. So it is
    // never evaluated, and its grant admits nothing.
    if (where.snapshot) {
      continue;
    }
    stats.predicateEvaluations++;
    let outcome = await evaluate(core, where, subject, actor);
    if (outcome === 'holds') {
      return candidate;
    }
    threw ||= outcome === 'threw';
  }
  return threw ? 'threw' : undefined;
}

// Whether `url` is the card the realm's policy key names. The pointer names
// the card either by its id or by its stored `.json`, and the index resolves
// either one to the same card, so both spellings are the same card here.
export async function namesPolicyCard(
  access: OperationPolicyAccess,
  url: URL,
): Promise<boolean> {
  let pointer = await access.policyCard();
  return pointer !== undefined && cardId(pointer) === cardId(url.href);
}

function cardId(href: string): string {
  return href.endsWith('.json') ? href.slice(0, -'.json'.length) : href;
}

// Whether `url` is the realm's config card, the card stored at `realm.json`.
function namesRealmConfigCard(core: OperationCore, url: URL): boolean {
  return cardId(pathsFor(core).fileURL('realm.json').href) === url.href;
}

// Whether any of these types, keys from an adoption chain, declares `name`
// non-grantable.
//
// A declaration a subclass writes takes the place of the one it inherits,
// flag and all, and the subclass's author decides what its definition entry
// says. So the flag is read from the types the chain records, not only from
// the definition the name resolved to: a subclass cannot make grantable what
// the type it extends kept out of a policy's reach.
//
// A type whose definition cannot be read might be the one holding the flag, so
// it answers yes.
export async function nonGrantableInChain(
  core: OperationCore,
  types: string[],
  name: string,
): Promise<boolean> {
  let relativeTo = new URL(core.realmURL);
  let answers = await Promise.all(
    types.map(async (key) => {
      let codeRef = codeRefFromInternalKey(key);
      let resolved = codeRef
        ? core.resolveCodeRef(codeRef, relativeTo)
        : undefined;
      if (!resolved) {
        return true;
      }
      let definition: Definition | undefined;
      try {
        definition = await core.definitionLookup.lookupDefinition(resolved);
      } catch {
        return true;
      }
      if (!definition) {
        return true;
      }
      let operations = definition.operations;
      return Boolean(
        operations &&
        Object.prototype.hasOwnProperty.call(operations, name) &&
        operations[name].nonGrantable,
      );
    }),
  );
  return answers.includes(true);
}

// Whether the realm ACL declined this invocation. A caller declined only
// writes keeps the ACL's answer for every read.
function declines(scope: GateScope, base: BaseOperation): boolean {
  return (
    scope.coarseDeclined === 'all' ||
    (scope.coarseDeclined === 'writes' && isWrite(base))
  );
}

// The adoption chain the index recorded on a card's row. An error row
// describes why the card could not be indexed, and says nothing the gate can
// trust about what the card is. No row at all is its own answer.
async function cardAdoptionChain(
  scope: GateScope,
  url: URL,
): Promise<string[] | typeof GATE_MISSING | undefined> {
  let row = await scope.peekInstance(url);
  if (!row) {
    return GATE_MISSING;
  }
  if (row.type !== 'instance' || !row.types) {
    return undefined;
  }
  return row.types;
}

// Every grant for `name` in a rule whose type is in the target's adoption
// chain. The index records that chain on the target's row, a type and every
// type it descends from, so a rule on `CardDef` matches every card.
async function matchingGrants(
  policy: CompiledRealmPolicy,
  types: string[],
  name: string,
  access: OperationPolicyAccess,
): Promise<MatchedGrant[]> {
  let chain = new Set(types);
  let matched: MatchedGrant[] = [];
  for (let rule of policy.rules) {
    let keys = await ruleTypeKeys(rule, access);
    if (!keys.some((key) => chain.has(key))) {
      continue;
    }
    for (let grant of rule.grants) {
      if (grant.operation === name) {
        matched.push({ rule, grant });
      }
    }
  }
  return matched;
}

// A compiled policy is held until something it was compiled from moves,
// including the definition of every type its rules name, so one rule's type
// keys do not change while it is held. A lookup that fails is not remembered:
// the rule matches nothing for this invocation, and the next one asks again.
const typeKeys = new WeakMap<CompiledPolicyRule, string[]>();

async function ruleTypeKeys(
  rule: CompiledPolicyRule,
  access: OperationPolicyAccess,
): Promise<string[]> {
  let keys = typeKeys.get(rule);
  if (!keys) {
    try {
      keys = await access.typeKeys(rule.targetType);
    } catch {
      return [];
    }
    typeKeys.set(rule, keys);
  }
  return keys;
}

// What a predicate reads: the target's stored source, projected the way a
// mutation program sees it, so a path means the same thing in a predicate as
// in the operation's own program. That is the target's own scalars, contained
// values and relationship links. A computed value and a linked card's fields
// are not there, since those come from the index and lag the stored source.
interface PredicateSubject {
  input: unknown;
  // What `instance()` answers. Absent where there is no card for it to name.
  instance?: Record<string, unknown>;
}

// A card's stored source as a predicate reads it.
async function storedSubject(
  core: OperationCore,
  url: URL,
  typeDefinition: Definition | undefined,
  resource: CardResource,
): Promise<PredicateSubject | undefined> {
  let sourcePath = `${localPathFor(core, url)}.json` as LocalPath;
  let input = await projectedSource(core, typeDefinition, resource, {
    relativeTo: url,
    linksRelativeTo: pathsFor(core).fileURL(sourcePath),
    targetId: url.href,
  });
  return input === undefined
    ? undefined
    : {
        input,
        // What `instance()` answers, as it does for a mutation program.
        instance: { id: url.href, ...(resource.attributes ?? {}) },
      };
}

// A pending write's target card as the lock holds it. A card that is gone, or
// that is stored as a type other than the one its grants were matched on, is
// not what those grants admit, and is judged by nothing.
async function lockedSubject(
  core: OperationCore,
  href: string,
  decision: PendingDecision,
  storedSource: string | undefined,
): Promise<PredicateSubject | undefined> {
  let url = parseURL(href);
  let resource =
    storedSource === undefined ? undefined : cardResourceIn(storedSource);
  if (!url || !resource || !core.policy) {
    return undefined;
  }
  let adoptsFrom = resource.meta?.adoptsFrom;
  let storedType = adoptsFrom
    ? core.resolveCodeRef(adoptsFrom, url)
    : undefined;
  if (!storedType || !decision.matchedType) {
    return undefined;
  }
  let keys: string[];
  try {
    keys = await core.policy.typeKeys(storedType);
  } catch {
    return undefined;
  }
  if (!keys.includes(decision.matchedType)) {
    return undefined;
  }
  return await storedSubject(core, url, decision.typeDefinition, resource);
}

// The card a create against a type would mint, as a predicate reads it:
// projected through that card's own type, which for a named create is the type
// its declaration mints rather than the type it is declared on.
async function mintedSubject(
  core: OperationCore,
  minted: AdmissionSubject | undefined,
): Promise<PredicateSubject | undefined> {
  let url = minted ? parseURL(minted.id) : undefined;
  let resource = minted ? cardResourceIn(minted.source) : undefined;
  let adoptsFrom = resource?.meta?.adoptsFrom;
  let type =
    url && adoptsFrom ? core.resolveCodeRef(adoptsFrom, url) : undefined;
  if (!url || !resource || !type) {
    return undefined;
  }
  let definition: Definition | undefined;
  try {
    definition = await core.definitionLookup.lookupDefinition(type);
  } catch {
    return undefined;
  }
  let input = await projectedSource(core, definition, resource, {
    relativeTo: url,
    linksRelativeTo: new URL(`${url.href}.json`),
    targetId: url.href,
  });
  return input === undefined
    ? undefined
    : { input, instance: { id: url.href, ...(resource.attributes ?? {}) } };
}

// A card resource projected the way a mutation program sees it. Undefined
// where the type's definition is not in hand or the resource does not fit it.
async function projectedSource(
  core: OperationCore,
  typeDefinition: Definition | undefined,
  resource: CardResource,
  at: {
    // What the type's own code refs resolve against.
    relativeTo: URL;
    // The file the resource's relationship links are spelled relative to.
    linksRelativeTo: URL;
    // The card the resource is, where there is one yet.
    targetId?: string;
  },
): Promise<unknown> {
  if (!typeDefinition || !core.policy) {
    return undefined;
  }
  let policy = core.policy;
  try {
    let bxl = await loadBxlMutation();
    let schema = await bxl.mutationSchemaForCardSource(typeDefinition, {
      lookupDefinition: async (codeRef) => {
        let resolved = core.resolveCodeRef(codeRef, at.relativeTo);
        return resolved
          ? await core.definitionLookup.lookupDefinition(resolved)
          : undefined;
      },
    });
    return bxl.snapshotBxlCardSource({ data: resource }, schema, {
      ...(at.targetId ? { targetId: at.targetId } : {}),
      resolveReference: (reference) =>
        policy.resolvedLink(reference, at.linksRelativeTo),
    });
  } catch {
    return undefined;
  }
}

// Whether one predicate holds for this caller. Only `true` holds. Anything
// else it answers fails, and any way its evaluation throws is reported as that.
//
// It runs through the transform runner, the one BXL entry that carries the
// request context a predicate reads. `params()` is not supplied, so a
// predicate cannot read the payload even where compiling let one through.
//
// `realmConfig()` answers with the settings every operation reads. Those
// follow the index pass of `realm.json`, so a changed setting reaches a
// predicate when that pass lands, as an edit to the policy card reaches it
// when the card's pass lands.
async function evaluate(
  core: OperationCore,
  where: CompiledPolicyPredicate,
  subject: PredicateSubject,
  actor: string | undefined,
): Promise<'holds' | 'fails' | 'threw'> {
  try {
    let bxl = await loadBxlTransform();
    let realmConfig = where.canonical.includes('realmConfig')
      ? await core.realmConfig()
      : undefined;
    let answer = bxl.runBxlTransform(
      where.canonical,
      subject.input,
      {
        ...(actor === undefined ? {} : { actor }),
        ...(subject.instance ? { instance: subject.instance } : {}),
        ...(realmConfig === undefined ? {} : { realmConfig }),
      },
      { syntax: 'solidified' },
    );
    return answer === true ? 'holds' : 'fails';
  } catch {
    return 'threw';
  }
}

function parseURL(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function cardResourceIn(content: string): CardResource | undefined {
  let resource: unknown;
  try {
    resource = (JSON.parse(content) as { data?: unknown }).data;
  } catch {
    return undefined;
  }
  return isCardResource(resource) ? resource : undefined;
}

// BXL's mutation entry, for the projection a predicate reads. Loaded the way
// `executors.ts` loads it, and for the same reason: the specifier stays opaque
// to TypeScript so bxl's sources stay out of every consumer's typecheck.
let bxlMutation: Promise<BxlMutationModule> | undefined;

function loadBxlMutation(): Promise<BxlMutationModule> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  bxlMutation ??= import('@cardstack/bxl/mutation' as string).then(
    (module) => module as BxlMutationModule,
  );
  return bxlMutation;
}
