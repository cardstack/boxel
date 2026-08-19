import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  computeBatchClearCacheGate,
  type BatchOwner,
} from '../prerender/batch-ownership-gate.ts';
import { toAffinityKey } from '../prerender/affinity.ts';
import type { PrerenderVisitArgs } from '@cardstack/runtime-common';

// These tests exercise CS-10758 step 3 (`clearCache` batch ownership) at
// the pure-policy level. The full Prerenderer class launches Chrome in its
// constructor (PagePool.warmStandbys) so we test the decision table via
// the extracted `computeBatchClearCacheGate` helper instead — the method
// inside the class is a thin wrapper around it.

function args(
  overrides: Partial<PrerenderVisitArgs> & {
    affinityValue?: string;
  } = {},
): PrerenderVisitArgs {
  let realm = overrides.affinityValue ?? 'https://realm.example/catalog/';
  return {
    affinityType: 'realm',
    affinityValue: realm,
    realm,
    url: `${realm}x/1`,
    auth: 'jwt.test.fake',
    ...overrides,
  };
}

module(basename(import.meta.filename), function () {
  module(
    'computeBatchClearCacheGate — clearCache batch ownership (CS-10758 step 3)',
    function () {
      const NOW = 1_700_000_000_000;
      const REALM = 'https://realm.example/catalog/';
      const AFFINITY_KEY = toAffinityKey({
        affinityType: 'realm',
        affinityValue: REALM,
      });

      test('owner batchId + clearCache with no existing owner: honor and set owner', function (assert) {
        let decision = computeBatchClearCacheGate(
          args({
            affinityValue: REALM,
            batchId: 'job-1-abcd',
            renderOptions: { clearCache: true },
          }),
          undefined,
          NOW,
        );
        assert.true(
          decision.gatedArgs.renderOptions?.clearCache,
          'clearCache preserved',
        );
        assert.deepEqual(
          decision.newOwner,
          { batchId: 'job-1-abcd', since: NOW },
          'owner set to caller batch',
        );
        assert.notOk(decision.log, 'no log emitted on first-time acquisition');
      });

      test('same-batch subsequent clearCache visit: honored, owner timestamp refreshed', function (assert) {
        let existing: BatchOwner = { batchId: 'job-1-abcd', since: NOW - 1000 };
        let decision = computeBatchClearCacheGate(
          args({
            affinityValue: REALM,
            batchId: 'job-1-abcd',
            renderOptions: { clearCache: true },
          }),
          existing,
          NOW,
        );
        assert.true(decision.gatedArgs.renderOptions?.clearCache);
        assert.deepEqual(
          decision.newOwner,
          { batchId: 'job-1-abcd', since: NOW },
          'owner refreshed to current time',
        );
        assert.notOk(
          decision.log,
          'no log — same batch holding ownership is the common case',
        );
      });

      test('successor batchId + clearCache: replace owner, honor clearCache, log info', function (assert) {
        let existing: BatchOwner = { batchId: 'job-1-abcd', since: NOW - 5000 };
        let decision = computeBatchClearCacheGate(
          args({
            affinityValue: REALM,
            batchId: 'job-2-wxyz',
            renderOptions: { clearCache: true },
          }),
          existing,
          NOW,
        );
        assert.true(
          decision.gatedArgs.renderOptions?.clearCache,
          'successor clearCache is honored (preserves .gts-invalidation on crash recovery)',
        );
        assert.deepEqual(
          decision.newOwner,
          { batchId: 'job-2-wxyz', since: NOW },
          'owner replaced to successor',
        );
        assert.strictEqual(
          decision.log?.level,
          'info',
          'info-level log on successor replacement',
        );
        assert.ok(
          decision.log?.message.includes(AFFINITY_KEY),
          'log mentions affinity key',
        );
        assert.ok(
          decision.log?.message.includes('job-1-abcd'),
          'log mentions old owner',
        );
        assert.ok(
          decision.log?.message.includes('job-2-wxyz'),
          'log mentions new owner',
        );
      });

      test('no batchId + clearCache with active owner: STRIP clearCache, no owner change, warn log', function (assert) {
        let existing: BatchOwner = { batchId: 'job-1-abcd', since: NOW };
        let decision = computeBatchClearCacheGate(
          args({
            affinityValue: REALM,
            // no batchId — user request or cross-realm traffic
            renderOptions: { clearCache: true },
          }),
          existing,
          NOW,
        );
        assert.strictEqual(
          decision.gatedArgs.renderOptions?.clearCache,
          undefined,
          'clearCache stripped from non-batch caller',
        );
        assert.notOk(
          decision.newOwner,
          'owner unchanged (user request must not take ownership)',
        );
        assert.strictEqual(
          decision.log?.level,
          'warn',
          'warn-level log on strip',
        );
        assert.ok(
          decision.log?.message.includes('stripping clearCache'),
          'log mentions strip action',
        );
        assert.ok(
          decision.log?.message.includes('job-1-abcd'),
          'log identifies the protected owner',
        );
      });

      test('no batchId + clearCache with NO existing owner: honor (nothing to protect)', function (assert) {
        let decision = computeBatchClearCacheGate(
          args({
            affinityValue: REALM,
            renderOptions: { clearCache: true },
          }),
          undefined,
          NOW,
        );
        assert.true(
          decision.gatedArgs.renderOptions?.clearCache,
          'clearCache honored — nothing to protect',
        );
        assert.notOk(decision.newOwner, 'owner remains unset');
      });

      test('owner batchId + no clearCache passes through, touches timestamp', function (assert) {
        let existing: BatchOwner = { batchId: 'job-1-abcd', since: NOW - 2000 };
        let decision = computeBatchClearCacheGate(
          args({
            affinityValue: REALM,
            batchId: 'job-1-abcd',
            // no clearCache requested — the common case during an
            // in-flight batch after the first clearCache visit
            renderOptions: { cardRender: true },
          }),
          existing,
          NOW,
        );
        assert.strictEqual(
          decision.gatedArgs.renderOptions?.clearCache,
          undefined,
          'no clearCache requested and none added',
        );
        assert.deepEqual(
          decision.newOwner,
          { batchId: 'job-1-abcd', since: NOW },
          'timestamp refreshed to keep owner alive',
        );
      });

      test('stranger batchId + clearCache:false does not take ownership', function (assert) {
        let existing: BatchOwner = { batchId: 'job-1-abcd', since: NOW - 1000 };
        let decision = computeBatchClearCacheGate(
          args({
            affinityValue: REALM,
            batchId: 'job-99-unrelated',
            // no clearCache
          }),
          existing,
          NOW,
        );
        assert.strictEqual(
          decision.gatedArgs.renderOptions?.clearCache,
          undefined,
          'unchanged',
        );
        assert.notOk(
          decision.newOwner,
          'no ownership change — only owner-matching batches or successors with clearCache can move the owner',
        );
      });

      test('no batchId + no clearCache + no owner: pass-through returns the same args instance', function (assert) {
        let visitArgs = args({ affinityValue: REALM });
        let decision = computeBatchClearCacheGate(visitArgs, undefined, NOW);
        assert.strictEqual(
          decision.gatedArgs,
          visitArgs,
          'gated args are the exact input instance (no clone when nothing to gate)',
        );
        assert.notOk(decision.newOwner, 'no owner mutation');
        assert.notOk(decision.log, 'no log emitted on a pure pass-through');
      });

      test('strip preserves non-clearCache renderOptions fields', function (assert) {
        let existing: BatchOwner = { batchId: 'job-1-abcd', since: NOW };
        let decision = computeBatchClearCacheGate(
          args({
            affinityValue: REALM,
            renderOptions: {
              cardRender: true,
              fileExtract: true,
              clearCache: true,
            },
          }),
          existing,
          NOW,
        );
        assert.strictEqual(
          decision.gatedArgs.renderOptions?.clearCache,
          undefined,
          'clearCache stripped',
        );
        assert.true(
          decision.gatedArgs.renderOptions?.cardRender,
          'cardRender preserved',
        );
        assert.true(
          decision.gatedArgs.renderOptions?.fileExtract,
          'fileExtract preserved',
        );
      });

      test('strip returns a new object (does not mutate input renderOptions)', function (assert) {
        let existing: BatchOwner = { batchId: 'job-1-abcd', since: NOW };
        let inputRenderOptions: { clearCache?: true; cardRender?: true } = {
          clearCache: true,
          cardRender: true,
        };
        let input = args({
          affinityValue: REALM,
          renderOptions: inputRenderOptions,
        });
        let decision = computeBatchClearCacheGate(input, existing, NOW);
        assert.true(inputRenderOptions.clearCache, 'input not mutated');
        assert.notStrictEqual(
          decision.gatedArgs.renderOptions,
          inputRenderOptions,
          'returned renderOptions is a new object',
        );
      });
    },
  );

  module('batch ownership is per-affinity', function () {
    const NOW = 1_700_000_000_000;

    test('same batchId can own different affinities independently', function (assert) {
      // Realm A: no owner; visit with batch X + clearCache → X owns A
      let decisionA = computeBatchClearCacheGate(
        args({
          affinityValue: 'https://realm.example/A/',
          batchId: 'job-7-aaaa',
          renderOptions: { clearCache: true },
        }),
        undefined,
        NOW,
      );
      assert.deepEqual(decisionA.newOwner, {
        batchId: 'job-7-aaaa',
        since: NOW,
      });

      // Realm B: no owner; same batch id does not automatically own B
      // until it visits B
      let decisionB = computeBatchClearCacheGate(
        args({
          affinityValue: 'https://realm.example/B/',
          batchId: 'job-7-aaaa',
          renderOptions: { clearCache: true },
        }),
        undefined,
        NOW,
      );
      assert.deepEqual(
        decisionB.newOwner,
        { batchId: 'job-7-aaaa', since: NOW },
        'batch owns B only after visiting B',
      );
    });
  });
});
