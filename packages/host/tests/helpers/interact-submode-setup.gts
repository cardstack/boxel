import { on } from '@ember/modifier';

import { getService } from '@universal-ember/test-support';

import { FieldContainer, GridContainer } from '@cardstack/boxel-ui/components';

import { baseRealm } from '@cardstack/runtime-common';
import type { Realm } from '@cardstack/runtime-common/realm';

import {
  SYSTEM_CARD_FIXTURE_CONTENTS,
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupOnSave,
  setupUserSubscription,
  testRealmURL,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

export const testRealm2URL = `http://test-realm/test2/`;
export const testRealm3URL = `http://test-realm/test3/`;
export const personalRealmURL = `http://test-realm/personal/`;

type InteractSubmodeSetupOptions = {
  setRealm: (realm: Realm) => void;
};

export function setupInteractSubmodeTests(
  hooks: NestedHooks,
  { setRealm }: InteractSubmodeSetupOptions,
) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL, testRealm2URL, testRealm3URL],
  });

  let { createAndJoinRoom, setActiveRealms, setRealmPermissions } =
    mockMatrixUtils;

  hooks.beforeEach(async function () {
    createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    setupAuthEndpoints();

    let loader = getService('loader-service').loader;
    let cardApi: typeof import('https://cardstack.com/base/card-api');
    let string: typeof import('https://cardstack.com/base/string');
    let spec: typeof import('https://cardstack.com/base/spec');
    let cardsGrid: typeof import('https://cardstack.com/base/cards-grid');
    let fileApi: typeof import('https://cardstack.com/base/file-api');
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);
    spec = await loader.import(`${baseRealm.url}spec`);
    cardsGrid = await loader.import(`${baseRealm.url}cards-grid`);
    fileApi = await loader.import(`${baseRealm.url}file-api`);

    let {
      field,
      contains,
      containsMany,
      linksTo,
      linksToMany,
      CardDef,
      Component,
      FieldDef,
    } = cardApi;
    let { default: StringField } = string;
    let { Spec } = spec;
    let { CardsGrid } = cardsGrid;
    let { FileDef } = fileApi;

    class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);
      @field favoriteTreat = contains(StringField);

      @field title = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.name;
        },
      });
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <h3 data-test-pet={{@model.name}}>
            <@fields.name />
          </h3>
        </template>
      };
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <GridContainer class='container'>
            <h2 data-test-pet-title><@fields.title /></h2>
            <div>
              <div>Favorite Treat: <@fields.favoriteTreat /></div>
              <div data-test-editable-meta>
                {{#if @canEdit}}
                  <@fields.title />
                  is editable.
                {{else}}
                  <@fields.title />
                  is NOT editable.
                {{/if}}
              </div>
            </div>
          </GridContainer>
        </template>
      };
    }

    class Puppy extends Pet {
      static displayName = 'Puppy';
      @field age = contains(StringField);
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
          <span data-test-preferredCarrier={{@model.preferredCarrier}}></span>
          <@fields.preferredCarrier />
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
          <h3 data-test-city={{@model.city}}>
            <@fields.city />
          </h3>
          <h3 data-test-country={{@model.country}}>
            <@fields.country />
          </h3>
          <div data-test-shippingInfo-field><@fields.shippingInfo /></div>

          <div data-test-editable-meta>
            {{#if @canEdit}}
              address is editable
            {{else}}
              address is NOT editable.
            {{/if}}
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

    class Person extends CardDef {
      static displayName = 'Person';
      @field firstName = contains(StringField);
      @field pet = linksTo(Pet);
      @field friends = linksToMany(Pet);
      @field firstLetterOfTheName = contains(StringField, {
        computeVia: function (this: Person) {
          if (!this.firstName) {
            return;
          }
          return this.firstName[0];
        },
      });
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field primaryAddress = contains(Address);
      @field additionalAddresses = containsMany(Address);

      static isolated = class Isolated extends Component<typeof this> {
        updateAndSavePet = () => {
          let pet = this.args.model.pet;
          if (pet) {
            pet.name = 'Updated Pet';
            this.args.saveCard?.(pet.id);
          }
        };
        <template>
          <h2 data-test-person={{@model.firstName}}>
            <@fields.firstName />
          </h2>
          <p data-test-first-letter-of-the-name={{@model.firstLetterOfTheName}}>
            <@fields.firstLetterOfTheName />
          </p>
          Pet:
          <div class='pet-container'>
            <@fields.pet />
          </div>
          Friends:
          <@fields.friends />
          Primary Address:
          <@fields.primaryAddress />
          Additional Adresses:
          <@fields.additionalAddresses />
          <button
            data-test-update-and-save-pet
            {{on 'click' this.updateAndSavePet}}
          >
            Update and Save Pet
          </button>
          <style scoped>
            .pet-container {
              height: 80px;
              padding: 10px;
            }
          </style>
        </template>
      };
    }

    class FileLinkCard extends CardDef {
      static displayName = 'File Link Card';
      @field title = contains(StringField);
      @field attachment = linksTo(FileDef);

      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2 data-test-file-link-card-title><@fields.title /></h2>
          <div data-test-file-link-attachment>
            <@fields.attachment />
          </div>
        </template>
      };
    }

    class Personnel extends Person {
      static displayName = 'Personnel';
    }

    class FocusTest extends CardDef {
      static displayName = 'Focus test';
      @field names = containsMany(StringField);
    }

    class FocusNestedItem extends FieldDef {
      static displayName = 'Focus nested item';
      @field label = contains(StringField);
      @field pets = linksToMany(Pet);
    }

    class FocusNested extends CardDef {
      static displayName = 'Focus nested';
      @field items = containsMany(FocusNestedItem);
    }

    let generateSpec = (
      fileName: string,
      title: string,
      ref: { module: string; name: string },
    ) => ({
      [`${fileName}.json`]: new Spec({
        title,
        description: `Spec for ${title}`,
        specType: 'card',
        ref,
      }),
    });
    let catalogEntries: Record<string, unknown> = {};
    for (let i = 0; i < 5; i++) {
      let entry = generateSpec(`p-${i + 1}`, `Personnel-${i + 1}`, {
        module: `${testRealmURL}personnel`,
        name: 'Personnel',
      });
      catalogEntries = { ...catalogEntries, ...entry };
    }

    let mangoPet = new Pet({ name: 'Mango' });

    let realm: Realm;
    ({ realm } = await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'address.gts': { Address },
        'focus-test.gts': { FocusTest },
        'focus-nested.gts': { FocusNested, FocusNestedItem },
        'file-link-card.gts': { FileLinkCard },
        'person.gts': { Person },
        'personnel.gts': { Personnel },
        'pet.gts': { Pet, Puppy },
        'shipping-info.gts': { ShippingInfo },
        'README.txt': `Hello World`,
        'FileLinkCard/notes.txt': 'Hello from a file link',
        'person-entry.json': new Spec({
          title: 'Person Card',
          description: 'Spec for Person Card',
          specType: 'card',
          ref: {
            module: `${testRealmURL}person`,
            name: 'Person',
          },
        }),
        'pet-entry.json': new Spec({
          title: 'Pet Card',
          description: 'Spec for Pet Card',
          specType: 'card',
          ref: {
            module: `${testRealmURL}pet`,
            name: 'Pet',
          },
        }),
        ...catalogEntries,
        'puppy-entry.json': new Spec({
          title: 'Puppy Card',
          description: 'Spec for Puppy Card',
          specType: 'card',
          ref: {
            module: `${testRealmURL}pet`,
            name: 'Puppy',
          },
        }),
        'Pet/mango.json': mangoPet,
        'Pet/vangogh.json': new Pet({ name: 'Van Gogh' }),
        'FocusTest/1.json': new FocusTest({ names: [] }),
        'FocusNested/1.json': new FocusNested({
          items: [
            new FocusNestedItem({ label: 'Plain', pets: [] }),
            new FocusNestedItem({ label: 'With Pet', pets: [mangoPet] }),
          ],
        }),
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
          additionalAddresses: [
            new Address({
              city: 'Jakarta',
              country: 'Indonesia',
              shippingInfo: new ShippingInfo({
                preferredCarrier: 'FedEx',
                remarks: `Make sure to deliver to the back door`,
              }),
            }),
            new Address({
              city: 'Bali',
              country: 'Indonesia',
              shippingInfo: new ShippingInfo({
                preferredCarrier: 'UPS',
                remarks: `Call ahead to make sure someone is home`,
              }),
            }),
          ],
          pet: mangoPet,
          friends: [mangoPet],
        }),
        'FileLinkCard/with-file.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'Linked file example',
            },
            relationships: {
              attachment: {
                links: {
                  self: './notes.txt',
                },
                data: {
                  type: 'file-meta',
                  id: './notes.txt',
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: '../file-link-card',
                name: 'FileLinkCard',
              },
            },
          },
        },
        'Puppy/marco.json': new Puppy({ name: 'Marco', age: '5 months' }),
        'grid.json': new CardsGrid(),
        'index.json': new CardsGrid(),
        '.realm.json': {
          name: 'Test Workspace B',
          backgroundURL:
            'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
          iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
        },
      },
    }));

    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      realmURL: testRealm2URL,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'index.json': new CardsGrid(),
        '.realm.json': {
          name: 'Test Workspace A',
          backgroundURL:
            'https://i.postimg.cc/tgRHRV8C/pawel-czerwinski-h-Nrd99q5pe-I-unsplash.jpg',
          iconURL: 'https://boxel-images.boxel.ai/icons/cardstack.png',
        },
        'Pet/ringo.json': new Pet({ name: 'Ringo' }),
        'Person/hassan.json': new Person({
          firstName: 'Hassan',
          pet: mangoPet,
          additionalAddresses: [
            new Address({
              city: 'New York',
              country: 'USA',
              shippingInfo: new ShippingInfo({
                preferredCarrier: 'DHL',
                remarks: `Don't let bob deliver the package--he's always bringing it to the wrong address`,
              }),
            }),
          ],
          friends: [mangoPet],
        }),
      },
    });

    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      realmURL: testRealm3URL,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'index.json': new CardsGrid(),
        '.realm.json': {
          name: 'Test Workspace C',
          backgroundURL:
            'https://boxel-images.boxel.ai/background-images/4k-powder-puff.jpg',
          iconURL: 'https://boxel-images.boxel.ai/icons/cardstack.png',
        },
      },
    });

    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      realmURL: personalRealmURL,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'index.json': new CardsGrid(),
        '.realm.json': {
          name: 'Test Personal Workspace',
          backgroundURL:
            'https://boxel-images.boxel.ai/background-images/4k-origami-flock.jpg',
          iconURL: 'https://boxel-images.boxel.ai/icons/cardstack.png',
        },
      },
    });

    setRealm(realm);
  });

  return { setActiveRealms, setRealmPermissions };
}
