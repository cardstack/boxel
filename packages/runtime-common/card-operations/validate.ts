import { instanceTargetURL, type OperationCore } from './dispatch.ts';
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
  let compiled = await core.compilePolicyCard(card);
  return { validation: validation(compiled) };
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
