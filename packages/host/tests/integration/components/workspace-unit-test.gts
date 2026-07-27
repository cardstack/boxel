import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { setupBaseRealm } from '../../helpers/base-realm';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | Card | workspace | pure functions', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let ws: typeof import('@cardstack/base/workspace');

  hooks.beforeEach(async function () {
    ws = await getService('loader-service').loader.import<
      typeof import('@cardstack/base/workspace')
    >('@cardstack/base/workspace');
  });

  module('etaMinutes', function () {
    const START = 1_000_000;
    const startedAt = new Date(START).toISOString();

    test('projects remaining minutes from the observed arrival rate', function (assert) {
      // 4 of 12 done one minute in -> 15s/item -> 8 remaining -> 2 min.
      assert.strictEqual(
        ws.etaMinutes(
          { progressDone: 4, progressTotal: 12, startedAt },
          START + 60_000,
        ),
        2,
      );
    });

    test('is undefined until at least 3 items are done', function (assert) {
      assert.strictEqual(
        ws.etaMinutes(
          { progressDone: 2, progressTotal: 12, startedAt },
          START + 60_000,
        ),
        undefined,
      );
    });

    test('is undefined when the total does not exceed what is done', function (assert) {
      assert.strictEqual(
        ws.etaMinutes(
          { progressDone: 12, progressTotal: 12, startedAt },
          START + 60_000,
        ),
        undefined,
      );
    });

    test('is undefined without a start time', function (assert) {
      assert.strictEqual(
        ws.etaMinutes({ progressDone: 4, progressTotal: 12 }, START + 60_000),
        undefined,
      );
    });

    test('is undefined when no time has elapsed', function (assert) {
      assert.strictEqual(
        ws.etaMinutes({ progressDone: 4, progressTotal: 12, startedAt }, START),
        undefined,
      );
    });

    test('is suppressed when the estimate exceeds 30 minutes', function (assert) {
      // 3 of 100 one minute in -> ~32 min remaining -> implausible, suppressed.
      assert.strictEqual(
        ws.etaMinutes(
          { progressDone: 3, progressTotal: 100, startedAt },
          START + 60_000,
        ),
        undefined,
      );
    });
  });

  module('classifyActivityVerb', function () {
    const created = 1_000_000;

    test('"Created" when modified within two minutes of creation', function (assert) {
      assert.strictEqual(
        ws.classifyActivityVerb(created + 60_000, created),
        'Created',
      );
    });

    test('"Updated" when modified well after creation', function (assert) {
      assert.strictEqual(
        ws.classifyActivityVerb(created + 300_000, created),
        'Updated',
      );
    });

    test('"Updated" when either timestamp is missing', function (assert) {
      assert.strictEqual(
        ws.classifyActivityVerb(undefined, created),
        'Updated',
      );
      assert.strictEqual(
        ws.classifyActivityVerb(created, undefined),
        'Updated',
      );
    });
  });

  module('activityVerbFor', function () {
    const created = 1_000_000;

    test('a RemixCard is a first-class "Remixed" event regardless of timing', function (assert) {
      // The remix verb wins even when the save timing would otherwise read as a
      // fresh "Created" — the RemixCard instance IS the record of the clone.
      assert.strictEqual(
        ws.activityVerbFor('Remix', created + 60_000, created),
        'Remixed',
      );
      assert.strictEqual(
        ws.activityVerbFor('Remix', created + 300_000, created),
        'Remixed',
      );
    });

    test('a non-remix card falls back to the Created/Updated timing rule', function (assert) {
      assert.strictEqual(
        ws.activityVerbFor('Note', created + 60_000, created),
        'Created',
      );
      assert.strictEqual(
        ws.activityVerbFor('Note', created + 300_000, created),
        'Updated',
      );
      assert.strictEqual(
        ws.activityVerbFor(undefined, created + 60_000, created),
        'Created',
      );
    });
  });

  module('indexEventTitle', function () {
    const realmURL = 'http://test-realm/';

    test('an incremental pass reports how many cards it reindexed', function (assert) {
      assert.strictEqual(
        ws.indexEventTitle({
          eventName: 'index',
          indexType: 'incremental',
          invalidations: ['a', 'b', 'c'],
          realmURL,
        }),
        '3 cards reindexed',
      );
    });

    test('a single-card incremental pass is singular', function (assert) {
      assert.strictEqual(
        ws.indexEventTitle({
          eventName: 'index',
          indexType: 'incremental',
          invalidations: ['a'],
          realmURL,
        }),
        '1 card reindexed',
      );
    });

    test('a full reindex is labeled as such', function (assert) {
      assert.strictEqual(
        ws.indexEventTitle({ eventName: 'index', indexType: 'full', realmURL }),
        'Full reindex',
      );
    });

    test('a copy names the source realm host', function (assert) {
      assert.strictEqual(
        ws.indexEventTitle({
          eventName: 'index',
          indexType: 'copy',
          sourceRealmURL: 'https://source.example.com/realm/',
          realmURL,
        }),
        'Copied from source.example.com',
      );
    });

    test('the pre-index initiation signal is not a feed event', function (assert) {
      // It has no committed state yet, so it must not surface a row.
      assert.strictEqual(
        ws.indexEventTitle({
          eventName: 'index',
          indexType: 'incremental-index-initiation',
          updatedFile: 'index.json',
          realmURL,
        }),
        undefined,
      );
    });
  });
});
