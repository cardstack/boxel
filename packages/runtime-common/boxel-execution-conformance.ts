/**
 * The machinery that holds the execution tiers to the protocol they share.
 *
 * RP-15.4 names three pieces of conformance machinery. This module is the
 * third — the **record diff** (RP-14.4): for one input, every tier must
 * produce deep-equal `BoxelDescription` and `InstanceProjection` records,
 * modulo the members the spec declares tier-specific, which are enumerated in
 * `TIER_SPECIFIC_RECORD_PATHS`. The other two, the main-equivalence oracle and
 * the cross-tier render suite, compare rendered behavior rather than records,
 * and are not here.
 *
 * Why this lives beside the protocol module rather than inside it: the two have
 * opposite constraints. The protocol module's runtime closure is held equal to
 * its own directory, because it is evaluated where the Host's module graph is
 * absent — inside a SES Compartment and inside an iframe child. A conformance
 * harness never crosses into either, and paying for it in every cage would
 * make the guard on that closure mean less rather than more. It reads the
 * protocol's own normalizer by path and adds nothing to what a cage carries.
 *
 * Why it lives in `runtime-common` rather than in a test suite: what counts as
 * record equality has to be one rule, and it is asked from more than one
 * package — a harness comparing one tier's record against an expected one, a
 * harness comparing two tiers, and a server-side assertion about records built
 * in another process all ask it. A rule that lives inside one suite gets a
 * second copy the first time a caller outside that suite needs it, and two
 * parity rules is how the answer starts depending on who asked.
 * `searchable-parity.ts` is the precedent: one diff rule here, imported by a
 * realm-server script and by its tests.
 *
 * Deliberately absent from `index.ts`. Nothing on a render path calls this, so
 * a consumer names the file:
 * `@cardstack/runtime-common/boxel-execution-conformance`.
 */

export * from './boxel-execution-conformance/record-diff.ts';
export * from './boxel-execution-conformance/tier-parity.ts';
