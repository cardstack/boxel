import type { ResolvedCodeRef } from '../code-ref.ts';
import type { Definition } from '../definitions.ts';
import { urlNamesFile } from '../file-def-code-ref.ts';
import { codeRefFromInternalKey } from '../index.ts';
import type { LocalPath } from '../paths.ts';
import { isCardResource } from '../card-document-shape.ts';
import type { CardResource } from '../resource-types.ts';
import { localPathFor, pathsFor } from './dispatch.ts';
import type { OperationCore, OperationScope } from './dispatch.ts';
import type { BxlMutationModule } from './executors.ts';
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
  // The URL of the card the realm's `policy` key names, or undefined for a
  // realm with no policy. Only the pointer: reading it loads nothing.
  policyCard(): Promise<string | undefined>;
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
  // here: they are carried to whatever takes the lock. Any one of them
  // holding admits the write.
  | { kind: 'pending'; grants: MatchedGrant[] };

// How often the gate loads a policy and evaluates a predicate, per core. A
// test asserts on these rather than on outcomes alone, since an outcome cannot
// show that a caller the ACL allowed never reached the policy.
export interface PolicyGateStats {
  policyLoads: number;
  predicateEvaluations: number;
}

const statsByCore = new WeakMap<OperationCore, PolicyGateStats>();

export function policyGateStats(core: OperationCore): PolicyGateStats {
  let stats = statsByCore.get(core);
  if (!stats) {
    stats = { policyLoads: 0, predicateEvaluations: 0 };
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
// resolved to `definition`, on `target`. `typeDefinition` is the target type's
// definition-cache entry, which describes the stored source a predicate
// reads.
export async function gateOperation(
  core: OperationCore,
  target: OperationTarget,
  name: string,
  definition: OperationDefinition,
  typeDefinition: Definition | undefined,
  scope: OperationScope,
): Promise<GateDecision> {
  let { base } = definition;
  if (!declines(scope, base)) {
    return { kind: 'coarse' };
  }
  let refuse = () => notPermitted(target, name);
  // An operation kept out of every policy's reach. This and the two checks
  // for authorization infrastructure below refuse before any rule is matched,
  // so a grant for it that a compiled policy holds is never consulted,
  // however that grant came to be there.
  if (definition.nonGrantable) {
    throw refuse();
  }
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
  // The realm's config card and the card its policy key names together
  // decide every grant, so no grant writes either, whatever their types
  // declare. A type marks only the operations it declares, and the policy
  // card's own type may leave one unmarked, so the rule follows the cards'
  // identities rather than their types.
  if (
    isWrite(base) &&
    (namesRealmConfigCard(core, url) ||
      (await namesPolicyCard(core.policy, url)))
  ) {
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
  // Once a grant would admit the invocation, and not before, so an
  // invocation that nothing grants pays no definition reads for a refusal it
  // was getting anyway. The target's own type is left out: the name resolved
  // against its entry, whose flag was read above.
  if (await nonGrantableInChain(core, url, row.types.slice(1), name)) {
    throw refuse();
  }
  let unconditional = matched.find(({ grant }) => !grant.where);
  if (unconditional) {
    return { kind: 'granted', grant: unconditional };
  }
  if (base !== 'read') {
    return { kind: 'pending', grants: matched };
  }
  // A read has one state to judge, and nothing to wait for, so its predicate
  // is evaluated here, against the target as it is stored now.
  let subject = await predicateSubject(core, url, typeDefinition);
  if (!subject) {
    throw refuse();
  }
  let actor = scope.caller.kind === 'user' ? scope.caller.actor : undefined;
  for (let candidate of matched) {
    let where = candidate.grant.where!;
    // A predicate annotated as reading a snapshot tier asks for computed or
    // linked values, and the gate reads the stored source alone. So it is
    // never evaluated, and its grant admits nothing.
    if (where.snapshot) {
      continue;
    }
    stats.predicateEvaluations++;
    if (await holds(core, where, subject, actor)) {
      return { kind: 'granted', grant: candidate };
    }
  }
  throw refuse();
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

// Whether any of these types, keys from a card's adoption chain, declares
// `name` non-grantable.
//
// A declaration a subclass writes takes the place of the one it inherits,
// flag and all, and the subclass's author decides what its definition entry
// says. So the flag is read from the types the index recorded the card under,
// not only from the definition the name resolved to: a subclass cannot make
// grantable what the type it extends kept out of a policy's reach.
//
// A type whose definition cannot be read might be the one holding the flag, so
// it answers yes.
export async function nonGrantableInChain(
  core: OperationCore,
  relativeTo: URL,
  types: string[],
  name: string,
): Promise<boolean> {
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
      let operations = definition?.operations;
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
  instance: Record<string, unknown>;
}

async function predicateSubject(
  core: OperationCore,
  url: URL,
  typeDefinition: Definition | undefined,
): Promise<PredicateSubject | undefined> {
  if (!typeDefinition) {
    return undefined;
  }
  let sourcePath = `${localPathFor(core, url)}.json` as LocalPath;
  let content = await core.readFileAsText(sourcePath);
  let resource = content === undefined ? undefined : cardResourceIn(content);
  if (!resource) {
    return undefined;
  }
  let fileURL = pathsFor(core).fileURL(sourcePath);
  try {
    let bxl = await loadBxlMutation();
    let schema = await bxl.mutationSchemaForCardSource(typeDefinition, {
      lookupDefinition: async (codeRef) => {
        let resolved = core.resolveCodeRef(codeRef, url);
        return resolved
          ? await core.definitionLookup.lookupDefinition(resolved)
          : undefined;
      },
    });
    let input = bxl.snapshotBxlCardSource({ data: resource }, schema, {
      targetId: url.href,
      resolveReference: (reference) =>
        core.policy!.resolvedLink(reference, fileURL),
    });
    return {
      input,
      // What `instance()` answers, as it does for a mutation program.
      instance: { id: url.href, ...(resource.attributes ?? {}) },
    };
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
        instance: subject.instance,
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
