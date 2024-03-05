import Service from '@ember/service';
import { click, render, waitUntil } from '@ember/test-helpers';

import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import CardPreviewPanel from '@cardstack/host/components/operator-mode/card-preview-panel';

import type LoaderService from '@cardstack/host/services/loader-service';

import { Format } from 'https://cardstack.com/base/card-api';

import { testRealmURL, shimModule } from '../../helpers';

let cardApi: typeof import('https://cardstack.com/base/card-api');
let string: typeof import('https://cardstack.com/base/string');

class MockLocalIndexer extends Service {
  url = new URL(testRealmURL);
}

module('Integration | card preview panel', function (hooks) {
  let loader: Loader;
  setupRenderingTest(hooks);

  hooks.beforeEach(async function () {
    loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);
    this.owner.register('service:local-indexer', MockLocalIndexer);
  });

  test('renders card', async function (assert) {
    let { field, contains, CardDef, Component } = cardApi;
    let { default: StringCard } = string;
    class TestCard extends CardDef {
      @field firstName = contains(StringCard);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-firstName><@fields.firstName /></div>
        </template>
      };
    }
    await shimModule(`${testRealmURL}test-cards`, { TestCard }, loader);
    let card = new TestCard({ firstName: 'Mango ' });

    let format = 'isolated' as Format;
    let setFormat = (f: Format) => {
      format = f;
    };
    let realmURL = new URL(testRealmURL);
    await render(<template>
      <CardPreviewPanel
        @card={{card}}
        @format={{format}}
        @setFormat={{setFormat}}
        @realmURL={{realmURL}}
      />
    </template>);

    await waitUntil(
      () => document.querySelectorAll(`.footer-button`).length === 4,
    );

    let element = (this as any).element;

    element.querySelector('.preview-footer').style.width = '499px'; // Reduce width of the footer. At 500px, the footer buttons should collapse into a dropdown

    await waitUntil(
      () => document.querySelectorAll(`.footer-button`).length === 1,
    );

    assert.dom('.footer-button').hasText('Isolated');
    await click('.footer-button');
    await click('[data-test-boxel-menu-item-text="Atom"]');

    assert.strictEqual(format, 'atom');

    element.querySelector('.preview-footer').style.width = '901px'; // Increase width of the footer. At 900px, the footer buttons should expand into individual buttons

    await waitUntil(
      () => document.querySelectorAll(`.footer-button`).length === 4,
    );
  });
});
