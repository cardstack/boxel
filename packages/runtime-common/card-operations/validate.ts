import {
  instanceTargetURL,
  scopeCallerFor,
  type OperationCore,
  type ScopeCaller,
} from './dispatch.ts';
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
// ============================================================================

export async function validateOperation(
  core: OperationCore,
  request: OperationRequest,
): Promise<OperationValidateResult> {
  let card = instanceTargetURL(request);
  if (!core.compilePolicyCard) {
    throw new OperationFailure({
      id: card.href,
      status: 500,
      code: 'internal-error',
      title: 'Cannot validate',
      detail: `operation "${request.name}" compiles a policy card, and this realm cannot compile one`,
    });
  }
  let { compiled, reads } = await core.compilePolicyCard(card);
  let asker = scopeCallerFor(request.principal ?? '');
  if (!(await readsEveryServedRealm(core, asker, reads))) {
    throw new OperationFailure({
      id: card.href,
      status: 403,
      code: 'operation-not-permitted',
      title: 'Operation not permitted',
      detail:
        `compiling ${card.href} reads definitions in a realm you cannot ` +
        `read, so what it compiles to is not reported to you`,
    });
  }
  return { validation: validation(compiled) };
}

// Whether the caller may read every realm this server serves that one of the
// URLs is in. A core that cannot say judges no one able to.
async function readsEveryServedRealm(
  core: OperationCore,
  asker: ScopeCaller,
  urls: string[],
): Promise<boolean> {
  if (!core.readsRealmOf) {
    return false;
  }
  for (let url of urls) {
    if ((await core.readsRealmOf(url, asker)) === false) {
      return false;
    }
  }
  return true;
}

function validation(compiled: CompiledRealmPolicy): PolicyValidation {
  return {
    card: compiled.card,
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
// Without one, a grant on a query is recorded as not filterable, and a grant
// on anything else whose predicate reads a snapshot tier is one the gate never
// evaluates.
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
  return grant.where?.snapshot ? 'snapshot' : undefined;
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
