import { module, test } from 'qunit';
import { basename } from 'path';
import { Prerenderer } from '../prerender/prerenderer';
import { decorateRenderErrorDiagnostics } from '../prerender/prerender-app';

// Regression coverage for the "render-timeout diagnostics are
// collected but silently dropped at persistence" bug (CS-10872
// follow-up). The persistence layer (`IndexWriter.updateEntry`) only
// serializes the **inner** `SerializedError` into
// `boxel_index.error_doc`:
//
//   error_doc: errorEntry?.error ?? entry.error   // <- inner only
//
// …but the two decorator helpers that stamp diagnostics onto a
// render-timeout response originally wrote them onto the **outer**
// `RenderError` wrapper. That meant diagnostics rode the response all
// the way through the fused visit, the card indexer, and the update
// path — and then vanished when the row was written to disk.
//
// These tests pin both decorators down to the inner
// `SerializedError` so the diagnostics payload survives persistence
// and can be surfaced by the in-UI error banner. Running them under
// the original outer-wrapper implementation fails on the
// `inner.diagnostics` assertions; running under the fix passes.

type FakeVisitResponse = {
  card?: {
    error?: {
      type: 'instance-error';
      error: {
        id: string;
        status: number;
        title: string;
        message: string;
        additionalErrors: unknown[] | null;
        diagnostics?: Record<string, unknown>;
      };
      evict?: boolean;
      // If the old (buggy) code path is restored, diagnostics would
      // appear here instead. We assert this field stays `undefined`
      // so the test isn't silently passing because the decorator
      // happened to stamp both places.
      diagnostics?: Record<string, unknown>;
    };
  };
  pageUnusableError?: unknown;
};

function buildFakeVisitResponse(): FakeVisitResponse {
  return {
    card: {
      error: {
        type: 'instance-error',
        error: {
          id: 'https://realm.example/c/1.json',
          status: 504,
          title: 'Render timeout',
          message: 'Render timed-out after 90000 ms',
          additionalErrors: null,
        },
        evict: true,
      },
    },
  };
}

module(basename(__filename), function () {
  module(
    'render-timeout diagnostics persistence (CS-10872 follow-up)',
    function () {
      test('Prerenderer.decorateRenderErrorsWithTimings writes to the inner SerializedError (where error_doc reads from)', function (assert) {
        let response = buildFakeVisitResponse();
        Prerenderer.decorateRenderErrorsWithTimings(
          response,
          {
            launchMs: 42,
            renderMs: 90000,
            waits: {
              semaphoreMs: 3,
              tabQueueMs: 5,
              tabStartupMs: 10,
            },
          },
          90042,
        );

        // The inner SerializedError is what `IndexWriter.updateEntry`
        // persists into `boxel_index.error_doc`. Diagnostics must
        // land here.
        let inner = response.card?.error?.error;
        assert.ok(inner, 'inner SerializedError still present');
        assert.ok(inner?.diagnostics, 'diagnostics attached to inner');
        assert.strictEqual(
          typeof inner?.diagnostics,
          'object',
          'diagnostics is an object',
        );
        assert.strictEqual(
          (inner!.diagnostics as any).launchMs,
          42,
          'launchMs present on inner',
        );
        assert.strictEqual(
          (inner!.diagnostics as any).renderElapsedMs,
          90000,
          'renderElapsedMs present on inner',
        );
        assert.strictEqual(
          (inner!.diagnostics as any).totalElapsedMs,
          90042,
          'totalElapsedMs present on inner',
        );
        assert.deepEqual(
          (inner!.diagnostics as any).waits,
          { semaphoreMs: 3, tabQueueMs: 5, tabStartupMs: 10 },
          'waits breakdown present on inner',
        );

        // And must NOT land on the outer RenderError wrapper —
        // that's the field the index writer ignores, so populating
        // it silently loses the data.
        assert.strictEqual(
          response.card?.error?.diagnostics,
          undefined,
          'diagnostics NOT attached to outer RenderError wrapper',
        );
      });

      test('decorateRenderErrorDiagnostics stamps requestId on the inner SerializedError', function (assert) {
        let response = buildFakeVisitResponse();
        decorateRenderErrorDiagnostics(response, 'req-abc-123');

        let inner = response.card?.error?.error;
        assert.ok(inner?.diagnostics, 'diagnostics block created on inner');
        assert.strictEqual(
          typeof inner?.diagnostics,
          'object',
          'diagnostics is an object',
        );
        assert.strictEqual(
          (inner!.diagnostics as any).requestId,
          'req-abc-123',
          'requestId threaded through to inner',
        );
        assert.strictEqual(
          response.card?.error?.diagnostics,
          undefined,
          'diagnostics NOT attached to outer RenderError wrapper',
        );
      });

      test('stacking both decorators leaves a single diagnostics object on the inner SerializedError', function (assert) {
        // In production these run back-to-back: Prerenderer attaches
        // launch/render/waits timings, then the HTTP handler stamps
        // requestId. Both must target the same location so the
        // second merges with the first rather than clobbering or
        // shadowing on a different level.
        let response = buildFakeVisitResponse();
        Prerenderer.decorateRenderErrorsWithTimings(
          response,
          { launchMs: 1, renderMs: 2, waits: {} },
          3,
        );
        decorateRenderErrorDiagnostics(response, 'req-xyz');

        let inner = response.card!.error!.error;
        assert.strictEqual(
          (inner.diagnostics as any)?.launchMs,
          1,
          'launchMs retained after second decorator ran',
        );
        assert.strictEqual(
          (inner.diagnostics as any)?.requestId,
          'req-xyz',
          'requestId merged into the same diagnostics object',
        );
        assert.strictEqual(
          response.card?.error?.diagnostics,
          undefined,
          'outer wrapper still clean (no shadow copy)',
        );
      });

      test('decorators are no-ops when there is no embedded error', function (assert) {
        // Successful responses should not sprout an empty
        // diagnostics object — that would confuse downstream UI into
        // showing a details section for an error that never happened.
        let response: { card: { serialized: null; error?: unknown } } = {
          card: { serialized: null },
        };
        Prerenderer.decorateRenderErrorsWithTimings(
          response,
          { launchMs: 1, renderMs: 2, waits: {} },
          3,
        );
        decorateRenderErrorDiagnostics(response, 'req-xyz');
        assert.strictEqual(
          response.card.error,
          undefined,
          'no error slot materialized',
        );
      });
    },
  );
});
