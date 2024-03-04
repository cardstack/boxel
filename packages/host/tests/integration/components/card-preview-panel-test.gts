import Service from '@ember/service';
import { click, waitFor } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import CardPreviewPanel from '@cardstack/host/components/operator-mode/card-preview-panel';

import type LoaderService from '@cardstack/host/services/loader-service';

import { testRealmURL, shimModule } from '../../helpers';
import { Format } from 'https://cardstack.com/base/card-api';

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
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CardPreviewPanel
            @card={{card}}
            @format={{format}}
            @setFormat={{setFormat}}
            @realmURL={{testRealmURL}}
          />
        </template>
      },
    );
    await waitFor('[data-test-firstName]'); // we need to wait for the card instance to load
    assert.dom('[data-test-firstName]').hasText('Mango');

    assert.dom('.footer-button').exists({ count: 4 });

    this.element.querySelector('.preview-footer').style.width = '499px'; // At 500px, the footer buttons will collapse into a dropdown
    await this.pauseTest();
    assert.dom('.footer-button').exists({ count: 1 });

    assert.dom('.footer-button').hasText('Isolated');
    await click('.footer-button');
    await click('[data-test-boxel-menu-item-text="Atom"]');
    await this.pauseTest();
    assert.dom('.footer-button').hasText('Atom');

    this.element.querySelector('.preview-footer').style.width = '901px';
    debugger;
    assert.dom('.footer-button').exists({ count: 4 });
    assert
      .dom('[data-test-preview-card-footer-button-atom]')
      .hasClass('active');
  });
});
