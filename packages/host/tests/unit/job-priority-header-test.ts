import { module, test } from 'qunit';

import { userInitiatedPriority } from '@cardstack/runtime-common';

import { resolveOutboundJobPriority } from '@cardstack/host/services/store';

// Pure-resolver tests for the policy that decides what
// `X-Boxel-Job-Priority` value the host SPA stamps on outbound
// `_federated-search` calls. The function is module-internal logic
// extracted so its policy can be pinned without acceptance-test
// scaffolding.
//
// Two states gated by `__boxelDuringPrerender`:
//   - inside prerender → forward (preserve 0)
//   - outside prerender → user-initiated (10) by default
module('Unit | job-priority-header | resolveOutboundJobPriority', function () {
  module('outside a prerender tab (user / API caller)', function () {
    test('returns userInitiatedPriority when no global is set', function (assert) {
      assert.strictEqual(
        resolveOutboundJobPriority({
          duringPrerender: undefined,
          jobPriority: undefined,
        }),
        userInitiatedPriority,
      );
    });

    test('returns userInitiatedPriority when __boxelDuringPrerender is false', function (assert) {
      assert.strictEqual(
        resolveOutboundJobPriority({
          duringPrerender: false,
          jobPriority: undefined,
        }),
        userInitiatedPriority,
      );
    });

    test('honors an explicit override on __boxelJobPriority', function (assert) {
      // Batch / scripting tooling running in the host SPA can set the
      // global before issuing a fetch; outside a prerender tab we still
      // forward what they set rather than overriding to user priority.
      assert.strictEqual(
        resolveOutboundJobPriority({
          duringPrerender: undefined,
          jobPriority: 3,
        }),
        3,
      );
      assert.strictEqual(
        resolveOutboundJobPriority({
          duringPrerender: false,
          jobPriority: 0,
        }),
        0,
        'override with 0 is preserved (not coerced to user priority)',
      );
    });

    test('rejects a truthy but non-boolean __boxelDuringPrerender — uses strict === true', function (assert) {
      // If `__boxelDuringPrerender` somehow ended up as a stringy
      // truthy value (e.g. set by a future code path that didn't
      // coerce), the policy must NOT silently flip to "forward 0";
      // a real user-facing fetch would then queue behind background
      // indexing. The check is `=== true` for exactly this reason.
      assert.strictEqual(
        resolveOutboundJobPriority({
          duringPrerender: 'yes',
          jobPriority: undefined,
        }),
        userInitiatedPriority,
      );
      assert.strictEqual(
        resolveOutboundJobPriority({
          duringPrerender: 1,
          jobPriority: undefined,
        }),
        userInitiatedPriority,
      );
    });
  });

  module('inside a prerender tab', function () {
    test('forwards an explicit __boxelJobPriority of 10', function (assert) {
      assert.strictEqual(
        resolveOutboundJobPriority({
          duringPrerender: true,
          jobPriority: 10,
        }),
        10,
      );
    });

    test('forwards an explicit __boxelJobPriority of 0 — must NOT upgrade', function (assert) {
      // System-initiated indexing has priority 0. A
      // `_federated-search` fired by the card render must preserve
      // that or its sub-prerenders would outrank the parent job.
      assert.strictEqual(
        resolveOutboundJobPriority({
          duringPrerender: true,
          jobPriority: 0,
        }),
        0,
      );
    });

    test('defaults to 0 when __boxelJobPriority is missing (older render-runner / test fixture)', function (assert) {
      assert.strictEqual(
        resolveOutboundJobPriority({
          duringPrerender: true,
          jobPriority: undefined,
        }),
        0,
      );
    });

    test('rejects malformed __boxelJobPriority values', function (assert) {
      // Non-number / negative / non-integer values fall through to
      // the default for the active branch.
      assert.strictEqual(
        resolveOutboundJobPriority({
          duringPrerender: true,
          jobPriority: -1,
        }),
        0,
      );
      assert.strictEqual(
        resolveOutboundJobPriority({
          duringPrerender: true,
          jobPriority: 1.5,
        }),
        0,
      );
      assert.strictEqual(
        resolveOutboundJobPriority({
          duringPrerender: true,
          jobPriority: '10',
        }),
        0,
      );
      assert.strictEqual(
        resolveOutboundJobPriority({
          duringPrerender: false,
          jobPriority: -1,
        }),
        userInitiatedPriority,
        'malformed value outside prerender → user-initiated default',
      );
    });
  });
});
