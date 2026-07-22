import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { validate as uuidValidate } from 'uuid';

import type { Realm } from '@cardstack/runtime-common';
import {
  baseCardRef,
  baseRealmRRI,
  rri,
  searchEntryWireQueryFromQuery,
} from '@cardstack/runtime-common';
import { isSingleCardDocument } from '@cardstack/runtime-common/document-types';
import {
  cardSrc,
  compiledCard,
} from '@cardstack/runtime-common/etc/test-fixtures';

import stripScopedCSSGlimmerAttributes from '@cardstack/runtime-common/helpers/strip-scoped-css-glimmer-attributes';
import type { Loader } from '@cardstack/runtime-common/loader';

import {
  testRealmURL,
  testRealmInfo,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
  testModuleRealm,
  cardInfo,
  getFileCreatedAt,
  realmConfigCardJSON,
} from '../helpers';
import {
  setupBaseRealm,
  FieldDef,
  contains,
  containsMany,
  linksTo,
  linksToMany,
  Component,
  CardDef,
  StringField,
  field,
} from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { searchCardsForTest } from '../helpers/search-cards';
import { setupRenderingTest } from '../helpers/setup';

import type * as CardAPI from '@cardstack/base/card-api';
import type * as StringFieldMod from '@cardstack/base/string';

import '@cardstack/runtime-common/helpers/code-equality-assertion';

let loader: Loader;

module('Integration | realm', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
  });

  let mockMatrixUtils = setupMockMatrix(hooks);

  setupLocalIndexing(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  async function handle(realm: Realm, ...args: Parameters<Realm['handle']>) {
    let result = await realm.handle(...args);
    if (!result) {
      throw new Error(`realm didn't handle request`);
    }
    return result;
  }

  test('realm can serve GET card requests', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'dir/empty.json': {
          data: {
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/card-api',
                name: 'CardDef',
              },
            },
          },
        },
      },
    });

    let response = await handle(
      realm,
      new Request(`${testRealmURL}dir/empty`, {
        headers: {
          Accept: 'application/vnd.card+json',
        },
      }),
    );

    assert.strictEqual(response.status, 200, 'successful http status');
    let json = await response.json();
    let resourceCreatedAt = await getFileCreatedAt(realm, 'dir/empty.json');
    // The card+json GET stamps the index-data generation in per-instance meta;
    // it's server metadata not asserted by this structural comparison.
    delete json.data.meta.generation;
    assert.deepEqual(json, {
      data: {
        type: 'card',
        id: `${testRealmURL}dir/empty`,
        attributes: {
          cardInfo,
          cardDescription: null,
          cardThumbnailURL: null,
          cardTitle: 'Untitled Card',
        },
        meta: {
          adoptsFrom: {
            module: '@cardstack/base/card-api',
            name: 'CardDef',
          },
          lastModified: adapter.lastModifiedMap.get(
            `${testRealmURL}dir/empty.json`,
          ),
          resourceCreatedAt: resourceCreatedAt!,
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

  test('realm serves instance ids in canonical RRI form for a prefix-mapped realm', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'dir/empty.json': {
          data: {
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/card-api',
                name: 'CardDef',
              },
            },
          },
        },
      },
    });

    // Without a realm-prefix mapping, instance ids are served in URL form.
    let urlResponse = await handle(
      realm,
      new Request(`${testRealmURL}dir/empty`, {
        headers: { Accept: 'application/vnd.card+json' },
      }),
    );
    let urlDoc = await urlResponse.json();
    assert.strictEqual(
      urlDoc.data.id,
      `${testRealmURL}dir/empty`,
      'an unmapped realm serves the instance id in URL form',
    );

    // Registering a realm-prefix mapping makes the same GET serve the id (and
    // links.self) in canonical RRI (prefix) form. The unresolve happens at
    // serve time in getCard, so the mapping need not be present at index time.
    // The network service's VirtualNetwork is shared across tests, so remove
    // the mapping afterward to avoid leaking it into later tests.
    let virtualNetwork = getService('network').virtualNetwork;
    virtualNetwork.addRealmMapping('@test-prefix/', testRealmURL);
    try {
      let rriResponse = await handle(
        realm,
        new Request(`${testRealmURL}dir/empty`, {
          headers: { Accept: 'application/vnd.card+json' },
        }),
      );
      let rriDoc = await rriResponse.json();
      assert.strictEqual(
        rriDoc.data.id,
        '@test-prefix/dir/empty',
        'a prefix-mapped realm serves the instance id in canonical RRI form',
      );
      assert.strictEqual(
        rriDoc.data.links.self,
        '@test-prefix/dir/empty',
        'links.self is served in canonical RRI form too',
      );
    } finally {
      virtualNetwork.removeRealmMapping('@test-prefix/');
    }
  });

  test('realm can serve GET card requests with linksTo relationships', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'dir/owner.json': {
          data: {
            id: `${testRealmURL}dir/owner`,
            attributes: {
              firstName: 'Hassan',
              lastName: 'Abdel-Rahman',
              cardInfo,
              cardDescription: null,
              cardThumbnailURL: null,
            },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}person`,
                name: 'Person',
              },
            },
          },
        },
        'dir/mango.json': {
          data: {
            id: `${testRealmURL}dir/mango`,
            attributes: {
              firstName: 'Mango',
              cardInfo,
              cardDescription: null,
              cardThumbnailURL: null,
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
                module: `${testModuleRealm}pet`,
                name: 'Pet',
              },
            },
          },
        },
      },
    });

    let response = await handle(
      realm,
      new Request(`${testRealmURL}dir/mango`, {
        headers: {
          Accept: 'application/vnd.card+json',
        },
      }),
    );
    assert.strictEqual(response.status, 200, 'successful http status');
    let json = await response.json();
    let mangoCreatedAt = await getFileCreatedAt(realm, 'dir/mango.json');
    let ownerCreatedAt = await getFileCreatedAt(realm, 'dir/owner.json');
    // The card+json GET stamps the index-data generation in per-instance meta;
    // it's server metadata not asserted by this structural comparison.
    delete json.data.meta.generation;
    assert.deepEqual(json, {
      data: {
        type: 'card',
        id: `${testRealmURL}dir/mango`,
        attributes: {
          firstName: 'Mango',
          cardTitle: 'Mango',
          cardInfo,
          cardDescription: null,
          cardThumbnailURL: null,
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
            module: `${testModuleRealm}pet`,
            name: 'Pet',
          },
          lastModified: adapter.lastModifiedMap.get(
            `${testRealmURL}dir/mango.json`,
          ),
          resourceCreatedAt: mangoCreatedAt!,
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
            cardDescription: 'Person',
            email: null,
            posts: null,
            cardThumbnailURL: null,
            firstName: 'Hassan',
            lastName: 'Abdel-Rahman',
            cardTitle: 'Hassan Abdel-Rahman',
            fullName: 'Hassan Abdel-Rahman',
            cardInfo,
          },
          meta: {
            adoptsFrom: {
              module: `${testModuleRealm}person`,
              name: 'Person',
            },
            lastModified: adapter.lastModifiedMap.get(
              `${testRealmURL}dir/owner.json`,
            ),
            resourceCreatedAt: ownerCreatedAt!,
            realmInfo: testRealmInfo,
            realmURL: testRealmURL,
          },
          links: {
            self: `./owner`,
          },
        },
      ],
    });
  });

  test('realm can serve GET card requests with linksTo relationships to other realms', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'dir/mango.json': {
          data: {
            id: `${testRealmURL}dir/mango`,
            attributes: {
              cardDescription: null,
              cardThumbnailURL: null,
              firstName: 'Mango',
            },
            relationships: {
              owner: {
                links: {
                  self: `${testModuleRealm}hassan`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}pet`,
                name: 'Pet',
              },
            },
          },
        },
      },
    });

    let response = await handle(
      realm,
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
    delete included[0]?.meta.resourceCreatedAt;
    let resourceCreatedAt = await getFileCreatedAt(realm, 'dir/mango.json');
    assert.strictEqual(json.data.id, `${testRealmURL}dir/mango`, 'mango id');
    assert.strictEqual(
      json.data.attributes.firstName,
      'Mango',
      'mango firstName',
    );
    assert.strictEqual(
      json.data.relationships.owner.links.self,
      `${testModuleRealm}hassan`,
      'owner self link points to other realm',
    );
    assert.strictEqual(
      json.data.relationships.owner.data.id,
      `${testModuleRealm}hassan`,
      'owner data id points to other realm',
    );
    assert.strictEqual(
      json.data.meta.lastModified,
      adapter.lastModifiedMap.get(`${testRealmURL}dir/mango.json`),
      'mango lastModified',
    );
    assert.strictEqual(
      json.data.meta.resourceCreatedAt,
      resourceCreatedAt,
      'mango resourceCreatedAt',
    );

    assert.strictEqual(included.length, 1, 'one included card');
    let hassan = included[0];
    assert.strictEqual(
      hassan.id,
      `${testModuleRealm}hassan`,
      'included hassan id',
    );
  });

  test("realm can route requests correctly when mounted in the origin's subdir", async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'dir/empty.json': {
          data: {
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/card-api',
                name: 'CardDef',
              },
            },
          },
        },
      },
      realmURL: `${testRealmURL}root/`,
    });
    {
      let response = await handle(
        realm,
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
      let response = await handle(
        realm,
        new Request(`${testRealmURL}root/_search`, {
          method: 'QUERY',
          headers: {
            Accept: 'application/vnd.card+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(
            // anchored to cards — an unanchored entry query also returns the
            // card `.json` file rows
            searchEntryWireQueryFromQuery(
              { filter: { type: baseCardRef } },
              { fields: ['item'] },
            ),
          ),
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
      mockMatrixUtils,
      contents: {},
    });
    let response = await handle(
      realm,
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
                  module: '@cardstack/base/card-api',
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
      id = json.data.id!.split('/').pop()!;
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
      let createdAt = await getFileCreatedAt(realm, `CardDef/${id}.json`);
      assert.ok(
        json.data.meta?.resourceCreatedAt,
        'resourceCreatedAt meta exists on created card',
      );
      assert.strictEqual(
        json.data.meta?.resourceCreatedAt,
        createdAt,
        'resourceCreatedAt matches file created time',
      );
    } else {
      assert.ok(false, 'response body is not a card document');
    }
    if (!id) {
      assert.ok(false, 'card document is missing an ID');
    }

    let queryEngine = realm.realmIndexQueryEngine;
    let result = await queryEngine.cardDocument(new URL(json.data.links.self));
    if (result?.type === 'error') {
      throw new Error(
        `unexpected error when getting card from index: ${result.error.errorDetail.message}`,
      );
    }
    assert.strictEqual(
      result?.doc.data.id,
      `${testRealmURL}CardDef/${id}`,
      'found card in index',
    );
  });

  test('realm cannot create card request which is NOT directory', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {},
    });
    let dirName = 'SomeDirectory';
    let notDirPath = `${testRealmURL}${dirName}`;
    let notFoundResponse = await handle(
      realm,
      new Request(notDirPath, {
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
                  module: '@cardstack/base/card-api',
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
    let notFoundJson = await notFoundResponse.json();
    assert.strictEqual(notFoundJson.errors[0].status, 404);
    assert.strictEqual(notFoundResponse.status, 404);
  });

  test('realm allows create card requests into directories of the realm', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {},
    });
    let dirName = 'SomeDirectory';
    let dirPath = `${testRealmURL}${dirName}/`; //needs to be a directory
    let response = await handle(
      realm,
      new Request(dirPath, {
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
                  module: '@cardstack/base/card-api',
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
      id = json.data.id!.split('/').pop()!;
      assert.true(uuidValidate(id), 'card ID is a UUID');
      assert.strictEqual(
        json.data.id,
        `${dirPath}CardDef/${id}`,
        'the card URL is correct',
      );
      assert.ok(
        (await adapter.openFile(`${dirName}/CardDef/${id}.json`))?.content,
        'file contents exist',
      );
      // verify resourceCreatedAt meta recorded for new file in directory
      let createdAt = await getFileCreatedAt(
        realm,
        `${dirName}/CardDef/${id}.json`,
      );
      assert.ok(
        json.data.meta?.resourceCreatedAt,
        'resourceCreatedAt meta exists on created card in directory',
      );
      assert.strictEqual(
        json.data.meta?.resourceCreatedAt,
        createdAt,
        'resourceCreatedAt matches file created time (directory)',
      );
    } else {
      assert.ok(false, 'response body is not a card document');
    }
    if (!id) {
      assert.ok(false, 'card document is missing an ID');
    }
    let queryEngine = realm.realmIndexQueryEngine;
    let result = await queryEngine.cardDocument(new URL(json.data.links.self));
    if (result?.type === 'error') {
      throw new Error(
        `unexpected error when getting card from index: ${result.error.errorDetail.message}`,
      );
    }
    assert.strictEqual(
      result?.doc.data.id,
      `${testRealmURL}${dirName}/CardDef/${id}`,
      'found card in index',
    );
  });

  test('realm can serve POST requests that include linksTo fields', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
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
                module: `${testModuleRealm}person`,
                name: 'Person',
              },
            },
          },
        },
      },
    });
    let response = await handle(
      realm,
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
                  module: `${testModuleRealm}pet`,
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
    let ownerCreatedAt = await getFileCreatedAt(realm, 'dir/owner.json');
    let petCreatedAt = await getFileCreatedAt(realm, `Pet/${id}.json`);
    assert.ok(uuidValidate(id), 'card ID is a UUID');
    assert.deepEqual(json, {
      data: {
        type: 'card',
        id: `${testRealmURL}Pet/${id}`,
        attributes: {
          firstName: 'Mango',
          cardTitle: 'Mango',
          cardDescription: null,
          cardThumbnailURL: null,
          cardInfo,
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
            module: `${testModuleRealm}pet`,
            name: 'Pet',
          },
          lastModified: adapter.lastModifiedMap.get(
            `${testRealmURL}Pet/${id}.json`,
          ),
          resourceCreatedAt: petCreatedAt!,
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
            cardDescription: 'Person',
            email: null,
            posts: null,
            cardThumbnailURL: null,
            firstName: 'Hassan',
            lastName: 'Abdel-Rahman',
            cardTitle: 'Hassan Abdel-Rahman',
            fullName: 'Hassan Abdel-Rahman',
            cardInfo,
          },
          meta: {
            adoptsFrom: {
              module: `${testModuleRealm}person`,
              name: 'Person',
            },
            lastModified: adapter.lastModifiedMap.get(
              `${testRealmURL}dir/owner.json`,
            ),
            resourceCreatedAt: ownerCreatedAt!,
            realmInfo: testRealmInfo,
            realmURL: testRealmURL,
          },
          links: {
            self: `../dir/owner`,
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
              module: `${testModuleRealm}pet`,
              name: 'Pet',
            },
          },
        },
      },
      'file contents are correct',
    );
  });

  test('realm returns 500 error for POST requests that set the value of a polymorphic field to an incompatible type', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
    }
    class Car extends FieldDef {
      @field make = contains(StringField);
      @field model = contains(StringField);
      @field year = contains(StringField);
    }
    class Driver extends CardDef {
      @field card = contains(Person);
    }
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'driver.gts': { Driver },
        'person.gts': { Person },
        'car.gts': { Car },
      },
    });
    let response = await handle(
      realm,
      new Request(testRealmURL, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.card+json',
        },
        body: JSON.stringify(
          {
            data: {
              type: 'card',
              attributes: {
                card: {
                  firstName: null,
                  make: 'Mercedes Benz',
                  model: 'C300',
                  year: '2024',
                },
              },
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}driver`,
                  name: 'Driver',
                },
                fields: {
                  card: {
                    adoptsFrom: {
                      module: `${testRealmURL}car`,
                      name: 'Car',
                    },
                  },
                },
              },
            },
          },
          null,
          2,
        ),
      }),
    );
    assert.strictEqual(response.status, 500, '500 server error');
    let json = await response.json();
    assert.strictEqual(
      json.errors[0].additionalErrors[0].errorDetail.message,
      "field validation error: tried set instance of Car as field 'card' but it is not an instance of Person",
    );
  });

  test('realm can serve patch card requests', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'dir/card.json': {
          data: {
            attributes: {
              firstName: 'Mango',
              lastName: 'Abdel-Rahman',
            },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}person`,
                name: 'Person',
              },
            },
          },
        },
      },
    });

    let response = await handle(
      realm,
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
                  module: `${testModuleRealm}person`,
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
    await realm.flushUpdateEvents();

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
        adapter.lastModifiedMap.get(`${testRealmURL}dir/card.json`),
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
              firstName: 'Van Gogh',
              lastName: 'Abdel-Rahman',
            },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}person`,
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

    let queryEngine = realm.realmIndexQueryEngine;
    let result = await queryEngine.cardDocument(new URL(json.data.links.self));
    if (result?.type === 'error') {
      throw new Error(
        `unexpected error when getting card from index: ${result.error.errorDetail.message}`,
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

    let { data: cards } = await searchCardsForTest(queryEngine, {
      filter: {
        on: {
          module: rri(`${testModuleRealm}person`),
          name: 'Person',
        },
        eq: { firstName: 'Van Gogh' },
      },
    });

    assert.strictEqual(cards.length, 1, 'search finds updated value');
  });

  test('realm can remove item from containsMany field via PATCH request', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'ski-trip.json': {
          data: {
            attributes: {
              cardTitle: 'Gore Mountain Ski Trip',
              venue: 'Gore Mountain',
              startTime: '2023-02-18T10:00:00.000Z',
              endTime: '2023-02-19T02:00:00.000Z',
              hosts: [{ firstName: 'Hassan' }, { firstName: 'Mango' }],
              sponsors: ['Burton', 'Spy Optics'],
              posts: [],
            },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}booking`,
                name: 'Booking',
              },
            },
          },
        },
      },
    });
    let resourceCreatedAt = await getFileCreatedAt(realm, 'ski-trip.json');
    let response = await handle(
      realm,
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
                  module: `${testModuleRealm}booking`,
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
          cardTitle: 'Gore Mountain Ski Trip',
          venue: 'Gore Mountain',
          startTime: '2023-02-18T10:00:00.000Z',
          endTime: '2023-02-19T02:00:00.000Z',
          hosts: [
            {
              cardDescription: 'Person',
              firstName: 'Hassan',
              lastName: null,
              fullName: 'Hassan ',
              cardTitle: 'Hassan ',
              email: null,
              posts: null,
            },
          ],
          sponsors: ['Burton'],
          posts: [],
          cardDescription: 'Gore Mountain',
          cardThumbnailURL: null,
          cardInfo,
        },
        meta: {
          adoptsFrom: {
            module: `${testModuleRealm}booking`,
            name: 'Booking',
          },
          lastModified: adapter.lastModifiedMap.get(
            `${testRealmURL}ski-trip.json`,
          ),
          resourceCreatedAt: resourceCreatedAt!,
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
            cardTitle: 'Gore Mountain Ski Trip',
            venue: 'Gore Mountain',
            startTime: '2023-02-18T10:00:00.000Z',
            endTime: '2023-02-19T02:00:00.000Z',
            hosts: [
              {
                firstName: 'Hassan',
                lastName: null,
              },
            ],
            sponsors: ['Burton'],
            posts: [],
          },
          meta: {
            adoptsFrom: {
              module: `${testModuleRealm}booking`,
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
      mockMatrixUtils,
      contents: {
        'dir/van-gogh.json': {
          data: {
            id: `${testRealmURL}dir/van-gogh`,
            attributes: { firstName: 'Van Gogh' },
            relationships: { owner: { links: { self: null } } },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}pet`,
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
                module: `${testModuleRealm}pet`,
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
                module: `${testModuleRealm}person`,
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
              'pets.0': {
                links: { self: `${testRealmURL}dir/van-gogh` },
              },
              'pets.1': {
                links: { self: `${testRealmURL}dir/mango` },
              },
              friend: { links: { self: `${testRealmURL}dir/friend` } },
            },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}pet-person`,
                name: 'PetPerson',
              },
            },
          },
        },
      },
    });
    let resourceCreatedAt = await getFileCreatedAt(realm, 'jackie.json');
    let friendCreatedAt = await getFileCreatedAt(realm, 'dir/friend.json');
    let vanGoghCreatedAt = await getFileCreatedAt(realm, 'dir/van-gogh.json');
    let response = await handle(
      realm,
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
                'pets.0': {
                  links: { self: `${testRealmURL}dir/van-gogh` },
                },
              },
              meta: {
                adoptsFrom: {
                  module: `${testModuleRealm}pet-person`,
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
          cardTitle: 'Jackie Pet Person',
          cardDescription: 'A person with pets',
          cardThumbnailURL: null,
          cardInfo,
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
            module: `${testModuleRealm}pet-person`,
            name: 'PetPerson',
          },
          realmInfo: testRealmInfo,
          realmURL: testRealmURL,
          lastModified: adapter.lastModifiedMap.get(
            `${testRealmURL}jackie.json`,
          ),
          resourceCreatedAt: resourceCreatedAt!,
        },
      },
      included: [
        {
          type: 'card',
          id: `${testRealmURL}dir/friend`,
          links: { self: `./dir/friend` },
          attributes: {
            cardDescription: 'Person',
            email: null,
            posts: null,
            cardThumbnailURL: null,
            firstName: 'Hassan',
            lastName: 'Abdel-Rahman',
            fullName: 'Hassan Abdel-Rahman',
            cardTitle: 'Hassan Abdel-Rahman',
            cardInfo,
          },
          meta: {
            adoptsFrom: {
              module: `${testModuleRealm}person`,
              name: 'Person',
            },
            lastModified: adapter.lastModifiedMap.get(
              `${testRealmURL}dir/friend.json`,
            ),
            resourceCreatedAt: friendCreatedAt!,
            realmInfo: testRealmInfo,
            realmURL: testRealmURL,
          },
        },
        {
          type: 'card',
          id: `${testRealmURL}dir/van-gogh`,
          links: { self: `./dir/van-gogh` },
          attributes: {
            firstName: 'Van Gogh',
            cardTitle: 'Van Gogh',
            cardDescription: null,
            cardThumbnailURL: null,
            cardInfo,
          },
          relationships: {
            owner: { links: { self: null } },
          },
          meta: {
            adoptsFrom: {
              module: `${testModuleRealm}pet`,
              name: 'Pet',
            },
            lastModified: adapter.lastModifiedMap.get(
              `${testRealmURL}dir/van-gogh.json`,
            ),
            resourceCreatedAt: vanGoghCreatedAt!,
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
              module: `${testModuleRealm}pet-person`,
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
      mockMatrixUtils,
      contents: {
        'dir/van-gogh.json': {
          data: {
            id: `${testRealmURL}dir/van-gogh`,
            attributes: { firstName: 'Van Gogh' },
            relationships: { owner: { links: { self: null } } },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}pet`,
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
                module: `${testModuleRealm}pet`,
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
                module: `${testModuleRealm}person`,
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
              'pets.0': {
                links: { self: `${testRealmURL}dir/van-gogh` },
              },
              friend: { links: { self: `${testRealmURL}dir/friend` } },
            },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}pet-person`,
                name: 'PetPerson',
              },
            },
          },
        },
      },
    });
    let resourceCreatedAt = await getFileCreatedAt(realm, 'jackie.json');

    let response = await handle(
      realm,
      new Request(`${testRealmURL}jackie`, {
        method: 'PATCH',
        headers: { Accept: 'application/vnd.card+json' },
        body: JSON.stringify(
          {
            data: {
              type: 'card',
              relationships: {
                'pets.0': { links: { self: `${testRealmURL}dir/mango` } },
                'pets.1': {
                  links: { self: `${testRealmURL}dir/van-gogh` },
                },
              },
              meta: {
                adoptsFrom: {
                  module: `${testModuleRealm}pet-person`,
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
        cardTitle: 'Jackie Pet Person',
        cardDescription: 'A person with pets',
        cardThumbnailURL: null,
        cardInfo,
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
          module: `${testModuleRealm}pet-person`,
          name: 'PetPerson',
        },
        lastModified: adapter.lastModifiedMap.get(`${testRealmURL}jackie.json`),
        resourceCreatedAt: resourceCreatedAt!,
        realmInfo: testRealmInfo,
        realmURL: testRealmURL,
      },
    });
  });

  test('realm can add items to null linksToMany relationship via PATCH request', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'dir/van-gogh.json': {
          data: {
            id: `${testRealmURL}dir/van-gogh`,
            attributes: { firstName: 'Van Gogh' },
            relationships: { owner: { links: { self: null } } },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}pet`,
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
                module: `${testModuleRealm}pet`,
                name: 'Pet',
              },
            },
          },
        },
        'jackie.json': {
          data: {
            id: `${testRealmURL}jackie`,
            attributes: { firstName: 'Jackie' },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}pet-person`,
                name: 'PetPerson',
              },
            },
          },
        },
      },
    });
    let resourceCreatedAt = await getFileCreatedAt(realm, 'jackie.json');

    let response = await handle(
      realm,
      new Request(`${testRealmURL}jackie`, {
        method: 'PATCH',
        headers: { Accept: 'application/vnd.card+json' },
        body: JSON.stringify(
          {
            data: {
              type: 'card',
              relationships: {
                'pets.0': { links: { self: `${testRealmURL}dir/mango` } },
                'pets.1': {
                  links: { self: `${testRealmURL}dir/van-gogh` },
                },
              },
              meta: {
                adoptsFrom: {
                  module: `${testModuleRealm}pet-person`,
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
        cardTitle: 'Jackie Pet Person',
        cardDescription: 'A person with pets',
        cardThumbnailURL: null,
        cardInfo,
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
      },
      meta: {
        adoptsFrom: {
          module: `${testModuleRealm}pet-person`,
          name: 'PetPerson',
        },
        lastModified: adapter.lastModifiedMap.get(`${testRealmURL}jackie.json`),
        resourceCreatedAt: resourceCreatedAt!,
        realmInfo: testRealmInfo,
        realmURL: testRealmURL,
      },
    });
  });

  test('realm PATCH request can set a linksTo nested within a containsMany', async function (assert) {
    class Other extends CardDef {
      static displayName = 'Other';
      @field name = contains(StringField);
    }

    class Inner extends FieldDef {
      @field message = contains(StringField);
      @field other = linksTo(Other);
      static embedded = class Embedded extends Component<typeof this> {
        <template>x: {{@model.other.name}}</template>
      };
    }

    class Outer extends CardDef {
      static displayName = 'Outer2';
      @field inners = containsMany(Inner);
    }

    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'outer.gts': {
          Outer,
          Inner,
          Other,
        },
        '1.json': {
          data: {
            id: `${testRealmURL}1`,
            attributes: {
              inners: [
                {
                  message: 'hello',
                },
              ],
            },
            relationships: { owner: { links: { self: null } } },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}outer`,
                name: 'Outer',
              },
            },
          },
        },
        '2.json': {
          data: {
            id: `${testRealmURL}2`,
            attributes: { name: 'Jackie' },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}outer`,
                name: 'Other',
              },
            },
          },
        },
      },
    });

    let response = await handle(
      realm,
      new Request(`${testRealmURL}1`, {
        method: 'PATCH',
        headers: { Accept: 'application/vnd.card+json' },
        body: JSON.stringify(
          {
            data: {
              type: 'card',
              relationships: {
                'inners.0.other': { links: { self: `${testRealmURL}2` } },
              },
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}outer`,
                  name: 'Outer',
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

    assert.deepEqual(json.data.relationships, {
      'inners.0.other': {
        links: { self: `./2` },
        data: { id: `${testRealmURL}2`, type: 'card' },
      },
    });
    assert.deepEqual(
      JSON.parse((adapter.files.contents['1.json'] as any).content).data
        .relationships,
      {
        'inners.0.other': {
          links: {
            self: './2',
          },
        },
      },
    );
  });

  test('realm can remove all items to in a linksToMany relationship via PATCH request', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'dir/van-gogh.json': {
          data: {
            id: `${testRealmURL}dir/van-gogh`,
            attributes: { firstName: 'Van Gogh' },
            relationships: { owner: { links: { self: null } } },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}pet`,
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
                module: `${testModuleRealm}pet`,
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
              'pets.1': {
                links: { self: `${testRealmURL}dir/van-gogh` },
              },
            },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}pet-person`,
                name: 'PetPerson',
              },
            },
          },
        },
      },
    });

    let response = await handle(
      realm,
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
                  module: `${testModuleRealm}pet-person`,
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
    let resourceCreatedAt = await getFileCreatedAt(realm, 'jackie.json');

    assert.strictEqual(response.status, 200, 'successful http status');
    let json = await response.json();

    assert.deepEqual(json.data, {
      type: 'card',
      id: `${testRealmURL}jackie`,
      links: { self: `${testRealmURL}jackie` },
      attributes: {
        firstName: 'Jackie',
        cardTitle: 'Jackie Pet Person',
        cardDescription: 'A person with pets',
        cardThumbnailURL: null,
        cardInfo,
      },
      // Emptying `pets` authors it empty — a relationship the card has, spelled
      // `{ self: null }` on the wire — as distinct from a never-set link, which
      // is omitted. So the served card+json keeps the emptied `pets` and omits
      // the never-authored `friend`.
      relationships: {
        pets: { links: { self: null } },
      },
      meta: {
        adoptsFrom: {
          module: `${testModuleRealm}pet-person`,
          name: 'PetPerson',
        },
        lastModified: adapter.lastModifiedMap.get(`${testRealmURL}jackie.json`),
        resourceCreatedAt: resourceCreatedAt!,
        realmInfo: testRealmInfo,
        realmURL: testRealmURL,
      },
    });
  });

  test('realm can serve PATCH requests to linksTo field in a card that also has a linksToMany field', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'dir/van-gogh.json': {
          data: {
            id: `${testRealmURL}dir/van-gogh`,
            attributes: { firstName: 'Van Gogh' },
            relationships: { owner: { links: { self: null } } },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}pet`,
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
                module: `${testModuleRealm}person`,
                name: 'Person',
              },
            },
          },
        },
        'dir/different-friend.json': {
          data: {
            id: `${testRealmURL}dir/different-friend`,
            attributes: { firstName: 'Burcu' },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}person`,
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
              'pets.0': {
                links: { self: `${testRealmURL}dir/van-gogh` },
              },
              friend: { links: { self: `${testRealmURL}dir/friend` } },
            },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}pet-person`,
                name: 'PetPerson',
              },
            },
          },
        },
      },
    });

    let resourceCreatedAt = await getFileCreatedAt(realm, 'jackie.json');
    // changing linksTo field only
    let response = await handle(
      realm,
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
                  module: `${testModuleRealm}pet-person`,
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
        cardTitle: 'Jackie Pet Person',
        cardDescription: 'A person with pets',
        cardThumbnailURL: null,
        cardInfo,
      },
      relationships: {
        'pets.0': {
          links: { self: `./dir/van-gogh` },
          data: { id: `${testRealmURL}dir/van-gogh`, type: 'card' },
        },
        friend: {
          links: { self: `./dir/different-friend` },
          data: {
            id: `${testRealmURL}dir/different-friend`,
            type: 'card',
          },
        },
      },
      meta: {
        adoptsFrom: {
          module: `${testModuleRealm}pet-person`,
          name: 'PetPerson',
        },
        lastModified: adapter.lastModifiedMap.get(`${testRealmURL}jackie.json`),
        resourceCreatedAt: resourceCreatedAt!,
        realmInfo: testRealmInfo,
        realmURL: testRealmURL,
      },
    });
  });

  test('realm can serve PATCH requests to both linksTo and linksToMany fields', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'dir/van-gogh.json': {
          data: {
            id: `${testRealmURL}dir/van-gogh`,
            attributes: { firstName: 'Van Gogh' },
            relationships: { owner: { links: { self: null } } },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}pet`,
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
                module: `${testModuleRealm}pet`,
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
                module: `${testModuleRealm}person`,
                name: 'Person',
              },
            },
          },
        },
        'dir/different-friend.json': {
          data: {
            id: `${testRealmURL}dir/different-friend`,
            attributes: { firstName: 'Burcu' },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}person`,
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
              'pets.0': {
                links: { self: `${testRealmURL}dir/van-gogh` },
              },
              friend: { links: { self: `${testRealmURL}dir/friend` } },
            },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}pet-person`,
                name: 'PetPerson',
              },
            },
          },
        },
      },
    });

    let resourceCreatedAt = await getFileCreatedAt(realm, 'jackie.json');
    let response = await handle(
      realm,
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
                  module: `${testModuleRealm}pet-person`,
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
        cardTitle: 'Jackie Pet Person',
        cardDescription: 'A person with pets',
        cardThumbnailURL: null,
        cardInfo,
      },
      relationships: {
        friend: {
          links: { self: `./dir/different-friend` },
          data: {
            id: `${testRealmURL}dir/different-friend`,
            type: 'card',
          },
        },
        'pets.0': {
          links: { self: `./dir/van-gogh` },
          data: {
            id: `${testRealmURL}dir/van-gogh`,
            type: 'card',
          },
        },
      },
      meta: {
        adoptsFrom: {
          module: `${testModuleRealm}pet-person`,
          name: 'PetPerson',
        },
        lastModified: adapter.lastModifiedMap.get(`${testRealmURL}jackie.json`),
        resourceCreatedAt: resourceCreatedAt!,
        realmInfo: testRealmInfo,
        realmURL: testRealmURL,
      },
    });
  });

  test('realm can serve PATCH requests that include linksTo fields', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
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
                module: `${testModuleRealm}person`,
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
                module: `${testModuleRealm}person`,
                name: 'Person',
              },
            },
          },
        },
        'dir/mango.json': {
          data: {
            id: `${testRealmURL}dir/mango`,
            attributes: {
              cardDescription: null,
              cardThumbnailURL: null,
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
                module: `${testModuleRealm}pet`,
                name: 'Pet',
              },
            },
          },
        },
      },
    });
    let response = await handle(
      realm,
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
                  module: `${testModuleRealm}pet`,
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

    assert.strictEqual(response.status, 200, 'successful http status');
    let json = await response.json();
    let mangoCreatedAt = await getFileCreatedAt(realm, 'dir/mango.json');
    let marikoCreatedAt = await getFileCreatedAt(realm, 'dir/mariko.json');
    assert.deepEqual(json, {
      data: {
        type: 'card',
        id: `${testRealmURL}dir/mango`,
        attributes: {
          firstName: 'Mango',
          cardTitle: 'Mango',
          cardDescription: null,
          cardThumbnailURL: null,
          cardInfo,
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
            module: `${testModuleRealm}pet`,
            name: 'Pet',
          },
          lastModified: adapter.lastModifiedMap.get(
            `${testRealmURL}dir/mango.json`,
          ),
          resourceCreatedAt: mangoCreatedAt!,
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
            fullName: 'Mariko Abdel-Rahman',
            cardTitle: 'Mariko Abdel-Rahman',
            cardDescription: 'Person',
            email: null,
            posts: null,
            cardThumbnailURL: null,
            cardInfo,
          },
          meta: {
            adoptsFrom: {
              module: `${testModuleRealm}person`,
              name: 'Person',
            },
            lastModified: adapter.lastModifiedMap.get(
              `${testRealmURL}dir/mariko.json`,
            ),
            resourceCreatedAt: marikoCreatedAt!,
            realmInfo: testRealmInfo,
            realmURL: testRealmURL,
          },
          links: {
            self: `./mariko`,
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
              module: `${testModuleRealm}pet`,
              name: 'Pet',
            },
          },
        },
      },
      'file contents are correct',
    );
  });

  test('realm can serve PATCH requests that include polymorphic updates', async function (assert) {
    class Driver extends CardDef {
      @field card = contains(FieldDef);
    }
    class Person extends FieldDef {
      @field firstName = contains(StringField);
    }
    class Car extends FieldDef {
      @field make = contains(StringField);
      @field model = contains(StringField);
      @field year = contains(StringField);
    }
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'driver.gts': { Driver },
        'person.gts': { Person },
        'car.gts': { Car },
        'dir/driver.json': {
          data: {
            id: `${testRealmURL}dir/driver`,
            attributes: {
              card: {
                firstName: 'Mango',
              },
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}driver`,
                name: 'Driver',
              },
              fields: {
                card: {
                  adoptsFrom: {
                    module: `${testRealmURL}person`,
                    name: 'Person',
                  },
                },
              },
            },
          },
        },
      },
    });
    let resourceCreatedAt = await getFileCreatedAt(realm, 'dir/driver.json');
    let response = await handle(
      realm,
      new Request(`${testRealmURL}dir/driver`, {
        method: 'PATCH',
        headers: {
          Accept: 'application/vnd.card+json',
        },
        body: JSON.stringify(
          {
            data: {
              type: 'card',
              attributes: {
                card: {
                  firstName: null,
                  make: 'Mercedes Benz',
                  model: 'C300',
                  year: '2024',
                },
              },
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}driver`,
                  name: 'Driver',
                },
                fields: {
                  card: {
                    adoptsFrom: {
                      module: `${testRealmURL}car`,
                      name: 'Car',
                    },
                  },
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
        id: `${testRealmURL}dir/driver`,
        attributes: {
          card: {
            make: 'Mercedes Benz',
            model: 'C300',
            year: '2024',
          },
          cardDescription: null,
          cardThumbnailURL: null,
          cardTitle: 'Untitled Card',
          cardInfo,
        },
        meta: {
          adoptsFrom: {
            module: `../driver`,
            name: 'Driver',
          },
          fields: {
            card: {
              adoptsFrom: {
                module: `../car`,
                name: 'Car',
              },
            },
          },
          lastModified: adapter.lastModifiedMap.get(
            `${testRealmURL}dir/driver.json`,
          ),
          resourceCreatedAt: resourceCreatedAt!,
          realmInfo: testRealmInfo,
          realmURL: testRealmURL,
        },
        links: {
          self: `${testRealmURL}dir/driver`,
        },
      },
    });
    let fileRef = await adapter.openFile('dir/driver.json');
    if (!fileRef) {
      throw new Error('file not found');
    }
    assert.deepEqual(
      JSON.parse(fileRef.content as string),
      {
        data: {
          type: 'card',
          attributes: {
            card: {
              make: 'Mercedes Benz',
              model: 'C300',
              year: '2024',
            },
          },
          meta: {
            adoptsFrom: {
              module: `../driver`,
              name: 'Driver',
            },
            fields: {
              card: {
                adoptsFrom: {
                  module: `../car`,
                  name: 'Car',
                },
              },
            },
          },
        },
      },
      'file contents are correct',
    );
  });

  test('realm returns 400 error for PATCH requests that change the type of the underlying instance', async function (assert) {
    class Person extends CardDef {
      @field firstName = contains(StringField);
    }
    class Car extends CardDef {
      @field make = contains(StringField);
      @field model = contains(StringField);
      @field year = contains(StringField);
    }
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'person.gts': { Person },
        'car.gts': { Car },
        'dir/person.json': {
          data: {
            attributes: {
              firstName: 'Mango',
            },
            meta: {
              adoptsFrom: {
                module: `../person`,
                name: 'Person',
              },
            },
          },
        },
      },
    });
    let response = await handle(
      realm,
      new Request(`${testRealmURL}dir/person`, {
        method: 'PATCH',
        headers: {
          Accept: 'application/vnd.card+json',
        },
        body: JSON.stringify(
          {
            data: {
              type: 'card',
              attributes: {
                make: 'Mercedes Benz',
                model: 'C300',
                year: '2024',
              },
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}car`,
                  name: 'Car',
                },
              },
            },
          },
          null,
          2,
        ),
      }),
    );

    assert.strictEqual(response.status, 400, '400 server error');
    let fileRef = await adapter.openFile('dir/person.json');
    if (!fileRef) {
      throw new Error('file not found');
    }
    assert.deepEqual(
      JSON.parse(fileRef.content as string),
      {
        data: {
          attributes: {
            firstName: 'Mango',
          },
          meta: {
            adoptsFrom: {
              module: `../person`,
              name: 'Person',
            },
          },
        },
      },
      'file contents are correct',
    );
  });

  test('realm returns 500 error for PATCH requests that set the value of a polymorphic field to an incompatible type', async function (assert) {
    class Person extends FieldDef {
      @field firstName = contains(StringField);
    }
    class Car extends FieldDef {
      @field make = contains(StringField);
      @field model = contains(StringField);
      @field year = contains(StringField);
    }
    class Driver extends CardDef {
      @field card = contains(Person);
    }
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'driver.gts': { Driver },
        'person.gts': { Person },
        'car.gts': { Car },
        'dir/driver.json': {
          data: {
            attributes: {
              card: {
                firstName: 'Mango',
              },
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}driver`,
                name: 'Driver',
              },
              fields: {
                card: {
                  adoptsFrom: {
                    module: `../person`,
                    name: 'Person',
                  },
                },
              },
            },
          },
        },
      },
    });
    try {
      (globalThis as any).__emulateServerPatchFailure = true;
      let response = await handle(
        realm,
        new Request(`${testRealmURL}dir/driver`, {
          method: 'PATCH',
          headers: {
            Accept: 'application/vnd.card+json',
          },
          body: JSON.stringify(
            {
              data: {
                type: 'card',
                attributes: {
                  card: {
                    firstName: null,
                    make: 'Mercedes Benz',
                    model: 'C300',
                    year: '2024',
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: `${testRealmURL}driver`,
                    name: 'Driver',
                  },
                  fields: {
                    card: {
                      adoptsFrom: {
                        module: `${testRealmURL}car`,
                        name: 'Car',
                      },
                    },
                  },
                },
              },
            },
            null,
            2,
          ),
        }),
      );

      assert.strictEqual(response.status, 500, '500 server error');
      let json = await response.json();
      assert.strictEqual(
        json.errors[0].additionalErrors[0].errorDetail.message,
        "field validation error: tried set instance of Car as field 'card' but it is not an instance of Person",
      );
    } finally {
      delete (globalThis as any).__emulateServerPatchFailure;
    }
  });

  test('realm can serve delete card requests', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'cards/1.json': {
          data: {
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/card-api',
                name: 'CardDef',
              },
            },
          },
        },
        'cards/2.json': {
          data: {
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/card-api',
                name: 'CardDef',
              },
            },
          },
        },
      },
    });

    let queryEngine = realm.realmIndexQueryEngine;

    let { data: cards } = await searchCardsForTest(queryEngine, {
      filter: { type: baseCardRef },
    });
    assert.strictEqual(cards.length, 2, 'two cards found');

    let result = await queryEngine.cardDocument(
      new URL(`${testRealmURL}cards/2`),
    );
    if (result?.type === 'error') {
      throw new Error(
        `unexpected error when getting card from index: ${result.error.errorDetail.message}`,
      );
    }
    assert.strictEqual(
      result?.doc.data.id,
      `${testRealmURL}cards/2`,
      'found card in index',
    );

    let response = await handle(
      realm,
      new Request(`${testRealmURL}cards/2`, {
        method: 'DELETE',
        headers: {
          Accept: 'application/vnd.card+json',
        },
      }),
    );
    await realm.flushUpdateEvents();

    assert.strictEqual(response.status, 204, 'status was 204');

    result = await queryEngine.cardDocument(new URL(`${testRealmURL}cards/2`));
    assert.strictEqual(result, undefined, 'card was deleted');
    let deletedFile = await adapter.openFile('cards/2.json');
    assert.strictEqual(
      deletedFile,
      undefined,
      'underlying file for deleted card no longer exists',
    );

    result = await queryEngine.cardDocument(new URL(`${testRealmURL}cards/1`));
    if (result?.type === 'error') {
      throw new Error(
        `unexpected error when getting card from index: ${result.error.errorDetail.message}`,
      );
    }
    assert.strictEqual(
      result?.doc.data.id,
      `${testRealmURL}cards/1`,
      'card 1 is still there',
    );

    cards = (
      await searchCardsForTest(queryEngine, {
        filter: { type: baseCardRef },
      })
    ).data;
    assert.strictEqual(cards.length, 1, 'only one card remains');
  });

  test('realm can serve card source file', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'dir/person.gts': cardSrc,
      },
    });
    let response = await handle(
      realm,
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
      mockMatrixUtils,
      contents: {
        'dir/person.gts': cardSrc,
      },
    });
    let response = await handle(
      realm,
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
      mockMatrixUtils,
      contents: {},
    });
    let response = await handle(
      realm,
      new Request(`${testRealmURL}dir/person`, {
        headers: {
          Accept: 'application/vnd.card+source',
        },
      }),
    );
    assert.strictEqual(response.status, 404, '404 HTTP status');
  });

  test('realm can serve card source post request', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {},
    });

    {
      let response = await handle(
        realm,
        new Request(`${testRealmURL}dir/person.gts`, {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.card+source',
          },
          body: cardSrc,
        }),
      );
      await realm.flushUpdateEvents();

      assert.strictEqual(response.status, 204, 'HTTP status is 204');
      assert.ok(
        response.headers.get('last-modified'),
        'last-modified header exists',
      );
    }
    {
      let response = await handle(
        realm,
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

  test('realm can serve card source delete request', async function (assert) {
    let { field, contains, CardDef } = await loader.import<typeof CardAPI>(
      '@cardstack/base/card-api',
    );
    let { default: StringField } = await loader.import<typeof StringFieldMod>(
      '@cardstack/base/string',
    );

    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field lastName = contains(StringField);
    }

    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'person.gts': { Person },
      },
    });

    let response = await handle(
      realm,
      new Request(`${testRealmURL}person`, {
        headers: {
          Accept: 'application/vnd.card+source',
        },
      }),
    );
    await realm.flushUpdateEvents();
    assert.strictEqual(response.status, 302, 'file exists');

    response = await handle(
      realm,
      new Request(`${testRealmURL}person`, {
        method: 'DELETE',
        headers: {
          Accept: 'application/vnd.card+source',
        },
      }),
    );
    await realm.flushUpdateEvents();

    assert.strictEqual(response.status, 204, 'file is deleted');

    response = await handle(
      realm,
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
      mockMatrixUtils,
      contents: {
        'dir/person.gts': cardSrc,
      },
    });
    let response = await handle(
      realm,
      new Request(`${testRealmURL}dir/person`),
    );
    assert.strictEqual(response.status, 200, 'HTTP 200 status code');
    let compiledJS = await response.text();
    assert.codeEqual(
      stripScopedCSSGlimmerAttributes(
        compiledJS.replace(/"id":\s"[^"]+"/, '"id": "<id>"'),
      ),
      compiledCard('"<id>"'),
      'compiled card is correct',
    );
  });

  test('realm can serve compiled js file when requested with file extension ', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'dir/person.gts': cardSrc,
      },
    });
    let response = await handle(
      realm,
      new Request(`${testRealmURL}dir/person.gts`),
    );
    assert.strictEqual(response.status, 200, 'HTTP 200 status code');
    let compiledJS = await response.text();
    assert.codeEqual(
      stripScopedCSSGlimmerAttributes(
        compiledJS.replace(/"id":\s"[^"]+"/, '"id": "<id>"'),
      ),
      compiledCard('"<id>"'),
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
      mockMatrixUtils,
      contents: {
        'dir/index.html': html,
      },
    });
    let response = await handle(
      realm,
      new Request(`${testRealmURL}dir/index.html`),
    );
    assert.strictEqual(response.status, 200, 'HTTP 200 status code');
    let responseText = await response.text();
    assert.strictEqual(responseText, html, 'asset contents are correct');
  });

  test('realm can serve search requests', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'dir/empty.json': {
          data: {
            attributes: {},
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/card-api',
                name: 'CardDef',
              },
            },
          },
        },
      },
    });
    let response = await handle(
      realm,
      new Request(`${testRealmURL}_search`, {
        method: 'QUERY',
        headers: {
          Accept: 'application/vnd.card+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          // anchored to cards — an unanchored entry query also returns the
          // card `.json` file rows
          searchEntryWireQueryFromQuery(
            { filter: { type: baseCardRef } },
            { fields: ['item'] },
          ),
        ),
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
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
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
                module: `${testModuleRealm}person`,
                name: 'Person',
              },
            },
          },
        },
        'dir/mango.json': {
          data: {
            id: `${testRealmURL}dir/mango`,
            attributes: {
              cardDescription: null,
              cardThumbnailURL: null,
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
                module: `${testModuleRealm}pet`,
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
                  self: `${testModuleRealm}hassan`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: `${testModuleRealm}pet`,
                name: 'Pet',
              },
            },
          },
        },
      },
    });

    let response = await handle(
      realm,
      new Request(`${testRealmURL}_search`, {
        method: 'QUERY',
        headers: {
          Accept: 'application/vnd.card+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          searchEntryWireQueryFromQuery(
            {
              // anchored to cards — an unanchored entry query also returns
              // the card `.json` file rows
              filter: { type: baseCardRef },
              sort: [
                {
                  by: 'id',
                  on: {
                    module: rri(`${baseRealmRRI}card-api`),
                    name: 'CardDef',
                  },
                },
              ],
            },
            { fields: ['item'] },
          ),
        ),
      }),
    );
    let json = await response.json();
    let mangoCreatedAt = await getFileCreatedAt(realm, 'dir/mango.json');
    let marikoCreatedAt = await getFileCreatedAt(realm, 'dir/mariko.json');
    let vanGoghCreatedAt = await getFileCreatedAt(realm, 'dir/vanGogh.json');
    // `/_search` returns `entry` resources in `data` (each just an
    // id + refs); the full card resources — the matched results themselves and
    // their `loadLinks`-expanded relationship targets — travel in `included`.
    let entries = json.data as any[];
    assert.strictEqual(entries.length, 3, 'returns 3 search entries');
    assert.strictEqual(json.meta.page.total, 3, 'meta page total is 3');

    let included = (json.included ?? []) as any[];
    let mango = included.find((r) => r.id === `${testRealmURL}dir/mango`);
    assert.ok(mango, 'mango is in results');
    assert.strictEqual(mango.attributes.firstName, 'Mango', 'mango name');
    assert.strictEqual(
      mango.relationships.owner.links.self,
      './mariko',
      'mango owner self link',
    );
    assert.strictEqual(
      mango.relationships.owner.data.id,
      `${testRealmURL}dir/mariko`,
      'mango owner id',
    );
    assert.strictEqual(
      mango.meta.resourceCreatedAt,
      mangoCreatedAt,
      'mango createdAt',
    );

    let mariko = included.find((r) => r.id === `${testRealmURL}dir/mariko`);
    assert.ok(mariko, 'mariko is in results');
    assert.strictEqual(
      mariko.attributes.fullName,
      'Mariko Abdel-Rahman',
      'mariko fullName',
    );
    assert.strictEqual(
      mariko.meta.resourceCreatedAt,
      marikoCreatedAt,
      'mariko createdAt',
    );

    let vanGogh = included.find((r) => r.id === `${testRealmURL}dir/vanGogh`);
    assert.ok(vanGogh, 'vanGogh is in results');
    assert.strictEqual(
      vanGogh.relationships.owner.links.self,
      `${testModuleRealm}hassan`,
      'vanGogh owner self link',
    );
    assert.strictEqual(
      vanGogh.relationships.owner.data.id,
      `${testModuleRealm}hassan`,
      'vanGogh owner id',
    );
    assert.strictEqual(
      vanGogh.meta.resourceCreatedAt,
      vanGoghCreatedAt,
      'vanGogh createdAt',
    );

    let hassan = included.find((r) => r.id === `${testModuleRealm}hassan`);
    assert.ok(hassan, 'hassan (cross-realm linksTo target) is included');
  });

  test('included card uses correct module path when realm is mounted', async function (assert) {
    let mountedRealmURL = 'https://localhost:4201/mounted-test/';
    let spreadsheet1Id = 'spreadsheet-1';
    let spreadsheet2Id = 'spreadsheet-2';

    class Spreadsheet extends CardDef {
      static displayName = 'Spreadsheet';
      @field name = contains(StringField);
    }

    class CatalogIndex extends CardDef {
      static displayName = 'CatalogIndex';
      @field spreadsheets = linksToMany(Spreadsheet);
    }

    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: mountedRealmURL,
      contents: {
        'spreadsheet/spreadsheet.gts': {
          Spreadsheet,
        },
        'index.gts': {
          CatalogIndex,
        },
        [`spreadsheet/Spreadsheet/${spreadsheet1Id}.json`]: {
          data: {
            attributes: {
              name: 'Sheet 1',
            },
            meta: {
              adoptsFrom: {
                module: '../spreadsheet',
                name: 'Spreadsheet',
              },
            },
          },
        },
        [`spreadsheet/Spreadsheet/${spreadsheet2Id}.json`]: {
          data: {
            attributes: {
              name: 'Sheet 2',
            },
            meta: {
              adoptsFrom: {
                module: '../spreadsheet',
                name: 'Spreadsheet',
              },
            },
          },
        },
        'index.json': {
          data: {
            relationships: {
              'spreadsheets.0': {
                links: {
                  self: `./spreadsheet/Spreadsheet/${spreadsheet1Id}`,
                },
              },
              'spreadsheets.1': {
                links: {
                  self: `./spreadsheet/Spreadsheet/${spreadsheet2Id}`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: './index',
                name: 'CatalogIndex',
              },
            },
          },
        },
      },
    });

    let response = await handle(
      realm,
      new Request(`${mountedRealmURL}index`, {
        headers: {
          Accept: 'application/vnd.card+json',
        },
      }),
    );
    assert.strictEqual(response.status, 200, 'successful http status');
    let json = await response.json();
    let included = json.included?.find(
      (resource: any) =>
        resource.id ===
        `${mountedRealmURL}spreadsheet/Spreadsheet/${spreadsheet1Id}`,
    );
    assert.ok(included, 'linked spreadsheet card is included');
    assert.strictEqual(
      included?.meta?.adoptsFrom?.module,
      './spreadsheet/spreadsheet',
      'adoptsFrom.module has the correct path',
    );
  });

  test('realm can serve directory requests', async function (assert) {
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'dir/empty.json': {
          data: {
            attributes: {},
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/card-api',
                name: 'CardDef',
              },
            },
          },
        },
        'dir/subdir/file.txt': '',
      },
    });
    let response = await handle(
      realm,
      new Request(`${testRealmURL}dir/`, {
        headers: {
          Accept: 'application/vnd.api+json',
        },
      }),
    );
    assert.strictEqual(response.status, 200, 'HTTP 200 status code');
    let json = await response.json();
    let resourceCreatedAt = await getFileCreatedAt(realm, 'dir/empty.json');
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
                lastModified: adapter.lastModifiedMap.get(
                  `${testRealmURL}dir/empty.json`,
                ),
                resourceCreatedAt: resourceCreatedAt!,
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
      import { CardDef } from '@cardstack/base/card-api';
      export class Post extends CardDef {}
    `;

    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
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
      let response = await handle(
        realm,
        new Request(`${testRealmURL}dir/`, {
          headers: {
            Accept: 'application/vnd.api+json',
          },
        }),
      );
      assert.strictEqual(response.status, 404, 'HTTP 404 response');
    }
    {
      let response = await handle(
        realm,
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
      let response = await handle(
        realm,
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

  test('realm can serve info requests by reading the RealmConfig card', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'realm.json': realmConfigCardJSON({
          name: 'Example Workspace',
          backgroundURL: 'https://example-background-url.com',
          iconURL: 'https://example-icon-url.com',
        }),
      },
    });
    let response = await handle(
      realm,
      new Request(`${testRealmURL}_info`, {
        method: 'QUERY',
        headers: {
          Accept: 'application/vnd.api+json',
        },
      }),
    );
    let json = await response.json();
    assert.strictEqual(json.data.id, testRealmURL, 'id is correct');
    assert.strictEqual(json.data.type, 'realm-info', 'type is correct');
    let attributes = json.data.attributes;
    assert.strictEqual(attributes.name, 'Example Workspace', 'name');
    assert.strictEqual(
      attributes.backgroundURL,
      'https://example-background-url.com',
      'backgroundURL',
    );
    assert.strictEqual(
      attributes.iconURL,
      'https://example-icon-url.com',
      'iconURL',
    );
    assert.strictEqual(
      attributes.realmUserId,
      '@realm_server:localhost',
      'realmUserId',
    );
    assert.strictEqual(attributes.showAsCatalog, null, 'showAsCatalog');
    assert.strictEqual(attributes.visibility, 'public', 'visibility');
    assert.strictEqual(attributes.publishable, null, 'publishable');
    assert.strictEqual(attributes.lastPublishedAt, null, 'lastPublishedAt');
    assert.strictEqual(
      attributes.includePrerenderedDefaultRealmIndex,
      null,
      'includePrerenderedDefaultRealmIndex',
    );
  });

  test('realm can serve info requests if the RealmConfig card is missing', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {},
    });
    let response = await handle(
      realm,
      new Request(`${testRealmURL}_info`, {
        method: 'QUERY',
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

  test('realm can serve info requests if the RealmConfig card is malformed', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'realm.json': `Some example content that is not valid json`,
      },
    });
    let response = await handle(
      realm,
      new Request(`${testRealmURL}_info`, {
        method: 'QUERY',
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
      mockMatrixUtils,
      contents: {
        'FieldDef/1.json': {
          data: {
            type: 'card',
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/card-api',
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
