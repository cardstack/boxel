// The request-context calls BXL's `policy` profile denies: who is asking, the
// card it asks about, the governed realm's own settings, and the policy card's
// own fields. A policy's expressions are still written against some of them,
// so each kind of expression admits the ones it reads.
export type RequestContextCall =
  | 'actor'
  | 'instance'
  | 'realmConfig'
  | 'policy';

// The errors the `policy` profile raised against an expression, less its
// denial of the calls in `admitted`.
//
// The profile reports a denied call only in its message, so the exception is
// matched there. If that wording changes, nothing matches. The calls are then
// refused rather than admitted, so a drift fails closed.
export function profileRefusals<
  Issue extends { code: string; severity: string; message: string },
>(issues: readonly Issue[], admitted: readonly RequestContextCall[]): Issue[] {
  let denial = new RegExp(` does not allow call (?:${admitted.join('|')}):`);
  return issues.filter(
    (issue) =>
      issue.severity === 'error' &&
      !(issue.code === 'policy-call-banned' && denial.test(issue.message)),
  );
}
