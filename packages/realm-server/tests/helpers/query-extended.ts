// The heavy generated query cases run in full only when QUERY_TESTS_EXTENDED=1
// (a scheduled run, or by hand before a release). A pull request runs a
// fixed, seeded part of each, so a failure on either run names an input that
// fails again the same way. Cases that once found a defect are never sampled
// out: each suite keeps them on the always-run side of its gate.
export const queryTestsExtended = process.env.QUERY_TESTS_EXTENDED === '1';

// `onPullRequest` when the extended run is off, `extended` when it is on.
export function sized<T>(onPullRequest: T, extended: T): T {
  return queryTestsExtended ? extended : onPullRequest;
}
