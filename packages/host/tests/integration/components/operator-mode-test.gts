import { module, test, skip } from 'qunit';
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
  setupLocalIndexing,
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
  setupLocalIndexing(hooks);
  setupCardLogs(
    hooks,
    async () => await Loader.import(`${baseRealm.url}card-api`)
  );

  let onClose = () => {};

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
      new URL(url),
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
          static displayName = 'Pet';
          @field name = contains(StringCard);
          static embedded = class Embedded extends Component<typeof this> {
            <template>
              <div ...attributes>
                <h3 data-test-pet={{@model.name}}>
                  <@fields.name/>
                </h3>
              </div>
            </template>
          }
        }
      `,
      'address.gts': `
        import { contains, field, Component, Card } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        import { FieldContainer } from '@cardstack/boxel-ui';

        export class Address extends Card {
          static displayName = 'Address';
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
        import { contains, linksTo, field, Component, Card, linksToMany } from "https://cardstack.com/base/card-api";
        import StringCard from "https://cardstack.com/base/string";
        import { Pet } from "./pet";
        import { Address } from "./address";

        export class Person extends Card {
          static displayName = 'Person';
          @field firstName = contains(StringCard);
          @field pet = linksTo(Pet);
          @field friends = linksToMany(Pet);
          @field firstLetterOfTheName = contains(StringCard, {
            computeVia: function (this: Chain) {
              return this.firstName[0];
            },
          });
          @field address = contains(Address);
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <h2 data-test-person={{@model.firstName}}>
                <@fields.firstName/>
              </h2>
              <p data-test-first-letter-of-the-name={{@model.firstLetterOfTheName}}>
                <@fields.firstLetterOfTheName/>
              </p>
              Pet: <@fields.pet/>
              Friends: <@fields.friends/>
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
      'Pet/jackie.json': {
        data: {
          type: 'card',
          id: `${testRealmURL}Pet/jackie`,
          attributes: {
            name: 'Jackie',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}pet`,
              name: 'Pet',
            },
          },
        },
      },
      'Pet/woody.json': {
        data: {
          type: 'card',
          id: `${testRealmURL}Pet/woody`,
          attributes: {
            name: 'Woody',
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
      'Person/burcu.json': {
        data: {
          type: 'card',
          id: `${testRealmURL}Person/burcu`,
          attributes: {
            firstName: 'Burcu',
          },
          relationships: {
            'friends.0': {
              links: {
                self: `${testRealmURL}Pet/jackie`,
              },
            },
            'friends.1': {
              links: {
                self: `${testRealmURL}Pet/woody`,
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
          static displayName = 'Blog Post';
          @field title = contains(StringCard);
          @field slug = contains(StringCard);
          @field body = contains(TextAreaCard);
          @field authorBio = linksTo(Author);
          static embedded = class Embedded extends Component<typeof this> {
            <template>
              <@fields.title /> by <@fields.authorBio />
            </template>
          };
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <div data-test-blog-post-isolated>
                <@fields.title /> by <@fields.authorBio />
              </div>
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
          static displayName = 'Author';
          @field firstName = contains(StringCard);
          @field lastName = contains(StringCard);
          static embedded = class Embedded extends Component<typeof this> {
            <template>
              <span data-test-author="{{@model.firstName}}">
                <@fields.firstName /> <@fields.lastName />
              </span>
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
          static displayName = 'Publishing Packet';
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
              module: `${testRealmURL}publishing-packet`,
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
                  module: `../publishing-packet`,
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
      'BlogPost/1.json': {
        data: {
          type: 'card',
          attributes: {
            title: 'Outer Space Journey',
            body: 'Hello world',
          },
          relationships: {
            authorBio: {
              links: {
                self: '../Author/1',
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: '../blog-post',
              name: 'BlogPost',
            },
          },
        },
      },
      'BlogPost/2.json': {
        data: {
          type: 'card',
          attributes: {
            title: 'Beginnings',
          },
          relationships: {
            authorBio: {
              links: {
                self: null,
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: '../blog-post',
              name: 'BlogPost',
            },
          },
        },
      },
      'Author/1.json': {
        data: {
          type: 'card',
          attributes: {
            firstName: 'Alien',
            lastName: 'Bob',
          },
          meta: {
            adoptsFrom: {
              module: '../author',
              name: 'Author',
            },
          },
        },
      },
      'Author/2.json': {
        data: {
          type: 'card',
          attributes: {
            firstName: 'R2-D2',
          },
          meta: {
            adoptsFrom: {
              module: '../author',
              name: 'Author',
            },
          },
        },
      },
    });
    realm = await TestRealm.createWithAdapter(adapter, this.owner);
    loader.registerURLHandler(new URL(realm.url), realm.handle.bind(realm));
    await realm.ready;
  });

  test('it loads a card and renders its isolated view', async function (assert) {
    let card = await loadCard(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @firstCardInStack={{card}} @onClose={{onClose}} />
          <CardPrerender />
        </template>
      }
    );

    await waitFor('[data-test-person]');
    assert.dom('[data-type-display-name]').hasText('Person');
    assert.dom('[data-test-person]').hasText('Fadhlan');
    assert.dom('[data-test-first-letter-of-the-name]').hasText('F');
    assert.dom('[data-test-city]').hasText('Bandung');
    assert.dom('[data-test-country]').hasText('Indonesia');
    assert.dom('.operator-mode-card-stack__card').exists({ count: 1 });
    await waitFor('[data-test-cardstack-operator-mode-overlay-button]');
    await click('[data-test-cardstack-operator-mode-overlay-button]');
    assert.dom('.operator-mode-card-stack__card').exists({ count: 2 });
    assert
      .dom('.operator-mode-card-stack__card:nth-of-type(2)')
      .includesText('Mango');
  });

  test("it doesn't change the field value if user clicks cancel in edit view", async function (assert) {
    let card = await loadCard(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @firstCardInStack={{card}} @onClose={{onClose}} />
          <CardPrerender />
        </template>
      }
    );
    await waitFor('[data-test-person]');
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
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @firstCardInStack={{card}} @onClose={{onClose}} />
          <CardPrerender />
        </template>
      }
    );
    await waitFor('[data-test-person]');
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

  test('displays cards on cards-grid', async function (assert) {
    let card = await loadCard(`${testRealmURL}grid`);
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
    assert.dom(`[data-test-cards-grid-item`).exists({ count: 9 });
    assert
      .dom(
        `[data-test-cards-grid-item="${testRealmURL}BlogPost/1"] [data-test-cards-grid-item-thumbnail-text]`
      )
      .hasText('Blog Post');
    assert
      .dom(
        `[data-test-cards-grid-item="${testRealmURL}BlogPost/1"] [data-test-cards-grid-item-title]`
      )
      .hasText('Outer Space Journey');
    assert
      .dom(
        `[data-test-cards-grid-item="${testRealmURL}BlogPost/1"] [data-test-cards-grid-item-display-name]`
      )
      .hasText('Blog Post');
  });

  test('can create a card using the cards-grid', async function (assert) {
    let card = await loadCard(`${testRealmURL}grid`);
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

    await click('[data-test-save-button]');
    await waitFor(`[data-test-stack-card="${testRealmURL}PublishingPacket/1"]`);
    assert
      .dom(`[data-test-stack-card="${testRealmURL}PublishingPacket/1"]`)
      .exists();
  });

  test('can open a card from the cards-grid and close it', async function (assert) {
    let card = await loadCard(`${testRealmURL}grid`);
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

    await click(`[data-test-cards-grid-item="${testRealmURL}Person/burcu"]`);

    assert.dom(`[data-test-stack-card-index="1"]`).exists(); // Opens card on the stack
    assert
      .dom(`[data-test-stack-card-index="1"] [data-type-display-name]`)
      .includesText('Person');

    await click('[data-test-stack-card-index="1"] [data-test-close-button]');
    assert.dom(`[data-test-stack-card-index="1"]`).doesNotExist();
  });

  test('create new card editor opens in the stack at each nesting level', async function (assert) {
    let card = await loadCard(`${testRealmURL}grid`);
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

    await click('[data-test-stack-card-index="3"] [data-test-save-button]');
    await waitFor(`[data-test-stack-card="${testRealmURL}Author/3"]`);
    await click('[data-test-stack-card-index="3"] [data-test-close-button]');
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
    await click('[data-test-stack-card-index="2"] [data-test-save-button]');
    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/3"]`);
    await click('[data-test-stack-card-index="2"] [data-test-close-button]');
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
    await click('[data-test-stack-card-index="1"] [data-test-save-button]');
    await waitFor(`[data-test-stack-card="${testRealmURL}PublishingPacket/1"]`);

    assert
      .dom(`[data-test-stack-card="${testRealmURL}PublishingPacket/1"]`)
      .containsText(
        'Everyone knows that Alice ran the show in the Brady household.'
      );
  });

  test('can choose a card for a linksTo field that has an existing value', async function (assert) {
    let card = await loadCard(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @firstCardInStack={{card}} @onClose={{onClose}} />
          <CardPrerender />
        </template>
      }
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/1"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="authorBio"]').containsText('Alien Bob');
    assert.dom('[data-test-choose-card]').doesNotExist();
    assert.dom('[data-test-create-new]').doesNotExist();

    await click('[data-test-remove-card]');
    assert.dom('[data-test-choose-card]').exists();
    assert.dom('[data-test-create-new]').exists();

    await click('[data-test-choose-card]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Author/2"]`);
    await click(`[data-test-select="${testRealmURL}Author/2"]`);

    await waitFor(`[data-test-author="R2-D2"]`);
    assert.dom('[data-test-field="authorBio"]').containsText('R2-D2');
  });

  test('can choose a card for a linksTo field that has no existing value', async function (assert) {
    let card = await loadCard(`${testRealmURL}BlogPost/2`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @firstCardInStack={{card}} @onClose={{onClose}} />
          <CardPrerender />
        </template>
      }
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/2"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-choose-card]').exists();
    assert.dom('[data-test-create-new]').exists();

    await click('[data-test-choose-card]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Author/2"]`);
    await click(`[data-test-select="${testRealmURL}Author/2"]`);

    await waitUntil(() => !document.querySelector('[card-catalog-modal]'));
    assert.dom('[data-test-field="authorBio"]').containsText('R2-D2');

    await click('[data-test-save-button]');
    await waitFor('[data-test-blog-post-isolated]');

    assert.dom('[data-test-blog-post-isolated]').hasText('Beginnings by R2-D2');
  });

  test('can create a new card to populate a linksTo field', async function (assert) {
    let card = await loadCard(`${testRealmURL}BlogPost/2`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @firstCardInStack={{card}} @onClose={{onClose}} />
          <CardPrerender />
        </template>
      }
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/2"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-choose-card]').exists();
    assert.dom('[data-test-create-new]').exists();

    await click('[data-test-create-new]');
    await waitFor('[data-test-stack-card-index="1"]');

    assert
      .dom('[data-test-stack-card-index="1"] [data-test-field="firstName"]')
      .exists();
    await fillIn(
      '[data-test-stack-card-index="1"] [data-test-field="firstName"] [data-test-boxel-input]',
      'Alice'
    );

    await click('[data-test-stack-card-index="1"] [data-test-save-button]');
    await waitFor(`[data-test-stack-card="${testRealmURL}Author/3"]`);
    await click('[data-test-stack-card-index="1"] [data-test-close-button]');
    await waitUntil(
      () => !document.querySelector('[data-test-stack-card-index="1"]')
    );
    assert.dom('[data-test-choose-card]').doesNotExist();
    assert.dom('[data-test-create-new]').doesNotExist();
    assert.dom('[data-test-field="authorBio"]').containsText('Alice');

    await click('[data-test-stack-card-index="0"] [data-test-save-button]');
    await waitFor('[data-test-blog-post-isolated] [data-test-author="Alice"]');
    assert.dom('[data-test-blog-post-isolated]').hasText('Beginnings by Alice');
  });

  test('can remove the link for a linksTo field', async function (assert) {
    let card = await loadCard(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @firstCardInStack={{card}} @onClose={{onClose}} />
          <CardPrerender />
        </template>
      }
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/1"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="authorBio"]').containsText('Alien Bob');
    await click('[data-test-field="authorBio"] [data-test-remove-card]');
    await click('[data-test-save-button]');

    await waitFor('[data-test-blog-post-isolated]');
    assert
      .dom('[data-test-blog-post-isolated]')
      .hasText('Outer Space Journey by');
  });

  test('can add a card to a linksToMany field with existing values', async function (assert) {
    let card = await loadCard(`${testRealmURL}Person/burcu`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @firstCardInStack={{card}} @onClose={{onClose}} />
          <CardPrerender />
        </template>
      }
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="friends"]').containsText('Jackie Woody');
    assert.dom('[data-test-field="friends"] [data-test-add-new]').exists();
    assert.dom('[data-test-field="friends"] [data-test-create-new]').exists();

    await click('[data-test-links-to-many="friends"] [data-test-add-new]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Pet/mango"]`);
    await click(`[data-test-select="${testRealmURL}Pet/mango"]`);

    await waitUntil(() => !document.querySelector('[card-catalog-modal]'));
    assert
      .dom('[data-test-field="friends"]')
      .containsText('Jackie Woody Mango');
  });

  test('can add a card to linksToMany field that has no existing values', async function (assert) {
    let card = await loadCard(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @firstCardInStack={{card}} @onClose={{onClose}} />
          <CardPrerender />
        </template>
      }
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="friends"] [data-test-pet]').doesNotExist();
    await click('[data-test-links-to-many="friends"] [data-test-add-new]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Pet/mango"]`);
    await click(`[data-test-select="${testRealmURL}Pet/jackie"]`);

    await waitUntil(() => !document.querySelector('[card-catalog-modal]'));
    assert.dom('[data-test-field="friends"]').containsText('Jackie');
  });

  test('can change the item selection in a linksToMany field', async function (assert) {
    let card = await loadCard(`${testRealmURL}Person/burcu`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @firstCardInStack={{card}} @onClose={{onClose}} />
          <CardPrerender />
        </template>
      }
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="friends"]').containsText('Jackie Woody');
    await click(
      '[data-test-links-to-many="friends"] [data-test-item="1"] [data-test-remove-card]'
    );

    assert.dom('[data-test-field="friends"]').containsText('Jackie');

    await click('[data-test-links-to-many="friends"] [data-test-add-new]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Pet/mango"]`);
    await click(`[data-test-select="${testRealmURL}Pet/mango"]`);

    await waitUntil(() => !document.querySelector('[card-catalog-modal]'));
    assert.dom('[data-test-field="friends"]').containsText('Mango');
  });

  test('can create a new card to add to a linksToMany field with no existing value', async function (assert) {
    let card = await loadCard(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @firstCardInStack={{card}} @onClose={{onClose}} />
          <CardPrerender />
        </template>
      }
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="friends"] [data-test-pet]').doesNotExist();
    await click('[data-test-links-to-many="friends"] [data-test-create-new]');

    await waitFor(`[data-test-stack-card-index="1"]`);
    await fillIn(
      '[data-test-stack-card-index="1"] [data-test-field="name"] [data-test-boxel-input]',
      'Woodster'
    );
    await click('[data-test-stack-card-index="1"] [data-test-save-button]');
    await waitFor(`[data-test-stack-card="${testRealmURL}Pet/1"]`);
    await click('[data-test-stack-card-index="1"] [data-test-close-button]');

    await waitUntil(
      () => !document.querySelector('[data-test-stack-card-index="1"]')
    );
    assert.dom('[data-test-field="friends"]').containsText('Woodster');
  });

  test('can create a new card to add to a linksToMany field with existing values', async function (assert) {
    let card = await loadCard(`${testRealmURL}Person/burcu`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @firstCardInStack={{card}} @onClose={{onClose}} />
          <CardPrerender />
        </template>
      }
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="friends"]').containsText('Jackie Woody');

    await click('[data-test-links-to-many="friends"] [data-test-create-new]');

    await waitFor(`[data-test-stack-card-index="1"]`);
    await fillIn(
      '[data-test-stack-card-index="1"] [data-test-field="name"] [data-test-boxel-input]',
      'Woodster'
    );
    await click('[data-test-stack-card-index="1"] [data-test-save-button]');
    await waitFor(`[data-test-stack-card="${testRealmURL}Pet/1"]`);
    await click('[data-test-stack-card-index="1"] [data-test-close-button]');

    await waitUntil(
      () => !document.querySelector('[data-test-stack-card-index="1"]')
    );
    assert
      .dom('[data-test-field="friends"]')
      .containsText('Jackie Woody Woodster');
  });

  skip('can remove all items of a linksToMany field', async function (assert) {
    // TODO: Pre-existing bug: removing items in linksToMany field
    let card = await loadCard(`${testRealmURL}Person/burcu`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @firstCardInStack={{card}} @onClose={{onClose}} />
          <CardPrerender />
        </template>
      }
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    assert.dom(`[data-test-plural-view-item]`).exists({ count: 2 });
    await click('[data-test-edit-button]');
    assert.dom('[data-test-field="friends"]').containsText('Jackie Woody');

    await click(
      '[data-test-links-to-many="friends"] [data-test-item="1"] [data-test-remove-card]'
    );
    await click(
      '[data-test-links-to-many="friends"] [data-test-item="0"] [data-test-remove-card]'
    );
    await click('[data-test-save-button]');

    await waitFor(`[data-test-person="Burcu"]`);
    assert
      .dom(`[data-test-stack-card="${testRealmURL}Person/burcu"]`)
      .doesNotContainText('Jackie');
    assert.dom(`[data-test-plural-view-item]`).doesNotExist();
  });

  skip('can create a specialized a new card to populate a linksTo field');
  skip('can create a specialized a new card to populate a linksToMany field');
});
