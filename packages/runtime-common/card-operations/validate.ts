import {
  instanceTargetURL,
  scopeCallerFor,
  type OperationCore,
  type ScopeCaller,
} from './dispatch.ts';
import { namesRealmConfigCard } from './gate.ts';
import type { CompiledOperationGrant, CompiledRealmPolicy } from './policy.ts';
import {
  OperationFailure,
  type OperationRequest,
  type OperationValidateResult,
  type PolicyIssue,
  type PolicyValidation,
  type ValidatedGrantInertia,
  type ValidatedPolicyIssue,
} from './types.ts';

// ============================================================================
// The validate operation.
//
// A policy that does not fully compile is still in force: a grant that does
// not compile is left out, and the rest of the policy applies. So a policy
// with one bad grant looks, to everyone it governs, like a policy without
// that grant, and nothing tells its author so. A validate is the card telling
// them. Invoked on the policy card, it compiles the card as a realm that names
// it compiles it, and answers with every issue compiling recorded and with the
// rules and grants that compiled, which are the ones in force.
//
// It is an operation on the policy card, so it rides the transports and the
// gate every operation does. No grant ever reaches one, so only a caller the
// card's own realm lets read it gets this far.
//
// Compiling reads the card's row and the definitions of the types its rules
// name, on the realm server's own authority, as a realm's policy cache does.
// What it reports describes those definitions: whether a type is there, the
// operations it declares and which of them no policy may grant, the fields a
// search filter could read. The lookup reads a module in a realm this server
// serves as that realm's own owner, and the card can name types in any such
// realm, one its reader may not be able to read. So the answer is given only
// to a caller who can read every realm this server serves that compiling read
// from, and is refused otherwise. The caller is judged in each of those realms
// as an explain judges one: by a session vouched for as their own. A module
// in a realm served elsewhere is read as the owner of the card's realm, as
// every card in that realm is, so what it discloses is already what the card's
// realm discloses to its readers. Nothing compiling reads is cached or put in
// force.
//
// Invoked on the realm's config card, it answers for the card the realm's
// pointer names, compiled with this realm's own compile environment, which is
// the one its policy cache compiles with. Two problems live in the pointer
// rather than in any policy card, a card the index does not hold and a card
// that is not a RealmPolicy, and this is where their author sees them.
// ============================================================================

export async function validateOperation(
  core: OperationCore,
  request: OperationRequest,
): Promise<OperationValidateResult> {
  let card = instanceTargetURL(request);
  let asker = scopeCallerFor(request.principal ?? '');
  if (namesRealmConfigCard(core, card)) {
    return {
      validation: await realmPolicyValidation(core, request, card, asker),
    };
  }
  if (!core.compilePolicyCard) {
    throw cannotCompile(card, request);
  }
  let { compiled, reads } = await core.compilePolicyCard(card);
  let realms = await servedRealmsRead(core, asker, reads);
  if (!realms) {
    throw notReported(card, card.href);
  }
  return { validation: validation(compiled, realms) };
}

// The policy the realm's pointer names, for a validate of its config card.
//
// A realm writer may point the realm at a card in any realm, including one
// they cannot read, and what this answers says whether a card is there and
// what it holds. Whether a card is there is exactly what a refusal withholds
// from a caller who cannot read its realm. So the realm holding the card is
// judged before anything about the card is read, and must be one this server
// serves and the caller reads: a pointer into a realm the caller cannot read,
// an archived one, or one no realm here serves is refused in the same bytes,
// whatever is or is not there. A realm URL nothing serves is not itself a
// secret, but this cannot tell one from a realm that is registered and failed
// to mount, whose cards are still in the index and are not the caller's to be
// told about. The rest of what compiling reads is judged as a validate of the
// policy card judges it.
//
// Compiled rather than read from the realm's policy cache, since the answer is
// refused unless the caller reads every realm compiling read, which only a
// compile reports. The cache compiles the same card with the same environment,
// and revalidates within five seconds of a change to anything it read, so
// what this reports is in force here within that bound.
async function realmPolicyValidation(
  core: OperationCore,
  request: OperationRequest,
  card: URL,
  asker: ScopeCaller,
): Promise<PolicyValidation> {
  if (!core.policy || !core.compilePolicyCard) {
    throw cannotCompile(card, request);
  }
  let pointer = await core.policy.policyCard();
  if (!pointer) {
    return { realms: [], issues: [], rules: [] };
  }
  if ((await core.readsRealmOf?.(pointer, asker))?.read !== true) {
    throw new OperationFailure({
      id: card.href,
      status: 403,
      code: 'operation-not-permitted',
      title: 'Operation not permitted',
      detail:
        `the card this realm's policy pointer names is not in a realm you ` +
        `can read here, so whether it is there, and what it compiles to, is ` +
        `not reported to you`,
    });
  }
  let { compiled, reads } = await core.compilePolicyCard(new URL(pointer));
  let realms = await servedRealmsRead(core, asker, reads);
  if (!realms) {
    throw notReported(card, `the policy this realm names`);
  }
  return validation(compiled, realms);
}

function cannotCompile(card: URL, request: OperationRequest): OperationFailure {
  return new OperationFailure({
    id: card.href,
    status: 500,
    code: 'internal-error',
    title: 'Cannot validate',
    detail: `operation "${request.name}" compiles a policy card, and this realm cannot compile one`,
  });
}

function notReported(card: URL, compiling: string): OperationFailure {
  return new OperationFailure({
    id: card.href,
    status: 403,
    code: 'operation-not-permitted',
    title: 'Operation not permitted',
    detail:
      `compiling ${compiling} reads definitions in a realm you cannot ` +
      `read, so what it compiles to is not reported to you`,
  });
}

// The realms this server serves that one of the URLs is in, each once in the
// order first read, when the caller may read every one of them. Undefined
// when they may not, and from a core that cannot say.
async function servedRealmsRead(
  core: OperationCore,
  asker: ScopeCaller,
  urls: string[],
): Promise<string[] | undefined> {
  if (!core.readsRealmOf) {
    return undefined;
  }
  let realms: string[] = [];
  for (let url of urls) {
    let served = await core.readsRealmOf(url, asker);
    if (!served) {
      continue;
    }
    if (!served.read) {
      return undefined;
    }
    if (!realms.includes(served.realm)) {
      realms.push(served.realm);
    }
  }
  return realms;
}

function validation(
  compiled: CompiledRealmPolicy,
  realms: string[],
): PolicyValidation {
  return {
    card: compiled.card,
    realms,
    ...(compiled.version !== undefined ? { version: compiled.version } : {}),
    ...(compiled.uncompilable ? { uncompilable: true as const } : {}),
    issues: compiled.issues.map(positioned),
    rules: compiled.rules.map((rule) => ({
      path: rule.path,
      grants: rule.grants.map((grant) => {
        let inertia = inertiaOf(grant, compiled.issues);
        return {
          path: grant.path,
          ...(inertia ? { admitsNothing: inertia } : {}),
        };
      }),
    })),
  };
}

// Why a grant that compiled can admit nothing, if it can't. A grant that
// carries a search filter is on a query, and admits what the filter matches.
// Without one, a grant on a query is recorded as not filterable.
function inertiaOf(
  grant: CompiledOperationGrant,
  issues: PolicyIssue[],
): ValidatedGrantInertia | undefined {
  if (grant.filter) {
    return undefined;
  }
  if (
    issues.some(
      (issue) =>
        issue.code === 'policy-not-filterable' &&
        issue.path === `${grant.path}.where`,
    )
  ) {
    return 'unfilterable';
  }
  return undefined;
}

// A path names the rule it falls under as `rules[i]`, and the grant as
// `rules[i].grants[j]`, before whatever it names inside them. A path about
// the card as a whole, or about its `rules` as a whole, names neither.
const POSITION = /^rules\[(\d+)\](?:\.grants\[(\d+)\])?/;

function positioned(issue: PolicyIssue): ValidatedPolicyIssue {
  let match = POSITION.exec(issue.path);
  if (!match) {
    return { ...issue };
  }
  return {
    ...issue,
    rule: Number(match[1]),
    ...(match[2] !== undefined ? { grant: Number(match[2]) } : {}),
  };
}
