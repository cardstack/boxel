import { visit } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import {
  baseRealm,
  type PrerenderMeta,
  type RenderRouteOptions,
} from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  capturePrerenderResult,
  setupSnapshotRealm,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

module('Acceptance | prerender | meta', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
  });
  let defaultMatrixRoomId: string;
  let snapshot = setupSnapshotRealm(hooks, {
    mockMatrixUtils,
    acceptanceTest: true,
    async build({ loader, isInitialBuild }) {
      if (isInitialBuild || !defaultMatrixRoomId) {
        defaultMatrixRoomId = mockMatrixUtils.createAndJoinRoom({
          sender: '@testuser:localhost',
          name: 'room-test',
        });
      }

      let cardApi: typeof import('https://cardstack.com/base/card-api');
      cardApi = await loader.import(`${baseRealm.url}card-api`);

      let {
        field,
        contains,
        containsMany,
        linksTo,
        linksToMany,
        CardDef,
        FieldDef,
        StringField,
        Component,
      } = cardApi;

      class EmergencyContact extends FieldDef {
        @field phone = contains(StringField);
        @field contact = linksTo(() => Person);
        static embedded = class Embedded extends Component<
          typeof EmergencyContact
        > {
          <template>
            <@fields.contact />
            <@fields.phone />
          </template>
        };
      }

      class Pet extends CardDef {
        static displayName = 'Pet';
        @field name = contains(StringField);
        @field title = contains(StringField, {
          computeVia(this: Pet) {
            return `${this.name}`;
          },
        });
      }

      class Cat extends Pet {
        static displayName = 'Cat';
        @field aliases = containsMany(StringField);
        @field emergencyContacts = containsMany(EmergencyContact);
      }

      class Person extends CardDef {
        static displayName = 'Person';
        @field name = contains(StringField);
        @field pets = linksToMany(() => Pet);
        @field friend = linksTo(() => Person);
        @field title = contains(StringField, {
          computeVia(this: Person) {
            return this.name;
          },
        });
        @field numOfPets = contains(StringField, {
          computeVia(this: Person) {
            return String(Array.isArray(this.pets) ? this.pets.length : 0);
          },
        });
      }

      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        loader,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'person.gts': { Person },
          'pet.gts': { Pet },
          'cat.gts': { Cat },
          'Pet/mango.json': {
            data: {
              attributes: { name: 'Mango' },
              meta: {
                adoptsFrom: {
                  module: '../pet',
                  name: 'Pet',
                },
              },
            },
          },
          'Pet/vangogh.json': {
            data: {
              attributes: { name: 'Van Gogh' },
              meta: {
                adoptsFrom: {
                  module: '../pet',
                  name: 'Pet',
                },
              },
            },
          },
          'Pet/paper.json': {
            data: {
              attributes: {
                name: 'Paper',
                aliases: ['Satan', "Satan's Mistress"],
              },
              meta: {
                adoptsFrom: {
                  module: '../cat',
                  name: 'Cat',
                },
              },
            },
          },
          'Pet/broken.json': {
            data: {
              attributes: {
                name: 'Bad Serialization',
              },
              meta: {
                adoptsFrom: {
                  module: '../cat',
                  // intentionally missing "name" prop
                },
              },
            },
          },
          'Pet/molly.json': {
            data: {
              attributes: {
                name: 'Molly',
                emergencyContacts: [{ phone: '01234' }, { phone: '56789' }],
              },
              relationships: {
                'emergencyContacts.0.contact': {
                  links: {
                    self: '../Person/jade',
                  },
                },
                'emergencyContacts.1.contact': {
                  links: {
                    self: '../Person/hassan',
                  },
                },
              },
              meta: {
                adoptsFrom: {
                  module: '../cat',
                  name: 'Cat',
                },
              },
            },
          },
          'Person/hassan.json': {
            data: {
              attributes: {
                name: 'Hassan',
              },
              relationships: {
                'pets.0': {
                  links: {
                    self: '../Pet/mango',
                  },
                },
                'pets.1': {
                  links: {
                    self: '../Pet/vangogh',
                  },
                },
                'pets.2': {
                  links: {
                    self: '../Pet/paper',
                  },
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
          'Person/jade.json': {
            data: {
              attributes: {
                name: 'Jade',
              },
              relationships: {
                friend: {
                  links: {
                    self: './hassan',
                  },
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
        },
      });
      return {};
    },
  });

  const DEFAULT_RENDER_OPTIONS_SEGMENT = encodeURIComponent(
    JSON.stringify({ clearCache: true } as RenderRouteOptions),
  );
  const renderPath = (url: string, suffix: string, nonce = 0) =>
    `/render/${encodeURIComponent(
      url,
    )}/${nonce}/${DEFAULT_RENDER_OPTIONS_SEGMENT}${suffix}`;

  hooks.beforeEach(function () {
    snapshot.get();
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__boxelRenderContext;
  });

  test('can generate serialized instance', async function (assert) {
    let url = `${testRealmURL}Person/hassan.json`;
    await visit(renderPath(url, '/meta'));
    let { value } = await capturePrerenderResult('textContent');
    let meta: PrerenderMeta = JSON.parse(value);
    assert.deepEqual(
      meta.serialized,
      {
        data: {
          type: 'card',
          id: `${testRealmURL}Person/hassan`,
          attributes: {
            name: 'Hassan',
            title: 'Hassan',
            cardInfo: {
              title: null,
              description: null,
              thumbnailURL: null,
              notes: null,
            },
            description: null,
            thumbnailURL: null,
            numOfPets: '3',
          },
          relationships: {
            'pets.0': {
              links: {
                self: '../Pet/mango',
              },
            },
            'pets.1': {
              links: {
                self: '../Pet/vangogh',
              },
            },
            'pets.2': {
              links: {
                self: '../Pet/paper',
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: '../person',
              name: 'Person',
            },
            realmURL: testRealmURL,
          },
        },
      },
      'serialized instance is correct',
    );
  });

  test('can generate display name', async function (assert) {
    let url = `${testRealmURL}Pet/paper.json`;
    await visit(renderPath(url, '/meta'));
    let { value } = await capturePrerenderResult('textContent');
    let meta: PrerenderMeta = JSON.parse(value);
    assert.deepEqual(
      meta.displayNames,
      ['Cat', 'Pet', 'Card'],
      'display names are correct',
    );
  });

  test('can generate deps', async function (assert) {
    let url = `${testRealmURL}Pet/paper.json`;
    await visit(renderPath(url, '/meta'));
    let { value } = await capturePrerenderResult('textContent');
    let meta: PrerenderMeta = JSON.parse(value);
    // note that we cannot derive deps for shimmed modules (better tests for this are on the server)
    assert.deepEqual(
      [...meta.deps!],
      ['http://test-realm/test/cat'],
      'deps are correct',
    );
  });

  test('can generate type hierarchy', async function (assert) {
    let url = `${testRealmURL}Pet/paper.json`;
    await visit(renderPath(url, '/meta'));
    let { value } = await capturePrerenderResult('textContent');
    let meta: PrerenderMeta = JSON.parse(value);
    assert.deepEqual(
      meta.types,
      [
        `${testRealmURL}cat/Cat`,
        `${testRealmURL}pet/Pet`,
        `${baseRealm.url}card-api/CardDef`,
      ],
      'types are correct',
    );
  });

  test('can generate search doc that includes contains field', async function (assert) {
    let url = `${testRealmURL}Pet/mango.json`;
    await visit(renderPath(url, '/meta'));
    let { value } = await capturePrerenderResult('textContent');
    let meta: PrerenderMeta = JSON.parse(value);
    assert.deepEqual(
      meta.searchDoc,
      {
        id: `${testRealmURL}Pet/mango`,
        _cardType: 'Pet',
        cardInfo: {},
        name: 'Mango',
        title: 'Mango',
      },
      'search doc is correct',
    );
  });

  test('can generate search doc that includes containsMany field', async function (assert) {
    let url = `${testRealmURL}Pet/paper.json`;
    await visit(renderPath(url, '/meta'));
    let { value } = await capturePrerenderResult('textContent');
    let meta: PrerenderMeta = JSON.parse(value);
    assert.deepEqual(
      meta.searchDoc,
      {
        id: `${testRealmURL}Pet/paper`,
        _cardType: 'Cat',
        cardInfo: {},
        name: 'Paper',
        title: 'Paper',
        aliases: ['Satan', "Satan's Mistress"],
        emergencyContacts: null,
      },
      'search doc is correct',
    );
  });

  test('can generate search doc that includes linksTo field', async function (assert) {
    let url = `${testRealmURL}Person/jade.json`;
    // note that you need to visit the html route first which will pull on all the linked fields
    await visit(renderPath(url, '/html/isolated/0'));
    await visit(renderPath(url, '/meta'));
    let { value } = await capturePrerenderResult('textContent');
    let meta: PrerenderMeta = JSON.parse(value);
    assert.deepEqual(
      meta.searchDoc,
      {
        id: `${testRealmURL}Person/jade`,
        _cardType: 'Person',
        cardInfo: {
          theme: null,
        },
        name: 'Jade',
        title: 'Jade',
        pets: null,
        numOfPets: '0',
        friend: {
          id: `${testRealmURL}Person/hassan`,
          cardInfo: {
            theme: null,
          },
          name: 'Hassan',
          title: 'Hassan',
          numOfPets: '3',
          pets: [
            {
              id: `${testRealmURL}Pet/mango`,
            },
            {
              id: `${testRealmURL}Pet/vangogh`,
            },
            {
              id: `${testRealmURL}Pet/paper`,
            },
          ],
        },
      },
      'search doc is correct',
    );
  });

  test('can generate search doc that includes linksToMany field', async function (assert) {
    let url = `${testRealmURL}Person/hassan.json`;
    await visit(renderPath(url, '/html/isolated/0'));
    await visit(renderPath(url, '/meta'));
    let { value } = await capturePrerenderResult('textContent');
    let meta: PrerenderMeta = JSON.parse(value);
    assert.deepEqual(
      meta.searchDoc,
      {
        id: `${testRealmURL}Person/hassan`,
        _cardType: 'Person',
        cardInfo: {
          theme: null,
        },
        name: 'Hassan',
        title: 'Hassan',
        friend: null,
        numOfPets: '3',
        pets: [
          {
            id: `${testRealmURL}Pet/mango`,
            name: 'Mango',
            title: 'Mango',
            cardInfo: {
              theme: null,
            },
          },
          {
            id: `${testRealmURL}Pet/vangogh`,
            name: 'Van Gogh',
            title: 'Van Gogh',
            cardInfo: {
              theme: null,
            },
          },
          {
            id: `${testRealmURL}Pet/paper`,
            name: 'Paper',
            title: 'Paper',
            aliases: ['Satan', "Satan's Mistress"],
            emergencyContacts: null,
            cardInfo: {
              theme: null,
            },
          },
        ],
      },
      'search doc is correct',
    );
  });

  test('can generate search doc that includes compound field', async function (assert) {
    let url = `${testRealmURL}Pet/molly.json`;
    await visit(renderPath(url, '/html/isolated/0'));
    await visit(renderPath(url, '/meta'));
    let { value } = await capturePrerenderResult('textContent');
    let meta: PrerenderMeta = JSON.parse(value);
    assert.deepEqual(
      meta.searchDoc,
      {
        _cardType: 'Cat',
        aliases: null,
        cardInfo: {
          theme: null,
        },
        emergencyContacts: [
          {
            phone: '01234',
            contact: {
              id: `${testRealmURL}Person/jade`,
              name: 'Jade',
              title: 'Jade',
              numOfPets: '0',
              pets: null,
              cardInfo: {
                theme: null,
              },
              friend: {
                id: `${testRealmURL}Person/hassan`,
              },
            },
          },
          {
            phone: '56789',
            contact: {
              id: `${testRealmURL}Person/hassan`,
              name: 'Hassan',
              title: 'Hassan',
              cardInfo: {
                theme: null,
              },
              numOfPets: '3',
              pets: [
                {
                  id: `${testRealmURL}Pet/mango`,
                },
                {
                  id: `${testRealmURL}Pet/vangogh`,
                },
                {
                  id: `${testRealmURL}Pet/paper`,
                },
              ],
            },
          },
        ],
        id: `${testRealmURL}Pet/molly`,
        name: 'Molly',
        title: 'Molly',
      },
      'search doc is correct',
    );
  });
});
