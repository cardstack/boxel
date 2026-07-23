import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import { ProcessCard, setupBaseRealm } from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | Card | process-card', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  module('percentComplete', function () {
    test('computes the fraction done / total as a rounded percentage', function (assert) {
      let card = new ProcessCard({ progressDone: 3, progressTotal: 12 });
      assert.strictEqual(card.percentComplete, 25);
    });

    test('is 0 when the total is unknown', function (assert) {
      let card = new ProcessCard({ progressDone: 3 });
      assert.strictEqual(card.percentComplete, 0);
    });

    test('clamps above 100 and below 0', function (assert) {
      let over = new ProcessCard({ progressDone: 20, progressTotal: 12 });
      assert.strictEqual(over.percentComplete, 100, 'clamped to 100');

      let under = new ProcessCard({ progressDone: -5, progressTotal: 12 });
      assert.strictEqual(under.percentComplete, 0, 'clamped to 0');
    });
  });

  module('progressLabel', function () {
    test('reads "done of total items" when a total is present', function (assert) {
      let card = new ProcessCard({ progressDone: 3, progressTotal: 12 });
      assert.strictEqual(card.progressLabel, '3 of 12 items');
    });

    test('treats a missing progressDone as 0', function (assert) {
      let card = new ProcessCard({ progressTotal: 12 });
      assert.strictEqual(card.progressLabel, '0 of 12 items');
    });

    test('is empty when the total is unknown', function (assert) {
      let card = new ProcessCard({ progressDone: 3 });
      assert.strictEqual(card.progressLabel, '');
    });
  });

  module('statusLabel', function () {
    test('defaults to "running" when processStatus is unset', function (assert) {
      let card = new ProcessCard({});
      assert.strictEqual(card.statusLabel, 'running');
    });

    test('reflects an explicit processStatus', function (assert) {
      let card = new ProcessCard({ processStatus: 'done' });
      assert.strictEqual(card.statusLabel, 'done');
    });
  });

  module('rendering', function () {
    test('renders the progress bar and copy', async function (assert) {
      let card = new ProcessCard({
        listingName: 'My Workspace',
        stage: 'Importing files',
        progressDone: 3,
        progressTotal: 12,
        processStatus: 'running',
      });

      await renderCard(loader, card, 'embedded');

      assert.dom('.process-card').exists();
      assert.dom('.process-card__name').hasText('My Workspace');
      assert.dom('.process-card__stage').hasText('Importing files');
      assert.dom('.process-card__count').hasText('3 of 12 items');
      assert.dom('.process-card__status').hasText('running');
      assert
        .dom('[data-test-boxel-progress-bar]')
        .exists('renders the shared themed progress bar');
    });

    test('falls back to a default stage and title when unset', async function (assert) {
      let card = new ProcessCard({});

      await renderCard(loader, card, 'embedded');

      assert.dom('.process-card__stage').hasText('In progress');
      assert.dom('.process-card__name').hasText('Setup process');
      assert.dom('.process-card__count').hasText('');
      assert.dom('[data-test-boxel-progress-bar]').exists();
    });
  });
});
