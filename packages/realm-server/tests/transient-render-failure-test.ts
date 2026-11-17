import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  TRANSIENT_RENDER_FAILURE_RETRY_BASE_MS,
  TRANSIENT_RENDER_FAILURE_RETRY_CAP,
  isTransientRenderError,
} from '@cardstack/runtime-common';

import {
  allIds,
  cardURL,
  genuineError,
  idsWithout,
  legacyRenderTimeout,
  renderTimeout,
  setupTransientRenderFixture,
  type Outcome,
} from './helpers/transient-render-fixture.ts';

// A render that did not finish (it timed out, or its prerender request
// aborted) says nothing about the card. A whole-realm HTML pass that ran while
// the prerender service was overloaded stored three such timeouts as the cards'
// current render errors, and the cards dropped out of every search. These
// tests hold the HTML pass, the search gates and the reconcile sweep to the
// rule that a transient render failure keeps the card's last good render and
// is retried with backoff, while a genuine one, or a transient one with no
// render to keep, is the card's error at once.

const timesOut = (name: string) =>
  new Map<string, Outcome>([
    [cardURL(name), { kind: 'card-error', error: renderTimeout }],
  ]);

module(basename(import.meta.filename), function (hooks) {
  let fixture = setupTransientRenderFixture(hooks);

  test('the classifier reads markers, and the title or message only of a legacy timeout', function (assert) {
    assert.true(isTransientRenderError(renderTimeout), 'a render timeout');
    assert.true(
      isTransientRenderError(legacyRenderTimeout),
      'a timeout stored before the marker, by its title',
    );
    assert.true(
      isTransientRenderError({
        status: 504,
        message: 'Render timed-out after 60000 ms',
        additionalErrors: null,
      }),
      'a timeout stored before the marker, by its message',
    );
    assert.true(
      isTransientRenderError({
        status: 500,
        message: 'Prerender request to http://x/ aborted after 60000ms',
        additionalErrors: null,
        visitRequestFailure: true,
      }),
      'a visit whose request failed',
    );
    assert.true(
      isTransientRenderError({
        status: 502,
        message: 'Gateway or network failure',
        additionalErrors: null,
        gatewayFailure: true,
      }),
      'a gateway failure a fetch met',
    );
    assert.false(
      isTransientRenderError(genuineError),
      'a template that throws',
    );
    assert.false(
      isTransientRenderError({
        status: 504,
        message: 'a card that answers 504 itself',
        additionalErrors: null,
      }),
      'a bare gateway status is not enough',
    );
  });

  test('an HTML pass whose render times out keeps the card searchable with its last good HTML, and schedules a retry', async function (assert) {
    assert.deepEqual((await fixture.search()).ids, allIds);

    await fixture.htmlPass(timesOut('n2'));

    let row = await fixture.htmlRow('n2');
    assert.strictEqual(
      Number(row.generation),
      Number(row.index_generation),
      "the rendering is at its index row's generation",
    );
    assert.strictEqual(row.error_doc, null, 'no current render error');
    assert.strictEqual(
      row.isolated_html,
      '<div>n2 good</div>',
      'the last good render is kept',
    );
    assert.deepEqual(
      row.diagnostics?.transientRenderFailure,
      ['instance'],
      'the failure is recorded in diagnostics',
    );
    assert.strictEqual(
      row.diagnostics?.transientRenderError?.message,
      'Render timed-out after 60000 ms',
      'with what failed',
    );
    assert.strictEqual(row.diagnostics?.transientRenderFailureRenders, 1);
    assert.strictEqual(
      (await fixture.htmlRow('n1')).isolated_html,
      '<div>fresh</div>',
      'the other notes rendered',
    );
    assert.deepEqual(
      (await fixture.search()).ids,
      allIds,
      'the note is still found',
    );
    assert.deepEqual(
      await fixture.sweepFinds(),
      [cardURL('n2')],
      'the reconcile sweep re-renders it',
    );
  });

  test('an HTML pass whose prerender request aborts keeps the card searchable with its last good HTML', async function (assert) {
    await fixture.htmlPass(
      new Map([
        [
          cardURL('n3'),
          {
            kind: 'throws',
            message:
              'Prerender request to http://prerender.test/ aborted after 60000ms (requestId=r1)',
          },
        ],
      ]),
    );

    let row = await fixture.htmlRow('n3');
    assert.strictEqual(row.error_doc, null, 'no current render error');
    assert.strictEqual(row.isolated_html, '<div>n3 good</div>');
    assert.deepEqual(row.diagnostics?.transientRenderFailure, ['instance']);
    assert.deepEqual((await fixture.search()).ids, allIds);
  });

  test('the retries back off', async function (assert) {
    let base = TRANSIENT_RENDER_FAILURE_RETRY_BASE_MS;
    await fixture.htmlPass(timesOut('n2'));
    assert.deepEqual(
      await fixture.sweepFinds(base - 60_000),
      [],
      'the first retry waits out the base interval',
    );
    assert.deepEqual(await fixture.sweepFinds(base + 60_000), [cardURL('n2')]);

    await fixture.htmlPass(timesOut('n2'));
    assert.deepEqual(
      await fixture.sweepFinds(base + 60_000),
      [],
      'the second waits twice as long',
    );
    assert.deepEqual(await fixture.sweepFinds(2 * base + 60_000), [
      cardURL('n2'),
    ]);
  });

  test('a render that keeps timing out keeps its last good render past the retries, and is no longer retried', async function (assert) {
    for (let i = 0; i <= TRANSIENT_RENDER_FAILURE_RETRY_CAP; i++) {
      assert.deepEqual(
        i === 0 ? [] : await fixture.sweepFinds(),
        i === 0 ? [] : [cardURL('n2')],
        `retry ${i} is due`,
      );
      await fixture.htmlPass(timesOut('n2'));
    }
    let row = await fixture.htmlRow('n2');
    assert.strictEqual(
      row.diagnostics?.transientRenderFailureRenders,
      TRANSIENT_RENDER_FAILURE_RETRY_CAP + 1,
      'the failure and every retry failed',
    );
    assert.strictEqual(row.error_doc, null, 'still not the card’s error');
    assert.strictEqual(row.isolated_html, '<div>n2 good</div>', 'stale');
    assert.deepEqual(await fixture.sweepFinds(), [], 'no retry past the cap');
    assert.deepEqual((await fixture.search()).ids, allIds, 'still visible');

    await fixture.htmlPass(new Map());
    row = await fixture.htmlRow('n2');
    assert.strictEqual(row.isolated_html, '<div>fresh</div>');
    assert.notOk(
      row.diagnostics?.transientRenderFailure,
      'a good render ends the run',
    );
  });

  test('a card with no render to keep records its timeout as its error at once, and is retried', async function (assert) {
    await fixture.dropRenderings('n3');
    await fixture.htmlPass(timesOut('n3'));

    let row = await fixture.htmlRow('n3');
    assert.strictEqual(row.isolated_html, null, 'there was nothing to keep');
    assert.strictEqual(
      row.error_doc?.message,
      renderTimeout.message,
      'the timeout is the row’s error',
    );
    assert.true(row.error_doc?.noGoodRowToKeep, 'marked as such');
    assert.deepEqual(
      (await fixture.search()).ids,
      idsWithout('n3'),
      'the card shows as errored, as a genuine error would',
    );
    assert.deepEqual(await fixture.sweepFinds(), [cardURL('n3')], 'retried');

    await fixture.htmlPass(new Map());
    assert.strictEqual((await fixture.htmlRow('n3')).error_doc, null);
    assert.deepEqual((await fixture.search()).ids, allIds, 'and it heals');
  });

  test('a genuine render error still takes the card out of search', async function (assert) {
    await fixture.htmlPass(
      new Map([[cardURL('n2'), { kind: 'card-error', error: genuineError }]]),
    );

    let row = await fixture.htmlRow('n2');
    assert.strictEqual(
      row.error_doc?.message,
      genuineError.message,
      'the render error is current',
    );
    assert.strictEqual(
      row.isolated_html,
      '<div>n2 good</div>',
      'beside the last good render',
    );
    assert.notOk(row.diagnostics?.transientRenderFailure);
    assert.deepEqual((await fixture.search()).ids, idsWithout('n2'));
    assert.deepEqual(
      await fixture.sweepFinds(),
      [],
      'a genuine error is terminal',
    );
  });

  test('a timeout stored as an error before the fix does not gate search, and is re-rendered once', async function (assert) {
    await fixture.storeRenderError('n1', legacyRenderTimeout);
    assert.deepEqual((await fixture.search()).ids, allIds);
    assert.deepEqual(
      await fixture.sweepFinds(),
      [cardURL('n1')],
      'the reconcile sweep re-renders it',
    );

    await fixture.htmlPass(new Map());
    assert.strictEqual(
      (await fixture.htmlRow('n1')).error_doc,
      null,
      'the re-render replaced the stored timeout',
    );
    assert.deepEqual(await fixture.sweepFinds(), []);
  });

  test('a genuine render error stored the same way still gates search', async function (assert) {
    await fixture.storeRenderError('n1', genuineError);
    assert.deepEqual((await fixture.search()).ids, idsWithout('n1'));
    assert.deepEqual(await fixture.sweepFinds(), []);
    // Heal it, so the store is in step again when the test closes: a row
    // edited by hand skips the liveness sync a writer runs.
    await fixture.htmlPass(new Map());
    assert.deepEqual((await fixture.search()).ids, allIds);
  });
});
