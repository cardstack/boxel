import type { ResolvedCodeRef } from '../code-ref.ts';
import type { Definition } from '../definitions.ts';
import { urlNamesFile } from '../file-def-code-ref.ts';
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
  type OperationTarget,
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
// Every way the gate can fail denies. A policy that is gone, a compiled policy
// with no rule for the type, a predicate that throws or answers anything but
// `true`, and a target whose type the index cannot vouch for are each a
// refusal, never an opening.
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
}

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
// exists, not its type, and not what the policy holds.
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

// Decide whether a caller the realm ACL declined may invoke `name`, which
// resolved to `base`, on `target`. `typeDefinition` is the target type's
// definition-cache entry, which describes the stored source a predicate
// reads.
export async function gateOperation(
  core: OperationCore,
  target: OperationTarget,
  name: string,
  base: BaseOperation,
  typeDefinition: Definition | undefined,
  scope: OperationScope,
): Promise<GateDecision> {
  if (!declines(scope, base)) {
    return { kind: 'coarse' };
  }
  let refuse = () => notPermitted(target, name);
  // A stored-bytes read resolves before any definition, and a query is planned
  // and run on the search engine. Neither is granted here.
  if (base === 'readSource' || base === 'query') {
    throw refuse();
  }
  // A rule matches the adoption chain the index recorded on the target's card
  // row. A type target has no row, and a file is not a card, so neither is
  // matched by a rule here.
  if (target.kind !== 'instance') {
    throw refuse();
  }
  let url = parseURL(target.url);
  if (!url || urlNamesFile(url) || !core.policy) {
    throw refuse();
  }
  let row = await scope.peekInstance(url);
  // An error row describes why the card could not be indexed, and says
  // nothing the gate can trust about what the card is.
  if (row?.type !== 'instance' || !row.types) {
    throw refuse();
  }
  let stats = policyGateStats(core);
  stats.policyLoads++;
  let policy = await core.policy.compiledPolicy();
  if (!policy) {
    throw refuse();
  }
  let matched = await matchingGrants(policy, row.types, name, core.policy);
  if (matched.length === 0) {
    throw refuse();
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
      ...(row.types[0] ? { matchedType: row.types[0] } : {}),
    };
  }
  // A read has one state to judge, and nothing to wait for, so its predicate
  // is evaluated here, against the target as it is stored now.
  let content = await core.readFileAsText(
    `${localPathFor(core, url)}.json` as LocalPath,
  );
  let resource = content === undefined ? undefined : cardResourceIn(content);
  let subject = resource
    ? await storedSubject(core, url, typeDefinition, resource)
    : undefined;
  let granted = subject
    ? await firstHolding(core, matched, subject, scope)
    : undefined;
  if (!granted) {
    throw refuse();
  }
  return { kind: 'granted', grant: granted };
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
  if (!(await admits(core, pending, judged))) {
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
  return await admits(
    core,
    pending,
    source === undefined ? undefined : { id: url.href, source },
  );
}

async function admits(
  core: OperationCore,
  { target, decision, scope }: PendingWrite,
  judged: AdmissionSubject | undefined,
): Promise<boolean> {
  let subject =
    target.kind === 'instance'
      ? await lockedSubject(core, target.url, decision, judged?.source)
      : await mintedSubject(core, judged);
  return (
    subject !== undefined &&
    (await firstHolding(core, decision.grants, subject, scope)) !== undefined
  );
}

// The first grant whose predicate holds for this caller against `subject`.
async function firstHolding(
  core: OperationCore,
  grants: MatchedGrant[],
  subject: PredicateSubject,
  scope: OperationScope,
): Promise<MatchedGrant | undefined> {
  let stats = policyGateStats(core);
  let actor = scope.caller.kind === 'user' ? scope.caller.actor : undefined;
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
    if (await holds(core, where, subject, actor)) {
      return candidate;
    }
  }
  return undefined;
}

// Whether the realm ACL declined this invocation. A caller declined only
// writes keeps the ACL's answer for every read.
function declines(scope: OperationScope, base: BaseOperation): boolean {
  return (
    scope.coarseDeclined === 'all' ||
    (scope.coarseDeclined === 'writes' && isWrite(base))
  );
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
// else it answers, and any way it fails, does not.
//
// It runs through the transform runner, the one BXL entry that carries the
// request context a predicate reads. `params()` is not supplied, so a
// predicate cannot read the payload even where compiling let one through.
//
// `realmConfig()` answers with the settings every operation reads. Those
// follow the index pass of `realm.json`, so a changed setting reaches a
// predicate when that pass lands, as an edit to the policy card reaches it
// when the card's pass lands.
async function holds(
  core: OperationCore,
  where: CompiledPolicyPredicate,
  subject: PredicateSubject,
  actor: string | undefined,
): Promise<boolean> {
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
    return answer === true;
  } catch {
    return false;
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

function parseURL(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
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
