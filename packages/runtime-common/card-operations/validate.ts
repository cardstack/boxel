import {
  instanceTargetURL,
  scopeCallerFor,
  type OperationCore,
} from './dispatch.ts';
import { namesRealmConfigCard } from './gate.ts';
import type { CompiledRealmPolicy } from './policy.ts';
import {
  OperationFailure,
  type OperationRequest,
  type OperationValidateResult,
  type PolicyIssue,
  type PolicyValidation,
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
// card's own realm lets read it is answered, which is also who can read the
// card's rules.
//
// Compiling reads the card's row and the definitions of the types its rules
// name, on the realm server's own authority, as a realm's policy cache does.
// Nothing it compiles is cached or put in force.
//
// Invoked on the realm's config card, it answers for the policy the realm
// names, from the realm's own compilation: what is in force, rather than what
// compiling the card again would say. Two problems live in the pointer rather
// than in any policy card, a card the index does not hold and a card that is
// not a RealmPolicy, and this is where their author sees them.
// ============================================================================

export async function validateOperation(
  core: OperationCore,
  request: OperationRequest,
): Promise<OperationValidateResult> {
  let card = instanceTargetURL(request);
  if (namesRealmConfigCard(core, card)) {
    return { validation: await realmPolicyValidation(core, request, card) };
  }
  if (!core.compilePolicyCard) {
    throw new OperationFailure({
      id: card.href,
      status: 500,
      code: 'internal-error',
      title: 'Cannot validate',
      detail: `operation "${request.name}" compiles a policy card, and this realm cannot compile one`,
    });
  }
  let compiled = await core.compilePolicyCard(card);
  return { validation: validation(compiled) };
}

// The realm's policy as the realm holds it, for a validate of its config card.
//
// A realm writer may point the realm at a card in any realm, including one
// they cannot read, and what this answers says whether a card is there and
// what it holds. Whether a card is there is exactly what a refusal withholds
// from a caller who cannot read its realm. So, as with an explain, the caller
// must be able to read both realms: the config card's, which the gate checks,
// since no grant reaches the config card, and the policy card's, which this
// checks, judged by a session that realm would accept as the caller's own.
// A caller who cannot read the policy card's realm, or whose policy card is
// in no realm this server serves, gets one refusal, the same bytes whatever
// the card is or whether it is there.
async function realmPolicyValidation(
  core: OperationCore,
  request: OperationRequest,
  card: URL,
): Promise<PolicyValidation> {
  if (!core.policy) {
    throw new OperationFailure({
      id: card.href,
      status: 500,
      code: 'internal-error',
      title: 'Cannot validate',
      detail: `operation "${request.name}" reports the realm's policy, and this realm cannot read one`,
    });
  }
  let compiled = await core.policy.compiledPolicy();
  if (!compiled) {
    return { issues: [], rules: [] };
  }
  let asker = scopeCallerFor(request.principal ?? '');
  let holder = await core.targetRealm?.(compiled.card);
  if (!holder || !(await holder.aclFor(asker)).read) {
    throw new OperationFailure({
      id: card.href,
      status: 403,
      code: 'operation-not-permitted',
      title: 'Operation not permitted',
      detail: `the realm's policy card is not in a realm you can read, so what it compiles to is reported only to a caller who can read that realm`,
    });
  }
  return validation(compiled);
}

function validation(compiled: CompiledRealmPolicy): PolicyValidation {
  return {
    card: compiled.card,
    ...(compiled.version !== undefined ? { version: compiled.version } : {}),
    ...(compiled.uncompilable ? { uncompilable: true as const } : {}),
    issues: compiled.issues.map(positioned),
    rules: compiled.rules.map((rule) => ({
      path: rule.path,
      grants: rule.grants.map((grant) => ({ path: grant.path })),
    })),
  };
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
