import type { ResolvedCodeRef } from '../code-ref.ts';
import type { Definition } from '../definitions.ts';
import type { LocalPath } from '../paths.ts';
import { isCardResource } from '../card-document-shape.ts';
import type { CardResource } from '../resource-types.ts';
import { policyFileDefCodeRef } from '../policy-file-def.ts';
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
  // A stored path that names no card. Only a stored-bytes read is matched
  // against one, and it resolves what the path actually holds for itself:
  // the extension table names a file's type, but it does not name every
  // stored file, and a card's own document is addressed through one of those
  // extensions too. Every other behavior treats this as unmatched.
  | { kind: 'file'; url: URL }
  // A target no rule is matched against: a URL that does not parse.
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

// How often the gate loads a policy, evaluates a predicate and reads a
// definition, per core, and how many pending writes were decided under a
// write lock. A test asserts on these rather than on outcomes alone, since an
// outcome cannot show that a caller the ACL allowed never reached the policy,
// or that a read never reached a lock.
//
// `definitionLookups` counts the lookups the gate makes to *type its target*,
// which a stored-bytes read is the only behavior to need: that read resolves
// before any definition, so the gate buys one back to learn what the bytes
// are. Every other behavior arrives with the entry its own resolution already
// read and adds nothing here. It does not count the field lookups a predicate
// projection makes through the definition callback, which every predicate
// path shares whatever resolved its target.
export interface PolicyGateStats {
  policyLoads: number;
  predicateEvaluations: number;
  pendingDischarges: number;
  definitionLookups: number;
}

const statsByCore = new WeakMap<OperationCore, PolicyGateStats>();

export function policyGateStats(core: OperationCore): PolicyGateStats {
  let stats = statsByCore.get(core);
  if (!stats) {
    stats = {
      policyLoads: 0,
      predicateEvaluations: 0,
      pendingDischarges: 0,
      definitionLookups: 0,
    };
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
// resolved to `definition`, on `subject`. `typeDefinition` is the target
// type's definition-cache entry, which describes the stored source a predicate
// reads.
export async function gateOperation(
  core: OperationCore,
  subject: GateSubject,
  name: string,
  definition: OperationDefinition,
  typeDefinition: Definition | undefined,
  scope: GateScope,
): Promise<GateDecision | typeof GATE_REFUSED> {
  let { base } = definition;
  if (!declines(scope, base)) {
    return { kind: 'coarse' };
  }
  // A query is planned and run on the search engine rather than against one
  // target, so nothing here can grant one.
  if (base === 'query') {
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
  // A file subject is a path that names no card, and a stored-bytes read is
  // the only behavior that addresses one. A file's metadata document is a
  // `read`, which is granted on cards alone.
  if (subject.kind === 'file' && base !== 'readSource') {
    return GATE_REFUSED;
  }
  let identified = await identifySubject(scope, subject, base);
  if (!identified) {
    return GATE_REFUSED;
  }
  let stats = policyGateStats(core);
  stats.policyLoads++;
  let policy = await core.policy.compiledPolicy();
  if (!policy) {
    return GATE_REFUSED;
  }
  // Only now, with a policy in hand, is a file's type worth reading: it costs
  // the definition lookup a stored-bytes read exists to skip, and a realm
  // with no policy has nothing to spend it on.
  let matchOn = await typedSubject(core, identified);
  if (!matchOn) {
    return GATE_REFUSED;
  }
  let { types } = matchOn;
  let matched = await matchingGrants(policy, types, name, core.policy);
  if (matched.length === 0) {
    return GATE_REFUSED;
  }
  let unconditional = matched.find(({ grant }) => !grant.where);
  if (unconditional) {
    return { kind: 'granted', grant: unconditional };
  }
  if (isWrite(base)) {
    return {
      kind: 'pending',
      grants: matched,
      typeDefinition,
      ...(matchOn.kind === 'card' && types[0] ? { matchedType: types[0] } : {}),
    };
  }
  // A read has one state to judge, and nothing to wait for, so its predicate
  // is evaluated here, against the target as it is stored now.
  let stored = await readSubject(core, scope, matchOn, typeDefinition);
  let granted = stored
    ? await firstHolding(core, matched, stored, scope)
    : undefined;
  return granted ? { kind: 'granted', grant: granted } : GATE_REFUSED;
}

// The target as the index identifies it, before any policy is loaded. This is
// the half of matching that costs an index peek and a table lookup, and it
// runs first so that a realm with no policy spends nothing more than it
// spends today.
type IdentifiedSubject =
  | { kind: 'card'; url: URL; types: string[] }
  // A stored file that holds no card, named by the `FileDef` its extension
  // resolves to. The chain that ref stands for is read later.
  | { kind: 'file'; url: URL; codeRef: ResolvedCodeRef }
  | { kind: 'type'; types: string[] };

// What the gate matches rules against, and what a predicate reads if one has
// to be evaluated.
type MatchedSubject =
  | { kind: 'card'; url: URL; types: string[] }
  // A stored file's chain is its `FileDef` subclass and every type that class
  // descends from, so a rule naming `FileDef` covers any data file while a
  // rule naming `PdfDef` covers only a `.pdf`.
  | { kind: 'file'; url: URL; types: string[] }
  | { kind: 'type'; types: string[] };

// Which target the rules will be matched against.
//
// A stored-bytes read is the one behavior that identifies its own target
// here, because it is the one resolved before any definition — every other
// behavior arrives with the type its own resolution already read. It also has
// the one target that is genuinely two things: the path a card's document is
// stored at is addressed through a file extension like any other file.
async function identifySubject(
  scope: GateScope,
  // Never the unmatched target: nothing is matched against one, and the gate
  // has refused it before reaching here.
  subject: Exclude<GateSubject, { kind: 'unmatched' }>,
  base: BaseOperation,
): Promise<IdentifiedSubject | undefined> {
  if (subject.kind === 'type') {
    return subject;
  }
  if (base !== 'readSource') {
    // Every other behavior runs against a stored card, matched on its row.
    if (subject.kind !== 'card') {
      return undefined;
    }
    let types = await cardAdoptionChain(scope, subject.url);
    return types ? { kind: 'card', url: subject.url, types } : undefined;
  }
  return await identifyStoredBytes(scope, subject.url);
}

// What the bytes at a path are, for the read that serves them.
//
// Which of the two a path is, is the index's answer rather than the name's. A
// card's document is stored at its id plus `.json` and nothing else is, so a
// `.json` path the index holds a row for is that card's source and is matched
// on the card's own type — a `Classroom`, never a `JsonFileDef`. Every path
// the index has no card at is a file, including the extensions the file-def
// table does not name: a `.css` or a `.yml` has no def written for it and
// resolves to `FileDef` itself, which is what lets one rule cover any data
// file.
//
// The presence of a row decides it, not whether that row indexed cleanly. An
// error row says the path holds a card the realm could not index, and a card
// whose type the gate cannot vouch for is matched by nothing at all. Reading
// it as the file its extension claims is the one answer that must not be
// given: it would let a grant on `FileDef` — "any data file" — serve the raw
// source of every card in the realm that happens to be broken.
//
// Module source is the remaining path with no answer. It resolves to no type,
// so no rule can name it and no grant can reach it.
async function identifyStoredBytes(
  scope: GateScope,
  url: URL,
): Promise<IdentifiedSubject | undefined> {
  let id = cardSourceId(url) ?? url;
  let row = await scope.peekInstance(id);
  if (row) {
    return row.type === 'instance' && row.types
      ? { kind: 'card', url: id, types: row.types }
      : undefined;
  }
  let codeRef = policyFileDefCodeRef(url.pathname);
  return codeRef ? { kind: 'file', url, codeRef } : undefined;
}

// The identified target with the adoption chain rules are matched on. Only a
// file has one still to read; a card's came off its row and a type's off the
// entry its definition was read from.
async function typedSubject(
  core: OperationCore,
  subject: IdentifiedSubject,
): Promise<MatchedSubject | undefined> {
  if (subject.kind !== 'file') {
    return subject;
  }
  let types = await fileAdoptionChain(core, subject.codeRef, subject.url);
  return types ? { kind: 'file', url: subject.url, types } : undefined;
}

// The card whose stored document a path holds, if the path is spelled as one.
// Only the `.json` spelling addresses a card's bytes; a card's id never
// carries an extension.
function cardSourceId(url: URL): URL | undefined {
  if (!url.pathname.endsWith('.json')) {
    return undefined;
  }
  let id = new URL(url.href);
  id.pathname = id.pathname.slice(0, -'.json'.length);
  return id;
}

// The adoption chain of the `FileDef` a stored file's extension names, read
// from the definition cache the way a create's type chain is.
//
// This is the lookup a stored-bytes read exists to skip, and skipping it is
// why nothing reaches here until the realm ACL has already declined: a caller
// the ACL allowed is answered before the gate runs at all, so only the
// already-slower branch pays it, and it pays a definition-cache hit rather
// than an index read.
async function fileAdoptionChain(
  core: OperationCore,
  codeRef: ResolvedCodeRef,
  relativeTo: URL,
): Promise<string[] | undefined> {
  let resolved = core.resolveCodeRef(codeRef, relativeTo);
  if (!resolved) {
    return undefined;
  }
  policyGateStats(core).definitionLookups++;
  try {
    return (await core.definitionLookup.lookupDefinitionEntry(resolved))?.types;
  } catch {
    return undefined;
  }
}

// What a read's predicate is evaluated against.
//
// A card is read as its stored source, the same projection a mutation program
// sees. A data file has no document to interrogate at all: a predicate on one
// reads the path it names through `instance()` and the caller through
// `actor()`, and anything else it reaches for finds nothing and so does not
// hold.
async function readSubject(
  core: OperationCore,
  scope: GateScope,
  matched: MatchedSubject,
  typeDefinition: Definition | undefined,
): Promise<PredicateSubject | undefined> {
  if (matched.kind === 'file') {
    return { input: undefined, instance: { id: matched.url.href } };
  }
  if (matched.kind !== 'card') {
    return undefined;
  }
  let content = await core.readFileAsText(
    `${localPathFor(core, matched.url)}.json` as LocalPath,
  );
  let resource = content === undefined ? undefined : cardResourceIn(content);
  if (!resource) {
    return undefined;
  }
  let definition =
    typeDefinition ?? (await cardTypeDefinition(core, scope, matched.url));
  return await storedSubject(core, matched.url, definition, resource);
}

// The definition of the type a stored card names, for a read that resolved
// without one.
//
// A stored-bytes read is the only read that arrives here with no definition in
// hand, so this is the definition lookup its card-source grants cost — and
// only where a grant carries a predicate, since an unconditional one is
// admitted before anything is read. The type comes off the card's index row,
// which is the same row the grants were matched on, so the predicate is
// projected through the type those grants were judged against.
async function cardTypeDefinition(
  core: OperationCore,
  scope: GateScope,
  url: URL,
): Promise<Definition | undefined> {
  let row = await scope.peekInstance(url);
  let adoptsFrom =
    row?.type === 'instance' ? row.instance.meta?.adoptsFrom : undefined;
  if (!adoptsFrom) {
    return undefined;
  }
  let resolved = core.resolveCodeRef(adoptsFrom, url);
  if (!resolved) {
    return undefined;
  }
  policyGateStats(core).definitionLookups++;
  try {
    return await core.definitionLookup.lookupDefinition(resolved);
  } catch {
    return undefined;
  }
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
  scope: GateScope,
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
function declines(scope: GateScope, base: BaseOperation): boolean {
  return (
    scope.coarseDeclined === 'all' ||
    (scope.coarseDeclined === 'writes' && isWrite(base))
  );
}

// The adoption chain the index recorded on a card's row. An error row
// describes why the card could not be indexed, and says nothing the gate can
// trust about what the card is.
async function cardAdoptionChain(
  scope: GateScope,
  url: URL,
): Promise<string[] | undefined> {
  let row = await scope.peekInstance(url);
  if (row?.type !== 'instance' || !row.types) {
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
