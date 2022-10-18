import { module, test } from 'qunit';
import GlimmerComponent from '@glimmer/component';
import { setupRenderingTest } from 'ember-qunit';
import { Loader, baseRealm } from '@cardstack/runtime-common';
import Preview  from 'runtime-spike/components/preview';
import Service from '@ember/service';
import { renderComponent } from '../../helpers/render-component';
import { testRealmURL, shimModule } from '../../helpers';
import type { Format } from "https://cardstack.com/base/card-api";
import { waitFor, fillIn, click } from '../../helpers/shadow-assert';
import type LoaderService from 'runtime-spike/services/loader-service';

let cardApi: typeof import("https://cardstack.com/base/card-api");
let string: typeof import ("https://cardstack.com/base/string");

class MockLocalRealm extends Service {
  isAvailable = true;
  url = new URL(testRealmURL);
}

const formats: Format[] = ['isolated', 'embedded', 'edit'];
module('Integration | preview', function (hooks) {
  let loader: Loader;
  setupRenderingTest(hooks);

  hooks.beforeEach(async function () {
    loader = (this.owner.lookup('service:loader-service') as LoaderService).loader;
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);
    this.owner.register('service:local-realm', MockLocalRealm);
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
      id: `${testRealmURL}test-cards/test-card`, // madeup id to satisfy saved card condition
      attributes: { firstName: 'Mango' },
      meta: {
        adoptsFrom: {
          module: `${testRealmURL}test-cards`,
          name: 'TestCard'
        }
      }
    });

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Preview @card={{card}} @formats={{formats}}/>
        </template>
      }
    )
    await waitFor('[data-test-firstName]'); // we need to wait for the card instance to load
    assert.shadowDOM('[data-test-firstName]').hasText('Mango');
  });

  test('can change card format', async function (assert) {
    let { field, contains, Card, Component, createFromSerialized } = cardApi;
    let { default: StringCard} = string;
    class TestCard extends Card {
      @field firstName = contains(StringCard);
      static isolated = class Isolated extends Component<typeof this> {
        <template> <div data-test-isolated-firstName><@fields.firstName/></div> </template>
      }
      static embedded = class Embedded extends Component<typeof this> {
        <template> <div data-test-embedded-firstName><@fields.firstName/></div> </template>
      }
      static edit = class Edit extends Component<typeof this> {
        <template> <div data-test-edit-firstName><@fields.firstName/></div> </template>
      }
    }
    await shimModule(`${testRealmURL}test-cards`, { TestCard }, loader);

    let card = await createFromSerialized(TestCard, {
      id: `${testRealmURL}test-cards/test-card`, // madeup id to satisfy saved card condition
      attributes: { firstName: 'Mango' },
      meta: {
        adoptsFrom:
        {
          module: `${testRealmURL}test-cards`,
          name: 'TestCard'
        }
      }
    });

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Preview @card={{card}} @formats={{formats}}/>
        </template>
      }
    )
    await waitFor('[data-test-isolated-firstName]'); // we need to wait for the card instance to load
    assert.shadowDOM('[data-test-isolated-firstName]').hasText('Mango');
    assert.shadowDOM('[data-test-embedded-firstName]').doesNotExist();
    assert.shadowDOM('[data-test-edit-firstName]').doesNotExist();

    await click('.format-button.embedded')
    assert.shadowDOM('[data-test-isolated-firstName]').doesNotExist();
    assert.shadowDOM('[data-test-embedded-firstName]').hasText('Mango');
    assert.shadowDOM('[data-test-edit-firstName]').doesNotExist();

    await click('.format-button.edit')
    assert.shadowDOM('[data-test-isolated-firstName]').doesNotExist();
    assert.shadowDOM('[data-test-embedded-firstName]').doesNotExist();
    assert.shadowDOM('[data-test-edit-firstName] input').hasValue('Mango');
  });

  test('edited card data is visible in different formats', async function (assert) {
    let { field, contains, Card, Component, createFromSerialized } = cardApi;
    let { default: StringCard} = string;
    class TestCard extends Card {
      @field firstName = contains(StringCard);
      static isolated = class Isolated extends Component<typeof this> {
        <template> <div data-test-isolated-firstName><@fields.firstName/></div> </template>
      }
      static embedded = class Embedded extends Component<typeof this> {
        <template> <div data-test-embedded-firstName><@fields.firstName/></div> </template>
      }
      static edit = class Edit extends Component<typeof this> {
        <template> <div data-test-edit-firstName><@fields.firstName/></div> </template>
      }
    }
    await shimModule(`${testRealmURL}test-cards`, { TestCard }, loader);
    let card = await createFromSerialized(TestCard, {
      id: `${testRealmURL}test-cards/test-card`, // madeup id to satisfy saved card condition
      attributes: { firstName: 'Mango' },
      meta: {
        adoptsFrom:
        {
          module: `${testRealmURL}test-cards`,
          name: 'TestCard'
        }
      }
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Preview @card={{card}} @formats={{formats}}/>
        </template>
      }
    )

    await click('.format-button.edit')
    await waitFor('[data-test-edit-firstName] input'); // we need to wait for the card instance to load
    await fillIn('[data-test-edit-firstName] input', 'Van Gogh');

    await click('.format-button.embedded');
    assert.shadowDOM('[data-test-embedded-firstName]').hasText('Van Gogh');

    await click('.format-button.isolated');
    assert.shadowDOM('[data-test-isolated-firstName]').hasText('Van Gogh');
  });
});
