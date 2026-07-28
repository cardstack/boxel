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
});
