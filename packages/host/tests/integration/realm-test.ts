import { RenderingTestContext } from '@ember/test-helpers';

import { setupRenderingTest } from 'ember-qunit';
import { stringify } from 'qs';
import { module, test } from 'qunit';

import { validate as uuidValidate } from 'uuid';

import { baseRealm, CodeRef } from '@cardstack/runtime-common';
import { isSingleCardDocument } from '@cardstack/runtime-common/card-document';
import {
  cardSrc,
  compiledCard,
} from '@cardstack/runtime-common/etc/test-fixtures';

import stripScopedCSSGlimmerAttributes from '@cardstack/runtime-common/helpers/strip-scoped-css-glimmer-attributes';
import { Loader } from '@cardstack/runtime-common/loader';

import type LoaderService from '@cardstack/host/services/loader-service';

import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type * as StringFieldMod from 'https://cardstack.com/base/string';

import {
  testRealmURL,
  testRealmInfo,
  setupCardLogs,
  setupLocalIndexing,
  setupServerSentEvents,
  type TestContextWithSSE,
  setupIntegrationTestRealm,
} from '../helpers';

import '@cardstack/runtime-common/helpers/code-equality-assertion';

let loader: Loader;

module('Integration | realm', function (hooks) {
  setupRenderingTest(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
  });
  setupServerSentEvents(hooks);
  setupLocalIndexing(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  test('realm can serve GET card requests', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'dir/empty.json': {
          data: {
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/card-api',
                name: 'CardDef',
              },
            },
          },
        },
      },
    });

    let response = await realm.handle(
      new Request(`${testRealmURL}dir/empty`, {
        headers: {
          Accept: 'application/vnd.card+json',
        },
      }),
    );

    assert.strictEqual(response.status, 200, 'successful http status');
    let json = await response.json();
    assert.deepEqual(json, {
      data: {
        type: 'card',
        id: `${testRealmURL}dir/empty`,
        attributes: {
          title: null,
          description: null,
          thumbnailURL: null,
        },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/card-api',
            name: 'CardDef',
          },
          lastModified: adapter.lastModified.get(
            `${testRealmURL}dir/empty.json`,
          ),
          realmInfo: testRealmInfo,
          realmURL: testRealmURL,
        },
        links: {
          self: `${testRealmURL}dir/empty`,
        },
      },
    });
    assert.ok(json.data.meta.lastModified, 'lastModified is populated');
  });

  test('realm can serve GET card requests with linksTo relationships', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'dir/owner.json': {
          data: {
            id: `${testRealmURL}dir/owner`,
            attributes: {
              firstName: 'Hassan',
              lastName: 'Abdel-Rahman',
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/person',
                name: 'Person',
              },
            },
          },
        },
        'dir/mango.json': {
          data: {
            id: `${testRealmURL}dir/mango`,
            attributes: {
              description: null,
              thumbnailURL: null,
              firstName: 'Mango',
            },
            relationships: {
              owner: {
                links: {
                  self: `${testRealmURL}dir/owner`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/pet',
                name: 'Pet',
              },
            },
          },
        },
      },
    });

    let response = await realm.handle(
      new Request(`${testRealmURL}dir/mango`, {
        headers: {
          Accept: 'application/vnd.card+json',
        },
      }),
    );
    assert.strictEqual(response.status, 200, 'successful http status');
    let json = await response.json();
    assert.deepEqual(json, {
      data: {
        type: 'card',
        id: `${testRealmURL}dir/mango`,
        attributes: {
          firstName: 'Mango',
          title: 'Mango',
          description: null,
          thumbnailURL: null,
        },
        relationships: {
          owner: {
            links: {
              self: `./owner`,
            },
            data: {
              type: 'card',
              id: `${testRealmURL}dir/owner`,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: 'http://localhost:4202/test/pet',
            name: 'Pet',
          },
          lastModified: adapter.lastModified.get(
            `${testRealmURL}dir/mango.json`,
          ),
          realmInfo: testRealmInfo,
          realmURL: testRealmURL,
        },
        links: {
          self: `${testRealmURL}dir/mango`,
        },
      },
      included: [
        {
          type: 'card',
          id: `${testRealmURL}dir/owner`,
          attributes: {
            email: null,
            posts: null,
            thumbnailURL: null,
            firstName: 'Hassan',
            lastName: 'Abdel-Rahman',
            title: 'Hassan Abdel-Rahman',
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/person',
              name: 'Person',
            },
            lastModified: adapter.lastModified.get(
              `${testRealmURL}dir/owner.json`,
            ),
            realmInfo: testRealmInfo,
            realmURL: testRealmURL,
          },
          links: {
            self: `${testRealmURL}dir/owner`,
          },
        },
      ],
    });
  });

  test('realm can serve GET card requests with linksTo relationships to other realms', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'dir/mango.json': {
          data: {
            id: `${testRealmURL}dir/mango`,
            attributes: {
              description: null,
              thumbnailURL: null,
              firstName: 'Mango',
            },
            relationships: {
              owner: {
                links: {
                  self: `http://localhost:4202/test/hassan`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/pet',
                name: 'Pet',
              },
            },
          },
        },
      },
    });

    let response = await realm.handle(
      new Request(`${testRealmURL}dir/mango`, {
        headers: {
          Accept: 'application/vnd.card+json',
        },
      }),
    );
    assert.strictEqual(response.status, 200, 'successful http status');
    let json = await response.json();
    let { included = [] } = json;
    delete included[0]?.meta.lastModified;
    assert.deepEqual(json, {
      data: {
        type: 'card',
        id: `${testRealmURL}dir/mango`,
        attributes: {
          firstName: 'Mango',
          title: 'Mango',
          description: null,
          thumbnailURL: null,
        },
        relationships: {
          owner: {
            links: {
              self: `http://localhost:4202/test/hassan`,
            },
            data: {
              type: 'card',
              id: `http://localhost:4202/test/hassan`,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: 'http://localhost:4202/test/pet',
            name: 'Pet',
          },
          lastModified: adapter.lastModified.get(
            `${testRealmURL}dir/mango.json`,
          ),
          realmInfo: testRealmInfo,
          realmURL: testRealmURL,
        },
        links: {
          self: `${testRealmURL}dir/mango`,
        },
      },
      included: [
        {
          type: 'card',
          id: `http://localhost:4202/test/hassan`,
          attributes: {
            email: null,
            posts: null,
            thumbnailURL: null,
            firstName: 'Hassan',
            lastName: 'Abdel-Rahman',
            title: 'Hassan Abdel-Rahman',
          },
          meta: {
            adoptsFrom: {
              module: './person',
              name: 'Person',
            },
            realmInfo: {
              name: 'Test Workspace A',
              backgroundURL:
                'https://i.postimg.cc/tgRHRV8C/pawel-czerwinski-h-Nrd99q5pe-I-unsplash.jpg',
              iconURL: 'https://i.postimg.cc/d0B9qMvy/icon.png',
            },
            realmURL: 'http://localhost:4202/test/',
          },
          links: {
            self: `http://localhost:4202/test/hassan`,
          },
        },
      ],
    });
  });

  test("realm can route requests correctly when mounted in the origin's subdir", async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'dir/empty.json': {
          data: {
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/card-api',
                name: 'CardDef',
              },
            },
          },
        },
      },
      realmURL: `${testRealmURL}root/`,
    });
    {
      let response = await realm.handle(
        new Request(`${testRealmURL}root/dir/empty`, {
          headers: {
            Accept: 'application/vnd.card+json',
          },
        }),
      );
      assert.strictEqual(response.status, 200, 'successful http status');
      let json = await response.json();
      assert.strictEqual(
        json.data.id,
        `${testRealmURL}root/dir/empty`,
        'card ID is correct',
      );
    }
    {
      let response = await realm.handle(
        new Request(`${testRealmURL}root/_search`, {
          headers: {
            Accept: 'application/vnd.card+json',
          },
        }),
      );
      let json = await response.json();
      assert.strictEqual(
        json.data.length,
        1,
        'the card is returned in the search results',
      );
      assert.strictEqual(
        json.data[0].id,
        `${testRealmURL}root/dir/empty`,
        'card ID is correct',
      );
    }
  });

  test('realm can serve create card requests', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      loader,
      contents: {},
    });
    let response = await realm.handle(
      new Request(testRealmURL, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.card+json',
        },
        body: JSON.stringify(
          {
            data: {
              type: 'card',
              meta: {
                adoptsFrom: {
                  module: 'https://cardstack.com/base/card-api',
                  name: 'CardDef',
                },
              },
            },
          },
          null,
          2,
        ),
      }),
    );
    let json = await response.json();
    let id: string | undefined;
    if (isSingleCardDocument(json)) {
      id = json.data.id.split('/').pop()!;
      assert.true(uuidValidate(id), 'card ID is a UUID');
      assert.strictEqual(
        json.data.id,
        `${testRealmURL}CardDef/${id}`,
        'the card URL is correct',
      );
      assert.ok(
        (await adapter.openFile(`CardDef/${id}.json`))?.content,
        'file contents exist',
      );
    } else {
      assert.ok(false, 'response body is not a card document');
    }
    if (!id) {
      assert.ok(false, 'card document is missing an ID');
    }

    let searchIndex = realm.searchIndex;
    let result = await searchIndex.card(new URL(json.data.links.self));
    if (result?.type === 'error') {
      throw new Error(
        `unexpected error when getting card from index: ${result.error.detail}`,
      );
    }
    assert.strictEqual(
      result?.doc.data.id,
      `${testRealmURL}CardDef/${id}`,
      'found card in index',
    );
  });

  test('realm can serve POST requests that include linksTo fields', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'dir/owner.json': {
          data: {
            id: `${testRealmURL}dir/owner`,
            attributes: {
              firstName: 'Hassan',
              lastName: 'Abdel-Rahman',
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/person',
                name: 'Person',
              },
            },
          },
        },
      },
    });
    let response = await realm.handle(
      new Request(testRealmURL, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.card+json',
        },
        body: JSON.stringify(
          {
            data: {
              attributes: {
                firstName: 'Mango',
              },
              relationships: {
                owner: {
                  links: {
                    self: `${testRealmURL}dir/owner`,
                  },
                },
              },
              meta: {
                adoptsFrom: {
                  module: 'http://localhost:4202/test/pet',
                  name: 'Pet',
                },
              },
            },
          },
          null,
          2,
        ),
      }),
    );
    assert.strictEqual(response.status, 201, 'successful http status');
    let json = await response.json();
    let id = json.data.id.split('/').pop()!;
    assert.ok(uuidValidate(id), 'card ID is a UUID');
    assert.deepEqual(json, {
      data: {
        type: 'card',
        id: `${testRealmURL}Pet/${id}`,
        attributes: {
          firstName: 'Mango',
          title: 'Mango',
          description: null,
          thumbnailURL: null,
        },
        relationships: {
          owner: {
            links: {
              self: `../dir/owner`,
            },
            data: {
              type: 'card',
              id: `${testRealmURL}dir/owner`,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: 'http://localhost:4202/test/pet',
            name: 'Pet',
          },
          lastModified: adapter.lastModified.get(
            `${testRealmURL}Pet/${id}.json`,
          ),
          realmInfo: testRealmInfo,
          realmURL: testRealmURL,
        },
        links: {
          self: `${testRealmURL}Pet/${id}`,
        },
      },
      included: [
        {
          type: 'card',
          id: `${testRealmURL}dir/owner`,
          attributes: {
            email: null,
            posts: null,
            thumbnailURL: null,
            firstName: 'Hassan',
            lastName: 'Abdel-Rahman',
            title: 'Hassan Abdel-Rahman',
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/person',
              name: 'Person',
            },
            lastModified: adapter.lastModified.get(
              `${testRealmURL}dir/owner.json`,
            ),
            realmInfo: testRealmInfo,
            realmURL: testRealmURL,
          },
          links: {
            self: `${testRealmURL}dir/owner`,
          },
        },
      ],
    });
    let fileRef = await adapter.openFile(`Pet/${id}.json`);
    if (!fileRef) {
      throw new Error('file not found');
    }
    assert.deepEqual(
      JSON.parse(fileRef.content as string),
      {
        data: {
          type: 'card',
          attributes: {
            description: null,
            thumbnailURL: null,
            firstName: 'Mango',
          },
          relationships: {
            owner: {
              links: {
                self: `../dir/owner`,
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/pet',
              name: 'Pet',
            },
          },
        },
      },
      'file contents are correct',
    );
  });

  test<TestContextWithSSE>('realm can serve patch card requests', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'dir/card.json': {
          data: {
            attributes: {
              firstName: 'Mango',
              lastName: 'Abdel-Rahman',
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/person',
                name: 'Person',
              },
            },
          },
        },
      },
    });
    let expectedEvents = [
      {
        type: 'index',
        data: {
          type: 'incremental',
          invalidations: [`${testRealmURL}dir/card`],
        },
      },
    ];
    let response = await this.expectEvents({
      assert,
      realm,
      expectedEvents,
      callback: async () => {
        let response = realm.handle(
          new Request(`${testRealmURL}dir/card`, {
            method: 'PATCH',
            headers: {
              Accept: 'application/vnd.card+json',
            },
            body: JSON.stringify(
              {
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Van Gogh',
                  },
                  meta: {
                    adoptsFrom: {
                      module: 'http://localhost:4202/test/person',
                      name: 'Person',
                    },
                  },
                },
              },
              null,
              2,
            ),
          }),
        );
        await Promise.all([realm.flushOperations(), realm.flushUpdateEvents()]);
        return await response;
      },
    });
    assert.strictEqual(response.status, 200, 'successful http status');
    let json = await response.json();
    if (isSingleCardDocument(json)) {
      assert.strictEqual(
        json.data.id,
        `${testRealmURL}dir/card`,
        'the id is correct',
      );
      assert.strictEqual(
        json.data.attributes?.firstName,
        'Van Gogh',
        'field value is correct',
      );
      assert.strictEqual(
        json.data.attributes?.lastName,
        'Abdel-Rahman',
        'field value is correct',
      );
      assert.strictEqual(
        json.data.meta.lastModified,
        adapter.lastModified.get(`${testRealmURL}dir/card.json`),
        'lastModified is correct',
      );
      let fileRef = await adapter.openFile('dir/card.json');
      if (!fileRef) {
        throw new Error('file not found');
      }
      assert.deepEqual(
        JSON.parse(fileRef.content as string),
        {
          data: {
            type: 'card',
            attributes: {
              email: null,
              posts: null,
              thumbnailURL: null,
              firstName: 'Van Gogh',
              lastName: 'Abdel-Rahman',
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/person',
                name: 'Person',
              },
            },
          },
        },
        'file contents are correct',
      );
    } else {
      assert.ok(false, 'response body is not a card document');
    }

    let searchIndex = realm.searchIndex;
    let result = await searchIndex.card(new URL(json.data.links.self));
    if (result?.type === 'error') {
      throw new Error(
        `unexpected error when getting card from index: ${result.error.detail}`,
      );
    }
    assert.strictEqual(
      result?.doc.data.id,
      `${testRealmURL}dir/card`,
      'found card in index',
    );
    assert.strictEqual(
      result?.doc.data.attributes?.firstName,
      'Van Gogh',
      'field value is correct',
    );
    assert.strictEqual(
      result?.doc.data.attributes?.lastName,
      'Abdel-Rahman',
      'field value is correct',
    );

    let { data: cards } = await searchIndex.search({
      filter: {
        on: { module: `http://localhost:4202/test/person`, name: 'Person' },
        eq: { firstName: 'Van Gogh' },
      },
    });

    assert.strictEqual(cards.length, 1, 'search finds updated value');
  });

  test('realm can remove item from containsMany field via PATCH request', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'ski-trip.json': {
          data: {
            attributes: {
              title: 'Gore Mountain Ski Trip',
              venue: 'Gore Mountain',
              startTime: '2023-02-18T10:00:00.000Z',
              endTime: '2023-02-19T02:00:00.000Z',
              hosts: [{ firstName: 'Hassan' }, { firstName: 'Mango' }],
              sponsors: ['Burton', 'Spy Optics'],
              posts: [],
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/booking',
                name: 'Booking',
              },
            },
          },
        },
      },
    });
    let response = await realm.handle(
      new Request(`${testRealmURL}ski-trip`, {
        method: 'PATCH',
        headers: {
          Accept: 'application/vnd.card+json',
        },
        body: JSON.stringify(
          {
            data: {
              type: 'card',
              attributes: {
                hosts: [
                  {
                    firstName: 'Hassan',
                    lastName: null,
                  },
                ],
                sponsors: ['Burton'],
              },
              meta: {
                adoptsFrom: {
                  module: 'http://localhost:4202/test/booking',
                  name: 'Booking',
                },
              },
            },
          },
          null,
          2,
        ),
      }),
    );
    assert.strictEqual(response.status, 200, 'successful http status');
    let json = await response.json();
    assert.deepEqual(json, {
      data: {
        type: 'card',
        id: `${testRealmURL}ski-trip`,
        links: {
          self: `${testRealmURL}ski-trip`,
        },
        attributes: {
          title: 'Gore Mountain Ski Trip',
          venue: 'Gore Mountain',
          startTime: '2023-02-18T10:00:00.000Z',
          endTime: '2023-02-19T02:00:00.000Z',
          hosts: [
            {
              firstName: 'Hassan',
              lastName: null,
              title: 'Hassan ',
              email: null,
              posts: null,
            },
          ],
          sponsors: ['Burton'],
          posts: [],
          description: 'Gore Mountain',
          thumbnailURL: null,
        },
        meta: {
          adoptsFrom: {
            module: 'http://localhost:4202/test/booking',
            name: 'Booking',
          },
          lastModified: adapter.lastModified.get(
            `${testRealmURL}ski-trip.json`,
          ),
          realmInfo: testRealmInfo,
          realmURL: testRealmURL,
        },
      },
    });
    let fileRef = await adapter.openFile('ski-trip.json');
    if (!fileRef) {
      throw new Error('file not found');
    }
    assert.deepEqual(
      JSON.parse(fileRef.content as string),
      {
        data: {
          type: 'card',
          attributes: {
            title: 'Gore Mountain Ski Trip',
            venue: 'Gore Mountain',
            startTime: '2023-02-18T10:00:00.000Z',
            endTime: '2023-02-19T02:00:00.000Z',
            hosts: [
              {
                firstName: 'Hassan',
                lastName: null,
                email: null,
                posts: null,
              },
            ],
            sponsors: ['Burton'],
            posts: [],
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/booking',
              name: 'Booking',
            },
          },
        },
      },
      'file contents are correct',
    );
  });

  test('realm can remove item from linksToMany field via PATCH request', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'dir/van-gogh.json': {
          data: {
            id: `${testRealmURL}dir/van-gogh`,
            attributes: { firstName: 'Van Gogh' },
            relationships: { owner: { links: { self: null } } },
            meta: {
              adoptsFrom: {
                module: `http://localhost:4202/test/pet`,
                name: 'Pet',
              },
            },
          },
        },
        'dir/mango.json': {
          data: {
            id: `${testRealmURL}dir/mango`,
            attributes: { firstName: 'Mango' },
            relationships: { owner: { links: { self: null } } },
            meta: {
              adoptsFrom: {
                module: `http://localhost:4202/test/pet`,
                name: 'Pet',
              },
            },
          },
        },
        'dir/friend.json': {
          data: {
            id: `${testRealmURL}dir/friend`,
            attributes: { firstName: 'Hassan', lastName: 'Abdel-Rahman' },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/person',
                name: 'Person',
              },
            },
          },
        },
        'jackie.json': {
          data: {
            id: `${testRealmURL}jackie`,
            attributes: { firstName: 'Jackie' },
            relationships: {
              'pets.0': { links: { self: `${testRealmURL}dir/van-gogh` } },
              friend: { links: { self: `${testRealmURL}dir/friend` } },
            },
            meta: {
              adoptsFrom: {
                module: `http://localhost:4202/test/pet-person`,
                name: 'PetPerson',
              },
            },
          },
        },
      },
    });
    let response = await realm.handle(
      new Request(`${testRealmURL}jackie`, {
        method: 'PATCH',
        headers: {
          Accept: 'application/vnd.card+json',
        },
        body: JSON.stringify(
          {
            data: {
              type: 'card',
              relationships: {
                'pets.0': { links: { self: `${testRealmURL}dir/van-gogh` } },
              },
              meta: {
                adoptsFrom: {
                  module: `http://localhost:4202/test/pet-person`,
                  name: 'PetPerson',
                },
              },
            },
          },
          null,
          2,
        ),
      }),
    );
    assert.strictEqual(response.status, 200, 'successful http status');
    let json = await response.json();
    assert.deepEqual(json, {
      data: {
        type: 'card',
        id: `${testRealmURL}jackie`,
        links: { self: `${testRealmURL}jackie` },
        attributes: {
          firstName: 'Jackie',
          title: 'Jackie Pet Person',
          description: 'A person with pets',
          thumbnailURL: null,
        },
        relationships: {
          'pets.0': {
            links: { self: `./dir/van-gogh` },
            data: {
              id: `${testRealmURL}dir/van-gogh`,
              type: 'card',
            },
          },
          friend: {
            links: { self: `./dir/friend` },
            data: {
              id: `${testRealmURL}dir/friend`,
              type: 'card',
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `http://localhost:4202/test/pet-person`,
            name: 'PetPerson',
          },
          lastModified: adapter.lastModified.get(`${testRealmURL}jackie.json`),
          realmInfo: testRealmInfo,
          realmURL: testRealmURL,
        },
      },
      included: [
        {
          type: 'card',
          id: `${testRealmURL}dir/friend`,
          links: { self: `${testRealmURL}dir/friend` },
          attributes: {
            email: null,
            posts: null,
            thumbnailURL: null,
            firstName: 'Hassan',
            lastName: 'Abdel-Rahman',
            title: 'Hassan Abdel-Rahman',
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/person',
              name: 'Person',
            },
            lastModified: adapter.lastModified.get(
              `${testRealmURL}dir/friend.json`,
            ),
            realmInfo: testRealmInfo,
            realmURL: testRealmURL,
          },
        },
        {
          type: 'card',
          id: `${testRealmURL}dir/van-gogh`,
          links: { self: `${testRealmURL}dir/van-gogh` },
          attributes: {
            firstName: 'Van Gogh',
            title: 'Van Gogh',
            description: null,
            thumbnailURL: null,
          },
          relationships: { owner: { links: { self: null } } },
          meta: {
            adoptsFrom: {
              module: `http://localhost:4202/test/pet`,
              name: 'Pet',
            },
            lastModified: adapter.lastModified.get(
              `${testRealmURL}dir/van-gogh.json`,
            ),
            realmInfo: testRealmInfo,
            realmURL: testRealmURL,
          },
        },
      ],
    });
    let fileRef = await adapter.openFile('jackie.json');
    if (!fileRef) {
      throw new Error('file not found');
    }
    assert.deepEqual(
      JSON.parse(fileRef.content as string),
      {
        data: {
          type: 'card',
          attributes: { firstName: 'Jackie' },
          relationships: {
            'pets.0': { links: { self: `./dir/van-gogh` } },
            friend: { links: { self: `./dir/friend` } },
          },
          meta: {
            adoptsFrom: {
              module: `http://localhost:4202/test/pet-person`,
              name: 'PetPerson',
            },
          },
        },
      },
      'file contents are correct',
    );
  });

  test('realm can add an item to linksToMany relationships via PATCH request', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'dir/van-gogh.json': {
          data: {
            id: `${testRealmURL}dir/van-gogh`,
            attributes: { firstName: 'Van Gogh' },
            relationships: { owner: { links: { self: null } } },
            meta: {
              adoptsFrom: {
                module: `http://localhost:4202/test/pet`,
                name: 'Pet',
              },
            },
          },
        },
        'dir/mango.json': {
          data: {
            id: `${testRealmURL}dir/mango`,
            attributes: { firstName: 'Mango' },
            relationships: { owner: { links: { self: null } } },
            meta: {
              adoptsFrom: {
                module: `http://localhost:4202/test/pet`,
                name: 'Pet',
              },
            },
          },
        },
        'dir/friend.json': {
          data: {
            id: `${testRealmURL}dir/friend`,
            attributes: { firstName: 'Hassan', lastName: 'Abdel-Rahman' },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/person',
                name: 'Person',
              },
            },
          },
        },
        'jackie.json': {
          data: {
            id: `${testRealmURL}jackie`,
            attributes: { firstName: 'Jackie' },
            relationships: {
              'pets.0': { links: { self: `${testRealmURL}dir/van-gogh` } },
              friend: { links: { self: `${testRealmURL}dir/friend` } },
            },
            meta: {
              adoptsFrom: {
                module: `http://localhost:4202/test/pet-person`,
                name: 'PetPerson',
              },
            },
          },
        },
      },
    });

    let response = await realm.handle(
      new Request(`${testRealmURL}jackie`, {
        method: 'PATCH',
        headers: { Accept: 'application/vnd.card+json' },
        body: JSON.stringify(
          {
            data: {
              type: 'card',
              relationships: {
                'pets.0': { links: { self: `${testRealmURL}dir/mango` } },
                'pets.1': { links: { self: `${testRealmURL}dir/van-gogh` } },
              },
              meta: {
                adoptsFrom: {
                  module: `http://localhost:4202/test/pet-person`,
                  name: 'PetPerson',
                },
              },
            },
          },
          null,
          2,
        ),
      }),
    );
    assert.strictEqual(response.status, 200, 'successful http status');
    let json = await response.json();

    assert.deepEqual(json.data, {
      type: 'card',
      id: `${testRealmURL}jackie`,
      links: { self: `${testRealmURL}jackie` },
      attributes: {
        firstName: 'Jackie',
        title: 'Jackie Pet Person',
        description: 'A person with pets',
        thumbnailURL: null,
      },
      relationships: {
        'pets.0': {
          links: { self: `./dir/mango` },
          data: {
            id: `${testRealmURL}dir/mango`,
            type: 'card',
          },
        },
        'pets.1': {
          links: { self: `./dir/van-gogh` },
          data: {
            id: `${testRealmURL}dir/van-gogh`,
            type: 'card',
          },
        },
        friend: {
          links: { self: `./dir/friend` },
          data: {
            id: `${testRealmURL}dir/friend`,
            type: 'card',
          },
        },
      },
      meta: {
        adoptsFrom: {
          module: `http://localhost:4202/test/pet-person`,
          name: 'PetPerson',
        },
        lastModified: adapter.lastModified.get(`${testRealmURL}jackie.json`),
        realmInfo: testRealmInfo,
        realmURL: testRealmURL,
      },
    });
  });

  test('realm can add items to null linksToMany relationship via PATCH request', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'dir/van-gogh.json': {
          data: {
            id: `${testRealmURL}dir/van-gogh`,
            attributes: { firstName: 'Van Gogh' },
            relationships: { owner: { links: { self: null } } },
            meta: {
              adoptsFrom: {
                module: `http://localhost:4202/test/pet`,
                name: 'Pet',
              },
            },
          },
        },
        'dir/mango.json': {
          data: {
            id: `${testRealmURL}dir/mango`,
            attributes: { firstName: 'Mango' },
            relationships: { owner: { links: { self: null } } },
            meta: {
              adoptsFrom: {
                module: `http://localhost:4202/test/pet`,
                name: 'Pet',
              },
            },
          },
        },
        'jackie.json': {
          data: {
            id: `${testRealmURL}jackie`,
            attributes: { firstName: 'Jackie' },
            relationships: {
              pets: { links: { self: null } },
            },
            meta: {
              adoptsFrom: {
                module: `http://localhost:4202/test/pet-person`,
                name: 'PetPerson',
              },
            },
          },
        },
      },
    });

    let response = await realm.handle(
      new Request(`${testRealmURL}jackie`, {
        method: 'PATCH',
        headers: { Accept: 'application/vnd.card+json' },
        body: JSON.stringify(
          {
            data: {
              type: 'card',
              relationships: {
                'pets.0': { links: { self: `${testRealmURL}dir/mango` } },
                'pets.1': { links: { self: `${testRealmURL}dir/van-gogh` } },
              },
              meta: {
                adoptsFrom: {
                  module: `http://localhost:4202/test/pet-person`,
                  name: 'PetPerson',
                },
              },
            },
          },
          null,
          2,
        ),
      }),
    );
    assert.strictEqual(response.status, 200, 'successful http status');
    let json = await response.json();

    assert.deepEqual(json.data, {
      type: 'card',
      id: `${testRealmURL}jackie`,
      links: { self: `${testRealmURL}jackie` },
      attributes: {
        firstName: 'Jackie',
        title: 'Jackie Pet Person',
        description: 'A person with pets',
        thumbnailURL: null,
      },
      relationships: {
        'pets.0': {
          links: { self: `./dir/mango` },
          data: { id: `${testRealmURL}dir/mango`, type: 'card' },
        },
        'pets.1': {
          links: { self: `./dir/van-gogh` },
          data: { id: `${testRealmURL}dir/van-gogh`, type: 'card' },
        },
        friend: { links: { self: null } },
      },
      meta: {
        adoptsFrom: {
          module: `http://localhost:4202/test/pet-person`,
          name: 'PetPerson',
        },
        lastModified: adapter.lastModified.get(`${testRealmURL}jackie.json`),
        realmInfo: testRealmInfo,
        realmURL: testRealmURL,
      },
    });
  });

  test('realm can remove all items to in a linksToMany relationship via PATCH request', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'dir/van-gogh.json': {
          data: {
            id: `${testRealmURL}dir/van-gogh`,
            attributes: { firstName: 'Van Gogh' },
            relationships: { owner: { links: { self: null } } },
            meta: {
              adoptsFrom: {
                module: `http://localhost:4202/test/pet`,
                name: 'Pet',
              },
            },
          },
        },
        'dir/mango.json': {
          data: {
            id: `${testRealmURL}dir/mango`,
            attributes: { firstName: 'Mango' },
            relationships: { owner: { links: { self: null } } },
            meta: {
              adoptsFrom: {
                module: `http://localhost:4202/test/pet`,
                name: 'Pet',
              },
            },
          },
        },
        'jackie.json': {
          data: {
            id: `${testRealmURL}jackie`,
            attributes: { firstName: 'Jackie' },
            relationships: {
              'pets.0': { links: { self: `${testRealmURL}dir/mango` } },
              'pets.1': { links: { self: `${testRealmURL}dir/van-gogh` } },
            },
            meta: {
              adoptsFrom: {
                module: `http://localhost:4202/test/pet-person`,
                name: 'PetPerson',
              },
            },
          },
        },
      },
    });

    let response = await realm.handle(
      new Request(`${testRealmURL}jackie`, {
        method: 'PATCH',
        headers: { Accept: 'application/vnd.card+json' },
        body: JSON.stringify(
          {
            data: {
              type: 'card',
              relationships: { pets: { links: { self: null } } },
              meta: {
                adoptsFrom: {
                  module: `http://localhost:4202/test/pet-person`,
                  name: 'PetPerson',
                },
              },
            },
          },
          null,
          2,
        ),
      }),
    );
    assert.strictEqual(response.status, 200, 'successful http status');
    let json = await response.json();

    assert.deepEqual(json.data, {
      type: 'card',
      id: `${testRealmURL}jackie`,
      links: { self: `${testRealmURL}jackie` },
      attributes: {
        firstName: 'Jackie',
        title: 'Jackie Pet Person',
        description: 'A person with pets',
        thumbnailURL: null,
      },
      relationships: {
        pets: { links: { self: null } },
        friend: { links: { self: null } },
      },
      meta: {
        adoptsFrom: {
          module: `http://localhost:4202/test/pet-person`,
          name: 'PetPerson',
        },
        lastModified: adapter.lastModified.get(`${testRealmURL}jackie.json`),
        realmInfo: testRealmInfo,
        realmURL: testRealmURL,
      },
    });
  });

  test('realm can serve PATCH requests to linksTo field in a card that also has a linksToMany field', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'dir/van-gogh.json': {
          data: {
            id: `${testRealmURL}dir/van-gogh`,
            attributes: { firstName: 'Van Gogh' },
            relationships: { owner: { links: { self: null } } },
            meta: {
              adoptsFrom: {
                module: `http://localhost:4202/test/pet`,
                name: 'Pet',
              },
            },
          },
        },
        'dir/friend.json': {
          data: {
            id: `${testRealmURL}dir/friend`,
            attributes: { firstName: 'Hassan', lastName: 'Abdel-Rahman' },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/person',
                name: 'Person',
              },
            },
          },
        },
        'dir/different-friend.json': {
          data: {
            id: `${testRealmURL}dir/friend`,
            attributes: { firstName: 'Burcu' },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/person',
                name: 'Person',
              },
            },
          },
        },
        'jackie.json': {
          data: {
            id: `${testRealmURL}jackie`,
            attributes: { firstName: 'Jackie' },
            relationships: {
              'pets.0': { links: { self: `${testRealmURL}dir/van-gogh` } },
              friend: { links: { self: `${testRealmURL}dir/friend` } },
            },
            meta: {
              adoptsFrom: {
                module: `http://localhost:4202/test/pet-person`,
                name: 'PetPerson',
              },
            },
          },
        },
      },
    });

    // changing linksTo field only
    let response = await realm.handle(
      new Request(`${testRealmURL}jackie`, {
        method: 'PATCH',
        headers: { Accept: 'application/vnd.card+json' },
        body: JSON.stringify(
          {
            data: {
              type: 'card',
              relationships: {
                friend: {
                  links: { self: `${testRealmURL}dir/different-friend` },
                },
              },
              meta: {
                adoptsFrom: {
                  module: `http://localhost:4202/test/pet-person`,
                  name: 'PetPerson',
                },
              },
            },
          },
          null,
          2,
        ),
      }),
    );
    assert.strictEqual(response.status, 200, 'successful http status');
    let json = await response.json();

    assert.deepEqual(json.data, {
      type: 'card',
      id: `${testRealmURL}jackie`,
      links: { self: `${testRealmURL}jackie` },
      attributes: {
        firstName: 'Jackie',
        title: 'Jackie Pet Person',
        description: 'A person with pets',
        thumbnailURL: null,
      },
      relationships: {
        'pets.0': {
          links: { self: `./dir/van-gogh` },
          data: { id: `${testRealmURL}dir/van-gogh`, type: 'card' },
        },
        friend: {
          links: { self: `./dir/different-friend` },
          data: { id: `${testRealmURL}dir/different-friend`, type: 'card' },
        },
      },
      meta: {
        adoptsFrom: {
          module: `http://localhost:4202/test/pet-person`,
          name: 'PetPerson',
        },
        lastModified: adapter.lastModified.get(`${testRealmURL}jackie.json`),
        realmInfo: testRealmInfo,
        realmURL: testRealmURL,
      },
    });
  });

  test('realm can serve PATCH requests to both linksTo and linksToMany fields', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'dir/van-gogh.json': {
          data: {
            id: `${testRealmURL}dir/van-gogh`,
            attributes: { firstName: 'Van Gogh' },
            relationships: { owner: { links: { self: null } } },
            meta: {
              adoptsFrom: {
                module: `http://localhost:4202/test/pet`,
                name: 'Pet',
              },
            },
          },
        },
        'dir/mango.json': {
          data: {
            id: `${testRealmURL}dir/mango`,
            attributes: { firstName: 'Mango' },
            relationships: { owner: { links: { self: null } } },
            meta: {
              adoptsFrom: {
                module: `http://localhost:4202/test/pet`,
                name: 'Pet',
              },
            },
          },
        },
        'dir/friend.json': {
          data: {
            id: `${testRealmURL}dir/friend`,
            attributes: { firstName: 'Hassan', lastName: 'Abdel-Rahman' },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/person',
                name: 'Person',
              },
            },
          },
        },
        'dir/different-friend.json': {
          data: {
            id: `${testRealmURL}dir/friend`,
            attributes: { firstName: 'Burcu' },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/person',
                name: 'Person',
              },
            },
          },
        },
        'jackie.json': {
          data: {
            id: `${testRealmURL}jackie`,
            attributes: { firstName: 'Jackie' },
            relationships: {
              'pets.0': { links: { self: `${testRealmURL}dir/van-gogh` } },
              friend: { links: { self: `${testRealmURL}dir/friend` } },
            },
            meta: {
              adoptsFrom: {
                module: `http://localhost:4202/test/pet-person`,
                name: 'PetPerson',
              },
            },
          },
        },
      },
    });

    let response = await realm.handle(
      new Request(`${testRealmURL}jackie`, {
        method: 'PATCH',
        headers: { Accept: 'application/vnd.card+json' },
        body: JSON.stringify(
          {
            data: {
              type: 'card',
              relationships: {
                pets: {
                  links: { self: null },
                },
                friend: {
                  links: { self: `${testRealmURL}dir/different-friend` },
                },
              },
              meta: {
                adoptsFrom: {
                  module: `http://localhost:4202/test/pet-person`,
                  name: 'PetPerson',
                },
              },
            },
          },
          null,
          2,
        ),
      }),
    );
    assert.strictEqual(response.status, 200, 'successful http status');
    let json = await response.json();

    assert.deepEqual(json.data, {
      type: 'card',
      id: `${testRealmURL}jackie`,
      links: { self: `${testRealmURL}jackie` },
      attributes: {
        firstName: 'Jackie',
        title: 'Jackie Pet Person',
        description: 'A person with pets',
        thumbnailURL: null,
      },
      relationships: {
        pets: {
          links: { self: null },
        },
        friend: {
          links: { self: `./dir/different-friend` },
          data: { id: `${testRealmURL}dir/different-friend`, type: 'card' },
        },
      },
      meta: {
        adoptsFrom: {
          module: `http://localhost:4202/test/pet-person`,
          name: 'PetPerson',
        },
        lastModified: adapter.lastModified.get(`${testRealmURL}jackie.json`),
        realmInfo: testRealmInfo,
        realmURL: testRealmURL,
      },
    });
  });

  test('realm can serve PATCH requests that include linksTo fields', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'dir/hassan.json': {
          data: {
            id: `${testRealmURL}dir/hassan`,
            attributes: {
              firstName: 'Hassan',
              lastName: 'Abdel-Rahman',
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/person',
                name: 'Person',
              },
            },
          },
        },
        'dir/mariko.json': {
          data: {
            id: `${testRealmURL}dir/mariko`,
            attributes: {
              firstName: 'Mariko',
              lastName: 'Abdel-Rahman',
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/person',
                name: 'Person',
              },
            },
          },
        },
        'dir/mango.json': {
          data: {
            id: `${testRealmURL}dir/mango`,
            attributes: {
              description: null,
              thumbnailURL: null,
              firstName: 'Mango',
            },
            relationships: {
              owner: {
                links: {
                  self: `${testRealmURL}dir/hassan`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/pet',
                name: 'Pet',
              },
            },
          },
        },
      },
    });
    let response = await realm.handle(
      new Request(`${testRealmURL}dir/mango`, {
        method: 'PATCH',
        headers: {
          Accept: 'application/vnd.card+json',
        },
        body: JSON.stringify(
          {
            data: {
              type: 'card',
              relationships: {
                owner: {
                  links: {
                    self: `${testRealmURL}dir/mariko`,
                  },
                },
              },
              meta: {
                adoptsFrom: {
                  module: 'http://localhost:4202/test/person',
                  name: 'Person',
                },
              },
            },
          },
          null,
          2,
        ),
      }),
    );

    assert.strictEqual(response.status, 200, 'successful http status');
    let json = await response.json();
    assert.deepEqual(json, {
      data: {
        type: 'card',
        id: `${testRealmURL}dir/mango`,
        attributes: {
          firstName: 'Mango',
          title: 'Mango',
          description: null,
          thumbnailURL: null,
        },
        relationships: {
          owner: {
            links: {
              self: `./mariko`,
            },
            data: {
              type: 'card',
              id: `${testRealmURL}dir/mariko`,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: 'http://localhost:4202/test/pet',
            name: 'Pet',
          },
          lastModified: adapter.lastModified.get(
            `${testRealmURL}dir/mango.json`,
          ),
          realmInfo: testRealmInfo,
          realmURL: testRealmURL,
        },
        links: {
          self: `${testRealmURL}dir/mango`,
        },
      },
      included: [
        {
          type: 'card',
          id: `${testRealmURL}dir/mariko`,
          attributes: {
            firstName: 'Mariko',
            lastName: 'Abdel-Rahman',
            title: 'Mariko Abdel-Rahman',
            email: null,
            posts: null,
            thumbnailURL: null,
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/person',
              name: 'Person',
            },
            lastModified: adapter.lastModified.get(
              `${testRealmURL}dir/mariko.json`,
            ),
            realmInfo: testRealmInfo,
            realmURL: testRealmURL,
          },
          links: {
            self: `${testRealmURL}dir/mariko`,
          },
        },
      ],
    });
    let fileRef = await adapter.openFile('dir/mango.json');
    if (!fileRef) {
      throw new Error('file not found');
    }
    assert.deepEqual(
      JSON.parse(fileRef.content as string),
      {
        data: {
          type: 'card',
          attributes: {
            description: null,
            thumbnailURL: null,
            firstName: 'Mango',
          },
          relationships: {
            owner: {
              links: {
                self: `./mariko`,
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/pet',
              name: 'Pet',
            },
          },
        },
      },
      'file contents are correct',
    );
  });

  test<TestContextWithSSE>('realm can serve delete card requests', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'cards/1.json': {
          data: {
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/card-api',
                name: 'CardDef',
              },
            },
          },
        },
        'cards/2.json': {
          data: {
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/card-api',
                name: 'CardDef',
              },
            },
          },
        },
      },
    });

    let searchIndex = realm.searchIndex;

    let { data: cards } = await searchIndex.search({});
    assert.strictEqual(cards.length, 2, 'two cards found');

    let result = await searchIndex.card(new URL(`${testRealmURL}cards/2`));
    if (result?.type === 'error') {
      throw new Error(
        `unexpected error when getting card from index: ${result.error.detail}`,
      );
    }
    assert.strictEqual(
      result?.doc.data.id,
      `${testRealmURL}cards/2`,
      'found card in index',
    );

    let expectedEvents = [
      {
        type: 'index',
        data: {
          type: 'incremental',
          invalidations: [`${testRealmURL}cards/2`],
        },
      },
    ];
    let response = await this.expectEvents({
      assert,
      realm,
      expectedEvents,
      callback: async () => {
        let response = realm.handle(
          new Request(`${testRealmURL}cards/2`, {
            method: 'DELETE',
            headers: {
              Accept: 'application/vnd.card+json',
            },
          }),
        );
        await Promise.all([realm.flushOperations(), realm.flushUpdateEvents()]);
        return await response;
      },
    });
    assert.strictEqual(response.status, 204, 'status was 204');

    result = await searchIndex.card(new URL(`${testRealmURL}cards/2`));
    assert.strictEqual(result, undefined, 'card was deleted');

    result = await searchIndex.card(new URL(`${testRealmURL}cards/1`));
    if (result?.type === 'error') {
      throw new Error(
        `unexpected error when getting card from index: ${result.error.detail}`,
      );
    }
    assert.strictEqual(
      result?.doc.data.id,
      `${testRealmURL}cards/1`,
      'card 1 is still there',
    );

    cards = (await searchIndex.search({})).data;
    assert.strictEqual(cards.length, 1, 'only one card remains');
  });

  test('realm can serve card source file', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'dir/person.gts': cardSrc,
      },
    });
    let response = await realm.handle(
      new Request(`${testRealmURL}dir/person.gts`, {
        headers: {
          Accept: 'application/vnd.card+source',
        },
      }),
    );
    assert.strictEqual(response.status, 200, '200 HTTP status');
    let responseText = await response.text();
    assert.strictEqual(responseText, cardSrc, 'the card source is correct');
    assert.ok(
      response.headers.get('last-modified'),
      'last-modified header exists',
    );
  });

  test('realm provide redirect for card source', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'dir/person.gts': cardSrc,
      },
    });
    let response = await realm.handle(
      new Request(`${testRealmURL}dir/person`, {
        headers: {
          Accept: 'application/vnd.card+source',
        },
      }),
    );
    assert.strictEqual(response.status, 302, '302 HTTP status');
    assert.strictEqual(
      response.headers.get('Location'),
      '/test/dir/person.gts',
      'Location header is correct',
    );
  });

  test('realm returns 404 when no card source can be found', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      loader,
      contents: {},
    });
    let response = await realm.handle(
      new Request(`${testRealmURL}dir/person`, {
        headers: {
          Accept: 'application/vnd.card+source',
        },
      }),
    );
    assert.strictEqual(response.status, 404, '404 HTTP status');
  });

  test<TestContextWithSSE>('realm can serve card source post request', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      loader,
      contents: {},
    });

    {
      let expectedEvents = [
        {
          type: 'index',
          data: {
            type: 'incremental',
            invalidations: [`${testRealmURL}dir/person.gts`],
          },
        },
      ];
      let response = await this.expectEvents({
        assert,
        realm,
        expectedEvents,
        callback: async () => {
          let response = realm.handle(
            new Request(`${testRealmURL}dir/person.gts`, {
              method: 'POST',
              headers: {
                Accept: 'application/vnd.card+source',
              },
              body: cardSrc,
            }),
          );
          await Promise.all([
            realm.flushOperations(),
            realm.flushUpdateEvents(),
          ]);
          return await response;
        },
      });

      assert.strictEqual(response.status, 204, 'HTTP status is 204');
      assert.ok(
        response.headers.get('last-modified'),
        'last-modified header exists',
      );
    }
    {
      let response = await realm.handle(
        new Request(`${testRealmURL}dir/person.gts`, {
          headers: {
            Accept: 'application/vnd.card+source',
          },
        }),
      );
      assert.strictEqual(response.status, 200, '200 HTTP status');
      let responseText = await response.text();
      assert.strictEqual(responseText, cardSrc, 'the card source is correct');
    }
  });

  test<TestContextWithSSE>('realm can serve card source delete request', async function (assert) {
    let { field, contains, CardDef } = await loader.import<typeof CardAPI>(
      'https://cardstack.com/base/card-api',
    );
    let { default: StringField } = await loader.import<typeof StringFieldMod>(
      'https://cardstack.com/base/string',
    );

    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field lastName = contains(StringField);
    }

    let { realm } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'person.gts': { Person },
      },
    });

    let expectedEvents = [
      {
        type: 'index',
        data: {
          type: 'incremental',
          invalidations: [`${testRealmURL}person.gts`],
        },
      },
    ];
    let response = await this.expectEvents({
      assert,
      realm,
      expectedEvents,
      callback: async () => {
        let response = realm.handle(
          new Request(`${testRealmURL}person`, {
            headers: {
              Accept: 'application/vnd.card+source',
            },
          }),
        );
        await Promise.all([realm.flushOperations(), realm.flushUpdateEvents()]);
        assert.strictEqual((await response).status, 302, 'file exists');

        response = realm.handle(
          new Request(`${testRealmURL}person`, {
            method: 'DELETE',
            headers: {
              Accept: 'application/vnd.card+source',
            },
          }),
        );
        await Promise.all([realm.flushOperations(), realm.flushUpdateEvents()]);
        return await response;
      },
    });
    assert.strictEqual(response.status, 204, 'file is deleted');

    response = await realm.handle(
      new Request(`${testRealmURL}person`, {
        headers: {
          Accept: 'application/vnd.card+source',
        },
      }),
    );
    assert.strictEqual(response.status, 404, 'file no longer exists');
  });

  test('realm can serve compiled js file when requested without file extension ', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'dir/person.gts': cardSrc,
      },
    });
    let response = await realm.handle(new Request(`${testRealmURL}dir/person`));
    assert.strictEqual(response.status, 200, 'HTTP 200 status code');
    let compiledJS = await response.text();
    assert.codeEqual(
      stripScopedCSSGlimmerAttributes(compiledJS),
      compiledCard(),
      'compiled card is correct',
    );
  });

  test('realm can serve compiled js file when requested with file extension ', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'dir/person.gts': cardSrc,
      },
    });
    let response = await realm.handle(
      new Request(`${testRealmURL}dir/person.gts`),
    );
    assert.strictEqual(response.status, 200, 'HTTP 200 status code');
    let compiledJS = await response.text();
    assert.codeEqual(
      stripScopedCSSGlimmerAttributes(compiledJS),
      compiledCard(),
      'compiled card is correct',
    );
  });

  test('realm can serve file asset (not card source, not js, not JSON-API)', async function (assert) {
    let html = `
      <html>
        <body>
          <h1>Hello World</h1>
        </body>
      </html>
    `.trim();
    let { realm } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'dir/index.html': html,
      },
    });
    let response = await realm.handle(
      new Request(`${testRealmURL}dir/index.html`),
    );
    assert.strictEqual(response.status, 200, 'HTTP 200 status code');
    let responseText = await response.text();
    assert.strictEqual(responseText, html, 'asset contents are correct');
  });

  test('realm can serve search requests', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'dir/empty.json': {
          data: {
            attributes: {},
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/card-api',
                name: 'CardDef',
              },
            },
          },
        },
      },
    });
    let response = await realm.handle(
      new Request(`${testRealmURL}_search`, {
        headers: {
          Accept: 'application/vnd.card+json',
        },
      }),
    );
    let json = await response.json();
    assert.strictEqual(
      json.data.length,
      1,
      'the card is returned in the search results',
    );
    assert.strictEqual(
      json.data[0].id,
      `${testRealmURL}dir/empty`,
      'card ID is correct',
    );
  });

  test('realm can serve search requests whose results have linksTo fields', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'dir/mariko.json': {
          data: {
            id: `${testRealmURL}dir/mariko`,
            attributes: {
              firstName: 'Mariko',
              lastName: 'Abdel-Rahman',
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/person',
                name: 'Person',
              },
            },
          },
        },
        'dir/mango.json': {
          data: {
            id: `${testRealmURL}dir/mango`,
            attributes: {
              description: null,
              thumbnailURL: null,
              firstName: 'Mango',
            },
            relationships: {
              owner: {
                links: {
                  self: `${testRealmURL}dir/mariko`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/pet',
                name: 'Pet',
              },
            },
          },
        },
        'dir/vanGogh.json': {
          data: {
            id: `${testRealmURL}dir/vanGogh`,
            attributes: {
              firstName: 'Van Gogh',
            },
            relationships: {
              owner: {
                links: {
                  self: `http://localhost:4202/test/hassan`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: 'http://localhost:4202/test/pet',
                name: 'Pet',
              },
            },
          },
        },
      },
    });

    let response = await realm.handle(
      new Request(
        `${testRealmURL}_search?${stringify({
          sort: [
            {
              by: 'id',
              on: { module: `${baseRealm.url}card-api`, name: 'CardDef' },
            },
          ],
        })}`,
        {
          headers: {
            Accept: 'application/vnd.card+json',
          },
        },
      ),
    );
    let json = await response.json();
    delete json.included?.[0].meta.lastModified;
    assert.deepEqual(json, {
      data: [
        {
          type: 'card',
          id: `${testRealmURL}dir/mango`,
          attributes: {
            description: null,
            firstName: 'Mango',
            title: 'Mango',
            thumbnailURL: null,
          },
          relationships: {
            owner: {
              links: {
                self: `./mariko`,
              },
              data: {
                type: 'card',
                id: `${testRealmURL}dir/mariko`,
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/pet',
              name: 'Pet',
            },
            lastModified: adapter.lastModified.get(
              `${testRealmURL}dir/mango.json`,
            ),
            realmInfo: testRealmInfo,
            realmURL: testRealmURL,
          },
          links: {
            self: `${testRealmURL}dir/mango`,
          },
        },
        {
          type: 'card',
          id: `${testRealmURL}dir/mariko`,
          attributes: {
            firstName: 'Mariko',
            lastName: 'Abdel-Rahman',
            title: 'Mariko Abdel-Rahman',
            email: null,
            posts: null,
            thumbnailURL: null,
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/person',
              name: 'Person',
            },
            lastModified: adapter.lastModified.get(
              `${testRealmURL}dir/mariko.json`,
            ),
            realmInfo: testRealmInfo,
            realmURL: testRealmURL,
          },
          links: {
            self: `${testRealmURL}dir/mariko`,
          },
        },
        {
          type: 'card',
          id: `${testRealmURL}dir/vanGogh`,
          attributes: {
            description: null,
            firstName: 'Van Gogh',
            title: 'Van Gogh',
            thumbnailURL: null,
          },
          relationships: {
            owner: {
              links: {
                self: `http://localhost:4202/test/hassan`,
              },
              data: {
                type: 'card',
                id: `http://localhost:4202/test/hassan`,
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4202/test/pet',
              name: 'Pet',
            },
            lastModified: adapter.lastModified.get(
              `${testRealmURL}dir/vanGogh.json`,
            ),
            realmInfo: testRealmInfo,
            realmURL: testRealmURL,
          },
          links: {
            self: `${testRealmURL}dir/vanGogh`,
          },
        },
      ],
      included: [
        {
          type: 'card',
          id: `http://localhost:4202/test/hassan`,
          attributes: {
            email: null,
            posts: null,
            thumbnailURL: null,
            firstName: 'Hassan',
            lastName: 'Abdel-Rahman',
            title: 'Hassan Abdel-Rahman',
          },
          meta: {
            adoptsFrom: {
              module: './person',
              name: 'Person',
            },
            realmInfo: {
              name: 'Test Workspace A',
              backgroundURL:
                'https://i.postimg.cc/tgRHRV8C/pawel-czerwinski-h-Nrd99q5pe-I-unsplash.jpg',
              iconURL: 'https://i.postimg.cc/d0B9qMvy/icon.png',
            },
            realmURL: 'http://localhost:4202/test/',
          },
          links: {
            self: `http://localhost:4202/test/hassan`,
          },
        },
      ],
    });
  });

  test('realm can serve directory requests', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'dir/empty.json': {
          data: {
            attributes: {},
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/card-api',
                name: 'CardDef',
              },
            },
          },
        },
        'dir/subdir/file.txt': '',
      },
    });
    let response = await realm.handle(
      new Request(`${testRealmURL}dir/`, {
        headers: {
          Accept: 'application/vnd.api+json',
        },
      }),
    );
    assert.strictEqual(response.status, 200, 'HTTP 200 status code');
    let json = await response.json();
    assert.deepEqual(
      json,
      {
        data: {
          id: `${testRealmURL}dir/`,
          type: 'directory',
          relationships: {
            'subdir/': {
              links: {
                related: `${testRealmURL}dir/subdir/`,
              },
              meta: {
                kind: 'directory',
              },
            },
            'empty.json': {
              links: {
                related: `${testRealmURL}dir/empty.json`,
              },
              meta: {
                kind: 'file',
              },
            },
          },
        },
      },
      'the directory response is correct',
    );
  });

  test('requests do not contain entries that match patterns in ignore files', async function (assert) {
    const cardSource = `
      import { CardDef } from 'https://cardstack.com/base/card-api';
      export class Post extends CardDef {}
    `;

    let { realm } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'sample-post.json': '',
        'posts/1.json': '',
        'posts/nested.gts': cardSource,
        'posts/ignore-me.gts': cardSource,
        'posts/2.json': '',
        'post.gts': cardSource,
        'dir/card.gts': cardSource,
        '.gitignore': `
*.json
/dir
posts/ignore-me.gts
`,
      },
    });

    {
      let response = await realm.handle(
        new Request(
          `${testRealmURL}_typeOf?${stringify({
            type: 'exportedCard',
            module: 'posts/ignore-me.gts',
            name: 'Post',
          } as CodeRef)}`,
          {
            headers: {
              Accept: 'application/vnd.api+json',
            },
          },
        ),
      );

      assert.strictEqual(response.status, 404, 'HTTP 404 response');
    }
    {
      let response = await realm.handle(
        new Request(`${testRealmURL}dir/`, {
          headers: {
            Accept: 'application/vnd.api+json',
          },
        }),
      );
      assert.strictEqual(response.status, 404, 'HTTP 404 response');
    }
    {
      let response = await realm.handle(
        new Request(testRealmURL, {
          headers: {
            Accept: 'application/vnd.api+json',
          },
        }),
      );

      let json = await response.json();
      assert.deepEqual(
        Object.keys(json.data.relationships).sort(),
        ['.gitignore', 'post.gts', 'posts/'],
        'top level entries are correct',
      );
    }
    {
      let response = await realm.handle(
        new Request(`${testRealmURL}posts/`, {
          headers: {
            Accept: 'application/vnd.api+json',
          },
        }),
      );

      let json = await response.json();
      assert.deepEqual(
        Object.keys(json.data.relationships).sort(),
        ['nested.gts'],
        'nested entries are correct',
      );
    }
  });

  test('realm can serve info requests by reading .realm.json', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      loader,
      contents: {
        '.realm.json': `{
          "name": "Example Workspace",
          "backgroundURL": "https://example-background-url.com",
          "iconURL": "https://example-icon-url.com"
        }`,
      },
    });
    let response = await realm.handle(
      new Request(`${testRealmURL}_info`, {
        headers: {
          Accept: 'application/vnd.api+json',
        },
      }),
    );
    let json = await response.json();
    assert.deepEqual(
      json,
      {
        data: {
          id: testRealmURL,
          type: 'realm-info',
          attributes: {
            name: 'Example Workspace',
            backgroundURL: 'https://example-background-url.com',
            iconURL: 'https://example-icon-url.com',
          },
        },
      },
      '/_info response is correct',
    );
  });

  test('realm can serve info requests if .realm.json is missing', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      loader,
      contents: {},
    });
    let response = await realm.handle(
      new Request(`${testRealmURL}_info`, {
        headers: {
          Accept: 'application/vnd.api+json',
        },
      }),
    );
    let json = await response.json();
    assert.deepEqual(
      json,
      {
        data: {
          id: testRealmURL,
          type: 'realm-info',
          attributes: testRealmInfo,
        },
      },
      '/_info response is correct',
    );
  });

  test('realm can serve info requests if .realm.json is malformed', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      loader,
      contents: {
        '.realm.json': `Some example content that is not valid json`,
      },
    });
    let response = await realm.handle(
      new Request(`${testRealmURL}_info`, {
        headers: {
          Accept: 'application/vnd.api+json',
        },
      }),
    );
    let json = await response.json();
    assert.deepEqual(
      json,
      {
        data: {
          id: testRealmURL,
          type: 'realm-info',
          attributes: testRealmInfo,
        },
      },
      '/_info response is correct',
    );
  });

  test('realm does not crash when indexing a broken instance', async function (assert) {
    await setupIntegrationTestRealm({
      loader,
      contents: {
        'FieldDef/1.json': {
          data: {
            type: 'card',
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/card-api',
                name: 'FieldDef',
              },
            },
          },
        },
      },
    }); // this is an example of a card that where loadCard will throw an error

    assert.ok(
      true,
      'realm did not crash when trying to index a broken instance',
    );
  });
});
