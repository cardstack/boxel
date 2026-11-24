import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  checkValueStore,
  query,
  syncValueStoreLiveness,
  type Expression,
  type ValueStoreHost,
} from '@cardstack/runtime-common';

import { testRealm } from './helpers/index.ts';
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

// The value store's half of transient-render-failure-test.ts. The HTML pass
// that ran under an overloaded prerender service called
// `syncValueStoreLiveness` after storing three render timeouts, and the
// liveness check (`LIVE_CARD`) read them as render errors: the cards lost their
// value rows and vanished from every Query V2 search, counts included. A
// transient render failure must leave a card's value rows alone; a genuine
// one, or a transient one with no render to keep, still removes them.

module(basename(import.meta.filename), function (hooks) {
  let fixture = setupTransientRenderFixture(hooks);
  let host = (): ValueStoreHost => ({
    dbAdapter: fixture.adapter,
    query: (e: Expression) => query(fixture.adapter, e),
  });

  async function valueRowCount(name: string) {
    let [{ n }] = (await fixture.adapter.execute(
      `SELECT count(*)::int AS n FROM boxel_index_values v
         JOIN boxel_index_value_cards c ON c.id = v.card_id
        WHERE c.url = $1 AND c.realm_url = $2`,
      { bind: [cardURL(name), testRealm] },
    )) as { n: number }[];
    return n;
  }

  const timesOut = (name: string) =>
    new Map<string, Outcome>([
      [cardURL(name), { kind: 'card-error', error: renderTimeout }],
    ]);

  test('an HTML pass whose render times out leaves the card its value rows, and the count', async function (assert) {
    let before = await valueRowCount('n2');
    assert.ok(before > 0, 'the note has value rows');

    await fixture.htmlPass(timesOut('n2'));

    assert.strictEqual(await valueRowCount('n2'), before, 'intact');
    assert.deepEqual(await fixture.search(), { ids: allIds, total: 3 });
    assert.deepEqual(await checkValueStore(host(), testRealm), []);
  });

  test('a card with no render to keep loses its value rows to its timeout', async function (assert) {
    await fixture.dropRenderings('n3');
    await fixture.htmlPass(timesOut('n3'));

    assert.strictEqual(await valueRowCount('n3'), 0, 'not live');
    assert.deepEqual(await fixture.search(), {
      ids: idsWithout('n3'),
      total: 2,
    });
    assert.deepEqual(await checkValueStore(host(), testRealm), []);
  });

  test('a genuine render error still takes the card out of the value store', async function (assert) {
    await fixture.htmlPass(
      new Map([[cardURL('n2'), { kind: 'card-error', error: genuineError }]]),
    );
    assert.strictEqual(await valueRowCount('n2'), 0);
    assert.deepEqual(await fixture.search(), {
      ids: idsWithout('n2'),
      total: 2,
    });
    assert.deepEqual(await checkValueStore(host(), testRealm), []);
  });

  test('a timeout stored as an error before the fix does not take the value rows in a liveness sync', async function (assert) {
    let before = await valueRowCount('n1');
    await fixture.storeRenderError('n1', legacyRenderTimeout);
    await syncValueStoreLiveness(host(), testRealm, [cardURL('n1')]);

    assert.strictEqual(await valueRowCount('n1'), before, 'kept');
    assert.deepEqual(await fixture.search(), { ids: allIds, total: 3 });
    assert.deepEqual(await checkValueStore(host(), testRealm), []);
  });

  test('a genuine render error stored the same way still does', async function (assert) {
    await fixture.storeRenderError('n1', genuineError);
    await syncValueStoreLiveness(host(), testRealm, [cardURL('n1')]);

    assert.strictEqual(await valueRowCount('n1'), 0, 'gone');
    assert.deepEqual(await fixture.search(), {
      ids: idsWithout('n1'),
      total: 2,
    });
    assert.deepEqual(await checkValueStore(host(), testRealm), []);
  });
});
