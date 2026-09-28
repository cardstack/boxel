import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  computeBatchClearCacheGate,
  type BatchOwners,
} from '../prerender/batch-ownership-gate.ts';
import { toAffinityKey } from '../prerender/affinity.ts';
import type { PrerenderVisitArgs } from '@cardstack/runtime-common';

// These tests exercise `clearCache` batch ownership at the pure-policy level.
// The full Prerenderer class launches Chrome in its constructor
// (PagePool.warmStandbys) so we test the decision table via the extracted
// `computeBatchClearCacheGate` helper instead — the method inside the class is
// a thin wrapper around it.

const STALE_AFTER_MS = 120_000;

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

function owners(entries: Record<string, number>): BatchOwners {
  return new Map(Object.entries(entries));
}

// Liveness as the Prerenderer supplies it: nothing in flight unless the test
// names the batch.
function liveness(inFlight: string[] = []) {
  return {
    staleAfterMs: STALE_AFTER_MS,
    isInFlight: (batchId: string) => inFlight.includes(batchId),
  };
}

module(basename(import.meta.filename), function () {
  module(
    'computeBatchClearCacheGate — clearCache batch ownership',
    function () {
      const NOW = 1_700_000_000_000;
      const REALM = 'https://realm.example/catalog/';
      const AFFINITY_KEY = toAffinityKey({
        affinityType: 'realm',
        affinityValue: REALM,
      });

      test('batchId + clearCache with no holders: honor and claim', function (assert) {
        let decision = computeBatchClearCacheGate(
          args({
            affinityValue: REALM,
            batchId: 'job-1-abcd',
            renderOptions: { clearCache: true },
          }),
          undefined,
          NOW,
          liveness(),
        );
        assert.true(
          decision.gatedArgs.renderOptions?.clearCache,
          'clearCache preserved',
        );
        assert.deepEqual(
          decision.claim,
          { batchId: 'job-1-abcd', since: NOW },
          'the caller batch claims the affinity',
        );
        assert.notOk(decision.drop, 'nothing to drop');
        assert.notOk(decision.log, 'no log emitted on first-time acquisition');
      });

      test('same-batch subsequent visit: honored, its entry refreshed', function (assert) {
        let decision = computeBatchClearCacheGate(
          args({
            affinityValue: REALM,
            batchId: 'job-1-abcd',
            renderOptions: { clearCache: true },
          }),
          owners({ 'job-1-abcd': NOW - 1000 }),
          NOW,
          liveness(),
        );
        assert.true(decision.gatedArgs.renderOptions?.clearCache);
        assert.deepEqual(
          decision.claim,
          { batchId: 'job-1-abcd', since: NOW },
          'entry refreshed to current time',
        );
        assert.notOk(
          decision.log,
          'no log — a batch refreshing its own entry is the common case',
        );
      });

      test('a batch arriving beside a live holder is a concurrent batch: both hold the affinity', function (assert) {
        // Index passes of one realm run one per writer lane, so a second
        // batch on the affinity while the first is still visiting is normal.
        // Neither may displace the other.
        let decision = computeBatchClearCacheGate(
          args({
            affinityValue: REALM,
            batchId: 'job-2-wxyz',
            renderOptions: { clearCache: true },
          }),
          owners({ 'job-1-abcd': NOW - 5000 }),
          NOW,
          liveness(),
        );
        assert.true(
          decision.gatedArgs.renderOptions?.clearCache,
          'the concurrent batch clearCache is honored',
        );
        assert.deepEqual(
          decision.claim,
          { batchId: 'job-2-wxyz', since: NOW },
          'the new batch claims its own entry',
        );
        assert.notOk(decision.drop, 'the live holder keeps its entry');
        assert.strictEqual(
          decision.log?.level,
          'debug',
          'a concurrent batch is routine, not news',
        );
        assert.ok(
          decision.log?.message.includes('concurrent'),
          `log calls it a concurrent batch: ${decision.log?.message}`,
        );
        assert.ok(
          decision.log?.message.includes('job-1-abcd'),
          'log names the batch it runs beside',
        );
        assert.notOk(
          decision.log?.message.includes('succeeds'),
          'log does not call it a successor',
        );
      });

      test('a holder idle past the window with nothing in flight is finished, and the next batch succeeds it', function (assert) {
        // `releaseBatch` is best-effort and a worker can die mid-pass, so an
        // entry can outlive the batch that made it.
        let decision = computeBatchClearCacheGate(
          args({
            affinityValue: REALM,
            batchId: 'job-2-wxyz',
            // no clearCache: a pass that never clears still succeeds
          }),
          owners({ 'job-1-abcd': NOW - STALE_AFTER_MS - 1 }),
          NOW,
          liveness(),
        );
        assert.deepEqual(
          decision.drop,
          ['job-1-abcd'],
          'the finished holder is dropped',
        );
        assert.deepEqual(
          decision.claim,
          { batchId: 'job-2-wxyz', since: NOW },
          'the successor claims the affinity',
        );
        assert.strictEqual(
          decision.log?.level,
          'info',
          'info-level log on succession',
        );
        assert.ok(
          decision.log?.message.includes('succeeds'),
          `log calls it a successor: ${decision.log?.message}`,
        );
        assert.ok(
          decision.log?.message.includes(AFFINITY_KEY),
          'log mentions affinity key',
        );
        assert.ok(
          decision.log?.message.includes('job-1-abcd'),
          'log mentions the finished batch',
        );
        assert.notOk(
          decision.log?.message.includes('concurrent'),
          'log does not call it a concurrent batch',
        );
      });

      test('a holder with a call still in flight is live however long since its last visit started', function (assert) {
        // One slow render outlasts the window without the batch having
        // stopped.
        let decision = computeBatchClearCacheGate(
          args({ affinityValue: REALM, batchId: 'job-2-wxyz' }),
          owners({ 'job-1-abcd': NOW - STALE_AFTER_MS * 10 }),
          NOW,
          liveness(['job-1-abcd']),
        );
        assert.notOk(decision.drop, 'the in-flight holder keeps its entry');
        assert.strictEqual(
          decision.log?.level,
          'debug',
          'the new batch joins it as a concurrent batch',
        );
      });

      test('live and finished holders are told apart in one decision', function (assert) {
        let decision = computeBatchClearCacheGate(
          args({ affinityValue: REALM, batchId: 'job-3-new' }),
          owners({
            'job-1-dead': NOW - STALE_AFTER_MS - 1,
            'job-2-live': NOW - 10,
          }),
          NOW,
          liveness(),
        );
        assert.deepEqual(
          decision.drop,
          ['job-1-dead'],
          'only the finished one',
        );
        assert.deepEqual(decision.claim, { batchId: 'job-3-new', since: NOW });
      });

      test('no batchId + clearCache with a live holder: STRIP clearCache, no claim, warn log', function (assert) {
        let decision = computeBatchClearCacheGate(
          args({
            affinityValue: REALM,
            // no batchId — user request or cross-realm traffic
            renderOptions: { clearCache: true },
          }),
          owners({ 'job-1-abcd': NOW, 'job-2-wxyz': NOW }),
          NOW,
          liveness(),
        );
        assert.strictEqual(
          decision.gatedArgs.renderOptions?.clearCache,
          undefined,
          'clearCache stripped from non-batch caller',
        );
        assert.notOk(decision.claim, 'a user request must not take ownership');
        assert.strictEqual(
          decision.log?.level,
          'warn',
          'warn-level log on strip',
        );
        assert.ok(
          decision.log?.message.includes('stripping clearCache'),
          'log mentions strip action',
        );
        assert.true(
          decision.log?.message.includes('job-1-abcd'),
          'log identifies the first protected holder',
        );
        assert.true(
          decision.log?.message.includes('job-2-wxyz'),
          'log identifies the second protected holder',
        );
      });

      test('no batchId + clearCache with only finished holders: honor, and drop them', function (assert) {
        // A batch that died without releasing must not strip on-demand
        // clears for as long as the affinity stays warm.
        let decision = computeBatchClearCacheGate(
          args({
            affinityValue: REALM,
            renderOptions: { clearCache: true },
          }),
          owners({ 'job-1-abcd': NOW - STALE_AFTER_MS - 1 }),
          NOW,
          liveness(),
        );
        assert.true(
          decision.gatedArgs.renderOptions?.clearCache,
          'clearCache honored — nothing live to protect',
        );
        assert.deepEqual(decision.drop, ['job-1-abcd']);
        assert.notOk(decision.claim, 'no claim');
      });

      test('no batchId + clearCache with no holders: honor (nothing to protect)', function (assert) {
        let decision = computeBatchClearCacheGate(
          args({
            affinityValue: REALM,
            renderOptions: { clearCache: true },
          }),
          undefined,
          NOW,
          liveness(),
        );
        assert.true(
          decision.gatedArgs.renderOptions?.clearCache,
          'clearCache honored — nothing to protect',
        );
        assert.notOk(decision.claim, 'holders remain empty');
      });

      test('batchId + no clearCache passes through and refreshes its entry', function (assert) {
        let decision = computeBatchClearCacheGate(
          args({
            affinityValue: REALM,
            batchId: 'job-1-abcd',
            // no clearCache requested — the common case during an
            // in-flight batch after the first clearCache visit
            renderOptions: { cardRender: true },
          }),
          owners({ 'job-1-abcd': NOW - 2000 }),
          NOW,
          liveness(),
        );
        assert.strictEqual(
          decision.gatedArgs.renderOptions?.clearCache,
          undefined,
          'no clearCache requested and none added',
        );
        assert.deepEqual(
          decision.claim,
          { batchId: 'job-1-abcd', since: NOW },
          'timestamp refreshed to keep the entry live',
        );
      });

      test('batchId + no clearCache on an unheld affinity claims it', function (assert) {
        // The protection has to hold for a pass that never clears: only a
        // pass whose invalidation set contains an executable asks for a
        // clear, so an instance-only pass would otherwise render its whole
        // batch on an unheld affinity and a user-initiated clearCache
        // landing on the same tab would drop the loader underneath it.
        let decision = computeBatchClearCacheGate(
          args({
            affinityValue: REALM,
            batchId: 'job-1-abcd',
            renderOptions: { cardRender: true },
          }),
          undefined,
          NOW,
          liveness(),
        );
        assert.deepEqual(
          decision.claim,
          { batchId: 'job-1-abcd', since: NOW },
          'the batch holds the affinity from its first visit',
        );
        assert.notOk(decision.log, 'claiming an unheld affinity is not news');
      });

      test('no batchId + no clearCache + no holders: pass-through returns the same args instance', function (assert) {
        let visitArgs = args({ affinityValue: REALM });
        let decision = computeBatchClearCacheGate(
          visitArgs,
          undefined,
          NOW,
          liveness(),
        );
        assert.strictEqual(
          decision.gatedArgs,
          visitArgs,
          'gated args are the exact input instance (no clone when nothing to gate)',
        );
        assert.notOk(decision.claim, 'no claim');
        assert.notOk(decision.drop, 'nothing dropped');
        assert.notOk(decision.log, 'no log emitted on a pure pass-through');
      });

      test('strip preserves non-clearCache renderOptions fields', function (assert) {
        let decision = computeBatchClearCacheGate(
          args({
            affinityValue: REALM,
            renderOptions: {
              cardRender: true,
              fileExtract: true,
              clearCache: true,
            },
          }),
          owners({ 'job-1-abcd': NOW }),
          NOW,
          liveness(),
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
        let inputRenderOptions: { clearCache?: true; cardRender?: true } = {
          clearCache: true,
          cardRender: true,
        };
        let input = args({
          affinityValue: REALM,
          renderOptions: inputRenderOptions,
        });
        let decision = computeBatchClearCacheGate(
          input,
          owners({ 'job-1-abcd': NOW }),
          NOW,
          liveness(),
        );
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

    test('same batchId can hold different affinities independently', function (assert) {
      let decisionA = computeBatchClearCacheGate(
        args({
          affinityValue: 'https://realm.example/A/',
          batchId: 'job-7-aaaa',
          renderOptions: { clearCache: true },
        }),
        undefined,
        NOW,
        liveness(),
      );
      assert.deepEqual(decisionA.claim, {
        batchId: 'job-7-aaaa',
        since: NOW,
      });

      // Realm B's holders are its own: a batch holding A says nothing about
      // B until it visits B.
      let decisionB = computeBatchClearCacheGate(
        args({
          affinityValue: 'https://realm.example/B/',
          batchId: 'job-7-aaaa',
          renderOptions: { clearCache: true },
        }),
        undefined,
        NOW,
        liveness(),
      );
      assert.deepEqual(
        decisionB.claim,
        { batchId: 'job-7-aaaa', since: NOW },
        'batch holds B only after visiting B',
      );
    });
  });
});
