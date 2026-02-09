import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';
import { waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { DataQuery, Loader, Realm } from '@cardstack/runtime-common';
import { baseRealm, type LooseSingleCardDocument } from '@cardstack/runtime-common';

import type { SearchDataArgs } from '@cardstack/host/resources/search-data';
import { SearchDataResource } from '@cardstack/host/resources/search-data';

import type LoaderService from '@cardstack/host/services/loader-service';
import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

import type { CardDocFiles } from '../../helpers';

class StubRealmService extends RealmService {
  realmOfURL(_url: URL) {
    return new URL(testRealmURL);
  }
}

function getSearchDataResourceForTest(
  owner: object,
  args: () => SearchDataArgs,
) {
  return SearchDataResource.from(owner, args) as unknown as Omit<
    SearchDataResource,
    'loaded'
  > & {
    loaded: Promise<void>;
  };
}

module(`Integration | search data resource`, function (hooks) {
  let loader: Loader;
  let loaderService: LoaderService;
  let realm: Realm;

  setupRenderingTest(hooks);
  hooks.beforeEach(function () {
    getOwner(this)!.register('service:realm', StubRealmService);
    loaderService = getService('loader-service');
    loader = loaderService.loader;
  });

  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
    autostart: true,
  });
  setupBaseRealm(hooks);
  hooks.beforeEach(async function (this: RenderingTestContext) {
    let cardApi = await loader.import(`${baseRealm.url}card-api`);
    let string = await loader.import(`${baseRealm.url}string`);

    let { contains, field, CardDef, FieldDef } = cardApi;
    let { default: StringField } = string;

    class PersonField extends FieldDef {
      @field firstName = contains(StringField);
      @field lastName = contains(StringField);
    }

    class Book extends CardDef {
      static displayName = 'Book';
      @field author = contains(PersonField);
    }

    const sampleCards: CardDocFiles = {
      'books/1.json': {
        data: {
          type: 'card',
          attributes: {
            author: {
              firstName: 'Mango',
              lastName: 'Abdel-Rahman',
            },
            editions: 1,
            pubDate: '2022-07-01',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}book`,
              name: 'Book',
            },
          },
        },
      },
      'books/2.json': {
        data: {
          type: 'card',
          attributes: {
            author: {
              firstName: 'Van Gogh',
              lastName: 'Abdel-Rahman',
            },
            editions: 0,
            pubDate: '2023-08-01',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}book`,
              name: 'Book',
            },
          },
        },
      },
    };

    ({ realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'book.gts': { Book },
        ...sampleCards,
        'files/hello.txt': 'Hello world',
        'files/notes.txt': 'Some notes',
      },
    }));
  });

  test(`returns raw card resources with asData`, async function (assert) {
    let query: DataQuery = {
      filter: {
        type: {
          module: `${testRealmURL}book`,
          name: 'Book',
        },
      },
      asData: true,
    };
    let search = getSearchDataResourceForTest(loaderService, () => ({
      named: {
        query,
        realms: [testRealmURL],
        isLive: false,
        owner: this.owner,
      },
    }));
    await search.loaded;

    assert.strictEqual(search.resources.length, 2, 'returns 2 resources');
    for (let resource of search.resources) {
      assert.strictEqual(resource.type, 'card', 'resource type is card');
      assert.ok(resource.id, 'resource has id');
      assert.ok(resource.meta, 'resource has meta');
      assert.ok(
        resource.attributes,
        'resource has attributes (raw JSON:API object)',
      );
    }
  });

  test(`returns raw resources with sparse fieldsets`, async function (assert) {
    let query: DataQuery = {
      filter: {
        on: {
          module: `${testRealmURL}book`,
          name: 'Book',
        },
        eq: {
          'author.firstName': 'Mango',
        },
      },
      fields: { card: ['author'] },
      asData: true,
    };
    let search = getSearchDataResourceForTest(loaderService, () => ({
      named: {
        query,
        realms: [testRealmURL],
        isLive: false,
        owner: this.owner,
      },
    }));
    await search.loaded;

    assert.strictEqual(search.resources.length, 1, 'returns 1 resource');
    let resource = search.resources[0];
    let attrKeys = Object.keys(resource.attributes ?? {});
    assert.deepEqual(
      attrKeys,
      ['author'],
      'only requested field is present in attributes',
    );
  });

  test(`returns raw file-meta resources with asData`, async function (assert) {
    let query: DataQuery = {
      filter: {
        type: {
          module: `${baseRealm.url}file-api`,
          name: 'FileDef',
        },
      },
      fields: { 'file-meta': ['name', 'url'] },
      asData: true,
    };
    let search = getSearchDataResourceForTest(loaderService, () => ({
      named: {
        query,
        realms: [testRealmURL],
        isLive: false,
        owner: this.owner,
      },
    }));
    await search.loaded;

    assert.ok(search.resources.length >= 2, 'returns file-meta resources');
    for (let resource of search.resources) {
      assert.strictEqual(
        resource.type,
        'file-meta',
        'resource type is file-meta',
      );
      let attrKeys = Object.keys(resource.attributes ?? {});
      assert.ok(
        attrKeys.every((k) => ['name', 'url'].includes(k)),
        `only requested fields present, got: ${attrKeys.join(', ')}`,
      );
    }
  });

  test(`live search updates when realm changes`, async function (assert) {
    let query: DataQuery = {
      filter: {
        type: {
          module: `${testRealmURL}book`,
          name: 'Book',
        },
      },
      asData: true,
    };
    let search = getSearchDataResourceForTest(loaderService, () => ({
      named: {
        query,
        realms: [testRealmURL],
        isLive: true,
        owner: this.owner,
      },
    }));
    await search.loaded;

    assert.strictEqual(search.resources.length, 2, 'initial results');

    await realm.write(
      'books/3.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            author: {
              firstName: 'Paper',
              lastName: 'Abdel-Rahman',
            },
            editions: 0,
            pubDate: '2023-08-01',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}book`,
              name: 'Book',
            },
          },
        },
      } as LooseSingleCardDocument),
    );

    await waitUntil(() => search.resources.length === 3);

    assert.strictEqual(
      search.resources.length,
      3,
      'live update adds new resource',
    );
    let ids = search.resources.map((r) => r.id);
    assert.ok(
      ids.includes(`${testRealmURL}books/3`),
      'new book appears in results',
    );
  });

  test(`returns correct meta with pagination`, async function (assert) {
    let query: DataQuery = {
      filter: {
        type: {
          module: `${testRealmURL}book`,
          name: 'Book',
        },
      },
      page: {
        number: 0,
        size: 1,
      },
      asData: true,
    };
    let search = getSearchDataResourceForTest(loaderService, () => ({
      named: {
        query,
        realms: [testRealmURL],
        isLive: false,
        owner: this.owner,
      },
    }));
    await search.loaded;

    assert.strictEqual(search.resources.length, 1, 'page contains 1 resource');
    assert.strictEqual(
      search.meta.page?.total,
      2,
      'meta.page.total shows total count across all pages',
    );
  });
});
