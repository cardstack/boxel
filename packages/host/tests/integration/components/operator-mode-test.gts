import {
  waitFor,
  waitUntil,
  click,
  fillIn,
  focus,
  blur,
  triggerEvent,
  triggerKeyEvent,
  typeIn,
  settled,
} from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { FieldContainer } from '@cardstack/boxel-ui/components';

import {
  baseRealm,
  Deferred,
  LooseSingleCardDocument,
  Realm,
} from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  percySnapshot,
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  type TestContextWithSave,
  withSlowSave,
} from '../../helpers';
import { TestRealmAdapter } from '../../helpers/adapter';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | operator-mode', function (hooks) {
  setupRenderingTest(hooks);

  const realmName = 'Operator Mode Workspace';
  let loader: Loader;
  let testRealm: Realm;
  let testRealmAdapter: TestRealmAdapter;
  let operatorModeStateService: OperatorModeStateService;

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
    operatorModeStateService = getService('operator-mode-state-service');
  });

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  let noop = () => {};

  hooks.beforeEach(async function () {
    let cardApi: typeof import('https://cardstack.com/base/card-api');
    let string: typeof import('https://cardstack.com/base/string');
    let textArea: typeof import('https://cardstack.com/base/text-area');
    let cardsGrid: typeof import('https://cardstack.com/base/cards-grid');
    let spec: typeof import('https://cardstack.com/base/spec');

    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);
    textArea = await loader.import(`${baseRealm.url}text-area`);
    cardsGrid = await loader.import(`${baseRealm.url}cards-grid`);
    spec = await loader.import(`${baseRealm.url}spec`);

    let {
      field,
      contains,
      containsMany,
      linksTo,
      linksToMany,
      serialize,
      CardDef,
      Component,
      FieldDef,
    } = cardApi;
    let { default: StringField } = string;
    let { default: TextAreaField } = textArea;
    let { CardsGrid } = cardsGrid;
    let { Spec } = spec;

    // use string source so we can get the transpiled scoped CSS
    let friendWithCSSSource = `
      import { Component, field, contains, linksTo, CardDef, StringField } from 'https://cardstack.com/base/card-api';
      export class FriendWithCSS extends CardDef {
        static displayName = 'Friend';
        @field title = contains(StringField);
        @field friend = linksTo(() => FriendWithCSS);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <div class='friend'>
              <@fields.title />
              has a friend
              <div class="friend-container">
                <@fields.friend />
              </div>
            </div>
            <style scoped>
              .friend {
                color: red;
              }
              .friend-container {
                padding: 5px;
                height: 65px;
              }
            </style>
          </template>
        };
      }
    `;

    class Car extends CardDef {
      static displayName = 'Car';
      @field name = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Car) {
          return this.name;
        },
      });
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <h3 data-test-pet={{@model.name}} data-test-embedded>
            <@fields.name />
          </h3>
        </template>
      };
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <h3 data-test-pet={{@model.name}} data-test-fitted>
            <@fields.name />
          </h3>
        </template>
      };
    }

    class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.name;
        },
      });
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <h3 data-test-pet={{@model.name}} data-test-embedded>
            <@fields.name />
          </h3>
        </template>
      };
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <h3 data-test-pet={{@model.name}} data-test-fitted>
            <@fields.name />
          </h3>
        </template>
      };
    }

    class ShippingInfo extends FieldDef {
      static displayName = 'Shipping Info';
      @field preferredCarrier = contains(StringField);
      @field remarks = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: ShippingInfo) {
          return this.preferredCarrier;
        },
      });
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span data-test-preferredCarrier={{@model.preferredCarrier}}>
            <@fields.preferredCarrier />
          </span>
        </template>
      };
    }

    class Address extends FieldDef {
      static displayName = 'Address';
      @field city = contains(StringField);
      @field country = contains(StringField);
      @field shippingInfo = contains(ShippingInfo);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <div data-test-address>
            <h3 data-test-city={{@model.city}}>
              <@fields.city />
            </h3>
            <h3 data-test-country={{@model.country}}>
              <@fields.country />
            </h3>
            <div data-test-shippingInfo-field><@fields.shippingInfo /></div>
          </div>
        </template>
      };

      static edit = class Edit extends Component<typeof this> {
        <template>
          <FieldContainer @label='city' @tag='label' data-test-boxel-input-city>
            <@fields.city />
          </FieldContainer>
          <FieldContainer
            @label='country'
            @tag='label'
            data-test-boxel-input-country
          >
            <@fields.country />
          </FieldContainer>
          <div data-test-shippingInfo-field><@fields.shippingInfo /></div>
        </template>
      };
    }

    // Friend card that can link to another friend
    class Friend extends CardDef {
      static displayName = 'Friend';
      @field name = contains(StringField);
      @field friend = linksTo(() => Friend);
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <@fields.name />
        </template>
      };
    }

    class Person extends CardDef {
      static displayName = 'Person';
      @field firstName = contains(StringField);
      @field pet = linksTo(Pet);
      @field friends = linksToMany(Pet);
      @field cars = linksToMany(Car);
      @field nicknames = containsMany(StringField);
      @field favoriteGames = containsMany(StringField);
      @field firstLetterOfTheName = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName[0];
        },
      });
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field address = contains(Address);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2 data-test-person={{@model.firstName}}>
            <@fields.firstName />
          </h2>
          <p data-test-first-letter-of-the-name={{@model.firstLetterOfTheName}}>
            <@fields.firstLetterOfTheName />
          </p>
          Pet:
          <@fields.pet />
          Friends:
          <@fields.friends />
          Cars:
          <@fields.cars />
          Nicknames:
          <@fields.nicknames />
          Favorite Games:
          <@fields.favoriteGames />
          <div data-test-addresses>Address: <@fields.address /></div>
        </template>
      };
    }

    // this field explodes when serialized (saved)
    class BoomField extends StringField {
      static [serialize](_boom: any) {
        throw new Error('Boom!');
      }
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          {{@model}}
        </template>
      };
    }
    class BoomPet extends Pet {
      static displayName = 'Boom Pet';
      @field boom = contains(BoomField);

      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2 data-test-pet={{@model.name}}>
            <@fields.name />
            <@fields.boom />
          </h2>
        </template>
      };
    }

    class Author extends CardDef {
      static displayName = 'Author';
      @field firstName = contains(StringField);
      @field lastName = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Author) {
          return [this.firstName, this.lastName].filter(Boolean).join(' ');
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-isolated-author>
            <@fields.title />
            <@fields.firstName />
            <@fields.lastName />
          </div>
        </template>
      };
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <span data-test-author='{{@model.firstName}}'>
            <@fields.firstName />
            <@fields.lastName />
          </span>
        </template>
      };
    }

    class SpecCardLinker extends CardDef {
      static displayName = 'Spec Card Link';
      @field spec = linksTo(Spec);
      @field title = contains(StringField);
      // Don't render the spec, it causes an error about constructors in the test
      // and isn't required.
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-spec-card-linker-isolated>
            The card is:
            <@fields.title />
            <br />
            Linked to:
            {{@model.spec.title}}
          </div>
        </template>
      };
    }

    class BlogPost extends CardDef {
      static displayName = 'Blog Post';
      @field title = contains(StringField);
      @field slug = contains(StringField);
      @field body = contains(TextAreaField);
      @field authorBio = linksTo(Author);
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <@fields.title /> by <@fields.authorBio />
        </template>
      };
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-blog-post-isolated>
            <@fields.title />
            by
            <@fields.authorBio />
          </div>
        </template>
      };
    }

    class PublishingPacket extends CardDef {
      static displayName = 'Publishing Packet';
      static headerColor = '#6638ff'; // rgb(102, 56, 255);
      @field blogPost = linksTo(BlogPost);
      @field socialBlurb = contains(TextAreaField);
    }

    class PetRoom extends CardDef {
      static displayName = 'Pet Room';
      @field name = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: PetRoom) {
          return this.name;
        },
      });
    }

    let myvi = new Car({ name: 'Myvi' });
    let proton = new Car({ name: 'Proton' });
    let petMango = new Pet({ name: 'Mango' });
    let petJackie = new Pet({ name: 'Jackie' });
    let petWoody = new Pet({ name: 'Woody' });
    let petBuzz = new Pet({ name: 'Buzz' });
    let friendB = new Friend({ name: 'Friend B' });
    let author1 = new Author({
      firstName: 'Alien',
      lastName: 'Bob',
    });
    let blogPost = new BlogPost({
      title: 'Outer Space Journey',
      body: 'Hello world',
      authorBio: author1,
    });

    //Generate 11 person card to test recent card menu in card sheet
    let personCards: Map<String, any> = new Map<String, any>();
    for (let i = 1; i <= 11; i++) {
      personCards.set(
        `Person/${i}.json`,
        new Person({
          firstName: String(i),
          address: new Address({
            city: 'Bandung',
            country: 'Indonesia',
          }),
          pet: petMango,
        }),
      );
    }

    ({ adapter: testRealmAdapter, realm: testRealm } =
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'pet.gts': { Pet },
          'shipping-info.gts': { ShippingInfo },
          'address.gts': { Address },
          'person.gts': { Person },
          'boom-field.gts': { BoomField },
          'boom-pet.gts': { BoomPet },
          'blog-post.gts': { BlogPost },
          'car.gts': { Car },
          'author.gts': { Author },
          'friend.gts': { Friend },
          'friend-with-css.gts': friendWithCSSSource,
          'publishing-packet.gts': { PublishingPacket },
          'pet-room.gts': { PetRoom },
          'Pet/mango.json': petMango,
          'spec-card-linker.gts': { SpecCardLinker },
          'BoomPet/paper.json': new BoomPet({ name: 'Paper' }),
          'Car/myvi.json': myvi,
          'Car/proton.json': proton,
          'SpecCardLinker/spec-card-linker.json': {
            data: {
              attributes: {
                title: 'Spec Card Linker',
              },
              meta: {
                adoptsFrom: {
                  module: '../spec-card-linker.gts',
                  name: 'SpecCardLinker',
                },
              },
            },
          } as LooseSingleCardDocument,
          'Pet/jackie.json': petJackie,
          'Pet/woody.json': petWoody,
          'Pet/buzz.json': petBuzz,
          'Person/fadhlan.json': new Person({
            firstName: 'Fadhlan',
            address: new Address({
              city: 'Bandung',
              country: 'Indonesia',
              shippingInfo: new ShippingInfo({
                preferredCarrier: 'DHL',
                remarks: `Don't let bob deliver the package--he's always bringing it to the wrong address`,
              }),
            }),
            pet: petMango,
            nicknames: ['Lan'],
            favoriteGames: ['Soccer'],
          }),
          'Person/hassan.json': {
            data: {
              attributes: {
                firstName: 'Hassan',
              },
              relationships: {
                friends: {
                  links: { self: null },
                },
              },
              meta: {
                adoptsFrom: {
                  module: '../person',
                  name: 'Person',
                },
              },
            },
          },
          'Person/burcu.json': new Person({
            firstName: 'Burcu',
            friends: [petJackie, petWoody, petBuzz],
            cars: [myvi, proton],
            nicknames: ['Ace', 'Bolt', 'Comet'],
            favoriteGames: ['Chess', 'Go'],
          }),
          'Friend/friend-b.json': friendB,
          'Friend/friend-a.json': new Friend({
            name: 'Friend A',
            friend: friendB,
          }),
          'FriendWithCSS/friend-b.json': {
            data: {
              attributes: {
                title: 'Jade',
              },
              meta: {
                adoptsFrom: {
                  module: '../friend-with-css.gts',
                  name: 'FriendWithCSS',
                },
              },
            },
          } as LooseSingleCardDocument,
          'FriendWithCSS/friend-a.json': {
            data: {
              attributes: {
                title: 'Hassan',
              },
              relationships: {
                friend: {
                  links: {
                    self: './friend-b',
                  },
                },
              },
              meta: {
                adoptsFrom: {
                  module: '../friend-with-css.gts',
                  name: 'FriendWithCSS',
                },
              },
            },
          } as LooseSingleCardDocument,
          'FriendWithCSS/missing-link.json': {
            data: {
              attributes: {
                title: 'Boris',
              },
              relationships: {
                friend: {
                  links: {
                    self: './does-not-exist',
                  },
                },
              },
              meta: {
                adoptsFrom: {
                  module: '../friend-with-css.gts',
                  name: 'FriendWithCSS',
                },
              },
            },
          } as LooseSingleCardDocument,
          'grid.json': new CardsGrid(),
          'index.json': new CardsGrid(),
          'Spec/publishing-packet.json': new Spec({
            title: 'Publishing Packet',
            description: 'Spec for PublishingPacket',
            specType: 'card',
            ref: {
              module: `${testRealmURL}publishing-packet`,
              name: 'PublishingPacket',
            },
          }),
          'Spec/pet-room.json': new Spec({
            title: 'General Pet Room',
            description: 'Spec for Pet Room Card',
            specType: 'card',
            ref: {
              module: `${testRealmURL}pet-room`,
              name: 'PetRoom',
            },
          }),
          'Spec/pet-card.json': new Spec({
            title: 'Pet',
            description: 'Spec for Pet',
            specType: 'card',
            ref: {
              module: `${testRealmURL}pet`,
              name: 'Pet',
            },
          }),
          'Author/1.json': author1,
          'Author/2.json': new Author({ firstName: 'R2-D2' }),
          'Author/mark.json': new Author({
            firstName: 'Mark',
            lastName: 'Jackson',
          }),
          'BlogPost/1.json': blogPost,
          'BlogPost/2.json': new BlogPost({ title: 'Beginnings' }),
          'CardDef/1.json': new CardDef({ title: 'CardDef instance' }),
          'PublishingPacket/story.json': new PublishingPacket({
            title: 'Space Story',
            blogPost,
          }),
          '.realm.json': `{ "name": "${realmName}", "iconURL": "https://boxel-images.boxel.ai/icons/Letter-o.png" }`,
          ...Object.fromEntries(personCards),
        },
      }));
  });

  function setCardInOperatorModeState(
    cardURL?: string,
    format: 'isolated' | 'edit' = 'isolated',
  ) {
    operatorModeStateService.restore({
      stacks: cardURL ? [[{ id: cardURL, format }]] : [[]],
    });
  }

  test('it loads a card and renders its isolated view', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    assert
      .dom('[data-test-boxel-card-header-title]')
      .hasText('Person - Fadhlan');
    assert
      .dom(
        `[data-test-card-header-realm-icon="https://boxel-images.boxel.ai/icons/Letter-o.png"]`,
      )
      .exists();
    assert.dom('[data-test-person]').hasText('Fadhlan');
    assert.dom('[data-test-first-letter-of-the-name]').hasText('F');
    assert.dom('[data-test-city]').hasText('Bandung');
    assert.dom('[data-test-country]').hasText('Indonesia');
    assert.dom('[data-test-stack-card]').exists({ count: 1 });
    await waitFor('[data-test-pet="Mango"]');
    await click('[data-test-pet="Mango"]');
    await waitFor(`[data-test-stack-card="${testRealmURL}Pet/mango"]`);
    assert.dom('[data-test-stack-card]').exists({ count: 2 });
    assert.dom('[data-test-stack-card-index="1"]').includesText('Mango');
  });

  test('it renders a card with an error that has does not have a last known good state', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}FriendWithCSS/missing-link`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    assert
      .dom('[data-test-boxel-card-header-title]')
      .includesText('Link Not Found', 'card error title is displayed');
    assert
      .dom('[data-test-error-message]')
      .containsText(
        `missing file ${testRealmURL}FriendWithCSS/does-not-exist.json`,
      );
    await click('[data-test-toggle-details]');
    assert
      .dom('[data-test-error-details]')
      .containsText(`FriendWithCSS/does-not-exist.json not found`);
    assert
      .dom('[data-test-error-stack]')
      .containsText('at Realm.getSourceOrRedirect');
    assert.strictEqual(
      operatorModeStateService.state?.submode,
      'interact',
      'in interact mode',
    );
    await click('[data-test-view-in-code-mode-button]');
    assert.strictEqual(
      operatorModeStateService.state?.submode,
      'code',
      'in code mode',
    );
    assert.strictEqual(
      operatorModeStateService.state?.codePath?.href,
      `${testRealmURL}FriendWithCSS/missing-link.json`,
      'codePath is correct',
    );
  });

  module(
    'card with an error that has a last known good state',
    function (hooks) {
      hooks.beforeEach(async function () {
        await testRealm.write(
          'FriendWithCSS/friend-a.json',
          JSON.stringify({
            data: {
              type: 'card',
              attributes: {
                name: 'Friend A',
              },
              relationships: {
                friend: {
                  links: {
                    self: './does-not-exist',
                  },
                },
              },
              meta: {
                adoptsFrom: {
                  module: '../friend-with-css.gts',
                  name: 'FriendWithCSS',
                },
              },
            },
          } as LooseSingleCardDocument),
        );
      });

      test('it renders a card with an error that has a last known good state', async function (assert) {
        setCardInOperatorModeState(`${testRealmURL}FriendWithCSS/friend-a`);
        await renderComponent(
          class TestDriver extends GlimmerComponent {
            <template>
              <OperatorMode @onClose={{noop}} />
            </template>
          },
        );

        assert
          .dom('[data-test-boxel-card-header-title]')
          .includesText('Link Not Found', 'card error title is displayed');
        assert
          .dom('[data-test-card-error]')
          .includesText(
            'Hassan has a friend Jade',
            'the last known good HTML is rendered',
          );

        // use percy snapshot to ensure the CSS has been applied--a red color
        await percySnapshot(assert);

        await click('[data-test-toggle-details]');
        assert
          .dom('[data-test-error-details]')
          .containsText(`FriendWithCSS/does-not-exist.json not found`);
        assert
          .dom('[data-test-error-stack]')
          .containsText('at Realm.getSourceOrRedirect');
        assert.strictEqual(
          operatorModeStateService.state?.submode,
          'interact',
          'in interact mode',
        );
        await click('[data-test-view-in-code-mode-button]');
        assert.strictEqual(
          operatorModeStateService.state?.submode,
          'code',
          'in code mode',
        );
        assert.strictEqual(
          operatorModeStateService.state?.codePath?.href,
          `${testRealmURL}FriendWithCSS/friend-a.json`,
          'codePath is correct',
        );
      });

      test('it has the ability to delete the card that has an error', async function (assert) {
        setCardInOperatorModeState(`${testRealmURL}FriendWithCSS/friend-a`);
        await renderComponent(
          class TestDriver extends GlimmerComponent {
            <template>
              <OperatorMode @onClose={{noop}} />
            </template>
          },
        );

        await click('[data-test-more-options-button]');
        await click('[data-test-boxel-menu-item-text="Delete Card"]');
        assert
          .dom('[data-test-delete-modal-container]')
          .includesText('Delete the card Hassan?');
        await click('[data-test-confirm-delete-button]');

        assert
          .dom(`[data-test-stack-card="${testRealmURL}FriendWithCSS/friend-a"]`)
          .doesNotExist();
        assert.dom(`[data-test-stack-card="${testRealmURL}index"]`).exists();
      });
    },
  );

  test<TestContextWithSave>('it auto saves the field value', async function (assert) {
    assert.expect(7);
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor('[data-test-person]');
    await click('[data-test-edit-button]');
    let finishedSaving = false;
    this.onSave((_, json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      finishedSaving = true;
      assert.strictEqual(json.data.attributes?.firstName, 'EditedName');
    });
    // not awaiting so that we can test in-between the test waiter
    fillIn(
      '[data-test-field="firstName"] [data-test-boxel-input]',
      'EditedName',
    );
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-auto-save-indicator]')
          ?.textContent?.trim() === 'Saving…',
      { timeout: 5000 },
    );
    assert.dom('[data-test-auto-save-indicator]').containsText('Saving…');
    assert.false(finishedSaving, 'save in-flight message is correct');
    await waitUntil(() => finishedSaving, { timeout: 10000 });
    assert.true(finishedSaving, 'finished saving message is correct');
    await waitFor('[data-test-last-saved]');
    assert.dom('[data-test-last-saved]').containsText('Saved');

    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);

    await waitFor('[data-test-person="EditedName"]');
    assert.dom('[data-test-person]').hasText('EditedName');
    assert.dom('[data-test-first-letter-of-the-name]').hasText('E');
  });

  test('an error in auto-save is handled gracefully', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}BoomPet/paper`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor('[data-test-pet]');
    await waitFor('[data-test-edit-button]');
    await click('[data-test-edit-button]');
    fillIn('[data-test-field="boom"] input', 'Bad cat!');
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-auto-save-indicator]')
          ?.textContent?.trim() == 'Saving…',
    );
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-auto-save-indicator]')
          ?.textContent?.trim() == 'Failed to save: Boom!',
    );
    await click('[data-test-edit-button]');
    // TODO consider adding a mechanism to go back to edit mode in order to try to fix the error with edit template
    assert
      .dom('[data-test-card-error]')
      .exists('last known good state is displayed in isolated mode');
  });

  test('a 403 from Web Application Firewall is handled gracefully when auto-saving', async function (assert) {
    let networkService = getService('network');
    networkService.virtualNetwork.mount(
      async (req: Request) => {
        if (req.method === 'PATCH' && req.url.includes('test/Pet/buzz')) {
          return new Response(
            '{ message: "Request blocked by Web Application Firewall. See x-blocked-by-waf-rule response header for detail." }',
            {
              status: 403,
              headers: {
                'Content-Type': 'application/json',
                'X-Blocked-By-WAF-Rule': 'CrossSiteScripting_BODY',
              },
            },
          );
        }
        return null;
      },
      { prepend: true },
    );
    setCardInOperatorModeState(`${testRealmURL}Pet/buzz`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor('[data-test-field="name"]');
    await waitFor('[data-test-edit-button]');
    await click('[data-test-edit-button]');
    fillIn('[data-test-field="name"] input', 'Fuzz');
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-auto-save-indicator]')
          ?.textContent?.trim() == 'Saving…',
      { timeoutMessage: 'Waiting for Saving... to appear' },
    );
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-auto-save-indicator]')
          ?.textContent?.trim() == 'Failed to save: Rejected by firewall',
      { timeoutMessage: 'Waiting for "Failed to save" to appear' },
    );
    assert
      .dom('[data-test-auto-save-indicator]')
      .containsText('Failed to save: Rejected by firewall');
  });

  test('opens workspace chooser after closing the only remaining card on the stack', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor('[data-test-person]');
    assert.dom('[data-test-person]').isVisible();

    await click('[data-test-close-button]');
    assert
      .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`)
      .doesNotExist();
    assert.dom(`[data-test-stack-card="${testRealmURL}index"]`).exists();
    await percySnapshot(assert);
  });

  test('displays cards on cards-grid and includes `spec` instances', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await waitFor(`[data-test-cards-grid-item]`);

    assert.dom(`[data-test-stack-card-index="0"]`).exists();
    assert.dom(`[data-test-cards-grid-item]`).exists();

    assert
      .dom(`[data-test-cards-grid-item="${testRealmURL}BlogPost/1"] `)
      .includesText('Outer Space Journey');

    assert
      .dom(
        `[data-test-cards-grid-item="${testRealmURL}Spec/publishing-packet"]`,
      )
      .exists('publishing-packet spec is displayed on cards-grid');
    assert
      .dom(`[data-test-cards-grid-item="${testRealmURL}Spec/pet-room"]`)
      .exists('pet-room spec instance is displayed on cards-grid');
  });

  test<TestContextWithSave>('can optimistically create a card using the cards-grid', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    let saved = new Deferred<void>();
    let savedCards = new Set<string>();
    this.onSave((url) => {
      savedCards.add(url.href);
      saved.fulfill();
    });

    // slow down the save so we can see the optimistic save at work
    await withSlowSave(1000, async () => {
      await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
      assert.dom(`[data-test-stack-card-index="0"]`).exists();

      await click(`[data-test-boxel-filter-list-button="All Cards"]`);
      await click('[data-test-create-new-card-button]');
      assert
        .dom('[data-test-card-catalog-modal] [data-test-boxel-header-title]')
        .containsText('Choose a Spec card');
      await waitFor(
        `[data-test-card-catalog-item="${testRealmURL}Spec/publishing-packet"]`,
      );
      assert
        .dom(`[data-test-realm="${realmName}"] [data-test-card-catalog-item]`)
        .exists({ count: 3 });

      await click(`[data-test-select="${testRealmURL}Spec/publishing-packet"]`);
      // intentionally not awaiting the click so we can ignore the test waiters
      click('[data-test-card-catalog-go-button]');
      await waitFor('[data-test-stack-card-index="1"]');
      assert
        .dom('[data-test-stack-card-index="1"] [data-test-field="blogPost"]')
        .exists();
      assert.strictEqual(
        savedCards.size,
        0,
        'the new card has not been saved yet',
      );
      await click(
        '[data-test-stack-card-index="1"] [data-test-more-options-button]',
      );
      await fillIn(`[data-test-field="cardInfo-name"] input`, 'New Post');
      await saved.promise;
      let packetId = [...savedCards].find((k) =>
        k.includes('PublishingPacket'),
      )!;
      setCardInOperatorModeState(packetId);

      await waitFor(`[data-test-stack-card="${packetId}"]`);
      assert.dom(`[data-test-stack-card="${packetId}"]`).exists();
    });
  });

  test('can open a card from the cards-grid and close it', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await waitFor(`[data-test-stack-card-index]`);
    assert.dom(`[data-test-stack-card-index="0"]`).exists();
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await waitFor(`[data-test-cards-grid-item]`);
    await click(
      `[data-test-cards-grid-item="${testRealmURL}Person/burcu"] .field-component-card`,
    );

    await waitFor(`[data-test-stack-card-index="1"]`);
    assert.dom(`[data-test-stack-card-index="1"]`).exists(); // Opens card on the stack
    assert
      .dom(
        `[data-test-stack-card-index="1"] [data-test-boxel-card-header-title]`,
      )
      .includesText('Person');

    await click('[data-test-stack-card-index="1"] [data-test-close-button]');
    await waitFor('[data-test-stack-card-index="1"]', { count: 0 });
    assert.dom(`[data-test-stack-card-index="1"]`).doesNotExist();
  });

  test<TestContextWithSave>('create new card editor opens in the stack at each nesting level', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    let savedCards = new Set<string>();
    this.onSave((url) => savedCards.add(url.href));

    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    assert.dom(`[data-test-stack-card-index="0"]`).exists();
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);

    await click('[data-test-create-new-card-button]');
    await waitFor(
      `[data-test-card-catalog-item="${testRealmURL}Spec/publishing-packet"]`,
    );
    assert
      .dom('[data-test-card-catalog-modal] [data-test-boxel-header-title]')
      .containsText('Choose a Spec card');
    assert
      .dom(`[data-test-realm="${realmName}"] [data-test-card-catalog-item]`)
      .exists({ count: 3 });

    await click(`[data-test-select="${testRealmURL}Spec/publishing-packet"]`);
    await click('[data-test-card-catalog-go-button]');
    await waitFor('[data-test-stack-card-index="1"]');
    assert
      .dom('[data-test-stack-card-index="1"] [data-test-field="blogPost"]')
      .exists();

    await click('[data-test-add-new="blogPost"]');
    await waitFor(`[data-test-card-catalog-modal]`);
    await click(`[data-test-card-catalog-create-new-button]`);
    await click(`[data-test-card-catalog-go-button]`);

    await waitFor(`[data-test-stack-card-index="2"]`);
    assert.dom('[data-test-stack-card-index]').exists({ count: 3 });
    assert
      .dom('[data-test-stack-card-index="2"] [data-test-field="authorBio"]')
      .exists();

    // Update the blog post card first to trigger auto-save.
    // This allows us to simulate a scenario where the non-top item in the card-catalog-modal stack is saved before the top item.
    await fillIn(
      '[data-test-stack-card-index="2"] [data-test-field="title"] [data-test-boxel-input]',
      'Mad As a Hatter',
    );

    await click(
      '[data-test-stack-card-index="2"] [data-test-field="authorBio"] [data-test-add-new]',
    );
    await waitFor(`[data-test-card-catalog-modal]`);
    await click(`[data-test-card-catalog-create-new-button]`);
    await click(`[data-test-card-catalog-go-button]`);

    await waitFor(`[data-test-stack-card-index="3"]`);

    assert
      .dom('[data-test-field="firstName"] [data-test-boxel-input]')
      .exists();
    await fillIn(
      '[data-test-field="firstName"] [data-test-boxel-input]',
      'Alice',
    );
    let authorId = [...savedCards].find((k) => k.includes('Author'))!;
    await waitFor(
      `[data-test-stack-card-index="3"] [data-test-card="${authorId}"]`,
    );
    await fillIn(
      '[data-test-field="lastName"] [data-test-boxel-input]',
      'Enwunder',
    );

    await click('[data-test-stack-card-index="3"] [data-test-close-button]');
    await waitFor('[data-test-stack-card-index="3"]', { count: 0 });

    await waitUntil(() =>
      /Alice\s*Enwunder/.test(
        document.querySelector(
          '[data-test-stack-card-index="2"] [data-test-field="authorBio"]',
        )!.textContent!,
      ),
    );

    await click('[data-test-stack-card-index="2"] [data-test-close-button]');
    await waitFor('[data-test-stack-card-index="2"]', { count: 0 });
    let packetId = [...savedCards].find((k) => k.includes('PublishingPacket'))!;
    await waitFor(
      `[data-test-stack-card-index="1"] [data-test-card="${packetId}"]`,
    );
    await fillIn(
      '[data-test-stack-card-index="1"] [data-test-field="socialBlurb"] [data-test-boxel-input]',
      `Everyone knows that Alice ran the show in the Brady household. But when Alice’s past comes to light, things get rather topsy turvy…`,
    );
    assert
      .dom('[data-test-stack-card-index="1"] [data-test-field="blogPost"]')
      .containsText('Mad As a Hatter by Alice Enwunder');

    await click('[data-test-stack-card-index="1"] [data-test-edit-button]');

    await waitUntil(() => {
      return document
        .querySelector(
          `[data-test-stack-item-content] >[data-test-card="${packetId}"]`,
        )
        ?.textContent?.includes(
          'Everyone knows that Alice ran the show in the Brady household.',
        );
    });
  });

  test('can choose a card for a linksTo field that has an existing value', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/1"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="authorBio"]').containsText('Alien Bob');
    assert.dom('[data-test-add-new="authorBio"]').doesNotExist();

    await click('[data-test-remove-card]');
    assert.dom('[data-test-add-new="authorBio"]').exists();
    await click('[data-test-add-new="authorBio"]');
    await waitFor(`[data-test-card-catalog-modal]`);
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Author/2"]`);
    await click(`[data-test-select="${testRealmURL}Author/2"]`);
    assert
      .dom(
        `[data-test-card-catalog-item="${testRealmURL}Author/2"][data-test-card-catalog-item-selected]`,
      )
      .exists();

    await waitUntil(
      () =>
        (
          document.querySelector(`[data-test-card-catalog-go-button]`) as
            | HTMLButtonElement
            | undefined
        )?.disabled === false,
    );
    await click('[data-test-card-catalog-go-button]');

    await waitFor(`.operator-mode [data-test-author="R2-D2"]`);
    assert.dom('[data-test-field="authorBio"]').containsText('R2-D2');
  });

  test('can choose a card for a linksTo field that has no existing value', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}BlogPost/2`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/2"]`);
    await click('[data-test-edit-button]');
    assert.dom('[data-test-add-new="authorBio"]').exists();

    await click('[data-test-add-new="authorBio"]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Author/2"]`);
    await click(`[data-test-select="${testRealmURL}Author/2"]`);
    await click('[data-test-card-catalog-go-button]');

    await waitUntil(() => !document.querySelector('[card-catalog-modal]'));
    assert.dom('[data-test-field="authorBio"]').containsText('R2-D2');

    await click('[data-test-edit-button]');
    await waitFor('.operator-mode [data-test-blog-post-isolated]');

    assert
      .dom('.operator-mode [data-test-blog-post-isolated]')
      .hasText('Beginnings by R2-D2');
  });

  test<TestContextWithSave>('can create a new card to populate a linksTo field', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}BlogPost/2`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    let savedCards = new Set<string>();
    this.onSave((url) => savedCards.add(url.href));

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/2"]`);
    await click('[data-test-edit-button]');
    assert.dom('[data-test-add-new="authorBio"]').exists();

    await click('[data-test-add-new="authorBio"]');
    await waitFor(`[data-test-card-catalog-modal]`);
    await click(`[data-test-card-catalog-create-new-button]`);
    await click(`[data-test-card-catalog-go-button]`);
    await waitFor('[data-test-stack-card-index="1"]');

    assert
      .dom('[data-test-stack-card-index="1"] [data-test-field="firstName"]')
      .exists();
    await fillIn(
      '[data-test-stack-card-index="1"] [data-test-field="firstName"] [data-test-boxel-input]',
      'Alice',
    );

    let authorId = [...savedCards].find((k) => k.includes('Author'))!;
    await waitFor(
      `[data-test-stack-card-index="1"] [data-test-card="${authorId}"]`,
    );

    await click('[data-test-stack-card-index="1"] [data-test-close-button]');
    await waitFor('[data-test-stack-card-index="1"]', { count: 0 });
    assert.dom('[data-test-add-new="authorBio"]').doesNotExist();
    assert.dom('[data-test-field="authorBio"]').containsText('Alice');

    await click('[data-test-stack-card-index="0"] [data-test-edit-button]');
    assert.dom('[data-test-blog-post-isolated]').hasText('Beginnings by Alice');
  });

  test('can choose a card from a publicly readable realm to link to a card in the current realm', async function (assert) {
    setCardInOperatorModeState(
      `${testRealmURL}SpecCardLinker/spec-card-linker`,
    );
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(
      `[data-test-stack-card="${testRealmURL}SpecCardLinker/spec-card-linker"]`,
    );
    await click('[data-test-edit-button]');
    assert.dom('[data-test-add-new="spec"]').exists();

    await click('[data-test-add-new="spec"]');
    // try and link a card from the base realm that we know exists
    await waitFor(
      `[data-test-card-catalog-item="https://cardstack.com/base/fields/biginteger-field"]`,
    );
    await click(
      `[data-test-select="https://cardstack.com/base/fields/biginteger-field"]`,
    );
    await click('[data-test-card-catalog-go-button]');

    await waitUntil(() => !document.querySelector('[card-catalog-modal]'));

    await click('[data-test-edit-button]');
    await waitFor('.operator-mode [data-test-spec-card-linker-isolated]');

    assert
      .dom('.operator-mode [data-test-spec-card-linker-isolated]')
      .hasText('The card is: Spec Card Linker Linked to: Bigint Field');
  });

  test('can remove the link for a linksTo field', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/1"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="authorBio"]').containsText('Alien Bob');
    await click('[data-test-field="authorBio"] [data-test-remove-card]');
    await click('[data-test-edit-button]');

    await waitFor('.operator-mode [data-test-blog-post-isolated]');
    assert
      .dom('.operator-mode [data-test-blog-post-isolated]')
      .hasText('Outer Space Journey by');
  });

  test('can add a card to a linksToMany field with existing values', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/burcu`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="friends"]').containsText('Jackie Woody');
    assert.dom('[data-test-field="friends"] [data-test-add-new]').exists();

    await click('[data-test-links-to-many="friends"] [data-test-add-new]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Pet/mango"]`);
    await click(`[data-test-select="${testRealmURL}Pet/mango"]`);
    await click('[data-test-card-catalog-go-button]');

    await waitUntil(() => !document.querySelector('[card-catalog-modal]'));
    assert
      .dom('[data-test-field="friends"]')
      .containsText('Jackie Woody Buzz Mango');
    assert
      .dom(
        '[data-test-links-to-many="friends"] [data-test-card-format="fitted"]',
      )
      .exists({ count: 4 });
  });

  test('can add a card to a linksTo field creating a loop', async function (assert) {
    // Friend A already links to friend B.
    // This test links B back to A
    setCardInOperatorModeState(`${testRealmURL}Friend/friend-b`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Friend/friend-b"]`);
    await click('[data-test-edit-button]');
    assert.dom('[data-test-field="friend"] [data-test-add-new]').exists();

    await click('[data-test-field="friend"] [data-test-add-new]');

    await waitFor(
      `[data-test-card-catalog-item="${testRealmURL}Friend/friend-a"]`,
    );
    await click(`[data-test-select="${testRealmURL}Friend/friend-a"]`);
    await click('[data-test-card-catalog-go-button]');

    await waitUntil(() => !document.querySelector('[card-catalog-modal]'));

    // Normally we'd only have an assert like this at the end that may work,
    // but the rest of the application may be broken.

    assert
      .dom('[data-test-stack-card] [data-test-field="friend"]')
      .containsText('Friend A');

    // Instead try and go somewhere else in the application to see if it's broken
    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').exists();
    assert.dom('[data-test-submode-switcher]').hasText('Interact');

    await click(
      '[data-test-submode-switcher] .submode-switcher-dropdown-trigger',
    );
    await click('[data-test-boxel-menu-item-text="Code"]');
    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').hasText('Code');
  });

  test('can add a card to linksToMany field that has no existing values', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="friends"] [data-test-pet]').doesNotExist();
    assert.dom('[data-test-add-new="friends"]').hasText('Add Pets');
    await click('[data-test-add-new="friends"]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Pet/mango"]`);
    await click(`[data-test-select="${testRealmURL}Pet/jackie"]`);
    await click('[data-test-card-catalog-go-button]');

    await waitUntil(() => !document.querySelector('[card-catalog-modal]'));
    assert.dom('[data-test-field="friends"]').containsText('Jackie');
  });

  test('can add a card to linksToMany field that has a null value for relationship', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/hassan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/hassan"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="friends"] [data-test-pet]').doesNotExist();
    assert
      .dom('[data-test-field="friends"] [data-test-add-new]')
      .hasText('Add Pets');
    await click('[data-test-field="friends"] [data-test-add-new]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Pet/mango"]`);
    await click(`[data-test-select="${testRealmURL}Pet/jackie"]`);
    await click('[data-test-card-catalog-go-button]');

    await waitUntil(() => !document.querySelector('[card-catalog-modal]'));
    assert.dom('[data-test-field="friends"]').containsText('Jackie');
  });

  test('can change the item selection in a linksToMany field', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/burcu`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="friends"]').containsText('Jackie Woody');
    await click(
      '[data-test-links-to-many="friends"] [data-test-item="1"] [data-test-remove-card]',
    );
    assert.dom('[data-test-field="friends"]').containsText('Jackie');

    await click('[data-test-links-to-many="friends"] [data-test-add-new]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Pet/mango"]`);
    await click(`[data-test-select="${testRealmURL}Pet/mango"]`);
    await click('[data-test-card-catalog-go-button]');

    await waitUntil(() => !document.querySelector('[card-catalog-modal]'));
    assert.dom('[data-test-field="friends"]').containsText('Mango');
  });

  test<TestContextWithSave>('can create a new card to add to a linksToMany field from card chooser', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    let savedCards = new Set<string>();
    this.onSave((url) => savedCards.add(url.href));

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="friends"] [data-test-pet]').doesNotExist();
    await click('[data-test-links-to-many="friends"] [data-test-add-new]');

    await waitFor(`[data-test-card-catalog-modal]`);
    assert
      .dom('[data-test-card-catalog-create-new-button]')
      .hasText('Create New Pet');
    await click('[data-test-card-catalog-create-new-button]');
    await click(`[data-test-card-catalog-go-button]`);

    await waitFor(`[data-test-stack-card-index="1"]`);
    await fillIn(
      '[data-test-stack-card-index="1"] [data-test-field="name"] [data-test-boxel-input]',
      'Woodster',
    );
    let petId = [...savedCards].find((k) => k.includes('Pet'))!;
    await waitFor(
      `[data-test-stack-card-index="1"] [data-test-card="${petId}"]`,
    );
    await click('[data-test-stack-card-index="1"] [data-test-close-button]');
    await waitUntil(
      () => !document.querySelector('[data-test-stack-card-index="1"]'),
    );
    assert.dom('[data-test-field="friends"]').containsText('Woodster');
  });

  test<TestContextWithSave>('does not create a new card to add to a linksToMany field from card chooser, if user cancel the edit view', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/burcu`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    let savedCards = new Set<string>();
    this.onSave((url) => savedCards.add(url.href));

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="friends"]').containsText('Jackie Woody');
    await click('[data-test-links-to-many="friends"] [data-test-add-new]');

    await waitFor(`[data-test-card-catalog-modal]`);
    assert
      .dom('[data-test-card-catalog-create-new-button]')
      .hasText('Create New Pet');
    await click('[data-test-card-catalog-create-new-button]');
    await click(`[data-test-card-catalog-go-button]`);

    await waitFor(`[data-test-stack-card-index="1"]`);
    await fillIn(
      '[data-test-stack-card-index="1"] [data-test-field="name"] [data-test-boxel-input]',
      'Woodster',
    );
    let petId = [...savedCards].find((k) => k.includes('Pet'))!;
    await waitFor(
      `[data-test-stack-card-index="1"] [data-test-card="${petId}"]`,
    );
    await click('[data-test-stack-card-index="1"] [data-test-close-button]');
    await waitUntil(
      () => !document.querySelector('[data-test-stack-card-index="1"]'),
    );
    assert.dom('[data-test-field="friends"]').containsText('Jackie Woody');

    //Ensuring the card chooser modal doesn't get stuck
    await click('[data-test-links-to-many="friends"] [data-test-add-new]');
    await waitFor(`[data-test-card-catalog-modal]`);
    assert
      .dom('[data-test-card-catalog-create-new-button]')
      .hasText('Create New Pet');
  });

  test('can remove all items of a linksToMany field', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/burcu`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    assert
      .dom(
        `[data-test-plural-view-field="friends"] [data-test-plural-view-item]`,
      )
      .exists({ count: 3 });
    await click('[data-test-edit-button]');
    assert.dom('[data-test-field="friends"]').containsText('Jackie Woody');

    await click(
      '[data-test-links-to-many="friends"] [data-test-item="1"] [data-test-remove-card]',
    );
    await click(
      '[data-test-links-to-many="friends"] [data-test-item="0"] [data-test-remove-card]',
    );
    await click(
      '[data-test-links-to-many="friends"] [data-test-item="0"] [data-test-remove-card]',
    );

    await click('[data-test-edit-button]');
    await waitFor(`[data-test-person="Burcu"]`);
    assert
      .dom(`[data-test-stack-card="${testRealmURL}Person/burcu"]`)
      .doesNotContainText('Jackie');
    assert
      .dom(
        `[data-test-plural-view-field="friends"] [data-test-plural-view-item]`,
      )
      .doesNotExist();
  });

  test('can close cards by clicking the header of a card deeper in the stack', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await waitFor(`[data-test-cards-grid-item]`);
    await click(
      `[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"] .field-component-card`,
    );
    await waitFor(`[data-test-stack-card-index="1"]`);
    assert.dom(`[data-test-stack-card-index="1"]`).exists();
    await waitFor('[data-test-person]');

    await waitFor('[data-test-cards-grid-item]');
    await click('[data-test-cards-grid-item] .field-component-card');
    await waitFor(`[data-test-stack-card-index="2"]`);
    assert.dom(`[data-test-stack-card-index="2"]`).exists();
    await click('[data-test-stack-card-index="0"] [data-test-card-header]');

    await waitFor('[data-test-stack-card-index="2"]', { count: 0 });
    await waitFor('[data-test-stack-card-index="1"]', { count: 0 });

    assert.dom(`[data-test-stack-card-index="2"]`).doesNotExist();
    assert.dom(`[data-test-stack-card-index="1"]`).doesNotExist();
    assert.dom(`[data-test-stack-card-index="0"]`).exists();
  });

  test(`displays realm name as cards grid card title and card's display name as other card titles`, async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    assert.dom(`[data-test-stack-card-header]`).containsText(realmName);

    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(
      `[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"] .field-component-card`,
    );
    await waitFor(`[data-test-stack-card-index="1"]`);
    assert.dom(`[data-test-stack-card-index="1"]`).exists();
    assert
      .dom(
        `[data-test-stack-card="${testRealmURL}Person/fadhlan"] [data-test-boxel-card-header-title]`,
      )
      .containsText('Person');

    assert.dom(`[data-test-cards-grid-cards]`).isNotVisible();
    assert.dom(`[data-test-create-new-card-button]`).isNotVisible();
  });

  test(`displays recently accessed card`, async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    assert.dom(`[data-test-stack-card-header]`).containsText(realmName);

    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(
      `[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"] .field-component-card`,
    );
    await waitFor(`[data-test-stack-card-index="1"]`);

    assert
      .dom(
        `[data-test-stack-card="${testRealmURL}Person/fadhlan"] [data-test-boxel-card-header-title]`,
      )
      .containsText('Person');

    assert.dom(`[data-test-cards-grid-cards]`).isNotVisible();
    assert.dom(`[data-test-create-new-card-button]`).isNotVisible();

    await click(`[data-test-open-search-field]`);
    assert
      .dom(`[data-test-search-result="${testRealmURL}Person/fadhlan"]`)
      .exists();
    await click(`[data-test-search-sheet-cancel-button]`);
    await click(`[data-test-stack-card-index="1"] [data-test-close-button]`);

    await waitUntil(
      () => !document.querySelector('[data-test-stack-card-index="1"]'),
    );

    await waitFor(`[data-test-cards-grid-item]`);
    await click(
      `[data-test-cards-grid-item="${testRealmURL}Person/burcu"] .field-component-card`,
    );
    await waitFor(`[data-test-stack-card-index="1"]`);

    await click(`[data-test-open-search-field]`);

    await waitFor(`[data-test-search-result-index="0"]`);
    await waitFor(`[data-test-search-result-index="1"]`);
    assert.dom(`[data-test-search-result]`).exists({ count: 2 });
    assert
      .dom(
        `[data-test-search-result-index="0"][data-test-search-result="${testRealmURL}Person/burcu"]`,
      )
      .exists();
    assert
      .dom(
        `[data-test-search-result-index="1"][data-test-search-result="${testRealmURL}Person/fadhlan"]`,
      )
      .exists();
  });

  test(`displays recently accessed card, maximum 10 cards`, async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    assert.dom(`[data-test-stack-card-header]`).containsText(realmName);

    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    for (let i = 1; i <= 11; i++) {
      await click(
        `[data-test-cards-grid-item="${testRealmURL}Person/${i}"] .field-component-card`,
      );
      await waitFor(
        `[data-test-stack-card-index="1"][data-test-stack-card="${testRealmURL}Person/${i}"]`,
      );
      await click(
        `[data-test-stack-card-index="1"][data-test-stack-card="${testRealmURL}Person/${i}"] [data-test-close-button]`,
      );
      await waitFor(
        `[data-test-stack-card-index="1"][data-test-stack-card="${testRealmURL}Person/${i}"]`,
        { count: 0 },
      );
    }

    await click(`[data-test-open-search-field]`);
    await waitFor(`[data-test-search-result]`);
    assert.dom(`[data-test-search-result]`).exists({ count: 10 });
  });

  test(`displays searching results`, async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    assert.dom(`[data-test-stack-card-header]`).containsText(realmName);

    await click(`[data-test-open-search-field]`);
    typeIn(`[data-test-search-field]`, 'ma');
    await waitUntil(() =>
      (
        document.querySelector('[data-test-search-label]') as HTMLElement
      )?.innerText.includes('Searching for “ma”'),
    );
    assert.dom(`[data-test-search-label]`).containsText('Searching for “ma”');
    await settled();

    assert.dom(`[data-test-search-result="${testRealmURL}Pet/mango"]`).exists();
    assert
      .dom(
        `[data-test-search-result="${testRealmURL}Pet/mango"] + [data-test-realm-name]`,
      )
      .containsText('Operator Mode Workspace');
    assert
      .dom(`[data-test-search-result="${testRealmURL}Author/mark"]`)
      .exists();

    await click(`[data-test-search-sheet-cancel-button]`);
    await click(`[data-test-open-search-field]`);
    await typeIn(`[data-test-search-field]`, 'Mark J');

    assert
      .dom(`[data-test-search-label]`)
      .containsText('1 Result for “Mark J”');

    //Ensures that there is no cards when reopen the search sheet
    await click(`[data-test-search-sheet-cancel-button]`);
    await click(`[data-test-open-search-field]`);
    assert.dom(`[data-test-search-label]`).doesNotExist();
    assert.dom(`[data-test-search-sheet-search-result]`).doesNotExist();

    //No cards match
    await focus(`[data-test-search-field]`);
    typeIn(`[data-test-search-field]`, 'No Cards');
    await waitUntil(() =>
      (
        document.querySelector('[data-test-search-label]') as HTMLElement
      )?.innerText.includes('Searching for “No Cards”'),
    );
    assert
      .dom(`[data-test-search-label]`)
      .containsText('Searching for “No Cards”');

    await settled();

    assert
      .dom(`[data-test-search-label]`)
      .containsText('0 Results for “No Cards”');
    assert.dom(`[data-test-search-sheet-search-result]`).doesNotExist();
  });

  test(`can specify a card by URL in the card chooser`, async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-create-new-card-button]`);
    await waitFor(`[data-test-card-catalog-item]`);
    await fillIn(
      `[data-test-search-field]`,
      `https://cardstack.com/base/types/card`,
    );

    await waitFor('[data-test-card-catalog-item]', {
      count: 1,
    });

    assert
      .dom(`[data-test-realm="Base Workspace"] [data-test-results-count]`)
      .hasText('1 result');

    assert.dom('[data-test-card-catalog-item]').exists({ count: 1 });
    await click('[data-test-select]');

    await waitFor('[data-test-card-catalog-go-button][disabled]', {
      count: 0,
    });
    await click('[data-test-card-catalog-go-button]');
    await waitFor(
      `[data-test-stack-card-index="1"] [data-test-field="cardInfo-name"]`,
    );
    assert
      .dom(`[data-test-stack-card-index="1"] [data-test-field="cardInfo-name"]`)
      .exists();
    assert
      .dom(
        `[data-test-stack-card-index="1"] [data-test-field="cardInfo-summary"]`,
      )
      .exists();
    assert
      .dom(
        `[data-test-stack-card-index="1"] [data-test-field="cardInfo-notes"]`,
      )
      .exists();
  });

  test(`can search by card title in card chooser`, async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-create-new-card-button]`);
    await waitFor('[data-test-card-catalog-item]');
    assert
      .dom(
        `[data-test-card-catalog-item="${testRealmURL}Spec/publishing-packet"]`,
      )
      .exists();

    await fillIn(`[data-test-search-field]`, `pet`);
    await waitFor(
      `[data-test-card-catalog-item="${testRealmURL}Spec/publishing-packet"]`,
      { count: 0 },
    );
    assert.dom(`[data-test-card-catalog-item]`).exists({ count: 2 });

    await fillIn(`[data-test-search-field]`, `publishing packet`);
    await waitUntil(
      () =>
        !document.querySelector(
          `[data-test-card-catalog-item="${testRealmURL}Spec/pet-card"]`,
        ),
    );
    assert.dom(`[data-test-card-catalog-item]`).exists({ count: 1 });

    await click(`[data-test-select="${testRealmURL}Spec/publishing-packet"]`);
    await waitUntil(
      () =>
        (
          document.querySelector(`[data-test-card-catalog-go-button]`) as
            | HTMLButtonElement
            | undefined
        )?.disabled === false,
    );
    await click(`[data-test-card-catalog-go-button]`);
    await waitFor('[data-test-stack-card-index="1"]');
    assert.dom('[data-test-stack-card-index="1"]').exists();
    assert
      .dom(
        '[data-test-stack-card-index="1"] [data-test-boxel-card-header-title]',
      )
      .hasText('Publishing Packet - Untitled Publishing Packet');
  });

  test(`can search by card title when opening card chooser from a field editor`, async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}BlogPost/2`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/2"]`);
    assert.dom(`[data-test-stack-card="${testRealmURL}BlogPost/2"]`).exists();
    await click(
      `[data-test-stack-card="${testRealmURL}BlogPost/2"] [data-test-edit-button]`,
    );
    await waitFor(`[data-test-field="authorBio"]`);
    await click('[data-test-add-new="authorBio"]');

    await waitFor('[data-test-card-catalog-item]');
    assert
      .dom('[data-test-card-catalog-modal] [data-test-boxel-header-title]')
      .hasText('Choose an Author card');
    assert.dom('[data-test-results-count]').hasText('3 results');

    await fillIn(`[data-test-search-field]`, `alien`);
    await waitFor('[data-test-card-catalog-item]');
    assert.dom(`[data-test-select="${testRealmURL}Author/1"]`).exists();
  });

  test(`displays no cards available message if search result does not exist`, async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-create-new-card-button]`);
    await waitFor('[data-test-card-catalog-item]');

    await fillIn(`[data-test-search-field]`, `friend`);
    await waitFor('[data-test-card-catalog-item]', { count: 0 });
    assert.dom(`[data-test-card-catalog]`).hasText('No cards available');
  });

  test(`can filter by realm after searching in card catalog`, async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-create-new-card-button]`);
    await waitFor('[data-test-card-catalog-item]');
    assert
      .dom(
        `[data-test-realm="Operator Mode Workspace"] [data-test-card-catalog-item]`,
      )
      .exists({ count: 3 });
    assert
      .dom(`[data-test-realm="Base Workspace"] [data-test-card-catalog-item]`)
      .exists();

    await fillIn(`[data-test-search-field]`, `general`);

    await waitFor(
      `[data-test-card-catalog-item="${testRealmURL}Spec/pet-card"]`,
      { count: 0 },
    );

    assert
      .dom(
        `[data-test-realm="Operator Mode Workspace"] [data-test-card-catalog-item]`,
      )
      .exists({ count: 1 });

    assert
      .dom(
        `[data-test-realm="Operator Mode Workspace"] [data-test-card-catalog-item]`,
      )
      .exists({ count: 1 });

    assert
      .dom(
        '[data-test-realm="Operator Mode Workspace"] [data-test-results-count]',
      )
      .hasText('1 result');

    assert
      .dom('[data-test-realm="Base Workspace"] [data-test-results-count]')
      .hasText('1 result');

    assert
      .dom(
        `[data-test-realm="Operator Mode Workspace"] [data-test-select="${testRealmURL}Spec/pet-room"]`,
      )
      .exists();

    assert
      .dom(
        `[data-test-realm="Base Workspace"] [data-test-select="${baseRealm.url}types/card"]`,
      )
      .exists();

    await click('[data-test-realm-filter-button]'); // At this point, both realms are selected
    await click('[data-test-boxel-menu-item-text="Base Workspace"]'); // Unselects the Base Workspace

    assert.dom(`[data-test-realm]`).exists({ count: 1 });
    assert.dom('[data-test-realm="Operator Mode Workspace"]').exists();
    assert.dom('[data-test-realm="Base Workspace"]').doesNotExist();
    assert.dom(`[data-test-select="${testRealmURL}Spec/pet-room"]`).exists();

    await click('[data-test-realm-filter-button]');
    await click('[data-test-boxel-menu-item-text="Operator Mode Workspace"]'); // Unselects the Operator Mode Workspace
    assert.dom('[data-test-realm="Operator Mode Workspace"]').doesNotExist();
    assert.dom('[data-test-realm="Base Workspace"]').doesNotExist();
    assert.dom(`[data-test-card-catalog-item]`).doesNotExist();
    assert.dom('[data-test-card-catalog]').hasText('No cards available');

    await click('[data-test-realm-filter-button]');
    await click('[data-test-boxel-menu-item-text="Operator Mode Workspace"]'); // Selects the Operator Mode Workspace
    assert.dom(`[data-test-realm]`).exists({ count: 1 });
    assert.dom('[data-test-realm="Operator Mode Workspace"]').exists();
    assert.dom('[data-test-realm="Base Workspace"]').doesNotExist();
    assert.dom(`[data-test-select="${testRealmURL}Spec/pet-room"]`).exists();
  });

  test(`can open new card editor in the stack after searching in card catalog`, async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-create-new-card-button]`);
    await waitFor('[data-test-card-catalog-item]');

    await typeIn(`[data-test-search-field]`, `pet`);
    await waitFor(
      `[data-test-card-catalog-item="${testRealmURL}Spec/publishing-packet"]`,
      { count: 0 },
    );
    assert.dom(`[data-test-card-catalog-item]`).exists({ count: 2 });

    await click(`[data-test-select="${testRealmURL}Spec/pet-card"]`);
    assert
      .dom(
        `[data-test-card-catalog-item="${testRealmURL}Spec/pet-card"][data-test-card-catalog-item-selected]`,
      )
      .exists({ count: 1 });

    await click('[data-test-card-catalog-go-button]');
    await waitFor('[data-test-stack-card-index="1"]');
    assert
      .dom(
        '[data-test-stack-card-index="1"] [data-test-boxel-card-header-title]',
      )
      .hasText('Pet');
  });

  test(`cancel button closes the spec card picker`, async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(`[data-test-create-new-card-button]`);

    await typeIn(`[data-test-search-field]`, `pet`);
    assert.dom(`[data-test-search-field]`).hasValue('pet');
    await waitFor('[data-test-card-catalog-item]', { count: 2 });
    await click(`[data-test-select="${testRealmURL}Spec/pet-room"]`);
    assert
      .dom(
        `[data-test-card-catalog-item="${testRealmURL}Spec/pet-room"][data-test-card-catalog-item-selected]`,
      )
      .exists({ count: 1 });

    await click('[data-test-card-catalog-cancel-button]');
    await waitFor('[data-test-card-catalog]', { count: 0 });

    assert.dom('[data-test-operator-mode-stack="0"]').exists();
    assert
      .dom('[data-test-operator-mode-stack="1"]')
      .doesNotExist('no cards are added');

    await click(`[data-test-create-new-card-button]`);
    await waitFor('[data-test-card-catalog-item]');
    assert
      .dom(`[data-test-search-field]`)
      .hasNoValue('Card picker state is reset');
    assert.dom('[data-test-card-catalog-item-selected]').doesNotExist();
  });

  test(`cancel button closes the field picker`, async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}BlogPost/2`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/2"]`);
    await click('[data-test-edit-button]');
    await click(`[data-test-field="authorBio"] [data-test-add-new]`);

    await waitFor('[data-test-card-catalog-modal]');
    await waitFor('[data-test-card-catalog-item]', { count: 3 });

    await typeIn(`[data-test-search-field]`, `bob`);
    assert.dom(`[data-test-search-field]`).hasValue('bob');

    await waitFor('[data-test-card-catalog-item]', { count: 1 });

    await click(`[data-test-select="${testRealmURL}Author/1"]`);
    assert
      .dom(
        `[data-test-card-catalog-item="${testRealmURL}Author/1"][data-test-card-catalog-item-selected]`,
      )
      .exists({ count: 1 });

    await click('[data-test-card-catalog-cancel-button]');
    await waitFor('[data-test-card-catalog]', { count: 0 });

    assert
      .dom(`[data-test-field="authorBio"] [data-test-add-new]`)
      .exists('no card is chosen');

    await click(`[data-test-field="authorBio"] [data-test-add-new]`);
    assert
      .dom(`[data-test-search-field]`)
      .hasNoValue('Field picker state is reset');
    assert.dom('[data-test-card-catalog-item-selected]').doesNotExist();
  });

  test(`can add a card to the stack by URL from search sheet`, async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);

    await click('[data-test-open-search-field]');
    await fillIn('[data-test-search-field]', 'http://localhost:4202/test/man');
    await waitFor(`[data-test-search-label]`);

    assert
      .dom('[data-test-search-label]')
      .containsText('No card found at http://localhost:4202/test/man');
    assert.dom('[data-test-search-sheet-search-result]').doesNotExist();

    await fillIn(
      '[data-test-search-field]',
      'http://localhost:4202/test/mango',
    );
    await waitFor('[data-test-search-sheet-search-result]');

    assert
      .dom('[data-test-search-label]')
      .containsText('Card found at http://localhost:4202/test/mango');
    assert.dom('[data-test-search-sheet-search-result]').exists({ count: 1 });

    await fillIn('[data-test-search-field]', 'http://localhost:4202/test/man');

    assert
      .dom('[data-test-search-label]')
      .containsText('No card found at http://localhost:4202/test/man');
    assert.dom('[data-test-search-sheet-search-result]').doesNotExist();

    await fillIn(
      '[data-test-search-field]',
      'http://localhost:4202/test/mango',
    );
    await waitFor('[data-test-search-sheet-search-result]');

    await click('[data-test-search-sheet-search-result]');

    await waitFor(`[data-test-stack-card="http://localhost:4202/test/mango"]`);
    assert
      .dom(
        `[data-test-stack-card="http://localhost:4202/test/mango"] [data-test-field-component-card]`,
      )
      .containsText('Mango', 'the card is rendered in the stack');
  });

  test(`can select one or more cards on cards-grid and unselect`, async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    assert.dom(`[data-test-cards-grid-cards]`).exists();

    await waitFor(
      `[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"]`,
    );
    assert.dom('[data-test-overlay-selected]').doesNotExist();

    await triggerEvent(
      `[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"] .field-component-card`,
      'mouseenter',
    );
    await click(`[data-test-overlay-select="${testRealmURL}Person/fadhlan"]`);
    assert
      .dom(`[data-test-overlay-selected="${testRealmURL}Person/fadhlan"]`)
      .exists();
    assert.dom('[data-test-overlay-selected]').exists({ count: 1 });

    await triggerEvent(
      `[data-test-cards-grid-item="${testRealmURL}Pet/jackie"] .field-component-card`,
      'mouseenter',
    );
    await click(`[data-test-overlay-select="${testRealmURL}Pet/jackie"]`);
    await click(
      `[data-test-cards-grid-item="${testRealmURL}Author/1"] .field-component-card`,
    );
    await click(
      `[data-test-cards-grid-item="${testRealmURL}BlogPost/2"] .field-component-card`,
    );
    assert.dom('[data-test-overlay-selected]').exists({ count: 4 });

    await click(
      `[data-test-cards-grid-item="${testRealmURL}Pet/jackie"] .field-component-card`,
    );
    assert.dom('[data-test-overlay-selected]').exists({ count: 3 });

    await click(
      `[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"] .field-component-card`,
    );
    await click(
      `[data-test-cards-grid-item="${testRealmURL}BlogPost/2"] .field-component-card`,
    );
    await click(`[data-test-overlay-select="${testRealmURL}Author/1"]`);
    assert.dom('[data-test-overlay-selected]').doesNotExist();

    await click(
      `[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"] .field-component-card`,
    );
    await waitFor(`[data-test-stack-card-index="1"]`, { count: 1 });
  });

  test('displays realm name in tooltip when hovering realm icon', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor('[data-test-card-header-realm-icon]');
    assert
      .dom('[data-test-boxel-card-header-title]')
      .hasText('Person - Fadhlan');
    assert
      .dom(
        `[data-test-card-header-realm-icon="https://boxel-images.boxel.ai/icons/Letter-o.png"]`,
      )
      .exists();
    await triggerEvent(`[data-test-card-header-realm-icon]`, 'mouseenter');
    assert
      .dom('[data-test-tooltip-content]')
      .hasText('In Operator Mode Workspace');
    await triggerEvent(`[data-test-card-header-realm-icon]`, 'mouseleave');
    assert
      .dom('[data-test-boxel-card-header-title]')
      .hasText('Person - Fadhlan');
  });

  test(`it has an option to copy the card url`, async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/burcu`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor('[data-test-more-options-button]');
    await click('[data-test-more-options-button]');
    await click('[data-test-boxel-menu-item-text="Copy Card URL"]');
    assert.dom('[data-test-boxel-menu-item]').doesNotExist();
  });

  test(`click on "links to" the embedded card will open it on the stack`, async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await click('[data-test-author]');
    await waitFor('[data-test-stack-card-index="1"]');
    assert.dom('[data-test-stack-card-index]').exists({ count: 2 });
    assert
      .dom(
        '[data-test-stack-card-index="1"] [data-test-boxel-card-header-title]',
      )
      .includesText('Author');
  });

  test(`toggles mode switcher`, async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').exists();
    assert.dom('[data-test-submode-switcher]').hasText('Interact');

    await click('[data-test-submode-switcher] > [data-test-boxel-button]');

    await click('[data-test-boxel-menu-item-text="Code"]');
    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').hasText('Code');
    assert.dom('[data-test-submode-arrow-direction="down"]').exists();

    await click('[data-test-submode-switcher] > [data-test-boxel-button]');
    await click('[data-test-boxel-menu-item-text="Interact"]');
    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').hasText('Interact');
    assert.dom('[data-test-submode-arrow-direction="down"]').exists();
  });

  test(`card url bar shows realm info of valid URL`, async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').exists();
    assert.dom('[data-test-submode-switcher]').hasText('Interact');

    await click(
      '[data-test-submode-switcher] .submode-switcher-dropdown-trigger',
    );
    await click('[data-test-boxel-menu-item-text="Code"]');
    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').hasText('Code');
    await waitUntil(() =>
      document
        .querySelector('[data-test-card-url-bar-realm-info]')
        ?.textContent?.includes('Operator Mode Workspace'),
    );

    assert.dom('[data-test-card-url-bar]').exists();
    assert
      .dom('[data-test-card-url-bar-realm-info]')
      .hasText('in Operator Mode Workspace');
    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}BlogPost/1.json`);

    await fillIn(
      '[data-test-card-url-bar-input]',
      `${testRealmURL}Pet/mango.json`,
    );
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );
    await blur('[data-test-card-url-bar-input]');
    assert
      .dom('[data-test-card-url-bar-realm-info]')
      .hasText('in Operator Mode Workspace');
    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}Pet/mango.json`);
    assert.dom('[data-test-card-url-bar-error]').doesNotExist();
  });

  test(`card url bar shows error message when URL is invalid`, async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor('[data-test-submode-switcher]');
    await click(
      '[data-test-submode-switcher] .submode-switcher-dropdown-trigger',
    );
    await click('[data-test-boxel-menu-item-text="Code"]');

    await waitUntil(() =>
      document
        .querySelector('[data-test-card-url-bar-realm-info]')
        ?.textContent?.includes('Operator Mode Workspace'),
    );
    assert.dom('[data-test-card-url-bar]').exists();
    assert
      .dom('[data-test-card-url-bar-realm-info]')
      .hasText('in Operator Mode Workspace');
    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}BlogPost/1.json`);

    await fillIn(
      '[data-test-card-url-bar-input]',
      `${testRealmURL}Pet/NotFoundCard`,
    );
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );
    assert
      .dom('[data-test-card-url-bar-error]')
      .containsText('This resource does not exist');

    await percySnapshot(assert);

    await fillIn('[data-test-card-url-bar-input]', `Wrong URL`);
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );
    assert
      .dom('[data-test-card-url-bar-error]')
      .containsText('Not a valid URL');
  });

  test('user can dismiss url bar error message', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor('[data-test-submode-switcher]');
    await click(
      '[data-test-submode-switcher] .submode-switcher-dropdown-trigger',
    );
    await click('[data-test-boxel-menu-item-text="Code"]');
    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').hasText('Code');

    await waitUntil(() =>
      document
        .querySelector('[data-test-card-url-bar-realm-info]')
        ?.textContent?.includes('Operator Mode Workspace'),
    );
    await fillIn(
      '[data-test-card-url-bar-input]',
      `${testRealmURL}Pet/NotFoundCard`,
    );
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );
    assert.dom('[data-test-card-url-bar-error]').exists();

    await click('[data-test-dismiss-url-error-button]');
    assert.dom('[data-test-card-url-bar-error]').doesNotExist();

    await fillIn(
      '[data-test-card-url-bar-input]',
      `${testRealmURL}Pet/NotFoundCard_2`,
    );
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );
    assert.dom('[data-test-card-url-bar-error]').exists();

    await fillIn(
      '[data-test-card-url-bar-input]',
      `${testRealmURL}Pet/mango.json`,
    );
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );
    assert.dom('[data-test-card-url-bar-error]').doesNotExist();
  });

  test(`card url bar URL reacts to external changes of code path when user is not editing`, async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').exists();
    assert.dom('[data-test-submode-switcher]').hasText('Interact');

    await click(
      '[data-test-submode-switcher] .submode-switcher-dropdown-trigger',
    );
    await waitFor('[data-test-boxel-menu-item-text]');
    await click('[data-test-boxel-menu-item-text="Code"]');
    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').hasText('Code');
    await waitUntil(() =>
      document
        .querySelector('[data-test-card-url-bar-realm-info]')
        ?.textContent?.includes('Operator Mode Workspace'),
    );

    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}BlogPost/1.json`);

    await operatorModeStateService.updateCodePath(
      new URL(`${testRealmURL}person.gts`),
    );

    await waitUntil(() =>
      document
        .querySelector('[data-test-card-url-bar-realm-info]')
        ?.textContent?.includes('Operator Mode Workspace'),
    );
    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}person.gts`);
  });

  test(`card url bar URL does not react to external changes when user is editing`, async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').exists();
    assert.dom('[data-test-submode-switcher]').hasText('Interact');

    await click(
      '[data-test-submode-switcher] .submode-switcher-dropdown-trigger',
    );
    await click('[data-test-boxel-menu-item-text="Code"]');
    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').hasText('Code');
    await waitUntil(() =>
      document
        .querySelector('[data-test-card-url-bar-realm-info]')
        ?.textContent?.includes('Operator Mode Workspace'),
    );

    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}BlogPost/1.json`);

    let someRandomText = 'I am still typing a url';
    await typeIn('[data-test-card-url-bar-input]', someRandomText);

    await operatorModeStateService.updateCodePath(
      new URL(`${testRealmURL}person.gts`),
    );

    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}BlogPost/1.json${someRandomText}`);

    blur('[data-test-card-url-bar-input]');

    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}BlogPost/1.json${someRandomText}`);
  });

  test(`can open and close search sheet`, async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);

    await click(`[data-test-open-search-field]`);
    assert.dom(`[data-test-search-sheet="search-prompt"]`).exists();

    await click(`[data-test-search-sheet] .search-sheet-content`);
    assert.dom(`[data-test-search-sheet="search-prompt"]`).exists();

    await typeIn(`[data-test-search-field]`, 'A');
    await click(`[data-test-search-sheet] .search-sheet-content .section`);
    assert.dom(`[data-test-search-sheet="search-results"]`).exists();

    await click(`[data-test-search-sheet] .search-sheet-content .section`);
    assert.dom(`[data-test-search-sheet="search-results"]`).exists();

    await click(`[data-test-operator-mode-stack]`);
    assert.dom(`[data-test-search-sheet="closed"]`).exists();
  });

  test<TestContextWithSave>('New cards are optimistically created for a linksTo field', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/1`, 'edit');
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    let savedCards = new Set<string>();
    this.onSave((url) => {
      savedCards.add(url.href);
    });
    await waitFor(`[data-test-stack-card="${testRealmURL}Person/1"]`);
    await waitFor('[data-test-links-to-editor="pet"] [data-test-remove-card]');
    await click('[data-test-links-to-editor="pet"] [data-test-remove-card]');
    await waitFor('[data-test-add-new="pet"]');
    assert.dom('[data-test-add-new="pet"]').exists();
    assert
      .dom('[data-test-links-to-editor="pet"] [data-test-boxel-card-container]')
      .doesNotExist();
    await click('[data-test-add-new="pet"]');
    await waitFor(`[data-test-card-catalog-modal]`);
    await waitFor(`[data-test-card-catalog-create-new-button]`);
    await click(`[data-test-card-catalog-create-new-button]`);
    // don't await this click so the test waiters don't get in the way
    click(`[data-test-card-catalog-go-button]`);
    await waitFor('[data-test-stack-card-index="1"]'); // wait for the 2nd stack item: Pet
    assert.deepEqual(
      [...savedCards],
      [`${testRealmURL}Person/1`],
      'linked card has not been saved yet',
    );
    await fillIn(
      `[data-test-stack-card-index="1"] [data-test-field="name"] input`,
      'Mango',
    );
    await click(`[data-test-stack-card-index="1"] [data-test-close-button]`);
    assert
      .dom(
        `[data-test-stack-card="${testRealmURL}Person/1"] [data-test-links-to-editor="pet"]`,
      )
      .containsText(
        'Mango',
        'the embedded link of new card is rendered correctly',
      );
    let ids = Array.from(savedCards);
    let paths = ids.map((url) => url.substring(testRealmURL.length) + '.json');
    let path = paths.find((p) => p.includes('Pet/'));
    let fileRef = await testRealmAdapter.openFile(path!);
    assert.deepEqual(
      JSON.parse(fileRef!.content as string),
      {
        data: {
          attributes: {
            name: 'Mango',
            cardInfo: {
              title: null,
              description: null,
              thumbnailURL: null,
              notes: null,
            },
          },
          relationships: {
            'cardInfo.theme': {
              links: {
                self: null,
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: '../pet',
              name: 'Pet',
            },
          },
          type: 'card',
        },
      },
      'file contents were saved correctly',
    );
  });

  test<TestContextWithSave>('Clicking on "Finish Editing" after creating a card from linksTo field will switch the card into isolated mode', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}BlogPost/2`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/2"]`);
    await click('[data-test-edit-button]');
    assert.dom('[data-test-add-new="authorBio"]').exists();
    await click('[data-test-add-new="authorBio"]');
    await waitFor(`[data-test-card-catalog-modal]`);
    await click(`[data-test-card-catalog-create-new-button]`);
    await click(`[data-test-card-catalog-go-button]`);
    await waitFor('[data-test-stack-card-index="1"]');

    await click('[data-test-stack-card-index="1"] [data-test-edit-button]');

    await waitFor('[data-test-isolated-author]');
    assert.dom('[data-test-isolated-author]').exists();
  });

  test('displays card in interact mode when clicking `Open in Interact Mode` menu in preview panel', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(
      `[data-test-cards-grid-item="${testRealmURL}BlogPost/1"] .field-component-card`,
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/1"]`);
    await click(
      `[data-test-stack-card="${testRealmURL}BlogPost/1"] [data-test-edit-button]`,
    );

    await click(
      `[data-test-links-to-editor="authorBio"] [data-test-author="Alien"]`,
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}Author/1"]`);

    assert.dom(`[data-test-stack-card]`).exists({ count: 3 });
    assert.dom(`[data-test-stack-card="${testRealmURL}grid"]`).exists();
    assert.dom(`[data-test-stack-card="${testRealmURL}BlogPost/1"]`).exists();
    assert.dom(`[data-test-stack-card="${testRealmURL}Author/1"]`).exists();

    await click(
      '[data-test-submode-switcher] .submode-switcher-dropdown-trigger',
    );
    await click('[data-test-boxel-menu-item-text="Code"]');
    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').hasText('Code');

    await fillIn(
      '[data-test-card-url-bar-input]',
      `${testRealmURL}Pet/mango.json`,
    );
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );
    await blur('[data-test-card-url-bar-input]');
    assert
      .dom('[data-test-card-url-bar-realm-info]')
      .hasText('in Operator Mode Workspace');
    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}Pet/mango.json`);
    await click(`[data-test-more-options-button]`);
    await click(`[data-test-boxel-menu-item-text="Open in Interact Mode"]`);

    await waitFor(`[data-test-stack-card]`);
    assert.dom(`[data-test-stack-card]`).exists({ count: 2 });
    assert.dom(`[data-test-stack-card="${testRealmURL}index"]`).exists();
    assert.dom(`[data-test-stack-card="${testRealmURL}Pet/mango"]`).exists();
  });

  test('can reorder linksToMany cards in edit view without affecting other linksToMany cards', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(
      `[data-test-cards-grid-item="${testRealmURL}Person/burcu"] .field-component-card`,
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    assert
      .dom(
        `[data-test-plural-view-field="friends"] [data-test-plural-view-item]`,
      )
      .exists({ count: 3 });
    assert
      .dom(`[data-test-plural-view-field="cars"] [data-test-plural-view-item]`)
      .exists({ count: 2 });

    assert
      .dom(
        `[data-test-plural-view-field="friends"] [data-test-plural-view-item="0"]`,
      )
      .hasText('Jackie');
    assert
      .dom(
        `[data-test-plural-view-field="friends"] [data-test-plural-view-item="1"]`,
      )
      .hasText('Woody');
    assert
      .dom(
        `[data-test-plural-view-field="friends"] [data-test-plural-view-item="2"]`,
      )
      .hasText('Buzz');

    await click(
      `[data-test-stack-card="${testRealmURL}Person/burcu"] [data-test-edit-button]`,
    );
    assert
      .dom('[data-test-list="friends"] [data-test-item]')
      .exists({ count: 3 });

    assert
      .dom(
        `[data-test-list="friends"] [data-test-item="0"] [data-test-card="${testRealmURL}Pet/jackie"]`,
      )
      .exists();
    assert
      .dom(`[data-test-list="friends"] [data-test-item="0"]`)
      .hasText('Jackie');
    assert
      .dom(
        `[data-test-list="friends"] [data-test-item="1"] [data-test-card="${testRealmURL}Pet/woody"]`,
      )
      .exists();
    assert
      .dom(`[data-test-list="friends"] [data-test-item="1"]`)
      .hasText('Woody');
    assert
      .dom(
        `[data-test-list="friends"] [data-test-item="2"] [data-test-card="${testRealmURL}Pet/buzz"]`,
      )
      .exists();
    assert
      .dom(`[data-test-list="friends"] [data-test-item="2"]`)
      .hasText('Buzz');

    assert.dom('[data-test-list="cars"] [data-test-item]').exists({ count: 2 });
    assert.dom(`[data-test-list="cars"] [data-test-item="0"]`).hasText('Myvi');
    assert
      .dom(`[data-test-list="cars"] [data-test-item="1"]`)
      .hasText('Proton');

    let dragAndDrop = async (itemSelector: string, targetSelector: string) => {
      let itemElement = document.querySelector(itemSelector);
      let targetElement = document.querySelector(targetSelector);

      if (!itemElement || !targetElement) {
        throw new Error('Item or target element not found');
      }

      let itemRect = itemElement.getBoundingClientRect();
      let targetRect = targetElement.getBoundingClientRect();

      await triggerEvent(itemElement, 'mousedown', {
        clientX: itemRect.left + itemRect.width / 2,
        clientY: itemRect.top + itemRect.height / 2,
      });

      await triggerEvent(document, 'mousemove', {
        clientX: itemRect.left + 1,
        clientY: itemRect.top + 1,
      });

      let firstStackItemHeaderRect = document
        .querySelector('[data-test-operator-mode-stack="0"] header')!
        .getBoundingClientRect();
      let firstStackItemPaddingTop = getComputedStyle(
        document.querySelector('[data-test-operator-mode-stack="0"]')!,
      )
        .getPropertyValue('padding-top')
        .replace('px', '');
      let marginTop =
        firstStackItemHeaderRect.height + Number(firstStackItemPaddingTop);
      await triggerEvent(document, 'mousemove', {
        clientX: targetRect.left + targetRect.width / 2,
        clientY: targetRect.top - marginTop,
      });

      await triggerEvent(itemElement, 'mouseup', {
        clientX: targetRect.left + targetRect.width / 2,
        clientY: targetRect.top - marginTop,
      });
    };
    await dragAndDrop('[data-test-sort="1"]', '[data-test-sort="0"]');
    await dragAndDrop('[data-test-sort="2"]', '[data-test-sort="1"]');
    assert
      .dom('[data-test-list="friends"] [data-test-item]')
      .exists({ count: 3 });
    assert
      .dom(
        `[data-test-list="friends"] [data-test-item="0"] [data-test-card="${testRealmURL}Pet/woody"]`,
      )
      .exists();
    assert
      .dom(`[data-test-list="friends"] [data-test-item="0"]`)
      .hasText('Woody');
    assert
      .dom(
        `[data-test-list="friends"] [data-test-item="1"] [data-test-card="${testRealmURL}Pet/buzz"]`,
      )
      .exists();
    assert
      .dom(`[data-test-list="friends"] [data-test-item="1"]`)
      .hasText('Buzz');
    assert
      .dom(
        `[data-test-list="friends"] [data-test-item="2"] [data-test-card="${testRealmURL}Pet/jackie"]`,
      )
      .exists();
    assert
      .dom(`[data-test-list="friends"] [data-test-item="2"]`)
      .hasText('Jackie');

    await triggerEvent(`[data-test-item="0"]`, 'mouseenter');
    let itemElement = document.querySelector(
      `[data-test-list="friends"] [data-test-item="0"]`,
    );
    let overlayButtonElements = document.querySelectorAll(
      `[data-test-card="${testRealmURL}Pet/woody"]`,
    );
    if (
      !itemElement ||
      !overlayButtonElements ||
      overlayButtonElements.length === 0
    ) {
      throw new Error('Item or overlay button element not found');
    }

    let itemRect = itemElement.getBoundingClientRect();
    let overlayButtonRect =
      overlayButtonElements[
        overlayButtonElements.length - 1
      ].getBoundingClientRect();

    assert.strictEqual(
      Math.round(itemRect.top),
      Math.round(overlayButtonRect.top),
    );
    assert.strictEqual(
      Math.round(
        itemRect.left + 40 / 2,
      ) /* add icon width / 2 for testing scale */,
      Math.round(overlayButtonRect.left),
    );

    await click(
      `[data-test-stack-card="${testRealmURL}Person/burcu"] [data-test-edit-button]`,
    );
    assert
      .dom(
        `[data-test-plural-view-field="friends"] [data-test-plural-view-item="0"]`,
      )
      .hasText('Woody');
    assert
      .dom(
        `[data-test-plural-view-field="friends"] [data-test-plural-view-item="1"]`,
      )
      .hasText('Buzz');
    assert
      .dom(
        `[data-test-plural-view-field="friends"] [data-test-plural-view-item="2"]`,
      )
      .hasText('Jackie');

    assert
      .dom(
        `[data-test-plural-view-field="cars"] [data-test-plural-view-item="0"]`,
      )
      .hasText('Myvi');
    assert
      .dom(
        `[data-test-plural-view-field="cars"] [data-test-plural-view-item="1"]`,
      )
      .hasText('Proton');
  });

  test('can reorder containsMany cards in edit view without affecting other containsMany cards', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(
      `[data-test-cards-grid-item="${testRealmURL}Person/burcu"] .field-component-card`,
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    assert
      .dom(
        `[data-test-plural-view-field="nicknames"] [data-test-plural-view-item]`,
      )
      .exists({ count: 3 });
    assert
      .dom(
        `[data-test-plural-view-field="favoriteGames"] [data-test-plural-view-item]`,
      )
      .exists({ count: 2 });
    assert.dom(`[data-test-plural-view-field="nicknames"]`).containsText('Ace');
    assert
      .dom(`[data-test-plural-view-field="nicknames"]`)
      .containsText('Bolt');
    assert
      .dom(`[data-test-plural-view-field="nicknames"]`)
      .containsText('Comet');
    assert
      .dom(`[data-test-plural-view-field="favoriteGames"]`)
      .containsText('Chess');
    assert
      .dom(`[data-test-plural-view-field="favoriteGames"]`)
      .containsText('Go');

    await click(
      `[data-test-stack-card="${testRealmURL}Person/burcu"] [data-test-edit-button]`,
    );
    document
      .querySelector('[data-test-list="nicknames"]')
      ?.scrollIntoView({ block: 'center' });

    assert
      .dom('[data-test-list="nicknames"] [data-test-item]')
      .exists({ count: 3 });
    assert
      .dom('[data-test-list="favoriteGames"] [data-test-item]')
      .exists({ count: 2 });

    assert
      .dom(`[data-test-list="nicknames"] [data-test-item="0"] input`)
      .hasValue('Ace');
    assert
      .dom(`[data-test-list="nicknames"] [data-test-item="1"] input`)
      .hasValue('Bolt');
    assert
      .dom(`[data-test-list="nicknames"] [data-test-item="2"] input`)
      .hasValue('Comet');

    assert
      .dom(`[data-test-list="favoriteGames"] [data-test-item="0"] input`)
      .hasValue('Chess');
    assert
      .dom(`[data-test-list="favoriteGames"] [data-test-item="1"] input`)
      .hasValue('Go');

    let dragAndDrop = async (itemSelector: string, targetSelector: string) => {
      let itemElement = document.querySelector(itemSelector);
      let targetElement = document.querySelector(targetSelector);

      if (!itemElement || !targetElement) {
        throw new Error('Item or target element not found');
      }

      let itemRect = itemElement.getBoundingClientRect();
      let targetRect = targetElement.getBoundingClientRect();

      await triggerEvent(itemElement, 'mousedown', {
        clientX: itemRect.left + itemRect.width / 2,
        clientY: itemRect.top + itemRect.height / 2,
      });

      await triggerEvent(document, 'mousemove', {
        clientX: itemRect.left + 1,
        clientY: itemRect.top + 1,
      });

      let firstStackItemHeaderRect = document
        .querySelector('[data-test-operator-mode-stack="0"] header')!
        .getBoundingClientRect();
      let firstStackItemPaddingTop = getComputedStyle(
        document.querySelector('[data-test-operator-mode-stack="0"]')!,
      )
        .getPropertyValue('padding-top')
        .replace('px', '');
      let marginTop =
        firstStackItemHeaderRect.height + Number(firstStackItemPaddingTop);
      await triggerEvent(document, 'mousemove', {
        clientX: targetRect.left + targetRect.width / 2,
        clientY: targetRect.top - marginTop,
      });

      await triggerEvent(itemElement, 'mouseup', {
        clientX: targetRect.left + targetRect.width / 2,
        clientY: targetRect.top - marginTop,
      });
    };
    await dragAndDrop(
      '[data-test-list="nicknames"] [data-test-sort="1"]',
      '[data-test-list="nicknames"] [data-test-sort="0"]',
    );

    assert
      .dom('[data-test-list="nicknames"] [data-test-item]')
      .exists({ count: 3 });
    assert
      .dom(`[data-test-list="nicknames"] [data-test-item="0"] input`)
      .hasValue('Bolt');
    assert
      .dom(`[data-test-list="nicknames"] [data-test-item="1"] input`)
      .hasValue('Ace');
    assert
      .dom(`[data-test-list="nicknames"] [data-test-item="2"] input`)
      .hasValue('Comet');

    assert
      .dom(`[data-test-list="favoriteGames"] [data-test-item="0"] input`)
      .hasValue('Chess');
    assert
      .dom(`[data-test-list="favoriteGames"] [data-test-item="1"] input`)
      .hasValue('Go');

    await click(
      `[data-test-stack-card="${testRealmURL}Person/burcu"] [data-test-edit-button]`,
    );
    assert
      .dom(
        `[data-test-plural-view-field="nicknames"] [data-test-plural-view-item]`,
      )
      .exists({ count: 3 });
    assert
      .dom(`[data-test-plural-view-field="nicknames"]`)
      .containsText('Bolt');
    assert.dom(`[data-test-plural-view-field="nicknames"]`).containsText('Ace');
    assert
      .dom(`[data-test-plural-view-field="nicknames"]`)
      .containsText('Comet');

    assert
      .dom(
        `[data-test-plural-view-field="favoriteGames"] [data-test-plural-view-item]`,
      )
      .exists({ count: 2 });
    assert
      .dom(`[data-test-plural-view-field="favoriteGames"]`)
      .containsText('Chess');
    assert
      .dom(`[data-test-plural-view-field="favoriteGames"]`)
      .containsText('Go');
  });

  test('CardDef filter is not displayed in filter list', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await click('[data-test-boxel-filter-list-button="All Cards"]');
    assert
      .dom(`[data-test-cards-grid-item="${testRealmURL}Person/1"]`)
      .exists();
    assert
      .dom(`[data-test-cards-grid-item="${testRealmURL}CardDef/1"]`)
      .exists();
    assert.dom(`[data-test-boxel-filter-list-button="Person"]`).exists();
    assert.dom(`[data-test-boxel-filter-list-button="CardDef"]`).doesNotExist();
  });

  test('updates filter list when there is indexing event', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await click('[data-test-boxel-filter-list-button="All Cards"]');
    assert
      .dom(`[data-test-cards-grid-item="${testRealmURL}Person/1"]`)
      .exists();
    assert
      .dom(`[data-test-cards-grid-item="${testRealmURL}CardDef/1"]`)
      .exists();

    assert.dom(`[data-test-boxel-filter-list-button]`).exists({ count: 13 });
    assert.dom(`[data-test-boxel-filter-list-button="Skill"]`).doesNotExist();

    await click('[data-test-create-new-card-button]');
    await waitFor(`[data-test-card-catalog-item]`);
    await fillIn(`[data-test-search-field]`, `Skill`);
    await click(
      '[data-test-card-catalog-item="https://cardstack.com/base/cards/skill"]',
    );
    await click('[data-test-card-catalog-go-button]');

    await fillIn('[data-test-field="title"] input', 'New Skill');
    await click('[data-test-close-button]');

    assert.dom(`[data-test-boxel-filter-list-button]`).exists({ count: 14 });
    assert.dom(`[data-test-boxel-filter-list-button="Skill"]`).exists();

    await click('[data-test-boxel-filter-list-button="Skill"]');
    await triggerEvent(
      `[data-test-cards-grid-item] .field-component-card`,
      'mouseenter',
    );
    await click(`[data-test-overlay-card] [data-test-overlay-more-options]`);
    await click('[data-test-boxel-menu-item-text="Delete"]');

    await click('[data-test-confirm-delete-button]');

    assert.dom(`[data-test-boxel-filter-list-button]`).exists({ count: 13 });
    assert.dom(`[data-test-boxel-filter-list-button="Skill"]`).doesNotExist();
    assert
      .dom(`[data-test-filter-list-item="Highlights"] > span`)
      .hasClass('is-selected');
    assert.dom(`[data-test-selected-filter="Highlights"]`).exists({ count: 1 });
  });

  test('edit card and finish editing should not animate', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    // Check that no animation when clicking edit button
    await waitFor(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`);
    await click(
      `[data-test-stack-card="${testRealmURL}Person/fadhlan"] [data-test-edit-button]`,
    );
    assert
      .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`)
      .doesNotHaveClass('opening-animation');

    // Check that no animation after finish editing
    await click('[data-test-edit-button]');
    await waitFor(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`);
    assert
      .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`)
      .doesNotHaveClass('opening-animation');
  });

  test('close card should not trigger opening animation again', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);

    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(
      `[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"] .field-component-card`,
    );
    await click(`[data-test-stack-card-index="1"] [data-test-close-button]`);

    await waitFor(`[data-test-stack-card-index="0"]`);
    assert
      .dom(`[data-test-stack-card-index="0"]`)
      .doesNotHaveClass('opening-animation');
  });

  test('stack item with custom header color does not lose the color when opening other cards in the stack', async function (assert) {
    const cardId = `${testRealmURL}PublishingPacket/story`;
    const customStyle = {
      backgroundColor: 'rgb(102, 56, 255)',
      color: 'rgb(255, 255, 255)',
    };
    setCardInOperatorModeState(cardId);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    assert.dom(`[data-test-stack-card="${cardId}"]`).exists();
    assert
      .dom(`[data-stack-card="${cardId}"] [data-test-card-header]`)
      .hasStyle(customStyle);

    await click(`[data-test-card="${testRealmURL}BlogPost/1"]`);
    assert.dom(`[data-test-stack-card="${testRealmURL}BlogPost/1"]`).exists();
    assert
      .dom(
        `[data-stack-card="${testRealmURL}BlogPost/1"] [data-test-card-header]`,
      )
      .hasStyle({
        backgroundColor: 'rgb(255, 255, 255)',
        color: 'rgb(0, 0, 0)',
      });
    assert
      .dom(`[data-stack-card="${cardId}"] [data-test-card-header]`)
      .hasStyle(customStyle);

    await click(
      `[data-stack-card="${testRealmURL}BlogPost/1"] [data-test-close-button]`,
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/1"]`, {
      count: 0,
    });
    assert
      .dom(`[data-stack-card="${cardId}"] [data-test-card-header]`)
      .hasStyle(customStyle);
  });
});
