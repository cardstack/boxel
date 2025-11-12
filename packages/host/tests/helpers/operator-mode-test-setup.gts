import { getService } from '@universal-ember/test-support';

import { FieldContainer } from '@cardstack/boxel-ui/components';

import {
  baseRealm,
  LooseSingleCardDocument,
  Realm,
} from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { TestRealmAdapter } from './adapter';

import { setupMockMatrix } from './mock-matrix';

import { setupRenderingTest } from './setup';

import {
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
} from './index';

interface OperatorModeTestContext {
  realmName: string;
  get loader(): Loader;
  get testRealm(): Realm;
  get testRealmAdapter(): TestRealmAdapter;
  get operatorModeStateService(): OperatorModeStateService;
  noop: () => void;
  setCardInOperatorModeState: (
    cardURL?: string,
    format?: 'isolated' | 'edit',
  ) => void;
}

export default function setupOperatorModeTest(
  hooks: NestedHooks,
): OperatorModeTestContext {
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
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-publishing-packet>
            Publishing packet
            <@fields.blogPost />
          </div>
        </template>
      };
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <div data-test-publishing-packet>Publishing packet</div>
        </template>
      };
    }

    class PetRoom extends CardDef {
      static displayName = 'Pet Room';
      @field pet = linksTo(Pet);
      @field occupant = linksTo(Person);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-pet-room>
            Pet room
            <@fields.pet />
            <@fields.occupant />
          </div>
        </template>
      };
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
          'Pet/jackie.json': petJackie,
          'Pet/woody.json': petWoody,
          'Pet/buzz.json': petBuzz,
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
                  module: '../spec-card-linker',
                  name: 'SpecCardLinker',
                },
              },
            },
          } as LooseSingleCardDocument,
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

  return {
    realmName,
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
    noop,
    setCardInOperatorModeState,
  };
}
