/**
 * The machinery that holds the execution tiers to the protocol they share.
 *
 * RP-15.4 names three pieces of conformance machinery. This module is the
 * third — the **record diff** (RP-14.4): for one input, every tier must
 * produce deep-equal `BoxelDescription` and `InstanceProjection` records,
 * modulo the members the spec declares tier-specific, of which there are
 * currently none. The other two, the main-equivalence oracle and the
 * cross-tier render suite, compare rendered behavior rather than records, and
 * are not here.
 *
 * Why this lives beside the protocol module rather than inside it: the two have
 * opposite constraints. The protocol module's runtime closure is held equal to
 * its own directory, because it is evaluated where the Host's module graph is
 * absent — inside a SES Compartment and inside an iframe child. A conformance
 * harness never crosses into either, and paying for it in every cage would
 * make the guard on that closure mean less rather than more. It reads the
 * protocol's own normalizer by path and adds nothing to what a cage carries.
 *
 * Why it lives in `runtime-common` rather than in a test suite: judging parity
 * is one rule, and more than one caller needs it. Today the caller is a host
 * conformance suite; the equivalence oracle will diff main's records against
 * Direct's with no tier notion at all, and a realm-server prerender assertion
 * will ask the same question of records built server-side. A rule that lives in
 * one suite gets a second copy the first time a second caller needs it, and
 * two parity rules is how the answer starts depending on who asked. The
 * precedent is `searchable-parity.ts`, which is shared between a
 * realm-server script and its tests for exactly that reason.
 *
 * Deliberately absent from `index.ts`. Nothing on a render path calls this, so
 * a consumer names the file:
 * `@cardstack/runtime-common/boxel-execution-conformance`.
 */

export * from './boxel-execution-conformance/record-diff.ts';
export * from './boxel-execution-conformance/tier-parity.ts';
