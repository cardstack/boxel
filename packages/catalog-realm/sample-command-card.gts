import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class SampleCommandCard extends CardDef {
  static displayName = 'Sample Command Card';
  @field title = contains(StringField);

  static isolated = class Isolated extends Component<typeof SampleCommandCard> {
    <template>
      <h1><@fields.title /></h1>
      <button type='button'>Create Card</button>
    </template>
  };
}

// ── Tests (imports resolved via loader.shimModule in live-test.js) ────────────
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import { click, render, waitUntil } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';
import { module, test } from 'qunit';

import { type Store } from '@cardstack/runtime-common';
import {
  setupCardTest,
  setupIntegrationTestRealm,
  testRealmURL,
  withCachedRealmSetup,
  type TestContextWithSave,
} from '@cardstack/host/tests/helpers';
import { TestRealmAdapter } from '@cardstack/host/tests/helpers/adapter';

class CreateCardButton extends GlimmerComponent {
  @service declare store: Store;

  createCard = async () => {
    await this.store.add(
      new SampleCommandCard({ title: 'Hello from live-test' }),
    );
  };

  <template>
    <button type='button' {{on 'click' this.createCard}}>Create Card</button>
  </template>
}

export function runTests() {
  module('Catalog | SampleCommandCard', function (hooks) {
    let { mockMatrixUtils } = setupCardTest(hooks);

    let testRealmAdapter: TestRealmAdapter;
    let testRealm: Awaited<ReturnType<typeof setupIntegrationTestRealm>>['realm'];

    hooks.beforeEach(async function () {
      let result = await withCachedRealmSetup(async () =>
        setupIntegrationTestRealm({
          mockMatrixUtils,
          contents: {
            'sample-command-card.gts': { SampleCommandCard },
            '.realm.json': '{ "name": "Sample Realm" }',
          },
        }),
      );
      testRealmAdapter = result.adapter;
      testRealm = result.realm;
    });

    test('clicking Create Card writes a new card to the realm', async function (this: TestContextWithSave, assert) {
      assert.expect(3);

      let savedUrl: URL | undefined;
      this.onSave((url, doc) => {
        savedUrl = url;
        assert.strictEqual(
          (doc as any).data.attributes.title,
          'Hello from live-test',
          'saved doc has correct title',
        );
      });

      await render(<template><CreateCardButton /></template>);
      await click('button');

      assert.ok(savedUrl, 'card was saved to realm');
      let relativePath = `${savedUrl!.href.substring(testRealmURL.length)}.json`;
      let file = await testRealmAdapter.openFile(relativePath);
      assert.ok(file, 'card JSON file exists in the realm adapter');
    });

    test('search finds the newly created card', async function (this: TestContextWithSave, assert) {
      assert.expect(3);

      let savedUrl: URL | undefined;
      this.onSave((url) => {
        savedUrl = url;
      });

      await render(<template><CreateCardButton /></template>);
      await click('button');

      await waitUntil(() => Boolean(savedUrl), { timeout: 5000 });

      await waitUntil(
        async () => {
          let { data: cards } =
            await testRealm.realmIndexQueryEngine.searchCards({
              filter: {
                on: {
                  module: `${testRealmURL}sample-command-card`,
                  name: 'SampleCommandCard',
                },
                eq: { title: 'Hello from live-test' },
              },
            });
          return cards.length === 1;
        },
        { timeout: 5000 },
      );

      let { data: cards } = await testRealm.realmIndexQueryEngine.searchCards({
        filter: {
          on: {
            module: `${testRealmURL}sample-command-card`,
            name: 'SampleCommandCard',
          },
          eq: { title: 'Hello from live-test' },
        },
      });

      assert.strictEqual(cards.length, 1, 'search returns the created card');
      assert.strictEqual(
        (cards[0] as any).attributes?.title,
        'Hello from live-test',
        'search result has correct title',
      );
      assert.ok(savedUrl, 'card save completed');
    });
  });
}
