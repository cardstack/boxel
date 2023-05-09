import { module, test } from 'qunit';
import GlimmerComponent from '@glimmer/component';
import { setupRenderingTest } from 'ember-qunit';
import { baseRealm } from '@cardstack/runtime-common';
import { Realm } from '@cardstack/runtime-common/realm';
import { Loader } from '@cardstack/runtime-common/loader';
import OperatorMode from '@cardstack/host/components/operator-mode';
import CardPrerender from '@cardstack/host/components/card-prerender';
import { Card } from 'https://cardstack.com/base/card-api';
import { renderComponent } from '../../helpers/render-component';
import {
  testRealmURL,
  setupCardLogs,
  setupMockLocalRealm,
  TestRealmAdapter,
  TestRealm,
} from '../../helpers';
import { waitFor, waitUntil, click, fillIn } from '@ember/test-helpers';
import type LoaderService from '@cardstack/host/services/loader-service';
import { shimExternals } from '@cardstack/host/lib/externals';

let cardApi: typeof import('https://cardstack.com/base/card-api');

module('Integration | operator-mode', function (hooks) {
  let adapter: TestRealmAdapter;
  let realm: Realm;
  setupRenderingTest(hooks);
  setupMockLocalRealm(hooks);
  setupCardLogs(
    hooks,
    async () => await Loader.import(`${baseRealm.url}card-api`)
  );

  async function loadCard(url: string): Promise<Card> {
    let { createFromSerialized, recompute } = cardApi;
    let result = await realm.searchIndex.card(new URL(url));
    if (!result || result.type === 'error') {
      throw new Error(
        `cannot get instance ${url} from the index: ${
          result ? result.error.detail : 'not found'
        }`
      );
    }
    let card = await createFromSerialized<typeof Card>(
      result.doc.data,
      result.doc,
      undefined,
      {
        loader: Loader.getLoaderFor(createFromSerialized),
      }
    );
    await recompute(card, { loadFields: true });
    return card;
  }

  hooks.beforeEach(async function () {
    Loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/')
    );
    shimExternals();
    let loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
    cardApi = await loader.import(`${baseRealm.url}card-api`);

    adapter = new TestRealmAdapter({
      'pet.gts': `
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
      `,
      'address.gts': `
        import { contains, field, Component, Card } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        import { FieldContainer } from '@cardstack/boxel-ui';

        export class Address extends Card {
          @field city = contains(StringCard);
          @field country = contains(StringCard);
          static embedded = class Embedded extends Component<typeof this> {
            <template>
              <h3 data-test-city={{@model.city}}>
                <@fields.city/>
              </h3>
              <h3 data-test-country={{@model.country}}>
                <@fields.country/>
              </h3>
            </template>
          }

          static edit = class Edit extends Component<typeof this> {
            <template>
              <FieldContainer @label='city' @tag='label' data-test-boxel-input-city>
                <@fields.city />
              </FieldContainer>
              <FieldContainer @label='country' @tag='label' data-test-boxel-input-country>
                <@fields.country />
              </FieldContainer>
            </template>
          };
        }
      `,
      'person.gts': `
        import { contains, linksTo, field, Component, Card } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        import { Pet } from "./pet";
        import { Address } from "./address";


        export class Person extends Card {
          @field firstName = contains(StringCard);
          @field pet = linksTo(Pet);
          @field firstLetterOfTheName = contains(StringCard, {
            computeVia: function (this: Chain) {
              return this.firstName[0];
            },
          });
          @field address = contains(Address);
          static isolated = class Embedded extends Component<typeof this> {
            <template>
              <h2 data-test-person={{@model.firstName}}>
                <@fields.firstName/>
              </h2>
              <p data-test-first-letter-of-the-name={{@model.firstLetterOfTheName}}>
                <@fields.firstLetterOfTheName/>
              </p>
              Pet: <@fields.pet/>
              Address: <@fields.address/>
            </template>
          }
        }
      `,
      'Pet/mango.json': {
        data: {
          type: 'card',
          id: `${testRealmURL}Pet/mango`,
          attributes: {
            name: 'Mango',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}pet`,
              name: 'Pet',
            },
          },
        },
      },
      'Person/fadhlan.json': {
        data: {
          type: 'card',
          id: `${testRealmURL}Person/fadhlan`,
          attributes: {
            firstName: 'Fadhlan',
            address: {
              city: 'Bandung',
              country: 'Indonesia',
            },
          },
          relationships: {
            pet: {
              links: {
                self: `${testRealmURL}Pet/mango`,
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}person`,
              name: 'Person',
            },
          },
        },
      },
      'grid.json': {
        data: {
          type: 'card',
          attributes: {},
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/cards-grid',
              name: 'CardsGrid',
            },
          },
        },
      },
      'blog-post.gts': `
        import StringCard from 'https://cardstack.com/base/string';
        import TextAreaCard from 'https://cardstack.com/base/text-area';
        import {
          Card,
          field,
          contains,
          linksTo,
          Component,
        } from 'https://cardstack.com/base/card-api';
        import { Author } from './author';

        export class BlogPost extends Card {
          @field title = contains(StringCard);
          @field slug = contains(StringCard);
          @field body = contains(TextAreaCard);
          @field authorBio = linksTo(Author);
          static embedded = class Embedded extends Component<typeof this> {
            <template>
              <@fields.title /> by <@fields.authorBio />
            </template>
          };
        }
      `,
      'author.gts': `
        import StringCard from 'https://cardstack.com/base/string';
        import {
          Component,
          Card,
          field,
          contains,
        } from 'https://cardstack.com/base/card-api';

        export class Author extends Card {
          @field firstName = contains(StringCard);
          @field lastName = contains(StringCard);
          static embedded = class Embedded extends Component<typeof this> {
            <template>
              <@fields.firstName /> <@fields.lastName />
            </template>
          };
        }
      `,
      'publishing-packet.gts': `
        import TextAreaCard from 'https://cardstack.com/base/text-area';
        import {
          Card,
          field,
          contains,
          linksTo,
        } from 'https://cardstack.com/base/card-api';
        import { BlogPost } from './blog-post';

        export class PublishingPacket extends Card {
          @field blogPost = linksTo(BlogPost);
          @field socialBlurb = contains(TextAreaCard);
        }
      `,
      'CatalogEntry/publishing-packet.json': {
        data: {
          type: 'card',
          attributes: {
            title: 'Publishing Packet',
            description: 'Catalog entry for PublishingPacket',
            ref: {
              module: '../publishing-packet',
              name: 'PublishingPacket',
            },
            demo: {
              socialBlurb: null,
            },
          },
          relationships: {
            'demo.blogPost': {
              links: {
                self: '../BlogPost/1',
              },
            },
          },
          meta: {
            fields: {
              demo: {
                adoptsFrom: {
                  module: '../publishing-packet',
                  name: 'PublishingPacket',
                },
              },
            },
            adoptsFrom: {
              module: 'https://cardstack.com/base/catalog-entry',
              name: 'CatalogEntry',
            },
          },
        },
      },
    });
    realm = await TestRealm.createWithAdapter(adapter, this.owner);
    loader.registerURLHandler(new URL(realm.url), realm.handle.bind(realm));
    await realm.ready;
  });

  test("it doesn't change the field value if user clicks cancel in edit view", async function (assert) {
    let card = await loadCard(`${testRealmURL}Person/fadhlan`);
    let onClose = () => {};
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @firstCardInStack={{card}} @onClose={{onClose}} />
          <CardPrerender />
        </template>
      }
    );
    await waitFor('[data-test-person]');
    assert.dom('[data-test-person]').hasText('Fadhlan');
    assert.dom('[data-test-first-letter-of-the-name]').hasText('F');
    assert.dom('[data-test-city]').hasText('Bandung');
    assert.dom('[data-test-country]').hasText('Indonesia');

    await click('[aria-label="Edit"]');
    await fillIn('[data-test-boxel-input]', 'EditedName');
    await fillIn(
      '[data-test-boxel-input-city] [data-test-boxel-input]',
      'EditedCity'
    );
    await fillIn(
      '[data-test-boxel-input-country] [data-test-boxel-input]',
      'EditedCountry'
    );

    await click('[aria-label="Cancel"]');
    assert.dom('[data-test-person]').hasText('Fadhlan');
    assert.dom('[data-test-first-letter-of-the-name]').hasText('F');
    assert.dom('[data-test-city]').hasText('Bandung');
    assert.dom('[data-test-country]').hasText('Indonesia');
  });

  test('it changes the field value if user clicks save in edit view', async function (assert) {
    let card = await loadCard(`${testRealmURL}Person/fadhlan`);
    let onClose = () => {};
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @firstCardInStack={{card}} @onClose={{onClose}} />
          <CardPrerender />
        </template>
      }
    );
    await waitFor('[data-test-person]');
    assert.dom('[data-test-person]').hasText('Fadhlan');
    assert.dom('[data-test-first-letter-of-the-name]').hasText('F');
    assert.dom('[data-test-city]').hasText('Bandung');
    assert.dom('[data-test-country]').hasText('Indonesia');

    await click('[aria-label="Edit"]');
    await fillIn('[data-test-boxel-input]', 'EditedName');
    await fillIn(
      '[data-test-boxel-input-city] [data-test-boxel-input]',
      'EditedCity'
    );
    await fillIn(
      '[data-test-boxel-input-country] [data-test-boxel-input]',
      'EditedCountry'
    );
    await click('[aria-label="Save"]');

    await waitFor('[data-test-person="EditedName"]');
    assert.dom('[data-test-person]').hasText('EditedName');
    assert.dom('[data-test-first-letter-of-the-name]').hasText('E');
    assert.dom('[data-test-city]').hasText('EditedCity');
    assert.dom('[data-test-country]').hasText('EditedCountry');
  });

  test('no card if user closes the only card in the stack', async function (assert) {
    let card = await loadCard(`${testRealmURL}Person/fadhlan`);
    let onClose = () => {};
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @firstCardInStack={{card}} @onClose={{onClose}} />
          <CardPrerender />
        </template>
      }
    );
    await waitFor('[data-test-person]');
    assert.dom('[data-test-person]').isVisible();

    await click('[aria-label="Close"]');
    await waitUntil(
      () => {
        return !document.querySelector('.operator-mode-card-stack__card__item');
      },
      { timeout: 3000 }
    );
    assert.dom('[data-test-person]').isNotVisible();
  });

  test('can create new card from the cards-grid card', async function (assert) {
    let card = await loadCard(`${testRealmURL}grid`);
    let onClose = () => {};
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @firstCardInStack={{card}} @onClose={{onClose}} />
          <CardPrerender />
        </template>
      }
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    assert.dom(`[data-test-stack-card-index="0"]`).exists();

    await click('[data-test-create-new-card-button]');
    await waitFor(
      `[data-test-card-catalog-item="${testRealmURL}CatalogEntry/publishing-packet"]`
    );
    assert.dom('[data-test-card-catalog-item]').exists({ count: 1 });

    await click(
      `[data-test-select="${testRealmURL}CatalogEntry/publishing-packet"]`
    );
    await waitFor('[data-test-stack-card-index="1"]');
    assert
      .dom('[data-test-stack-card-index="1"] [data-test-field="blogPost"]')
      .exists();

    await click('[data-test-operator-mode-save-button]');
    await waitFor(`[data-test-stack-card="${testRealmURL}PublishingPacket/1"]`);
    assert
      .dom(`[data-test-stack-card="${testRealmURL}PublishingPacket/1"]`)
      .exists();
  });

  test('create new card editor opens in the stack at each nesting level', async function (assert) {
    let card = await loadCard(`${testRealmURL}grid`);
    let onClose = () => {};
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @firstCardInStack={{card}} @onClose={{onClose}} />
          <CardPrerender />
        </template>
      }
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    assert.dom(`[data-test-stack-card-index="0"]`).exists();

    await click('[data-test-create-new-card-button]');
    await waitFor(
      `[data-test-card-catalog-item="${testRealmURL}CatalogEntry/publishing-packet"]`
    );
    assert.dom('[data-test-card-catalog-item]').exists({ count: 1 });

    await click(
      `[data-test-select="${testRealmURL}CatalogEntry/publishing-packet"]`
    );
    await waitFor('[data-test-stack-card-index="1"]');
    assert
      .dom('[data-test-stack-card-index="1"] [data-test-field="blogPost"]')
      .exists();

    await click('[data-test-create-new]');

    await waitFor(`[data-test-stack-card-index="2"]`);
    assert.dom('[data-test-stack-card-index]').exists({ count: 3 });
    assert
      .dom('[data-test-stack-card-index="2"] [data-test-field="authorBio"]')
      .exists();

    await click(
      '[data-test-stack-card-index="2"] [data-test-field="authorBio"] [data-test-create-new]'
    );
    await waitFor(`[data-test-stack-card-index="3"]`);

    assert
      .dom('[data-test-field="firstName"] [data-test-boxel-input]')
      .exists();
    await fillIn(
      '[data-test-field="firstName"] [data-test-boxel-input]',
      'Alice'
    );
    await fillIn(
      '[data-test-field="lastName"] [data-test-boxel-input]',
      'Enwunder'
    );

    await click(
      '[data-test-stack-card-index="3"] [data-test-operator-mode-save-button]'
    );
    await waitUntil(
      () => !document.querySelector('[data-test-stack-card-index="3"]')
    );

    assert
      .dom('[data-test-stack-card-index="2"] [data-test-field="authorBio"]')
      .containsText('Alice Enwunder');

    await fillIn(
      '[data-test-stack-card-index="2"] [data-test-field="title"] [data-test-boxel-input]',
      'Mad As a Hatter'
    );
    await click(
      '[data-test-stack-card-index="2"] [data-test-operator-mode-save-button]'
    );
    await waitUntil(
      () => !document.querySelector('[data-test-stack-card-index="2"]')
    );

    assert
      .dom('[data-test-stack-card-index="1"] [data-test-field="blogPost"]')
      .containsText('Mad As a Hatter by Alice Enwunder');
    assert
      .dom(`[data-test-stack-card="${testRealmURL}PublishingPacket/1"]`)
      .doesNotExist();

    await fillIn(
      '[data-test-stack-card-index="1"] [data-test-field="socialBlurb"] [data-test-boxel-input]',
      `Everyone knows that Alice ran the show in the Brady household. But when Alice’s past comes to light, things get rather topsy turvy…`
    );
    await click(
      '[data-test-stack-card-index="1"] [data-test-operator-mode-save-button]'
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}PublishingPacket/1"]`);

    assert
      .dom(`[data-test-stack-card="${testRealmURL}PublishingPacket/1"]`)
      .containsText(
        'Everyone knows that Alice ran the show in the Brady household.'
      );
  });
});
