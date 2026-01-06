import { getService } from '@universal-ember/test-support';

import { FieldContainer } from '@cardstack/boxel-ui/components';

import type {
  LooseSingleCardDocument,
  Realm,
  Loader,
} from '@cardstack/runtime-common';
import { baseRealm } from '@cardstack/runtime-common';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  setupOperatorModeStateCleanup,
} from '../../../helpers';

import { setupMockMatrix } from '../../../helpers/mock-matrix';
import { setupRenderingTest } from '../../../helpers/setup';

import type { TestRealmAdapter } from '../../../helpers/adapter';

export type OperatorModeTestSetup = {
  realmName: string;
  setCardInOperatorModeState: (
    cardURL?: string,
    format?: 'isolated' | 'edit',
  ) => void;
  readonly loader: Loader;
  readonly testRealm: Realm;
  readonly testRealmAdapter: TestRealmAdapter;
  readonly operatorModeStateService: OperatorModeStateService;
};

export function setupOperatorModeTests(
  hooks: NestedHooks,
): OperatorModeTestSetup {
  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);

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
        @field cardTitle = contains(StringField);
        @field friend = linksTo(() => FriendWithCSS);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <div class='friend'>
              <@fields.cardTitle />
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
      @field cardTitle = contains(StringField, {
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
      @field cardTitle = contains(StringField, {
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
      @field cardTitle = contains(StringField, {
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
      @field cardTitle = contains(StringField, {
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
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Author) {
          return [this.firstName, this.lastName].filter(Boolean).join(' ');
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-isolated-author>
            <@fields.cardTitle />
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
      @field cardTitle = contains(StringField);
      // Don't render the spec, it causes an error about constructors in the test
      // and isn't required.
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-spec-card-linker-isolated>
            The card is:
            <@fields.cardTitle />
            <br />
            Linked to:
            {{@model.spec.title}}
          </div>
        </template>
      };
    }

    class BlogPost extends CardDef {
      static displayName = 'Blog Post';
      @field cardTitle = contains(StringField);
      @field slug = contains(StringField);
      @field body = contains(TextAreaField);
      @field authorBio = linksTo(Author);
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <@fields.cardTitle /> by <@fields.authorBio />
        </template>
      };
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-blog-post-isolated>
            <@fields.cardTitle />
            by
            <@fields.authorBio />
          </div>
        </template>
      };
    }

    class ExplodingCard extends CardDef {
      static displayName = 'Exploding Card';
      @field name = contains(StringField);
      @field status = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: ExplodingCard) {
          if (this.status === 'boom') {
            throw new Error('Boom!');
          }
          return this.name;
        },
      });
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
      @field cardTitle = contains(StringField, {
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
      cardTitle: 'Outer Space Journey',
      body: 'Hello world',
      authorBio: author1,
    });
    let explodingCard = new ExplodingCard({
      name: 'Stable Example',
      status: 'ok',
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
          'exploding-card.gts': { ExplodingCard },
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
                cardTitle: 'Spec Card Linker',
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
                cardTitle: 'Jade',
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
                cardTitle: 'Hassan',
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
                cardTitle: 'Boris',
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
            cardTitle: 'Publishing Packet',
            cardDescription: 'Spec for PublishingPacket',
            specType: 'card',
            ref: {
              module: `${testRealmURL}publishing-packet`,
              name: 'PublishingPacket',
            },
          }),
          'Spec/pet-room.json': new Spec({
            cardTitle: 'General Pet Room',
            cardDescription: 'Spec for Pet Room Card',
            specType: 'card',
            ref: {
              module: `${testRealmURL}pet-room`,
              name: 'PetRoom',
            },
          }),
          'Spec/pet-card.json': new Spec({
            cardTitle: 'Pet',
            cardDescription: 'Spec for Pet',
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
          'BlogPost/2.json': new BlogPost({ cardTitle: 'Beginnings' }),
          'ExplodingCard/1.json': explodingCard,
          'CardDef/1.json': new CardDef({ cardTitle: 'CardDef instance' }),
          'PublishingPacket/story.json': new PublishingPacket({
            cardTitle: 'Space Story',
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

  return {
    realmName,
    setCardInOperatorModeState,
    get loader() {
      return loader;
    },
    get testRealm() {
      return testRealm;
    },
    get testRealmAdapter() {
      return testRealmAdapter;
    },
    get operatorModeStateService() {
      return operatorModeStateService;
    },
  };
}
