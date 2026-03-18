import { CardDef, field, contains, Component } from 'https://cardstack.com/base/card-api';
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
import { click, render } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';
import { module, test } from 'qunit';

import { getService } from '@universal-ember/test-support';
import { baseRealm, type Store } from '@cardstack/runtime-common';
import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  setupCardLogs,
  testRealmURL,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
  type TestContextWithSave,
} from '@cardstack/host/tests/helpers';
import { TestRealmAdapter } from '@cardstack/host/tests/helpers/adapter';
import { setupMockMatrix } from '@cardstack/host/tests/helpers/mock-matrix';
import { setupRenderingTest } from '@cardstack/host/tests/helpers/setup';

class CreateCardButton extends GlimmerComponent {
  @service declare store: Store;

  createCard = async () => {
    await this.store.add(new SampleCommandCard({ title: 'Hello from live-test' }));
  };

  <template>
    <button type='button' {{on 'click' this.createCard}}>Create Card</button>
  </template>
}

module('Experiments | SampleCommandCard', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);
  setupCardLogs(hooks, async () =>
    (getService('loader-service') as any).loader.import(`${baseRealm.url}card-api`),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  let testRealmAdapter: TestRealmAdapter;

  hooks.beforeEach(async function () {
    ({ adapter: testRealmAdapter } = await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'sample-command-card.gts': { SampleCommandCard },
          '.realm.json': '{ "name": "Sample Realm" }',
        },
      }),
    ));
  });

  test('clicking Create Card writes a new card to the realm', async function (
    this: TestContextWithSave,
    assert,
  ) {
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
    },
  );
});
