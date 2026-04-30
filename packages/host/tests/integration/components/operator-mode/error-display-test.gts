import { click, render, waitFor } from '@ember/test-helpers';

import { module, test } from 'qunit';

import type { CardErrorJSONAPI } from '@cardstack/runtime-common';

import CardErrorDetail from '@cardstack/host/components/operator-mode/card-error-detail';

import { setupRenderingTest } from '../../../helpers/setup';

// CS-10872: guards the in-UI surfacing of prerender-timeout diagnostics.
// When a RenderError carries diagnostics (launchMs / waits / renderStage /
// queryLoadsInFlight / etc.) via `error_doc.meta.diagnostics`, the error
// banner must expose it in the "Show Details" section so operators can
// classify the timeout without hitting the DB or correlating CloudWatch.
module(
  'Integration | Component | ErrorDisplay | diagnostics',
  function (hooks) {
    setupRenderingTest(hooks);

    function makeTimeoutError(
      overrides?: Record<string, unknown>,
    ): CardErrorJSONAPI {
      let diagnostics: Record<string, unknown> = {
        requestId: 'b14e24e3-8b1f-4a7d-9e62-3c5f2db2c1aa',
        launchMs: 18720,
        waits: { semaphoreMs: 18500, tabQueueMs: 200, tabStartupMs: 20 },
        renderElapsedMs: 71280,
        totalElapsedMs: 90000,
        renderStage: 'waiting-stability',
        stageAgeMs: 62110,
        queryLoadsInFlight: [
          {
            source: 'search-resource:search:query-field-support:…',
            fieldName: 'topRelated',
            cardId: 'https://example.com/Product.json',
            realms: ['https://example.com/'],
            ageMs: 71000,
          },
        ],
        currentlyEvaluatingModule: null,
        recentModuleEvaluations: [
          { url: 'https://example.com/product.gts', ms: 4200 },
        ],
        ...overrides,
      };
      return {
        id: 'https://example.com/Product.json',
        status: 504,
        title: 'Render timeout',
        message: 'Render timed-out after 90000 ms',
        realm: 'https://example.com/',
        meta: {
          lastKnownGoodHtml: null,
          cardTitle: null,
          scopedCssUrls: [],
          stack: null,
          diagnostics,
        },
      };
    }

    test('renders launch vs render breakdown + stage summary in details section', async function (assert) {
      let error = makeTimeoutError();
      await render(<template><CardErrorDetail @error={{error}} /></template>);

      assert
        .dom('[data-test-error-message]')
        .hasText('Render timed-out after 90000 ms');
      assert
        .dom('[data-test-error-diagnostics]')
        .doesNotExist(
          'diagnostics block is hidden until the caller opens details',
        );

      await click('[data-test-toggle-details]');
      await waitFor('[data-test-error-diagnostics]');

      // Single-line summary: the fields that nearly always point at
      // the triage category (total/launch-breakdown/render/stage/id).
      let summary =
        document.querySelector('[data-test-error-diagnostics-summary]')
          ?.textContent ?? '';
      assert.ok(
        summary.includes('total=90000ms'),
        `summary shows total elapsed (got "${summary}")`,
      );
      assert.ok(
        summary.includes(
          'launch=18720ms (semaphore=18500ms, tabQueue=200ms, tabStartup=20ms)',
        ),
        'summary breaks launch into semaphore / tabQueue / tabStartup',
      );
      assert.ok(
        summary.includes('render=71280ms'),
        'summary shows render elapsed',
      );
      assert.ok(
        summary.includes('stage=waiting-stability'),
        'summary names the current render stage',
      );
      assert.ok(
        summary.includes('age=62110ms'),
        'summary shows stage age so stuck stages are visible at a glance',
      );
      assert.ok(
        summary.includes('requestId=b14e24e3-8b1f-4a7d-9e62-3c5f2db2c1aa'),
        'summary carries the correlation id for cross-log grepping',
      );

      // Full JSON block: gives the per-item timings operators drill into.
      let json =
        document.querySelector('[data-test-error-diagnostics-json]')
          ?.textContent ?? '';
      let queryFieldPreserved =
        json.includes('"queryLoadsInFlight"') &&
        json.includes('"fieldName": "topRelated"');
      assert.true(
        queryFieldPreserved,
        'diagnostics JSON preserves query-field identifiers',
      );
      let moduleEvalsPreserved =
        json.includes('"recentModuleEvaluations"') &&
        json.includes('"ms": 4200');
      assert.true(
        moduleEvalsPreserved,
        'diagnostics JSON preserves recent module-evaluation timings',
      );
    });

    test('is hidden when no diagnostics are present', async function (assert) {
      let error: CardErrorJSONAPI = {
        id: 'https://example.com/x',
        status: 500,
        title: 'Internal Server Error',
        message: 'Something went wrong',
        realm: 'https://example.com/',
        meta: {
          lastKnownGoodHtml: null,
          cardTitle: null,
          scopedCssUrls: [],
          stack: 'Error: boom\n  at foo',
          // no diagnostics
        },
      };

      await render(<template><CardErrorDetail @error={{error}} /></template>);
      await click('[data-test-toggle-details]');

      assert
        .dom('[data-test-error-stack]')
        .exists('stack trace still renders for non-timeout errors');
      assert
        .dom('[data-test-error-diagnostics]')
        .doesNotExist('no diagnostics section when meta.diagnostics is absent');
    });

    // CS-10977: additionalErrors carried on the error doc — typically
    // browser console errors enriched by the prerender runner — are
    // surfaced under the stack trace so the operator can see the
    // underlying template throw the runloop swallowed.
    test('renders additionalErrors when provided', async function (assert) {
      let error: CardErrorJSONAPI = {
        id: 'https://example.com/x',
        status: 500,
        title: 'Render binding desync',
        message: 'Encountered an Ember rendering error',
        realm: 'https://example.com/',
        meta: {
          lastKnownGoodHtml: null,
          cardTitle: null,
          scopedCssUrls: [],
          stack: 'Error: outer\n  at frame',
        },
        additionalErrors: [
          {
            title: 'Console error 1',
            message: 'TypeError: cannot read properties of undefined',
            stack: 'TypeError\n  at template (foo.gts:10:5)',
          } as any,
          {
            title: 'Console error 2',
            message: 'Uncaught (in promise) Error: ohno',
            stack: 'Error\n  at promise (bar.gts:42:1)',
          } as any,
        ],
      };

      await render(<template><CardErrorDetail @error={{error}} /></template>);
      assert
        .dom('[data-test-error-additional-errors]')
        .doesNotExist('hidden until the caller opens details');

      await click('[data-test-toggle-details]');
      await waitFor('[data-test-error-additional-errors]');

      assert
        .dom('[data-test-error-additional-errors]')
        .hasAttribute('data-test-error-additional-errors-count', '2');
      assert
        .dom('[data-test-error-additional-error]')
        .exists({ count: 2 }, 'each additional error renders its own block');

      let entries = document.querySelectorAll(
        '[data-test-error-additional-error]',
      );
      let firstText = entries[0]?.textContent ?? '';
      assert.ok(
        firstText.includes('Console error 1'),
        'first entry shows its title',
      );
      assert.ok(
        firstText.includes('TypeError: cannot read properties of undefined'),
        'first entry shows its message',
      );
      assert.ok(
        firstText.includes('at template (foo.gts:10:5)'),
        'first entry shows its stack',
      );
      let secondText = entries[1]?.textContent ?? '';
      assert.ok(
        secondText.includes('Uncaught (in promise) Error: ohno'),
        'second entry shows its message',
      );
      assert.ok(
        secondText.includes('at promise (bar.gts:42:1)'),
        'second entry shows its stack',
      );
    });

    test('truncates long additional error stacks', async function (assert) {
      let longStack = 'a'.repeat(10 * 1024);
      let error: CardErrorJSONAPI = {
        id: 'https://example.com/x',
        status: 500,
        title: 'Render error',
        message: 'boom',
        realm: 'https://example.com/',
        meta: {
          lastKnownGoodHtml: null,
          cardTitle: null,
          scopedCssUrls: [],
          stack: null,
        },
        additionalErrors: [
          { title: 'Big stack', message: 'long', stack: longStack } as any,
        ],
      };

      await render(<template><CardErrorDetail @error={{error}} /></template>);
      await click('[data-test-toggle-details]');
      await waitFor('[data-test-error-additional-errors]');

      let stackEl = document.querySelector(
        '[data-test-error-additional-stack]',
      );
      let rendered = stackEl?.textContent ?? '';
      assert.ok(
        rendered.includes('…[truncated]'),
        `truncation suffix is appended (got length ${rendered.length})`,
      );
      assert.ok(
        rendered.length < longStack.length,
        'rendered stack is shorter than the input stack',
      );
    });

    test('caps additional errors at 20 with omitted summary', async function (assert) {
      let raw = Array.from({ length: 25 }, (_v, i) => ({
        title: `Console error ${i + 1}`,
        message: `msg ${i + 1}`,
        stack: `stack ${i + 1}`,
      }));
      let error: CardErrorJSONAPI = {
        id: 'https://example.com/x',
        status: 500,
        title: 'Render error',
        message: 'boom',
        realm: 'https://example.com/',
        meta: {
          lastKnownGoodHtml: null,
          cardTitle: null,
          scopedCssUrls: [],
          stack: null,
        },
        additionalErrors: raw as any,
      };

      await render(<template><CardErrorDetail @error={{error}} /></template>);
      await click('[data-test-toggle-details]');
      await waitFor('[data-test-error-additional-errors]');

      assert
        .dom('[data-test-error-additional-errors]')
        .hasAttribute(
          'data-test-error-additional-errors-count',
          '25',
          'count attribute reflects the raw input length',
        );
      // 20 real entries + 1 synthetic "Errors omitted" placeholder
      assert.dom('[data-test-error-additional-error]').exists({ count: 21 });
      let block = document.querySelector('[data-test-error-additional-errors]');
      let blockText = block?.textContent ?? '';
      assert.ok(
        blockText.includes('5 additional errors hidden'),
        `omitted summary indicates the dropped count (got "${blockText.slice(0, 200)}…")`,
      );
    });

    test('truncate caps final length at the configured max including suffix', async function (assert) {
      // 4KB stack budget, suffix is ' …[truncated]' (14 chars). The
      // rendered length must be <= 4096, not 4096 + suffix length.
      let longStack = 'b'.repeat(20 * 1024);
      let error: CardErrorJSONAPI = {
        id: 'https://example.com/x',
        status: 500,
        title: 'Render error',
        message: 'boom',
        realm: 'https://example.com/',
        meta: {
          lastKnownGoodHtml: null,
          cardTitle: null,
          scopedCssUrls: [],
          stack: null,
        },
        additionalErrors: [
          { title: 'Big stack', message: 'long', stack: longStack } as any,
        ],
      };

      await render(<template><CardErrorDetail @error={{error}} /></template>);
      await click('[data-test-toggle-details]');
      await waitFor('[data-test-error-additional-errors]');

      let stackEl = document.querySelector(
        '[data-test-error-additional-stack]',
      );
      let rendered = stackEl?.textContent ?? '';
      assert.ok(
        rendered.endsWith(' …[truncated]'),
        'truncation suffix is at the end',
      );
      assert.ok(
        rendered.length <= 4 * 1024,
        `rendered stack length (${rendered.length}) is at or below the 4KiB budget`,
      );
    });

    test('does not duplicate message when entry has no title', async function (assert) {
      let error: CardErrorJSONAPI = {
        id: 'https://example.com/x',
        status: 500,
        title: 'Render error',
        message: 'boom',
        realm: 'https://example.com/',
        meta: {
          lastKnownGoodHtml: null,
          cardTitle: null,
          scopedCssUrls: [],
          stack: null,
        },
        additionalErrors: [
          {
            message: 'TypeError: only message, no title',
            stack: 'TypeError\n  at template (foo.gts:10:5)',
          } as any,
        ],
      };

      await render(<template><CardErrorDetail @error={{error}} /></template>);
      await click('[data-test-toggle-details]');
      await waitFor('[data-test-error-additional-errors]');

      assert
        .dom('[data-test-error-additional-heading]')
        .doesNotExist('no heading rendered when entry has no title');
      assert
        .dom('[data-test-error-additional-message]')
        .hasText(
          'TypeError: only message, no title',
          'message body renders exactly once',
        );
      let entry = document.querySelector('[data-test-error-additional-error]');
      let occurrences = (
        entry?.textContent?.match(/TypeError: only message, no title/g) ?? []
      ).length;
      assert.strictEqual(
        occurrences,
        1,
        'message text appears exactly once in the entry',
      );
    });

    test('omits Additional Errors block when array is empty/absent', async function (assert) {
      // absent
      let absent: CardErrorJSONAPI = {
        id: 'https://example.com/x',
        status: 500,
        title: 'x',
        message: 'm',
        realm: 'https://example.com/',
        meta: {
          lastKnownGoodHtml: null,
          cardTitle: null,
          scopedCssUrls: [],
          stack: null,
        },
      };
      await render(<template><CardErrorDetail @error={{absent}} /></template>);
      await click('[data-test-toggle-details]');
      assert
        .dom('[data-test-error-additional-errors]')
        .doesNotExist('absent additionalErrors → no block');

      // empty
      let empty: CardErrorJSONAPI = {
        ...absent,
        additionalErrors: [],
      };
      await render(<template><CardErrorDetail @error={{empty}} /></template>);
      await click('[data-test-toggle-details]');
      assert
        .dom('[data-test-error-additional-errors]')
        .doesNotExist('empty additionalErrors → no block');
    });

    test('renders when diagnostics only has per-item load fields (no launch timing)', async function (assert) {
      // Simulates a best-effort capture where launch timing wasn't
      // available but the host-side hooks still produced some data —
      // the UI should render whatever fields are present rather than
      // hide the whole section.
      let error = makeTimeoutError();
      error.meta.diagnostics = {
        cardDocLoadsInFlight: [
          { url: 'https://example.com/Manager.json', ageMs: 68500 },
        ],
        inFlightModuleImports: ['https://example.com/foo.gts'],
      };

      await render(<template><CardErrorDetail @error={{error}} /></template>);
      await click('[data-test-toggle-details]');

      assert.dom('[data-test-error-diagnostics]').exists();
      let json =
        document.querySelector('[data-test-error-diagnostics-json]')
          ?.textContent ?? '';
      let cardDocsPreserved =
        json.includes('"cardDocLoadsInFlight"') &&
        json.includes('"ageMs": 68500');
      assert.true(
        cardDocsPreserved,
        'per-URL ageMs survives into the rendered JSON',
      );
      let modulesPreserved =
        json.includes('"inFlightModuleImports"') && json.includes('foo.gts');
      assert.true(
        modulesPreserved,
        'in-flight module imports survive into the rendered JSON',
      );
    });
  },
);
