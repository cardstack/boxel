import { module, test } from 'qunit';

import {
  setupCardTest,
  setupIntegrationTestRealm,
  withCachedRealmSetup,
} from '@cardstack/host/tests/helpers';
import { renderCard } from '@cardstack/host/tests/helpers/render-component';

import { SampleCommandCard } from '../sample-command-card';

export function runTests() {
  module('Catalog | SampleCommandCard (standalone test file)', function (hooks) {
    let { mockMatrixUtils } = setupCardTest(hooks);

    hooks.beforeEach(async function () {
      await withCachedRealmSetup(async () =>
        setupIntegrationTestRealm({
          mockMatrixUtils,
          contents: {
            'sample-command-card.gts': { SampleCommandCard },
            '.realm.json': '{ "name": "Sample Realm" }',
          },
        }),
      );
    });

    test('renders the card title', async function (this: any, assert) {
      let loader = this.owner.lookup('service:loader-service').loader;
      let card = new SampleCommandCard({ title: 'Test Title' });
      await renderCard(loader, card, 'isolated');
      assert.dom('h1').hasText('Test Title');
    });
  });
}
