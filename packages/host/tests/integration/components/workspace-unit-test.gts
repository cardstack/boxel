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

  module('progressMilestone', function () {
    test('holds steady between milestones', function (assert) {
      // The point of the quantising: a meter creeping 26 -> 49 must not change
      // the announced text, or the status region interrupts on every tick.
      assert.strictEqual(ws.progressMilestone(26), 25);
      assert.strictEqual(ws.progressMilestone(49), 25);
    });

    test('advances on crossing each quarter', function (assert) {
      assert.strictEqual(ws.progressMilestone(0), 0);
      assert.strictEqual(ws.progressMilestone(25), 25);
      assert.strictEqual(ws.progressMilestone(50), 50);
      assert.strictEqual(ws.progressMilestone(75), 75);
      assert.strictEqual(ws.progressMilestone(100), 100);
    });

    test('clamps a negative percentage to zero', function (assert) {
      assert.strictEqual(ws.progressMilestone(-5), 0);
    });
  });

  module('describeSearchResults', function () {
    test('names a genuine settled zero as no matches', function (assert) {
      // Reached only on settle, so an empty result here is a real "no matches",
      // not the debounce window or a dismissed dropdown (those never call it).
      assert.strictEqual(ws.describeSearchResults(0, 0), 'No matching cards');
    });

    test('counts the shown results, singular and plural', function (assert) {
      assert.strictEqual(ws.describeSearchResults(1, 1), '1 result');
      assert.strictEqual(ws.describeSearchResults(3, 3), '3 results');
    });

    test('reports the shown-of-total split when the list is capped', function (assert) {
      assert.strictEqual(
        ws.describeSearchResults(8, 40),
        'Showing 8 of 40 results',
      );
    });
  });

  module('searchHotkeyLabel', function () {
    test('spells the Frame hotkey the way the platform does', function (assert) {
      // Matches on `Mac`, as codemirror-editor.gts's own mod-key label does.
      // Desktop-class Safari on an iPad also reports MacIntel, so the platforms
      // that actually have a ⌘ key to press are covered.
      assert.strictEqual(ws.searchHotkeyLabel('MacIntel'), '⌘K', 'macOS');
      assert.strictEqual(ws.searchHotkeyLabel('Win32'), 'Ctrl+K', 'Windows');
      assert.strictEqual(
        ws.searchHotkeyLabel('Linux x86_64'),
        'Ctrl+K',
        'Linux',
      );
    });

    test('falls back to Ctrl when the platform is unknown', function (assert) {
      // What a prerender pass sees: no navigator, so the label is built from ''.
      assert.strictEqual(ws.searchHotkeyLabel(''), 'Ctrl+K');
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
});
