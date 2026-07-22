import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import {
  CardDef,
  ProcessCard,
  RemixCard,
  setupBaseRealm,
} from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | Card | remix-card', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  test('is a ProcessCard subtype with displayName "Remix"', function (assert) {
    assert.strictEqual(RemixCard.displayName, 'Remix');
    assert.true(
      new RemixCard({}) instanceof ProcessCard,
      'a remix is a kind of setup process',
    );
  });

  test('inherits the shared job-progress getters', function (assert) {
    let card = new RemixCard({
      progressDone: 4,
      progressTotal: 8,
      processStatus: 'running',
    });
    assert.strictEqual(card.percentComplete, 50);
    assert.strictEqual(card.progressLabel, '4 of 8 items');
    assert.strictEqual(card.statusLabel, 'running');
  });

  test('links to the card it was remixed from', function (assert) {
    let source = new CardDef({});
    let card = new RemixCard({ remixedFrom: source });
    assert.strictEqual(
      card.remixedFrom,
      source,
      'remixedFrom holds the source the remix was cloned from',
    );
  });

  module('rendering', function () {
    test('renders the inherited progress bar', async function (assert) {
      let card = new RemixCard({
        listingName: 'Remixed Space',
        stage: 'Cloning cards',
        progressDone: 4,
        progressTotal: 8,
      });

      await renderCard(loader, card, 'embedded');

      assert.dom('.process-card__name').hasText('Remixed Space');
      assert.dom('.process-card__stage').hasText('Cloning cards');
      assert.dom('.process-card__count').hasText('4 of 8 items');
      assert
        .dom('.process-card__bar')
        .hasAttribute('role', 'progressbar')
        .hasAttribute('aria-valuenow', '50');
      assert.dom('.process-card__fill').hasAttribute('style', 'width: 50%');
    });

    test('title falls back to "Remix" when listingName is unset', async function (assert) {
      let card = new RemixCard({});

      await renderCard(loader, card, 'embedded');

      assert.dom('.process-card__name').hasText('Remix');
    });
  });
});
