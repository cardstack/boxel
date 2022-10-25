import { module, test } from 'qunit';
import GlimmerComponent from '@glimmer/component';
import { ComponentLike } from '@glint/template';
import { setupRenderingTest } from 'ember-qunit';
import { Loader, baseRealm } from '@cardstack/runtime-common';
import Preview  from 'runtime-spike/components/preview';
import Service from '@ember/service';
import { renderComponent } from '../../helpers/render-component';
import { testRealmURL, shimModule } from '../../helpers';
import { waitFor } from '../../helpers/shadow-assert';
import type LoaderService from 'runtime-spike/services/loader-service';
import type CardService from 'runtime-spike/services/card-service';

let cardApi: typeof import("https://cardstack.com/base/card-api");
let string: typeof import ("https://cardstack.com/base/string");

class MockLocalRealm extends Service {
  isAvailable = true;
  url = new URL(testRealmURL);
}

class MockCardService extends Service {
  components = new WeakMap<
    Record<string, any>,
    (format: 'isolated' | 'embedded' | 'edit') => ComponentLike<{ Args: {}; Blocks: {} }>
  >();
}

module('Integration | preview', function (hooks) {
  let loader: Loader;
  let cardService: CardService;
  setupRenderingTest(hooks);

  hooks.beforeEach(async function () {
    loader = (this.owner.lookup('service:loader-service') as LoaderService).loader;
    cardService = this.owner.lookup('service:card-service') as CardService;
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);
    this.owner.register('service:local-realm', MockLocalRealm);
    this.owner.register('service:card-service', MockCardService);
  });

  test('renders card', async function (assert) {
    let { field, contains, Card, Component, createFromSerialized } = cardApi;
    let { default: StringCard} = string;
    class TestCard extends Card {
      @field firstName = contains(StringCard);
      static isolated = class Isolated extends Component<typeof this> {
        <template> <div data-test-firstName><@fields.firstName/></div> </template>
      }
    }
    await shimModule(`${testRealmURL}test-cards`, { TestCard }, loader);
    let card = await createFromSerialized(TestCard, {
      data: {
        attributes: { firstName: 'Mango' },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}test-cards`,
            name: 'TestCard'
          }
        }
      }
    });
    cardService.components.set(card, format => cardApi.getComponent(card, format));
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Preview @card={{card}} />
        </template>
      }
    )
    await waitFor('[data-test-firstName]'); // we need to wait for the card instance to load
    assert.shadowDOM('[data-test-firstName]').hasText('Mango');
  });
});
