import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  PRERENDER_HTML_VISIT_FAILURE_RETRY_CAP,
  TRANSIENT_RENDER_FAILURE_RETRY_BASE_MS,
  TRANSIENT_RENDER_FAILURE_RETRY_CAP,
  findStalePrerenderedHtmlRows,
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

const requestFails: Outcome = {
  kind: 'request-fails',
  message:
    'Prerender request to http://prerender.test/ aborted after 60000ms (requestId=r1)',
};

const requestRefused: Outcome = {
  kind: 'request-refused',
  message:
    'Prerender request to http://prerender.test/prerender-visit failed with status 400: URL is required',
};

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
            kind: 'request-fails',
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

  test('an HTML pass whose prerender request is refused records it as the card’s error', async function (assert) {
    await fixture.htmlPass(
      new Map([
        [
          cardURL('n3'),
          {
            kind: 'request-refused',
            message:
              'Prerender request to http://prerender.test/prerender-visit failed with status 400: URL is required',
          },
        ],
      ]),
    );

    let row = await fixture.htmlRow('n3');
    assert.ok(
      row.error_doc?.message?.includes('failed with status 400'),
      'the refusal is the rendering’s error',
    );
    assert.notOk(
      row.error_doc?.visitRequestFailure,
      'not marked a request failure',
    );
    assert.notOk(row.diagnostics?.transientRenderFailure, 'nor transient');
    assert.deepEqual(
      (await fixture.search()).ids,
      idsWithout('n3'),
      'the card shows as errored',
    );
    assert.deepEqual(
      await fixture.sweepFinds(),
      [],
      'and nothing retries it, as for any render error',
    );
    // Heal it, so the store is in step again when the test closes.
    await fixture.htmlPass(new Map());
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

  test('a failure after the retries ran out starts a new run, with retries of its own', async function (assert) {
    for (let i = 0; i <= TRANSIENT_RENDER_FAILURE_RETRY_CAP; i++) {
      await fixture.sweepFinds();
      await fixture.htmlPass(timesOut('n2'));
    }
    assert.deepEqual(await fixture.sweepFinds(), [], 'the run is spent');

    // The card is rendered again for its own reason (an edit, say), and that
    // render times out too.
    await fixture.htmlPass(timesOut('n2'));
    let row = await fixture.htmlRow('n2');
    assert.strictEqual(
      row.diagnostics?.transientRenderFailureRenders,
      1,
      'a new run',
    );
    assert.strictEqual(row.isolated_html, '<div>n2 good</div>');
    assert.deepEqual(
      await fixture.transientSweepFinds(),
      [cardURL('n2')],
      'which the sweep retries',
    );
  });

  test('a render before its retry was due starts a new run rather than spending a retry', async function (assert) {
    await fixture.htmlPass(timesOut('n2'));
    // Rendered again for its own reason, an edit say, three minutes into the
    // five-minute backoff, and timed out again.
    await fixture.transientSweepFinds(3 * 60_000);
    await fixture.htmlPass(timesOut('n2'));
    assert.strictEqual(
      (await fixture.htmlRow('n2')).diagnostics?.transientRenderFailureRenders,
      1,
    );

    await fixture.sweepFinds(TRANSIENT_RENDER_FAILURE_RETRY_BASE_MS + 60_000);
    await fixture.htmlPass(timesOut('n2'));
    assert.strictEqual(
      (await fixture.htmlRow('n2')).diagnostics?.transientRenderFailureRenders,
      2,
      'the sweep’s due retry extends the run',
    );
  });

  test('a retry that dies before writing counts as a failed attempt', async function (assert) {
    let minutes = TRANSIENT_RENDER_FAILURE_RETRY_BASE_MS / 60_000;
    let ageRepairs = (byMinutes: number) =>
      fixture.adapter.execute(
        `UPDATE jobs SET finished_at = NOW() - ($1 || ' minutes')::interval`,
        { bind: [String(byMinutes)] },
      );
    await fixture.htmlPass(timesOut('n2'));
    await fixture.repairDied('n2', 2 * minutes - 1);
    assert.deepEqual(
      await fixture.transientSweepFinds(),
      [],
      'the next retry waits out the second interval, timed from the repair',
    );
    await ageRepairs(2 * minutes + 1);
    assert.deepEqual(
      await fixture.transientSweepFinds(),
      [cardURL('n2')],
      'and is due once it has',
    );

    await fixture.repairDied('n2', 0);
    await fixture.repairDied('n2', 0);
    await ageRepairs(24 * 60);
    assert.deepEqual(
      await fixture.transientSweepFinds(),
      [],
      'the failure and three dead repairs spend the retries',
    );
    assert.strictEqual(
      (await fixture.htmlRow('n2')).diagnostics?.transientRenderFailureRenders,
      1,
      'the row records only its own failed render',
    );
  });

  test('a retry that fails after retries that died carries them in its run', async function (assert) {
    await fixture.htmlPass(timesOut('n2'));
    await fixture.repairDied('n2', 0);
    await fixture.repairDied('n2', 0);
    await fixture.adapter.execute(
      `UPDATE jobs SET finished_at = NOW() - INTERVAL '1 day'`,
    );
    assert.deepEqual(
      await fixture.transientSweepFinds(),
      [cardURL('n2')],
      'the last retry is due',
    );

    await fixture.htmlPass(timesOut('n2'));
    assert.strictEqual(
      (await fixture.htmlRow('n2')).diagnostics?.transientRenderFailureRenders,
      TRANSIENT_RENDER_FAILURE_RETRY_CAP + 1,
      'the failure, the two retries that died and this one',
    );
    assert.deepEqual(
      await fixture.transientSweepFinds(),
      [],
      'the retries are spent',
    );
  });

  test('the every-minute sweep finds the transient retries and none of the hourly sweep’s other residue', async function (assert) {
    await fixture.htmlPass(timesOut('n2'));
    await fixture.dropRenderings('n1');
    assert.deepEqual(
      await fixture.sweepFinds(),
      [cardURL('n1'), cardURL('n2')],
      'the hourly sweep repairs the missing rendering and retries the timeout',
    );
    assert.deepEqual(
      await fixture.transientSweepFinds(),
      [cardURL('n2')],
      'the every-minute sweep only retries the timeout',
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

  test('a legacy row’s stored timeout does not gate search, and is re-rendered once', async function (assert) {
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

  test('a request failure with no render to keep is retried by the transient lane alone', async function (assert) {
    await fixture.dropRenderings('n3');
    await fixture.htmlPass(new Map([[cardURL('n3'), requestFails]]));
    let row = await fixture.htmlRow('n3');
    assert.true(row.error_doc?.visitRequestFailure, 'a request failure');
    assert.true(row.error_doc?.noGoodRowToKeep, 'with nothing to keep');
    assert.deepEqual(row.diagnostics?.transientRenderFailure, ['instance']);

    assert.deepEqual(
      await fixture.transientSweepFinds(60 * 60_000),
      [cardURL('n3')],
      'the transient lane retries it',
    );
    assert.deepEqual(
      (await findStalePrerenderedHtmlRows(fixture.adapter))
        .map((r) => r.url)
        .filter((url) => url === cardURL('n3')),
      [],
      'the visit-failure lane leaves it to that lane',
    );
    await fixture.htmlPass(new Map());
  });

  test('a legacy row’s request failure still gates search, and is re-rendered once after its own lane’s retries', async function (assert) {
    // A rendering with nothing to keep, then a request failure an earlier
    // release stored on it: marked on every rejected request, without the
    // transient verdict.
    await fixture.dropRenderings('n3');
    await fixture.htmlPass(new Map([[cardURL('n3'), requestRefused]]));
    let legacyFailure = (consecutiveVisitFailures: number) => ({
      status: 500,
      message:
        'Prerender request to http://prerender.test/prerender-visit failed with status 400: URL is required',
      additionalErrors: null,
      visitRequestFailure: true as const,
      consecutiveVisitFailures,
    });
    await fixture.storeRenderError('n3', legacyFailure(1));
    assert.deepEqual(
      (await fixture.search()).ids,
      idsWithout('n3'),
      'it may be a deterministic failure, so it still counts',
    );
    assert.deepEqual(
      await fixture.sweepFinds(10 * 60_000),
      [],
      'within its own lane’s cap, it waits for that lane',
    );

    await fixture.storeRenderError(
      'n3',
      legacyFailure(PRERENDER_HTML_VISIT_FAILURE_RETRY_CAP),
    );
    assert.deepEqual((await fixture.search()).ids, idsWithout('n3'));
    assert.deepEqual(
      await fixture.sweepFinds(10 * 60_000),
      [cardURL('n3')],
      'past that lane’s cap, the sweep re-renders it',
    );

    await fixture.htmlPass(new Map([[cardURL('n3'), requestRefused]]));
    assert.deepEqual(
      (await fixture.search()).ids,
      idsWithout('n3'),
      'a refusal is the card’s error',
    );
    assert.deepEqual(await fixture.sweepFinds(), [], 'once');
    await fixture.htmlPass(new Map());
    assert.deepEqual((await fixture.search()).ids, allIds);
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
