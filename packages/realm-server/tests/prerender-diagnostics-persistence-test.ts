import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { flattenPrerenderHtmlVisitMeta } from '@cardstack/runtime-common';
import { Prerenderer } from '../prerender/prerenderer.ts';
import { decorateRenderErrorDiagnostics } from '../prerender/prerender-app.ts';

// Locks down the consolidated diagnostic channel: every payload the
// Prerenderer or HTTP layer knows about (server timings, host-side
// breadcrumbs lifted from `RenderError.diagnostics`, and the HTTP
// correlation ID) ends up on `response.meta`, not on any embedded
// inner `SerializedError`. The indexer reads from `response.meta`
// and persists into `boxel_index.diagnostics`; the error-row
// write path also copies the same blob onto `error_doc.diagnostics`
// so the UI read surface (CardErrorJSONAPI.meta.diagnostics) keeps
// working without a schema rename. The point of these tests is to
// catch any regression that reintroduces the old "stuff diagnostics
// into the inner SerializedError" pattern.

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
        // Must stay undefined post-consolidation — the decorator
        // lifts diagnostics off the outer wrapper, not onto the inner.
        diagnostics?: Record<string, unknown>;
      };
      // The transient transport from `withTimeout`; lifted to
      // `response.meta.diagnostics` and then deleted.
      diagnostics?: Record<string, unknown>;
    };
    // Success-path host diagnostics block (computed-field counters,
    // broken-link findings) captured by render.meta and spread onto the
    // card response. Lifted onto `response.meta.diagnostics` the same way
    // as the error-path block.
    diagnostics?: Record<string, unknown>;
  };
  meta?: {
    timing?: Record<string, unknown>;
    requestId?: string;
    diagnostics?: Record<string, unknown>;
  };
  pageUnusableError?: unknown;
};

function buildFakeVisitResponseWithTimeoutError(): FakeVisitResponse {
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
        // Mirror what `withTimeout` produces today — host-side
        // breadcrumbs attached on the outer wrapper as a transient
        // transport. The decorator should lift these to response.meta.
        diagnostics: {
          renderStage: 'waiting-stability',
          stageAgeMs: 89696,
          queryLoadsInFlight: [{ ageMs: 89721 }],
        },
      },
    },
  };
}

function buildFakeSuccessVisitResponse(): FakeVisitResponse {
  return {
    card: {
      // Successful visit — no error wrapper at all.
    } as FakeVisitResponse['card'],
  };
}

module(basename(import.meta.filename), function () {
  module('render diagnostics persistence — consolidated channel', function () {
    test('Prerenderer.decorateRenderErrorsWithTimings lifts outer RenderError.diagnostics onto response.meta and leaves the inner SerializedError clean', function (assert) {
      let response = buildFakeVisitResponseWithTimeoutError();
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

      // Host-side breadcrumbs lifted off the outer RenderError and
      // merged with the server timing measurements into a single
      // block on response.meta.diagnostics.
      let meta = response.meta;
      assert.ok(meta, 'response.meta populated');
      let diagnostics = meta?.diagnostics;
      assert.ok(diagnostics, 'diagnostics block on response.meta');
      assert.strictEqual(diagnostics?.launchMs, 42, 'server launchMs present');
      assert.strictEqual(
        diagnostics?.renderElapsedMs,
        90000,
        'server renderElapsedMs present',
      );
      assert.strictEqual(
        diagnostics?.totalElapsedMs,
        90042,
        'server totalElapsedMs present',
      );
      assert.deepEqual(
        diagnostics?.waits,
        { semaphoreMs: 3, tabQueueMs: 5, tabStartupMs: 10 },
        'waits breakdown present',
      );
      assert.strictEqual(
        diagnostics?.renderStage,
        'waiting-stability',
        'host-side renderStage lifted from RenderError.diagnostics',
      );
      assert.deepEqual(
        diagnostics?.queryLoadsInFlight,
        [{ ageMs: 89721 }],
        'host-side queryLoadsInFlight lifted',
      );

      // Outer RenderError.diagnostics was a transient transport —
      // deleted after the lift so nothing downstream has to know
      // about the two-channel layout.
      assert.strictEqual(
        response.card?.error?.diagnostics,
        undefined,
        'outer RenderError.diagnostics cleared after lift',
      );
      // Inner SerializedError.diagnostics must NOT be populated by
      // the decorator. This catches any regression that reintroduces
      // the pre-consolidation dual-write pattern.
      assert.strictEqual(
        response.card?.error?.error.diagnostics,
        undefined,
        'inner SerializedError.diagnostics remains untouched',
      );
    });

    test('decorateRenderErrorDiagnostics stamps requestId onto response.meta, not the inner error', function (assert) {
      let response = buildFakeVisitResponseWithTimeoutError();
      decorateRenderErrorDiagnostics(response, 'req-abc-123');

      assert.strictEqual(
        response.meta?.requestId,
        'req-abc-123',
        'requestId stamped on response.meta',
      );
      assert.strictEqual(
        response.card?.error?.error.diagnostics,
        undefined,
        'inner SerializedError left alone',
      );
    });

    test('decorator populates response.meta even when there is no embedded error (successful render)', function (assert) {
      // Successful renders still get timing summaries so the indexer
      // can persist them onto `diagnostics` — that's the whole
      // point of the consolidated column: operators can retrospectively
      // ask "why did this instance take N seconds?" regardless of
      // error status.
      let response = buildFakeSuccessVisitResponse();
      Prerenderer.decorateRenderErrorsWithTimings(
        response,
        { launchMs: 1, renderMs: 2, waits: {} },
        3,
      );

      assert.ok(response.meta?.diagnostics, 'meta.diagnostics populated');
      assert.strictEqual(response.meta?.diagnostics?.launchMs, 1);
      assert.strictEqual(response.meta?.diagnostics?.renderElapsedMs, 2);
      assert.strictEqual(response.meta?.diagnostics?.totalElapsedMs, 3);
      assert.deepEqual(response.meta?.diagnostics?.waits, {});
    });

    test('broken-link findings on the success-path card diagnostics are lifted onto response.meta.diagnostics', function (assert) {
      // A card with a broken linksTo indexes cleanly (no error wrapper),
      // but render.meta records the broken slot on the card's success-path
      // diagnostics block. The decorator must lift that onto
      // response.meta.diagnostics — the consolidated channel the indexer
      // flattens into `boxel_index.diagnostics.brokenLinks`.
      let response: FakeVisitResponse = {
        card: {
          diagnostics: {
            serializeMs: 1.5,
            brokenLinks: [
              {
                fieldName: 'pet',
                reference: 'http://realm.example/missing-pet',
                kind: 'not-found',
              },
            ],
          },
        } as FakeVisitResponse['card'],
      };
      Prerenderer.decorateRenderErrorsWithTimings(
        response,
        { launchMs: 1, renderMs: 2, waits: {} },
        3,
      );

      let diagnostics = response.meta?.diagnostics;
      assert.deepEqual(
        diagnostics?.brokenLinks,
        [
          {
            fieldName: 'pet',
            reference: 'http://realm.example/missing-pet',
            kind: 'not-found',
          },
        ],
        'brokenLinks lifted onto response.meta.diagnostics',
      );
      assert.strictEqual(
        diagnostics?.serializeMs,
        1.5,
        'sibling host-side counters lifted alongside brokenLinks',
      );
      assert.strictEqual(
        diagnostics?.launchMs,
        1,
        'server timings merged into the same block',
      );
      // The card success-path diagnostics was a transient transport,
      // deleted after the lift just like the error-path block.
      assert.strictEqual(
        response.card?.diagnostics,
        undefined,
        'card success-path diagnostics cleared after lift',
      );
    });

    test('module-prerender searchablePathIssues on response.meta.diagnostics survive the timing stamp', function (assert) {
      // The module-prerender route records definition-build findings on
      // meta.diagnostics before the Prerenderer stamps timings. The timing
      // stamp must MERGE onto the existing diagnostics, not replace them —
      // otherwise the findings are dropped on the prerender path and never
      // reach `modules.diagnostics` via `flattenPrerenderMeta`.
      let searchablePathIssues = [
        {
          codeRef: 'http://realm.example/article/Article',
          fieldName: 'typo',
          path: 'addresss',
        },
      ];
      let response: FakeVisitResponse = {
        meta: { diagnostics: { searchablePathIssues } },
      };
      Prerenderer.decorateRenderErrorsWithTimings(
        response,
        { launchMs: 4, renderMs: 8, waits: {} },
        12,
      );

      let diagnostics = response.meta?.diagnostics;
      assert.deepEqual(
        diagnostics?.searchablePathIssues,
        searchablePathIssues,
        'searchablePathIssues preserved through the timing stamp',
      );
      assert.strictEqual(
        diagnostics?.launchMs,
        4,
        'server timing merged alongside the preserved findings',
      );
      assert.strictEqual(
        diagnostics?.totalElapsedMs,
        12,
        'totalElapsedMs merged alongside',
      );
    });

    test('both decorators stack: host-lifted diagnostics + server timings + requestId coexist on response.meta', function (assert) {
      let response = buildFakeVisitResponseWithTimeoutError();
      Prerenderer.decorateRenderErrorsWithTimings(
        response,
        { launchMs: 7, renderMs: 13, waits: { semaphoreMs: 1 } },
        20,
      );
      decorateRenderErrorDiagnostics(response, 'req-xyz');

      let meta = response.meta;
      assert.strictEqual(meta?.diagnostics?.launchMs, 7, 'timing retained');
      assert.strictEqual(
        meta?.diagnostics?.renderStage,
        'waiting-stability',
        'host-side breadcrumb retained',
      );
      assert.strictEqual(
        meta?.requestId,
        'req-xyz',
        'requestId present on same meta block',
      );
    });

    test('renderFormatsMs recorded on response.meta.diagnostics survives the timing stamp', function (assert) {
      // The RenderRunner records per-format render timings directly onto
      // `response.meta.diagnostics` as each html step completes; the
      // Prerenderer's later timing stamp must merge around that block, not
      // replace it — otherwise the per-format breakdown never reaches
      // `prerendered_html.diagnostics`.
      let renderFormatsMs = {
        card: { isolated: 80, head: 3, atom: 2, markdown: 5 },
        file: { isolated: 9 },
      };
      let response: FakeVisitResponse = {
        meta: { diagnostics: { renderFormatsMs } },
      };
      Prerenderer.decorateRenderErrorsWithTimings(
        response,
        { launchMs: 4, renderMs: 99, waits: {} },
        103,
      );

      let diagnostics = response.meta?.diagnostics;
      assert.deepEqual(
        diagnostics?.renderFormatsMs,
        renderFormatsMs,
        'per-format timings preserved through the timing stamp',
      );
      assert.strictEqual(
        diagnostics?.renderElapsedMs,
        99,
        'server timing merged alongside the preserved breakdown',
      );
    });
  });

  module('flattenPrerenderHtmlVisitMeta', function () {
    test('the visit HTTP id lands under prerenderHtmlRequestId, never requestId', function (assert) {
      let flattened = flattenPrerenderHtmlVisitMeta({
        requestId: 'render-req-1',
        diagnostics: {
          launchMs: 5,
          renderElapsedMs: 100,
          renderFormatsMs: { card: { isolated: 80 } },
        },
      });
      assert.deepEqual(flattened, {
        launchMs: 5,
        renderElapsedMs: 100,
        renderFormatsMs: { card: { isolated: 80 } },
        prerenderHtmlRequestId: 'render-req-1',
      });
    });

    test('returns undefined when there is nothing to persist', function (assert) {
      assert.strictEqual(flattenPrerenderHtmlVisitMeta(undefined), undefined);
      assert.strictEqual(flattenPrerenderHtmlVisitMeta({}), undefined);
    });

    test('a diagnostics-only meta (in-process caller, no HTTP id) flattens without a request id', function (assert) {
      let flattened = flattenPrerenderHtmlVisitMeta({
        diagnostics: { renderElapsedMs: 42 },
      });
      assert.deepEqual(flattened, { renderElapsedMs: 42 });
    });
  });
});
