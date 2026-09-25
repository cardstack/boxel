import type { ResolvedCodeRef } from '../code-ref.ts';
import type { Definition } from '../definitions.ts';
import { urlNamesFile } from '../file-def-code-ref.ts';
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
// resolved to `base`, on `target`. `typeDefinition` is the target type's
// definition-cache entry, which describes the stored source a predicate
// reads. `loaded` is the policy, where the caller already loaded it.
export async function gateOperation(
  core: OperationCore,
  target: OperationTarget,
  name: string,
  base: BaseOperation,
  typeDefinition: Definition | undefined,
  scope: OperationScope,
  loaded?: LoadedPolicy,
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
  // Nothing is there. A caller who may read the realm is told so, as the
  // operation would have told them; one who may not is told the same thing
  // they are told of a card the gate refuses.
  if (!row) {
    throw new OperationFailure({
      id: url.href,
      status: 404,
      code: 'target-not-found',
      title: 'Not found',
      detail: `${url.href} does not exist in realm ${core.realmURL}`,
    });
  }
  // An error row describes why the card could not be indexed, and says
  // nothing the gate can trust about what the card is.
  if (row.type !== 'instance' || !row.types) {
    throw refuse();
  }
  let { policy } = loaded ?? (await loadPolicy(core));
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
    return { kind: 'pending', grants: matched };
  }
  // A read has one state to judge, and nothing to wait for, so its predicate
  // is evaluated here, against the target as it is stored now.
  let subject = await predicateSubject(core, url, typeDefinition);
  if (!subject) {
    throw refuse();
  }
  let actor = scope.caller.kind === 'user' ? scope.caller.actor : undefined;
  let stats = policyGateStats(core);
  // A predicate that throws is a fault in the policy, but another grant can
  // still hold. Grants union, so the fault is reported only when none does,
  // and the answer is the same whatever order the grants are in.
  let threw = false;
  for (let candidate of matched) {
    let where = candidate.grant.where!;
    // A predicate annotated as reading a snapshot tier asks for computed or
    // linked values, and the gate reads the stored source alone. So it is
    // never evaluated, and its grant admits nothing.
    if (where.snapshot) {
      continue;
    }
    stats.predicateEvaluations++;
    let outcome = await evaluate(core, where, subject, actor);
    if (outcome === 'holds') {
      return { kind: 'granted', grant: candidate };
    }
    threw ||= outcome === 'threw';
  }
  if (threw) {
    throw new OperationFailure({
      id: url.href,
      status: 500,
      code: 'internal-error',
      title: 'Policy predicate failed',
      detail:
        `a predicate in the realm's policy failed while deciding whether ` +
        `operation "${name}" is permitted on ${url.href}`,
    });
  }
  throw refuse();
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
        instance: subject.instance,
        ...(realmConfig === undefined ? {} : { realmConfig }),
      },
      { syntax: 'solidified' },
    );
    return answer === true ? 'holds' : 'fails';
  } catch {
    return 'threw';
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
