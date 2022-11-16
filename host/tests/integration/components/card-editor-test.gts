import { module, test, skip } from 'qunit';
import GlimmerComponent from '@glimmer/component';
import { setupRenderingTest } from 'ember-qunit';
import { baseRealm, LooseSingleCardDocument } from '@cardstack/runtime-common';
import { Realm } from "@cardstack/runtime-common/realm";
import { Loader } from "@cardstack/runtime-common/loader";
import CardEditor  from 'runtime-spike/components/card-editor';
import Service from '@ember/service';
import { renderComponent } from '../../helpers/render-component';
import CardCatalogModal from 'runtime-spike/components/card-catalog-modal';
import { testRealmURL, shimModule, setupCardLogs, TestRealmAdapter, TestRealm, saveCard } from '../../helpers';
import { waitFor, fillIn, click } from '../../helpers/shadow-assert';
import type LoaderService from 'runtime-spike/services/loader-service';
import { Card } from "https://cardstack.com/base/card-api";
import CreateCardModal from 'runtime-spike/components/create-card-modal';

let cardApi: typeof import("https://cardstack.com/base/card-api");
let string: typeof import ("https://cardstack.com/base/string");
let updateFromSerialized: typeof cardApi["updateFromSerialized"];

class MockLocalRealm extends Service {
  isAvailable = true;
  url = new URL(testRealmURL);
}

module('Integration | card-editor', function (hooks) {
  let loader: Loader;
  let adapter: TestRealmAdapter
  let realm: Realm;
  setupRenderingTest(hooks);
  setupCardLogs(hooks, async () => await Loader.import(`${baseRealm.url}card-api`));

  async function loadCard(url: string): Promise<Card> {
    let { createFromSerialized, recompute } = cardApi;
    let result = await realm.searchIndex.card(new URL(url));
    if (!result || result.type === 'error') {
      throw new Error(`cannot get instance ${url} from the index: ${result ? result.error.detail : 'not found'}`);
    }
    let card = await createFromSerialized<typeof Card>(result.doc.data, result.doc, undefined, {
      loader: Loader.getLoaderFor(createFromSerialized)
    });
    await recompute(card, { loadFields: true });
    return card;
  }

  hooks.beforeEach(async function () {
    Loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/')
    );
    let loader = (this.owner.lookup('service:loader-service') as LoaderService).loader;
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);
    updateFromSerialized = cardApi.updateFromSerialized;
    this.owner.register('service:local-realm', MockLocalRealm);

    adapter = new TestRealmAdapter({});
    realm = TestRealm.createWithAdapter(adapter);
    loader.registerURLHandler(new URL(realm.url), realm.handle.bind(realm));
    await realm.ready;

    await realm.write('pet.gts',`
      import { contains, field, Component, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Pet extends Card {
        @field name = contains(StringCard);
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <h3 data-test-pet={{@model.name}}>
              <@fields.name/>
            </h3>
          </template>
        }
      }
    `);
    await realm.write('fancy-pet.gts',`
      import { contains, field, Component, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";
      import { Pet } from "./pet";

      export class FancyPet extends Pet {
        @field favoriteToy = contains(StringCard);
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <h3 data-test-pet={{@model.name}}>
              <@fields.name/>
              (plays with <@fields.favoriteToy/>)
            </h3>
          </template>
        }
      }
    `);
    await realm.write('person.gts',`
      import { contains, linksTo, field, Component, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";
      import { Pet } from "./pet";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field pet = linksTo(Pet);
        static isolated = class Embedded extends Component<typeof this> {
          <template>
            <h2 data-test-person={{@model.firstName}}>
              <@fields.firstName/>
            </h2>
            Pet: <@fields.pet/>
          </template>
        }
      }
    `);
    await realm.write('Pet/mango.json', JSON.stringify({
      data: {
        type: 'card',
        id: `${testRealmURL}Pet/mango`,
        attributes: {
          name: 'Mango'
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}pet`,
            name: 'Pet'
          }
        }
      }
    } as LooseSingleCardDocument));
    await realm.write('Pet/vangogh.json', JSON.stringify({
      data: {
        type: 'card',
        id: `${testRealmURL}Pet/vangogh`,
        attributes: {
          name: 'Van Gogh'
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}pet`,
            name: 'Pet'
          }
        }
      }
    } as LooseSingleCardDocument));
    await realm.write('Pet/ringo.json', JSON.stringify({
      data: {
        type: 'card',
        id: `${testRealmURL}Pet/ringo`,
        attributes: {
          name: 'Ringo',
          favoriteToy: 'sneaky snake',
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}fancy-pet`,
            name: 'FancyPet'
          }
        }
      }
    } as LooseSingleCardDocument));
    await realm.write('Person/hassan.json', JSON.stringify({
      data: {
        type: 'card',
        id: `${testRealmURL}Person/hassan`,
        attributes: {
          firstName: 'Hassan'
        },
        relationships: {
          pet: {
            links: {
              self: `${testRealmURL}Pet/mango`
            }
          }
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}person`,
            name: 'Person'
          }
        }
      }
    } as LooseSingleCardDocument));
    await realm.write('Person/mariko.json', JSON.stringify({
      data: {
        type: 'card',
        id: `${testRealmURL}Person/mariko`,
        attributes: {
          firstName: 'Mariko'
        },
        relationships: {
          pet: {
            links: {
              self: null
            }
          }
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}person`,
            name: 'Person'
          }
        }
      }
    } as LooseSingleCardDocument));
  });

  test('renders card in edit (default) format', async function (assert) {
    let { field, contains, Card, Component } = cardApi;
    let { default: StringCard} = string;
    class TestCard extends Card {
      @field firstName = contains(StringCard);
      static isolated = class Isolated extends Component<typeof this> {
        <template> <div data-test-firstName><@fields.firstName/></div> </template>
      }
    }
    await shimModule(`${testRealmURL}test-cards`, { TestCard }, loader);
    let card = new TestCard({ firstName: "Mango" });
    await saveCard(card, `${testRealmURL}test-cards/test-card`, Loader.getLoaderFor(updateFromSerialized));

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CardEditor @card={{card}} />
        </template>
      }
    )

    await waitFor('[data-test-field="firstName"]'); // we need to wait for the card instance to load
    assert.shadowDOM('[data-test-field="firstName"] input').hasValue('Mango');
  });

  test('can change card format', async function (assert) {
    let { field, contains, Card, Component } = cardApi;
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

    let card = new TestCard({ firstName: "Mango" });
    await saveCard(card, `${testRealmURL}test-cards/test-card`, Loader.getLoaderFor(updateFromSerialized));

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CardEditor @card={{card}} @format="isolated" />
        </template>
      }
    )
    await waitFor('[data-test-isolated-firstName]'); // we need to wait for the card instance to load
    assert.shadowDOM('[data-test-isolated-firstName]').hasText('Mango');
    assert.shadowDOM('[data-test-embedded-firstName]').doesNotExist();
    assert.shadowDOM('[data-test-edit-firstName]').doesNotExist();

    await click('.format-button.embedded');
    assert.shadowDOM('[data-test-isolated-firstName]').doesNotExist();
    assert.shadowDOM('[data-test-embedded-firstName]').hasText('Mango');
    assert.shadowDOM('[data-test-edit-firstName]').doesNotExist();

    await click('.format-button.edit');
    assert.shadowDOM('[data-test-isolated-firstName]').doesNotExist();
    assert.shadowDOM('[data-test-embedded-firstName]').doesNotExist();
    assert.shadowDOM('[data-test-edit-firstName] input').hasValue('Mango');
  });

  test('edited card data is visible in different formats', async function (assert) {
    let { field, contains, Card, Component } = cardApi;
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
    let card = new TestCard({ firstName: "Mango" });
    await saveCard(card, `${testRealmURL}test-cards/test-card`, Loader.getLoaderFor(updateFromSerialized));
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CardEditor @card={{card}} />
        </template>
      }
    )

    await waitFor('[data-test-edit-firstName] input'); // we need to wait for the card instance to load
    await fillIn('[data-test-edit-firstName] input', 'Van Gogh');

    await click('.format-button.embedded');
    assert.shadowDOM('[data-test-embedded-firstName]').hasText('Van Gogh');

    await click('.format-button.isolated');
    assert.shadowDOM('[data-test-isolated-firstName]').hasText('Van Gogh');
  });

  test('can choose a card for a linksTo field that has an existing value', async function(assert) {
    let card = await loadCard(`${testRealmURL}Person/hassan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CardEditor @card={{card}} />
          <CardCatalogModal />
        </template>
      }
    );

    assert.shadowDOM('[data-test-pet="Mango"]').exists();
    assert.shadowDOM('[data-test-pet="Mango"]').containsText("Mango");

    await click('[data-test-remove-card]');
    await click('[data-test-choose-card]');
    await waitFor('[data-test-card-catalog-modal] [data-test-card-catalog-item]');

    assert.shadowDOM('[data-test-card-catalog-modal] [data-test-card-catalog-item]').exists({ count: 3 });
    assert.shadowDOM(`[data-test-select="${testRealmURL}Pet/vangogh"]`).exists();
    assert.shadowDOM(`[data-test-select="${testRealmURL}Pet/ringo"]`).exists();
    assert.shadowDOM(`[data-test-card-catalog-item="${testRealmURL}Pet/mango"`).exists();
    await click(`[data-test-select="${testRealmURL}Pet/vangogh"]`);

    assert.shadowDOM('[data-test-card-catalog-modal]').doesNotExist('card catalog modal dismissed');
    assert.shadowDOM('[data-test-pet="Van Gogh"]').exists();
    assert.shadowDOM('[data-test-pet="Van Gogh"]').containsText("Van Gogh");
  });

  test('can choose a card for a linksTo field that has no existing value', async function(assert) {
    let card = await loadCard(`${testRealmURL}Person/mariko`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CardEditor @card={{card}} />
          <CardCatalogModal />
        </template>
      }
    );

    assert.shadowDOM('[data-test-empty-link]').exists();
    assert.shadowDOM('button[data-test-remove-card]').doesNotExist();

    await click('[data-test-choose-card]');
    await waitFor('[data-test-card-catalog-modal] [data-test-card-catalog-item]');
    await click(`[data-test-select="${testRealmURL}Pet/vangogh"]`);

    assert.shadowDOM('[data-test-card-catalog-modal]').doesNotExist('card catalog modal dismissed');
    assert.shadowDOM('[data-test-pet="Van Gogh"]').exists();
    assert.shadowDOM('[data-test-pet="Van Gogh"]').containsText("Van Gogh");
    assert.shadowDOM('button[data-test-remove-card]').hasProperty('disabled', false, 'remove button is enabled');
  });

  test('can remove the link for a linksTo field', async function (assert) {
    let card = await loadCard(`${testRealmURL}Person/hassan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CardEditor @card={{card}} />
          <CardCatalogModal />
        </template>
      }
    );

    assert.shadowDOM('[data-test-pet="Mango"]').exists();
    assert.shadowDOM('[data-test-pet="Mango"]').containsText("Mango");
    assert.shadowDOM('[data-test-choose-card]').doesNotExist();

    await click('[data-test-remove-card]');

    assert.shadowDOM('[data-test-pet="Mango"]').doesNotExist();
    assert.shadowDOM('[data-test-empty-link]').exists();
    assert.shadowDOM('button[data-test-remove-card]').doesNotExist();
    assert.shadowDOM('[data-test-choose-card]').exists();
  });

  test('can create a new card to populate a linksTo field', async function (assert) {
    let card = await loadCard(`${testRealmURL}Person/mariko`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CardEditor @card={{card}} />
          <CardCatalogModal />
          <CreateCardModal />
        </template>
      }
    );

    await click('[data-test-choose-card]');
    await waitFor('[data-test-create-new]');
    await click('[data-test-create-new]');

    await waitFor('[data-test-create-new-card="Pet"]');

    assert.shadowDOM('[data-test-field="name"] input').exists();
    await fillIn('[data-test-field="name"] input', 'Simba');
    assert.shadowDOM('[data-test-field="name"] input').hasValue('Simba');

    await click('[data-test-create-new-card="Pet"] [data-test-save-card]');
    await waitFor('[data-test-pet="Simba"]');
    assert.shadowDOM('[data-test-create-new-card="Pet"]').doesNotExist();
    assert.shadowDOM('[data-test-remove-card]').exists();

    await click('[data-test-save-card]');

    await waitFor('[data-test-person="Mariko"]');
    assert.shadowDOM('[data-test-person="Mariko"]').hasText('Mariko');
    assert.shadowDOM('[data-test-pet="Simba"]').exists();
    assert.shadowDOM('[data-test-pet="Simba"]').hasText('Simba');
  });

  skip('can create a specialized a new card to populate a linksTo field');
});
