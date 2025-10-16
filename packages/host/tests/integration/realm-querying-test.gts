import { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, baseCardRef } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';
import { RealmPaths } from '@cardstack/runtime-common/paths';

import { RealmIndexQueryEngine } from '@cardstack/runtime-common/realm-index-query-engine';

import {
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  type CardDocFiles,
  setupIntegrationTestRealm,
  testModuleRealm,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

const paths = new RealmPaths(new URL(testRealmURL));
let loader: Loader;
module(`Integration | realm querying`, function (hooks) {
  setupRenderingTest(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
  });

  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks);

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  const sampleCards: CardDocFiles = {
    'card-1.json': {
      data: {
        type: 'card',
        attributes: {
          title: 'Card 1',
          description: 'Sample post',
          author: {
            firstName: 'Cardy',
            lastName: 'Stackington Jr. III',
          },
          views: 0,
        },
        meta: {
          adoptsFrom: {
            module: `${testModuleRealm}article`,
            name: 'Article',
          },
        },
      },
    },
    'card-2.json': {
      data: {
        type: 'card',
        attributes: {
          author: { firstName: 'Cardy', lastName: 'Jones' },
          editions: 1,
          pubDate: '2023-09-01',
        },
        meta: {
          adoptsFrom: {
            module: `${testModuleRealm}book`,
            name: 'Book',
          },
        },
      },
    },
    'cards/1.json': {
      data: {
        type: 'card',
        attributes: {
          title: 'Card 1',
          description: 'Sample post',
          author: {
            firstName: 'Carl',
            lastName: 'Stack',
            posts: 1,
          },
          createdAt: new Date(2022, 7, 1),
          views: 10,
        },
        meta: {
          adoptsFrom: {
            module: `${testModuleRealm}post`,
            name: 'Post',
          },
        },
      },
    },
    'cards/2.json': {
      data: {
        type: 'card',
        attributes: {
          title: 'Card 2',
          description: 'Sample post',
          author: {
            firstName: 'Carl',
            lastName: 'Deck',
            posts: 3,
          },
          createdAt: new Date(2022, 7, 22),
          views: 5,
        },
        meta: {
          adoptsFrom: {
            module: `${testModuleRealm}article`,
            name: 'Article',
          },
        },
      },
    },
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
            module: `${testModuleRealm}book`,
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
            module: `${testModuleRealm}book`,
            name: 'Book',
          },
        },
      },
    },
    'books/3.json': {
      data: {
        type: 'card',
        attributes: {
          author: {
            firstName: 'Jackie',
            lastName: 'Aguilar',
          },
          editions: 2,
          pubDate: '2022-08-01',
        },
        meta: {
          adoptsFrom: {
            module: `${testModuleRealm}book`,
            name: 'Book',
          },
        },
      },
    },
    'spec-1.json': {
      data: {
        type: 'card',
        attributes: {
          title: 'Post',
          description: 'A card that represents a blog post',
          specType: 'card',
          ref: {
            module: `${testModuleRealm}post`,
            name: 'Post',
          },
        },
        meta: {
          adoptsFrom: {
            module: `${baseRealm.url}spec`,
            name: 'Spec',
          },
        },
      },
    },
    'spec-2.json': {
      data: {
        type: 'card',
        attributes: {
          title: 'Article',
          description: 'A card that represents an online article ',
          specType: 'card',
          ref: {
            module: `${testModuleRealm}article`,
            name: 'Article',
          },
        },
        meta: {
          adoptsFrom: {
            module: `${baseRealm.url}spec`,
            name: 'Spec',
          },
        },
      },
    },
    'event-1.json': {
      data: {
        type: 'card',
        attributes: {
          title: "Mango's Birthday",
          venue: 'Dog Park',
          date: '2024-10-30',
        },
        meta: {
          adoptsFrom: {
            module: `${testModuleRealm}event`,
            name: 'Event',
          },
        },
      },
    },
    'event-2.json': {
      data: {
        type: 'card',
        attributes: {
          title: "Van Gogh's Birthday",
          venue: 'Backyard',
          date: '2024-11-19',
        },
        meta: {
          adoptsFrom: {
            module: `${testModuleRealm}event`,
            name: 'Event',
          },
        },
      },
    },
    'mango.json': {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Mango',
          numberOfTreats: ['one', 'two'],
        },
        meta: {
          adoptsFrom: {
            module: `${testModuleRealm}dog`,
            name: 'Dog',
          },
        },
      },
    },
    'ringo.json': {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Ringo',
          numberOfTreats: ['three', 'five'],
        },
        meta: {
          adoptsFrom: {
            module: `${testModuleRealm}dog`,
            name: 'Dog',
          },
        },
      },
    },
    'vangogh.json': {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Van Gogh',
          numberOfTreats: ['two', 'nine'],
        },
        meta: {
          adoptsFrom: {
            module: `${testModuleRealm}dog`,
            name: 'Dog',
          },
        },
      },
    },
    'friend1.json': {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Hassan',
        },
        relationships: {
          friend: {
            links: {
              self: `${paths.url}friend2`,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${testModuleRealm}friend`,
            name: 'Friend',
          },
        },
      },
    },
    'friend2.json': {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Mango',
        },
        relationships: {
          friend: {
            links: {
              self: null,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${testModuleRealm}friend`,
            name: 'Friend',
          },
        },
      },
    },
    'booking1.json': {
      data: {
        type: 'card',
        attributes: {
          hosts: [
            {
              firstName: 'Arthur',
            },
            {
              firstName: 'Ed',
              lastName: 'Faulkner',
            },
          ],
          sponsors: ['Sony', 'Nintendo'],
          posts: [
            {
              title: 'post 1',
              author: {
                firstName: 'A',
                lastName: null,
                posts: 10,
              },
              views: 16,
            },
          ],
        },
        relationships: {},
        meta: {
          adoptsFrom: {
            module: `${testModuleRealm}booking`,
            name: 'Booking',
          },
        },
      },
    },
    'booking2.json': {
      data: {
        type: 'card',
        attributes: {
          hosts: [
            {
              firstName: 'Arthur',
              lastName: 'Faulkner',
            },
          ],
          sponsors: null,
          posts: [
            {
              title: 'post 1',
              author: {
                firstName: 'A',
                lastName: 'B',
                posts: 5,
              },
              views: 10,
            },
            {
              title: 'post 2',
              author: {
                firstName: 'C',
                lastName: 'D',
                posts: 11,
              },
              views: 13,
            },
            {
              title: 'post 2',
              author: {
                firstName: 'C',
                lastName: 'D',
                posts: 2,
              },
              views: 0,
            },
          ],
        },
        relationships: {},
        meta: {
          adoptsFrom: {
            module: `${testModuleRealm}booking`,
            name: 'Booking',
          },
        },
      },
    },
    'person-card1.json': {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Person',
          lastName: 'Card 1',
        },
        meta: {
          adoptsFrom: {
            module: `${testModuleRealm}person`,
            name: 'Person',
          },
        },
      },
    },
    'person-card2.json': {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Person',
          lastName: 'Card 2',
        },
        meta: {
          adoptsFrom: {
            module: `${testModuleRealm}person`,
            name: 'Person',
          },
        },
      },
    },
    'larry.json': {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Larry',
        },
        relationships: {
          'friends.0': {
            links: {
              self: './missing',
            },
          },
          'friends.1': {
            links: {
              self: './empty',
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${testModuleRealm}friends`,
            name: 'Friends',
          },
        },
      },
    },
    'missing.json': {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Missing',
        },
        meta: {
          adoptsFrom: {
            module: `${testModuleRealm}friends`,
            name: 'Friends',
          },
        },
      },
    },
    'empty.json': {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Empty',
        },
        relationships: {
          'friends.0': {
            links: {
              self: null,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${testModuleRealm}friends`,
            name: 'Friends',
          },
        },
      },
    },
    'bob.json': {
      data: {
        type: 'card',
        attributes: {
          stringField: 'Bob',
          stringArrayField: ['blue', 'tree', 'carrot'],
        },
        meta: {
          adoptsFrom: {
            module: `${testModuleRealm}type-examples`,
            name: 'TypeExamples',
          },
        },
      },
    },
    'alicia.json': {
      data: {
        type: 'card',
        attributes: {
          stringField: 'Alicia',
          stringArrayField: null,
        },
        meta: {
          adoptsFrom: {
            module: `${testModuleRealm}type-examples`,
            name: 'TypeExamples',
          },
        },
      },
    },
    'margaret.json': {
      data: {
        type: 'card',
        attributes: {
          stringField: 'Margaret',
        },
        meta: {
          adoptsFrom: {
            module: `${testModuleRealm}type-examples`,
            name: 'TypeExamples',
          },
        },
      },
    },
    'noname.json': {
      data: {
        type: 'card',
        attributes: {
          stringArrayField: ['happy', 'green'],
        },
        meta: {
          adoptsFrom: {
            module: `${testModuleRealm}type-examples`,
            name: 'TypeExamples',
          },
        },
      },
    },
  };

  let queryEngine: RealmIndexQueryEngine;

  hooks.beforeEach(async function () {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      sampleCards,
    });
    queryEngine = realm.realmIndexQueryEngine;
  });

  test(`can search for cards by using the 'eq' filter`, async function (assert) {
    let { data: matching } = await queryEngine.search({
      filter: {
        on: { module: `${testModuleRealm}post`, name: 'Post' },
        eq: { title: 'Card 1', description: 'Sample post' },
      },
    });
    assert.deepEqual(
      matching.map((m) => m.id),
      [`${paths.url}card-1`, `${paths.url}cards/1`],
    );
  });

  test(`can use 'eq' to find empty values`, async function (assert) {
    let { data: matching } = await queryEngine.search({
      filter: {
        on: { module: `${testModuleRealm}booking`, name: 'Booking' },
        eq: { 'posts.author.lastName': null },
      },
    });
    assert.deepEqual(
      matching.map((m) => m.id),
      [`${testRealmURL}booking1`],
    );
  });

  test(`can use 'eq' to find missing values`, async function (assert) {
    let { data: matching } = await queryEngine.search({
      filter: {
        on: {
          module: `${testModuleRealm}type-examples`,
          name: 'TypeExamples',
        },
        eq: { stringField: null },
      },
    });
    assert.deepEqual(
      matching.map((m) => m.id),
      [`${testRealmURL}noname`],
    );
  });

  test(`can use 'eq' to find empty containsMany field and missing containsMany field`, async function (assert) {
    let { data: matching } = await queryEngine.search({
      filter: {
        on: {
          module: `${testModuleRealm}type-examples`,
          name: 'TypeExamples',
        },
        eq: { stringArrayField: null },
      },
    });
    assert.deepEqual(
      matching.map((m) => m.id),
      [`${testRealmURL}alicia`, `${testRealmURL}margaret`],
    );
  });

  test(`can use 'eq' to find empty linksToMany field and missing linksToMany field`, async function (assert) {
    let { data: matching } = await queryEngine.search({
      filter: {
        on: {
          module: `${testModuleRealm}friends`,
          name: 'Friends',
        },
        eq: { friends: null },
      },
    });
    assert.deepEqual(
      matching.map((m) => m.id),
      [`${testRealmURL}empty`, `${testRealmURL}missing`],
    );
  });

  test(`can use 'eq' to find empty linksTo field`, async function (assert) {
    let { data: matching } = await queryEngine.search({
      filter: {
        on: {
          module: `${testModuleRealm}friend`,
          name: 'Friend',
        },
        every: [{ eq: { firstName: 'Mango' } }, { eq: { friend: null } }],
      },
    });
    assert.deepEqual(
      matching.map((m) => m.id),
      [`${testRealmURL}friend2`],
    );
  });

  test(`can search for cards by using a computed field`, async function (assert) {
    let { data: matching } = await queryEngine.search({
      filter: {
        on: { module: `${testModuleRealm}post`, name: 'Post' },
        eq: { 'author.fullName': 'Carl Stack' },
      },
    });
    assert.deepEqual(
      matching.map((m) => m.id),
      [`${paths.url}cards/1`],
    );
  });

  test('can search for cards by using a linksTo field', async function (assert) {
    let { data: matching } = await queryEngine.search({
      filter: {
        on: { module: `${testModuleRealm}friend`, name: 'Friend' },
        eq: { 'friend.firstName': 'Mango' },
      },
    });
    assert.deepEqual(
      matching.map((m) => m.id),
      [`${paths.url}friend1`],
    );
  });

  test(`can search for cards that have code-ref queryableValue`, async function (assert) {
    let { data: matching } = await queryEngine.search({
      filter: {
        on: {
          module: `${baseRealm.url}spec`,
          name: 'Spec',
        },
        eq: {
          ref: {
            module: `${testModuleRealm}post`,
            name: 'Post',
          },
        },
      },
    });
    assert.deepEqual(
      matching.map((m) => m.id),
      [`${paths.url}spec-1`],
    );
  });

  test('can combine multiple filters', async function (assert) {
    let { data: matching } = await queryEngine.search({
      filter: {
        on: {
          module: `${testModuleRealm}post`,
          name: 'Post',
        },
        every: [
          { eq: { title: 'Card 1' } },
          { not: { eq: { 'author.firstName': 'Cardy' } } },
        ],
      },
    });
    assert.strictEqual(matching.length, 1);
    assert.strictEqual(matching[0]?.id, `${testRealmURL}cards/1`);
  });

  test('can handle a filter with double negatives', async function (assert) {
    let { data: matching } = await queryEngine.search({
      filter: {
        on: { module: `${testModuleRealm}post`, name: 'Post' },
        not: { not: { not: { eq: { 'author.firstName': 'Carl' } } } },
      },
    });
    assert.deepEqual(
      matching.map((m) => m.id),
      [`${paths.url}card-1`],
    );
  });

  test('can filter by card type', async function (assert) {
    let { data: matching } = await queryEngine.search({
      filter: {
        type: { module: `${testModuleRealm}article`, name: 'Article' },
      },
    });
    assert.deepEqual(
      matching.map((m) => m.id),
      [`${paths.url}card-1`, `${paths.url}cards/2`],
      'found cards of type Article',
    );

    matching = (
      await queryEngine.search({
        filter: {
          type: { module: `${testModuleRealm}post`, name: 'Post' },
        },
      })
    ).data;
    assert.deepEqual(
      matching.map((m) => m.id),
      [`${paths.url}card-1`, `${paths.url}cards/1`, `${paths.url}cards/2`],
      'found cards of type Post',
    );
  });

  test(`can filter on a card's own fields using range`, async function (assert) {
    let { data: matching } = await queryEngine.search({
      filter: {
        on: { module: `${testModuleRealm}post`, name: 'Post' },
        range: {
          views: { lte: 10, gt: 5 },
          'author.posts': { gte: 1 },
        },
      },
    });
    assert.deepEqual(
      matching.map((m) => m.id),
      [`${paths.url}cards/1`],
    );
  });

  test(`can filter on a nested field inside a containsMany using 'range'`, async function (assert) {
    {
      let { data: matching } = await queryEngine.search({
        filter: {
          on: { module: `${testModuleRealm}booking`, name: 'Booking' },
          range: {
            'posts.views': { gt: 10, lte: 16 },
            'posts.author.posts': { gte: 5, lt: 10 },
          },
        },
      });
      assert.deepEqual(
        matching.map((m) => m.id),
        [`${paths.url}booking2`],
      );
    }
    {
      let { data: matching } = await queryEngine.search({
        filter: {
          on: { module: `${testModuleRealm}booking`, name: 'Booking' },
          range: {
            'posts.views': { lte: 0 },
          },
        },
      });
      assert.deepEqual(
        matching.map((m) => m.id),
        [`${paths.url}booking2`],
      );
    }
  });

  test('can use an eq filter with a date field', async function (assert) {
    let { data: matching } = await queryEngine.search({
      filter: {
        on: { module: `${testModuleRealm}event`, name: 'Event' },
        eq: {
          date: '2024-10-30',
        },
      },
    });
    assert.deepEqual(
      matching.map((m) => m.id),
      [`${paths.url}event-1`],
    );
  });

  test(`can filter on a nested field using 'eq'`, async function (assert) {
    let { data: matching } = await queryEngine.search({
      filter: {
        on: { module: `${testModuleRealm}post`, name: 'Post' },
        eq: { 'author.firstName': 'Carl' },
      },
    });
    assert.deepEqual(
      matching.map((m) => m.id),
      [`${paths.url}cards/1`, `${paths.url}cards/2`],
    );
  });

  test(`can filter on a nested field inside a containsMany using 'eq'`, async function (assert) {
    {
      let { data: matching } = await queryEngine.search({
        filter: {
          on: { module: `${testModuleRealm}booking`, name: 'Booking' },
          eq: { 'hosts.firstName': 'Arthur' },
        },
      });
      assert.deepEqual(
        matching.map((m) => m.id),
        [`${paths.url}booking1`, `${paths.url}booking2`],
        'eq on hosts.firstName',
      );
    }
    {
      let { data: matching } = await queryEngine.search({
        filter: {
          on: { module: `${testModuleRealm}booking`, name: 'Booking' },
          eq: { 'hosts.firstName': null },
        },
      });
      assert.strictEqual(matching.length, 0, 'eq on null hosts.firstName');
    }
    {
      let { data: matching } = await queryEngine.search({
        filter: {
          on: { module: `${testModuleRealm}booking`, name: 'Booking' },
          eq: {
            'posts.author.firstName': 'A',
            'posts.author.lastName': 'B',
          },
        },
      });
      assert.deepEqual(
        matching.map((m) => m.id),
        [`${paths.url}booking2`],
        'eq on posts.author.firstName and posts.author.lastName',
      );
    }
    {
      let { data: matching } = await queryEngine.search({
        filter: {
          on: { module: `${testModuleRealm}booking`, name: 'Booking' },
          eq: {
            'hosts.firstName': 'Arthur',
            'posts.author.lastName': null,
          },
        },
      });
      assert.deepEqual(
        matching.map((m) => m.id),
        [`${paths.url}booking1`],
        'eq on hosts.firstName, posts.author.firstName, and null posts.author.lastName',
      );
    }
  });

  test(`can filter on an array of primitive fields inside a containsMany using 'eq'`, async function (assert) {
    {
      let { data: matching } = await queryEngine.search({
        filter: {
          on: {
            module: `${testModuleRealm}booking`,
            name: 'Booking',
          },
          eq: { sponsors: 'Nintendo' },
        },
      });
      assert.deepEqual(
        matching.map((m) => m.id),
        [`${paths.url}booking1`],
        'eq on sponsors',
      );
    }
    {
      let { data: matching } = await queryEngine.search({
        filter: {
          on: {
            module: `${testModuleRealm}booking`,
            name: 'Booking',
          },
          eq: { sponsors: 'Playstation' },
        },
      });
      assert.strictEqual(
        matching.length,
        0,
        'eq on nonexisting value in sponsors',
      );
    }
    {
      let { data: matching } = await queryEngine.search({
        filter: {
          on: {
            module: `${testModuleRealm}booking`,
            name: 'Booking',
          },
          eq: {
            'hosts.firstName': 'Arthur',
            sponsors: null,
          },
        },
      });
      assert.deepEqual(
        matching.map((m) => m.id),
        [`${paths.url}booking2`],
        'eq on hosts.firstName and null sponsors',
      );
    }
  });

  test('can negate a filter', async function (assert) {
    let { data: matching } = await queryEngine.search({
      filter: {
        on: { module: `${testModuleRealm}article`, name: 'Article' },
        not: { eq: { 'author.firstName': 'Carl' } },
      },
    });
    assert.deepEqual(
      matching.map((m) => m.id),
      [`${testRealmURL}card-1`],
    );
  });

  test('can combine multiple types', async function (assert) {
    let { data: matching } = await queryEngine.search({
      filter: {
        any: [
          {
            on: {
              module: `${testModuleRealm}article`,
              name: 'Article',
            },
            eq: { 'author.firstName': 'Cardy' },
          },
          {
            on: { module: `${testModuleRealm}book`, name: 'Book' },
            eq: { 'author.firstName': 'Cardy' },
          },
        ],
      },
    });
    assert.deepEqual(
      matching.map((m) => m.id),
      [`${paths.url}card-1`, `${paths.url}card-2`],
    );
  });

  // sorting
  test('can sort in alphabetical order', async function (assert) {
    let { data: matching } = await queryEngine.search({
      sort: [
        {
          by: 'author.lastName',
          on: { module: `${testModuleRealm}article`, name: 'Article' },
        },
      ],
      filter: {
        type: { module: `${testModuleRealm}article`, name: 'Article' },
      },
    });
    assert.deepEqual(
      matching.map((m) => m.id),
      [`${paths.url}cards/2`, `${paths.url}card-1`],
    );
  });

  test('can sort in reverse alphabetical order', async function (assert) {
    let { data: matching } = await queryEngine.search({
      sort: [
        {
          by: 'author.firstName',
          on: { module: `${testModuleRealm}article`, name: 'Article' },
          direction: 'desc',
        },
      ],
      filter: {
        type: { module: `${testModuleRealm}post`, name: 'Post' },
      },
    });
    assert.deepEqual(
      matching.map((m) => m.id),
      [
        `${paths.url}cards/1`, // type is post
        `${paths.url}cards/2`, // Carl
        `${paths.url}card-1`, // Cardy
      ],
    );
  });

  test('can sort by card display name (card type shown in the interface)', async function (assert) {
    let { data: matching } = await queryEngine.search({
      sort: [
        {
          on: baseCardRef,
          by: '_cardType',
        },
      ],
    });

    // note that the card id is always included as a secondary sort
    // field in the case of ties for the specified sort field
    assert.deepEqual(
      matching.map((m) => m.id),
      [
        `${paths.url}card-1`, // article
        `${paths.url}cards/2`, // article
        `${paths.url}books/1`, // book
        `${paths.url}books/2`, // book
        `${paths.url}books/3`, // book
        `${paths.url}card-2`, // book
        `${paths.url}booking1`, // booking
        `${paths.url}booking2`, // booking
        `${paths.url}mango`, // dog
        `${paths.url}ringo`, // dog
        `${paths.url}vangogh`, // dog
        `${paths.url}event-1`, // event
        `${paths.url}event-2`, // event
        `${paths.url}friend1`, // friend
        `${paths.url}friend2`, // friend
        `${paths.url}empty`, // friends
        `${paths.url}larry`, // friends
        `${paths.url}missing`, // friends
        `${paths.url}person-card1`, // person
        `${paths.url}person-card2`, // person
        `${paths.url}cards/1`, // person
        `${paths.url}spec-1`, // spec
        `${paths.url}spec-2`, // spec
        `${paths.url}alicia`, // type example
        `${paths.url}bob`, // type example
        `${paths.url}margaret`, // type example
        `${paths.url}noname`, // type example
      ],
    );
  });

  test('can sort by multiple string field conditions in given directions', async function (assert) {
    let { data: matching } = await queryEngine.search({
      sort: [
        {
          by: 'author.lastName',
          on: { module: `${testModuleRealm}book`, name: 'Book' },
          direction: 'asc',
        },
        {
          by: 'author.firstName',
          on: { module: `${testModuleRealm}book`, name: 'Book' },
          direction: 'desc',
        },
      ],
      filter: {
        type: { module: `${testModuleRealm}book`, name: 'Book' },
      },
    });
    assert.deepEqual(
      matching.map((m) => m.id),
      [
        `${paths.url}books/2`, // Van Gogh Ab
        `${paths.url}books/1`, // Mango Ab
        `${paths.url}books/3`, // Jackie Ag
        `${paths.url}card-2`, // Cardy --> lastName is null
      ],
    );
  });

  test('can sort by number value', async function (assert) {
    let { data: matching } = await queryEngine.search({
      sort: [
        {
          by: 'editions',
          on: { module: `${testModuleRealm}book`, name: 'Book' },
        },
        {
          by: 'author.lastName',
          on: { module: `${testModuleRealm}book`, name: 'Book' },
        },
      ],
      filter: {
        type: { module: `${testModuleRealm}book`, name: 'Book' },
      },
    });
    assert.deepEqual(
      matching.map((m) => m.id),
      [
        `${paths.url}books/2`, // 0
        `${paths.url}books/1`, // 1
        `${paths.url}card-2`, // 1
        `${paths.url}books/3`, // 2
      ],
    );
  });

  test('can sort by date', async function (assert) {
    let { data: matching } = await queryEngine.search({
      sort: [
        {
          by: 'pubDate',
          on: { module: `${testModuleRealm}book`, name: 'Book' },
        },
      ],
      filter: {
        type: { module: `${testModuleRealm}book`, name: 'Book' },
      },
    });
    // note that sorting by nulls is problematic in that sqlite
    // considers nulls the smallest possible value and postgres considers
    // nulls the largest possible value. removing tests that make
    // assertions around the positions of nulls as it cannot be run
    // consistently between postgres, sqlite, and our in-memory index
    assert.deepEqual(
      matching.map((m) => m.id),
      [
        `${paths.url}books/1`, // 2022-07-01
        `${paths.url}books/3`, // 2022-08-01
        `${paths.url}books/2`, // 2023-08-01
        `${paths.url}card-2`, // 2023-09-01
      ],
    );
  });

  test('can sort by mixed field types', async function (assert) {
    let { data: matching } = await queryEngine.search({
      sort: [
        {
          by: 'editions',
          on: { module: `${testModuleRealm}book`, name: 'Book' },
          direction: 'desc',
        },
        {
          by: 'author.lastName',
          on: { module: `${testModuleRealm}book`, name: 'Book' },
        },
      ],
      filter: {
        type: { module: `${testModuleRealm}book`, name: 'Book' },
      },
    });
    assert.deepEqual(
      matching.map((m) => m.id),
      [
        `${paths.url}books/3`, // 2
        `${paths.url}books/1`, // 1 // Ab
        `${paths.url}card-2`, // 1 // Jo
        `${paths.url}books/2`, // 0
      ],
    );
  });

  test(`can sort on multiple paths in combination with 'any' filter`, async function (assert) {
    let { data: matching } = await queryEngine.search({
      sort: [
        {
          by: 'author.lastName',
          on: { module: `${testModuleRealm}book`, name: 'Book' },
        },
        {
          by: 'author.firstName',
          on: { module: `${testModuleRealm}book`, name: 'Book' },
          direction: 'desc',
        },
      ],
      filter: {
        any: [
          {
            type: {
              module: `${testModuleRealm}book`,
              name: 'Book',
            },
          },
          {
            type: {
              module: `${testModuleRealm}article`,
              name: 'Article',
            },
          },
        ],
      },
    });
    assert.deepEqual(
      matching.map((m) => m.id),
      [
        `${paths.url}books/2`, // Ab Van Gogh
        `${paths.url}books/1`, // Ab Mango
        `${paths.url}books/3`, // Ag Jackie
        `${paths.url}cards/2`, // De Darrin
        `${paths.url}card-2`, // Jo Cardy
        `${paths.url}card-1`, // St Cardy
      ],
    );
  });

  test(`can sort on multiple paths in combination with 'every' filter`, async function (assert) {
    let { data: matching } = await queryEngine.search({
      sort: [
        {
          by: 'author.firstName',
          on: { module: `${testModuleRealm}book`, name: 'Book' },
          direction: 'desc',
        },
      ],
      filter: {
        every: [
          {
            on: { module: `${testModuleRealm}book`, name: 'Book' },
            not: { eq: { 'author.lastName': 'Aguilar' } },
          },
          {
            on: { module: `${testModuleRealm}book`, name: 'Book' },
            eq: { editions: 1 },
          },
        ],
      },
    });
    assert.deepEqual(
      matching.map((m) => m.id),
      [
        `${paths.url}books/1`, // Mango
        `${paths.url}card-2`, // Cardy
      ],
    );
  });

  test(`can search for cards by using the 'contains' filter`, async function (assert) {
    let { data: matching } = await queryEngine.search({
      filter: {
        contains: { title: 'ca' },
      },
    });
    assert.strictEqual(matching.length, 5);
    assert.deepEqual(
      matching.map((m) => m.id),
      [
        `${paths.url}card-1`,
        `${paths.url}cards/1`,
        `${paths.url}cards/2`,
        `${paths.url}person-card1`,
        `${paths.url}person-card2`,
      ],
    );
  });

  test(`can search on specific card by using 'contains' filter`, async function (assert) {
    let { data: personMatchingByTitle } = await queryEngine.search({
      filter: {
        on: { module: `${testModuleRealm}person`, name: 'Person' },
        contains: { title: 'ca' },
      },
    });
    assert.strictEqual(personMatchingByTitle.length, 2);
    assert.deepEqual(
      personMatchingByTitle.map((m) => m.id),
      [`${paths.url}person-card1`, `${paths.url}person-card2`],
    );

    let { data: dogMatchingByFirstName } = await queryEngine.search({
      filter: {
        on: { module: `${testModuleRealm}dog`, name: 'Dog' },
        contains: { firstName: 'go' },
      },
    });
    assert.strictEqual(dogMatchingByFirstName.length, 3);
    assert.deepEqual(
      dogMatchingByFirstName.map((m) => m.id),
      [`${paths.url}mango`, `${paths.url}ringo`, `${paths.url}vangogh`],
    );
  });

  test(`can use 'contains' filter to find 'null' values`, async function (assert) {
    let { data: matching } = await queryEngine.search({
      filter: {
        on: { module: `${testModuleRealm}dog`, name: 'Dog' },
        contains: { title: null },
      },
    });
    assert.strictEqual(matching.length, 3);
  });
});
