import {
  Indexer,
  internalKeyFor,
  baseCardRef,
  type LooseCardResource,
  type DBAdapter,
  type IndexedInstance,
  type BoxelIndexTable,
  type CardResource,
} from '../index';
import { cardSrc, compiledCard } from '../etc/test-fixtures';
import { type SharedTests } from '../helpers';
import { setupIndex } from '../helpers/indexer';
import { testRealmURL } from '../helpers/const';
import stripScopedCSSGlimmerAttributes from '../helpers/strip-scoped-css-glimmer-attributes';
import '../helpers/code-equality-assertion';

const testRealmURL2 = `http://test-realm/test2/`;

const tests = Object.freeze({
  'can perform invalidations for a instance entry': async (
    assert,
    { indexer, adapter },
  ) => {
    await setupIndex(
      indexer,
      [
        { realm_url: testRealmURL, current_version: 1 },
        { realm_url: testRealmURL2, current_version: 5 },
      ],
      [
        {
          url: `${testRealmURL}1.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          deps: [`${testRealmURL}2.json`],
        },
        {
          url: `${testRealmURL}2.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          deps: [`${testRealmURL}4.json`],
        },
        {
          url: `${testRealmURL}3.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          deps: [`${testRealmURL}2.json`],
        },
        {
          url: `${testRealmURL}4.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          deps: [],
        },
        {
          url: `${testRealmURL}5.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          deps: [],
        },
        {
          url: `${testRealmURL2}A.json`,
          realm_version: 5,
          realm_url: testRealmURL2,
          deps: [],
        },
      ],
    );

    let batch = await indexer.createBatch(new URL(testRealmURL));
    let invalidations = await batch.invalidate(
      new URL(`${testRealmURL}4.json`),
    );

    assert.deepEqual(invalidations.sort(), [
      `${testRealmURL}1.json`,
      `${testRealmURL}2.json`,
      `${testRealmURL}3.json`,
      `${testRealmURL}4.json`,
    ]);

    let originalEntries = await adapter.execute(
      'SELECT url, realm_url, is_deleted FROM boxel_index WHERE realm_version = 1 ORDER BY url COLLATE "POSIX"',
      { coerceTypes: { is_deleted: 'BOOLEAN' } },
    );
    assert.deepEqual(
      originalEntries,
      [1, 2, 3, 4, 5].map((i) => ({
        url: `${testRealmURL}${i}.json`,
        realm_url: testRealmURL,
        is_deleted: null,
      })),
      'the "production" version of the index entries are unchanged',
    );
    let invalidatedEntries = await adapter.execute(
      'SELECT url, realm_url, is_deleted FROM boxel_index WHERE realm_version = 2 ORDER BY url COLLATE "POSIX"',
      { coerceTypes: { is_deleted: 'BOOLEAN' } },
    );
    assert.deepEqual(
      invalidatedEntries,
      [1, 2, 3, 4].map((i) => ({
        url: `${testRealmURL}${i}.json`,
        realm_url: testRealmURL,
        is_deleted: true,
      })),
      'the "work-in-progress" version of the index entries have been marked as deleted',
    );
    let otherRealms = await adapter.execute(
      `SELECT url, realm_url, realm_version, is_deleted FROM boxel_index WHERE realm_url != '${testRealmURL}'`,
      { coerceTypes: { is_deleted: 'BOOLEAN' } },
    );
    assert.deepEqual(
      otherRealms,
      [
        {
          url: `${testRealmURL2}A.json`,
          realm_url: testRealmURL2,
          realm_version: 5,
          is_deleted: null,
        },
      ],
      'the index entries from other realms are unchanged',
    );
    let realmVersions = await adapter.execute(
      'select * from realm_versions ORDER BY realm_url COLLATE "POSIX"',
    );
    assert.deepEqual(
      realmVersions,
      [
        {
          realm_url: `${testRealmURL}`,
          current_version: 1,
        },
        {
          realm_url: `${testRealmURL2}`,
          current_version: 5,
        },
      ],
      'the "production" realm versions are correct',
    );
  },

  'can perform invalidations for a module entry': async (
    assert,
    { indexer },
  ) => {
    await setupIndex(
      indexer,
      [
        { realm_url: testRealmURL, current_version: 1 },
        { realm_url: testRealmURL2, current_version: 5 },
      ],
      [
        {
          url: `${testRealmURL}person.gts`,
          file_alias: `${testRealmURL}person`,
          type: 'module',
          realm_version: 1,
          realm_url: testRealmURL,
          deps: [],
        },
        {
          url: `${testRealmURL}employee.gts`,
          file_alias: `${testRealmURL}employee`,
          type: 'module',
          realm_version: 1,
          realm_url: testRealmURL,
          deps: [`${testRealmURL}person`],
        },
        {
          url: `${testRealmURL}1.json`,
          file_alias: `${testRealmURL}1.json`,
          type: 'instance',
          realm_version: 1,
          realm_url: testRealmURL,
          deps: [`${testRealmURL}employee`],
        },
        {
          url: `${testRealmURL}2.json`,
          file_alias: `${testRealmURL}2.json`,
          type: 'instance',
          realm_version: 1,
          realm_url: testRealmURL,
          deps: [`${testRealmURL}1.json`],
        },
        {
          url: `${testRealmURL}3.json`,
          file_alias: `${testRealmURL}3.json`,
          type: 'instance',
          realm_version: 1,
          realm_url: testRealmURL,
          deps: [],
        },
      ],
    );

    let batch = await indexer.createBatch(new URL(testRealmURL));
    let invalidations = await batch.invalidate(
      new URL(`${testRealmURL}person.gts`),
    );

    assert.deepEqual(invalidations.sort(), [
      `${testRealmURL}1.json`,
      `${testRealmURL}2.json`,
      `${testRealmURL}employee.gts`,
      `${testRealmURL}person.gts`,
    ]);
  },

  'only invalidates latest version of content': async (
    assert,
    { indexer, adapter },
  ) => {
    await setupIndex(
      indexer,
      [{ realm_url: testRealmURL, current_version: 2 }],
      [
        {
          url: `${testRealmURL}1.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          deps: [`${testRealmURL}2.json`],
        },
        {
          url: `${testRealmURL}2.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          deps: [`${testRealmURL}4.json`],
        },
        {
          url: `${testRealmURL}2.json`,
          realm_version: 2,
          realm_url: testRealmURL,
          deps: [],
        },
        {
          url: `${testRealmURL}3.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          deps: [`${testRealmURL}2.json`],
        },
        {
          url: `${testRealmURL}4.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          deps: [],
        },
        {
          url: `${testRealmURL}5.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          deps: [`${testRealmURL}4.json`],
        },
      ],
    );

    let batch = await indexer.createBatch(new URL(testRealmURL));
    let invalidations = await batch.invalidate(
      new URL(`${testRealmURL}4.json`),
    );

    assert.deepEqual(invalidations.sort(), [
      `${testRealmURL}4.json`,
      `${testRealmURL}5.json`,
    ]);
    let invalidatedEntries = await adapter.execute(
      'SELECT url, realm_url, is_deleted FROM boxel_index WHERE realm_version = 3 ORDER BY url COLLATE "POSIX"',
      { coerceTypes: { is_deleted: 'BOOLEAN' } },
    );
    assert.deepEqual(
      invalidatedEntries,
      [4, 5].map((i) => ({
        url: `${testRealmURL}${i}.json`,
        realm_url: testRealmURL,
        is_deleted: true,
      })),
      'the "work-in-progress" version of the index entries have been marked as deleted',
    );
  },

  'can prevent concurrent batch invalidations from colliding': async (
    assert,
    { indexer },
  ) => {
    await setupIndex(
      indexer,
      [{ realm_url: testRealmURL, current_version: 1 }],
      [
        {
          url: `${testRealmURL}1.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          deps: [],
        },
        {
          url: `${testRealmURL}2.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          deps: [`${testRealmURL}1.json`],
        },
        {
          url: `${testRealmURL}3.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          deps: [`${testRealmURL}1.json`],
        },
      ],
    );

    // both batches have the same WIP version number
    let batch1 = await indexer.createBatch(new URL(testRealmURL));
    let batch2 = await indexer.createBatch(new URL(testRealmURL));
    await batch1.invalidate(new URL(`${testRealmURL}1.json`));

    try {
      await batch2.invalidate(new URL(`${testRealmURL}3.json`));
      throw new Error(`expected invalidation conflict error`);
    } catch (e: any) {
      assert.ok(
        e.message.includes(
          'Invalidation conflict error in realm http://test-realm/test/ version 2',
        ),
        'received invalidation conflict error',
      );
    }
  },

  'can prevent concurrent batch invalidations from colliding when making new generation':
    async (assert, { indexer, adapter }) => {
      await setupIndex(
        indexer,
        [{ realm_url: testRealmURL, current_version: 1 }],
        [
          {
            url: `${testRealmURL}1.json`,
            realm_version: 1,
            realm_url: testRealmURL,
            deps: [],
          },
          {
            url: `${testRealmURL}2.json`,
            realm_version: 1,
            realm_url: testRealmURL,
            deps: [],
          },
        ],
      );

      // both batches have the same WIP version number
      let batch1 = await indexer.createBatch(new URL(testRealmURL));
      let batch2 = await indexer.createBatch(new URL(testRealmURL));
      await batch1.invalidate(new URL(`${testRealmURL}1.json`));
      {
        let index = await adapter.execute(
          'SELECT url, realm_url, realm_version, is_deleted FROM boxel_index ORDER BY url COLLATE "POSIX", realm_version',
          { coerceTypes: { is_deleted: 'BOOLEAN' } },
        );
        assert.deepEqual(
          index,
          [
            {
              url: `${testRealmURL}1.json`,
              realm_url: testRealmURL,
              realm_version: 1,
              is_deleted: null,
            },
            {
              url: `${testRealmURL}1.json`,
              realm_url: testRealmURL,
              realm_version: 2,
              is_deleted: true,
            },
            {
              url: `${testRealmURL}2.json`,
              realm_version: 1,
              realm_url: testRealmURL,
              is_deleted: null,
            },
          ],
          'the index entries are correct',
        );
      }

      // this will force batch2 to have a higher version number than batch 1
      await batch2.makeNewGeneration();
      {
        let index = await adapter.execute(
          'SELECT url, realm_url, realm_version, is_deleted FROM boxel_index ORDER BY url COLLATE "POSIX", realm_version',
          { coerceTypes: { is_deleted: 'BOOLEAN' } },
        );
        assert.deepEqual(
          index,
          [
            {
              url: `${testRealmURL}1.json`,
              realm_url: testRealmURL,
              realm_version: 1,
              is_deleted: null,
            },
            {
              url: `${testRealmURL}1.json`,
              realm_url: testRealmURL,
              realm_version: 2,
              is_deleted: true,
            },
            {
              url: `${testRealmURL}1.json`,
              realm_url: testRealmURL,
              realm_version: 3,
              is_deleted: true,
            },
            {
              url: `${testRealmURL}2.json`,
              realm_version: 1,
              realm_url: testRealmURL,
              is_deleted: null,
            },
            {
              url: `${testRealmURL}2.json`,
              realm_version: 3,
              realm_url: testRealmURL,
              is_deleted: true,
            },
          ],
          'the index entries are correct',
        );
      }
    },

  'can update an index entry': async (assert, { indexer, adapter }) => {
    await setupIndex(
      indexer,
      [{ realm_url: testRealmURL, current_version: 1 }],
      [
        {
          url: `${testRealmURL}1.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          pristine_doc: {
            id: `${testRealmURL}1.json`,
            type: 'card',
            attributes: {
              name: 'Mango',
            },
            meta: {
              adoptsFrom: {
                module: `./person`,
                name: 'Person',
              },
            },
          } as LooseCardResource,
          search_doc: { name: 'Mango' },
          deps: [`${testRealmURL}person`],
          types: [{ module: `./person`, name: 'Person' }, baseCardRef].map(
            (i) => internalKeyFor(i, new URL(testRealmURL)),
          ),
        },
      ],
    );

    let resource: CardResource = {
      id: `${testRealmURL}1.json`,
      type: 'card',
      attributes: {
        name: 'Van Gogh',
      },
      meta: {
        adoptsFrom: {
          module: `./fancy-person`,
          name: 'FancyPerson',
        },
      },
    };
    let batch = await indexer.createBatch(new URL(testRealmURL));
    await batch.invalidate(new URL(`${testRealmURL}1.json`));
    await batch.updateEntry(new URL(`${testRealmURL}1.json`), {
      type: 'instance',
      resource,
      source: JSON.stringify(resource),
      lastModified: Date.now(),
      searchData: { name: 'Van Gogh' },
      deps: new Set([`${testRealmURL}fancy-person`]),
      types: [
        { module: `./fancy-person`, name: 'FancyPerson' },
        { module: `./person`, name: 'Person' },
        baseCardRef,
      ].map((i) => internalKeyFor(i, new URL(testRealmURL))),
    });

    let versions = await adapter.execute(
      `SELECT realm_version, pristine_doc, search_doc, deps, types FROM boxel_index WHERE url = $1 ORDER BY realm_version`,
      {
        bind: [`${testRealmURL}1.json`],
        coerceTypes: {
          pristine_doc: 'JSON',
          search_doc: 'JSON',
          deps: 'JSON',
          types: 'JSON',
        },
      },
    );
    assert.strictEqual(
      versions.length,
      2,
      'correct number of versions exist for the entry before finishing the batch',
    );

    let [liveVersion, wipVersion] = versions;
    assert.deepEqual(
      liveVersion,
      {
        realm_version: 1,
        pristine_doc: {
          id: `${testRealmURL}1.json`,
          type: 'card',
          attributes: {
            name: 'Mango',
          },
          meta: {
            adoptsFrom: {
              module: `./person`,
              name: 'Person',
            },
          },
        },
        search_doc: { name: 'Mango' },
        deps: [`${testRealmURL}person`],
        types: [{ module: `./person`, name: 'Person' }, baseCardRef].map((i) =>
          internalKeyFor(i, new URL(testRealmURL)),
        ),
      },
      'live version of the doc has not changed',
    );
    assert.deepEqual(
      wipVersion,
      {
        realm_version: 2,
        pristine_doc: {
          id: `${testRealmURL}1.json`,
          type: 'card',
          attributes: {
            name: 'Van Gogh',
          },
          meta: {
            adoptsFrom: {
              module: `./fancy-person`,
              name: 'FancyPerson',
            },
          },
        },
        search_doc: { name: 'Van Gogh' },
        deps: [`${testRealmURL}fancy-person`],
        types: [
          { module: `./fancy-person`, name: 'FancyPerson' },
          { module: `./person`, name: 'Person' },
          baseCardRef,
        ].map((i) => internalKeyFor(i, new URL(testRealmURL))),
      },
      'WIP version of the doc exists',
    );

    await batch.done();

    versions = await adapter.execute(
      `SELECT realm_version, pristine_doc, search_doc, deps, types FROM boxel_index WHERE url = $1 ORDER BY realm_version`,
      {
        bind: [`${testRealmURL}1.json`],
        coerceTypes: {
          pristine_doc: 'JSON',
          search_doc: 'JSON',
          deps: 'JSON',
          types: 'JSON',
        },
      },
    );
    assert.strictEqual(
      versions.length,
      2,
      'correct number of versions exist for the entry after finishing the batch',
    );

    let [_, finalVersion] = versions;
    assert.deepEqual(
      finalVersion,
      {
        realm_version: 2,
        pristine_doc: {
          id: `${testRealmURL}1.json`,
          type: 'card',
          attributes: {
            name: 'Van Gogh',
          },
          meta: {
            adoptsFrom: {
              module: `./fancy-person`,
              name: 'FancyPerson',
            },
          },
        },
        search_doc: { name: 'Van Gogh' },
        deps: [`${testRealmURL}fancy-person`],
        types: [
          { module: `./fancy-person`, name: 'FancyPerson' },
          { module: `./person`, name: 'Person' },
          baseCardRef,
        ].map((i) => internalKeyFor(i, new URL(testRealmURL))),
      },
      'final version of the doc exists',
    );
  },

  'can create a new generation of index entries': async (
    assert,
    { indexer, adapter },
  ) => {
    await setupIndex(
      indexer,
      [{ realm_url: testRealmURL, current_version: 1 }],
      [
        {
          url: `${testRealmURL}1.json`,
          realm_version: 1,
          realm_url: testRealmURL,
        },
        {
          url: `${testRealmURL}2.json`,
          realm_version: 1,
          realm_url: testRealmURL,
        },
        {
          url: `${testRealmURL}3.json`,
          realm_version: 1,
          realm_url: testRealmURL,
        },
        {
          url: `${testRealmURL2}A.json`,
          realm_version: 5,
          realm_url: testRealmURL2,
        },
      ],
    );

    let batch = await indexer.createBatch(new URL(testRealmURL));
    await batch.makeNewGeneration();

    let index = await adapter.execute(
      'SELECT url, realm_url, realm_version, is_deleted FROM boxel_index ORDER BY url COLLATE "POSIX", realm_version',
      { coerceTypes: { is_deleted: 'BOOLEAN' } },
    );
    assert.deepEqual(
      index,
      [
        {
          url: `${testRealmURL}1.json`,
          realm_url: testRealmURL,
          realm_version: 1,
          is_deleted: null,
        },
        {
          url: `${testRealmURL}1.json`,
          realm_url: testRealmURL,
          realm_version: 2,
          is_deleted: true,
        },
        {
          url: `${testRealmURL}2.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          is_deleted: null,
        },
        {
          url: `${testRealmURL}2.json`,
          realm_version: 2,
          realm_url: testRealmURL,
          is_deleted: true,
        },
        {
          url: `${testRealmURL}3.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          is_deleted: null,
        },
        {
          url: `${testRealmURL}3.json`,
          realm_version: 2,
          realm_url: testRealmURL,
          is_deleted: true,
        },
        {
          url: `${testRealmURL2}A.json`,
          realm_version: 5,
          realm_url: testRealmURL2,
          is_deleted: null,
        },
      ],
      'the WIP next generation index entries have been added',
    );

    let resource: CardResource = {
      id: `${testRealmURL}1.json`,
      type: 'card',
      attributes: {
        name: 'Van Gogh',
      },
      meta: {
        adoptsFrom: {
          module: `./person`,
          name: 'Person',
        },
      },
    };
    // in this next generation only 1 card happened to be visited
    await batch.updateEntry(new URL(`${testRealmURL}1.json`), {
      type: 'instance',
      resource,
      source: JSON.stringify(resource),
      lastModified: Date.now(),
      searchData: { name: 'Van Gogh' },
      deps: new Set(),
      types: [],
    });

    await batch.done();
    index = await adapter.execute(
      'SELECT url, realm_url, realm_version, is_deleted FROM boxel_index ORDER BY url COLLATE "POSIX", realm_version',
      { coerceTypes: { is_deleted: 'BOOLEAN' } },
    );
    assert.deepEqual(
      index,
      [
        {
          url: `${testRealmURL}1.json`,
          realm_url: testRealmURL,
          realm_version: 2,
          is_deleted: false,
        },
        {
          url: `${testRealmURL}2.json`,
          realm_version: 2,
          realm_url: testRealmURL,
          is_deleted: true,
        },
        {
          url: `${testRealmURL}3.json`,
          realm_version: 2,
          realm_url: testRealmURL,
          is_deleted: true,
        },
        {
          url: `${testRealmURL2}A.json`,
          realm_version: 5,
          realm_url: testRealmURL2,
          is_deleted: null,
        },
      ],
      'the old generation index entries have been pruned',
    );
  },

  'can get an error doc': async (assert, { indexer }) => {
    await setupIndex(indexer, [
      {
        url: `${testRealmURL}1.json`,
        realm_version: 1,
        realm_url: testRealmURL,
        type: 'error',
        error_doc: {
          detail: 'test error',
          status: 500,
          additionalErrors: [],
        },
      },
    ]);
    let entry = await indexer.getInstance(new URL(`${testRealmURL}1`));
    if (entry?.type === 'error') {
      assert.deepEqual(entry, {
        type: 'error',
        error: {
          detail: 'test error',
          status: 500,
          additionalErrors: [],
        },
      });
    } else {
      assert.ok(false, `expected index entry to not be a card document`);
    }
  },

  'can get "production" index entry': async (assert, { indexer }) => {
    let originalModified = Date.now();
    let originalResource: LooseCardResource = {
      id: `${testRealmURL}1`,
      type: 'card',
      attributes: {
        name: 'Mango',
      },
      meta: {
        adoptsFrom: {
          module: `./person`,
          name: 'Person',
        },
      },
    };
    let originalSource = JSON.stringify(originalResource);
    await setupIndex(
      indexer,
      [{ realm_url: testRealmURL, current_version: 1 }],
      [
        {
          url: `${testRealmURL}1.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          pristine_doc: originalResource,
          source: originalSource,
          last_modified: String(originalModified),
        },
      ],
    );

    let resource: CardResource = {
      id: `${testRealmURL}1.json`,
      type: 'card',
      attributes: {
        name: 'Van Gogh',
      },
      meta: {
        adoptsFrom: {
          module: `./person`,
          name: 'Person',
        },
      },
    };
    let batch = await indexer.createBatch(new URL(testRealmURL));
    await batch.invalidate(new URL(`${testRealmURL}1.json`));
    await batch.updateEntry(new URL(`${testRealmURL}1.json`), {
      type: 'instance',
      resource,
      source: JSON.stringify(resource),
      lastModified: Date.now(),
      searchData: { name: 'Van Gogh' },
      deps: new Set(),
      types: [],
    });

    let entry = await indexer.getInstance(new URL(`${testRealmURL}1`));
    if (entry?.type === 'instance') {
      assert.deepEqual(entry, {
        type: 'instance',
        realmVersion: 1,
        realmURL: testRealmURL,
        canonicalURL: `${testRealmURL}1.json`,
        instance: {
          id: `${testRealmURL}1`,
          type: 'card',
          attributes: {
            name: 'Mango',
          },
          meta: {
            adoptsFrom: {
              module: `./person`,
              name: 'Person',
            },
          },
        },
        source: originalSource,
        lastModified: originalModified,
        searchDoc: null,
        deps: null,
        types: null,
        indexedAt: null,
        isolatedHtml: null,
        embeddedHtml: null,
        _embeddedHtmlByClassHierarchy: null,
      });
    } else {
      assert.ok(false, `expected index entry to not be an error document`);
    }
  },

  'can get work in progress card': async (assert, { indexer }) => {
    await setupIndex(
      indexer,
      [{ realm_url: testRealmURL, current_version: 1 }],
      [
        {
          url: `${testRealmURL}1.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          pristine_doc: {
            attributes: {
              name: 'Mango',
            },
            meta: {
              adoptsFrom: {
                module: `./person`,
                name: 'Person',
              },
            },
          } as LooseCardResource,
        },
      ],
    );

    let resource: CardResource = {
      id: `${testRealmURL}1.json`,
      type: 'card',
      attributes: {
        name: 'Van Gogh',
      },
      meta: {
        adoptsFrom: {
          module: `./person`,
          name: 'Person',
        },
      },
    };
    let source = JSON.stringify(resource);
    let batch = await indexer.createBatch(new URL(testRealmURL));
    let now = Date.now();
    await batch.invalidate(new URL(`${testRealmURL}1.json`));
    await batch.updateEntry(new URL(`${testRealmURL}1.json`), {
      type: 'instance',
      resource,
      source,
      lastModified: now,
      searchData: { name: 'Van Gogh' },
      deps: new Set(),
      types: [],
    });

    let entry = await indexer.getInstance(new URL(`${testRealmURL}1`), {
      useWorkInProgressIndex: true,
    });
    if (entry?.type === 'instance') {
      assert.ok(entry?.indexedAt, 'the indexed_at field was set');
      delete (entry as Partial<IndexedInstance>)?.indexedAt;
      assert.deepEqual(entry as Omit<IndexedInstance, 'indexedAt'>, {
        type: 'instance',
        realmVersion: 2,
        realmURL: testRealmURL,
        canonicalURL: `${testRealmURL}1.json`,
        instance: {
          id: `${testRealmURL}1.json`,
          type: 'card',
          attributes: {
            name: 'Van Gogh',
          },
          meta: {
            adoptsFrom: {
              module: `./person`,
              name: 'Person',
            },
          },
        },
        source,
        lastModified: now,
        searchDoc: { name: 'Van Gogh' },
        deps: [],
        types: [],
        isolatedHtml: null,
        embeddedHtml: null,
        _embeddedHtmlByClassHierarchy: null,
      });
    } else {
      assert.ok(false, `expected index entry to not be an error document`);
    }
  },

  'returns undefined when getting a deleted card': async (
    assert,
    { indexer },
  ) => {
    await setupIndex(
      indexer,
      [{ realm_url: testRealmURL, current_version: 1 }],
      [
        {
          url: `${testRealmURL}1.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          is_deleted: true,
        },
      ],
    );

    let entry = await indexer.getInstance(new URL(`${testRealmURL}1`));
    assert.strictEqual(entry, undefined, 'deleted entries return undefined');
  },

  'can perform invalidations for an instance with deps more than a thousand':
    async (assert, { indexer, adapter }) => {
      let indexRows: (Pick<BoxelIndexTable, 'url'> &
        Partial<Omit<BoxelIndexTable, 'url' | 'pristine_doc'>>)[] = [];
      for (let i = 1; i <= 1002; i++) {
        indexRows.push({
          url: `${testRealmURL}${i}.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          deps: [...(i <= 1 ? [] : [`${testRealmURL}1.json`])],
        });
      }
      indexRows.sort((a, b) => a.url.localeCompare(b.url));
      await setupIndex(
        indexer,
        [{ realm_url: testRealmURL, current_version: 1 }],
        indexRows,
      );

      let batch = await indexer.createBatch(new URL(testRealmURL));
      let invalidations = await batch.invalidate(
        new URL(`${testRealmURL}1.json`),
      );

      assert.ok(invalidations.length > 1000, 'Can invalidate more than 1000');
      assert.deepEqual(
        invalidations.sort(),
        indexRows.map((r) => r.url),
      );

      let originalEntries = (await adapter.execute(
        'SELECT url, realm_url, is_deleted FROM boxel_index WHERE realm_version = 1 ORDER BY url COLLATE "POSIX"',
        { coerceTypes: { is_deleted: 'BOOLEAN' } },
      )) as Pick<BoxelIndexTable, 'url' | 'realm_url' | 'is_deleted'>[];
      assert.deepEqual(
        originalEntries,
        indexRows.map((indexRow) => ({
          url: indexRow.url,
          realm_url: indexRow.realm_url,
          is_deleted: null,
        })) as Pick<BoxelIndexTable, 'url' | 'realm_url' | 'is_deleted'>[],
        'the "production" version of the index entries are unchanged',
      );
      let invalidatedEntries = (await adapter.execute(
        'SELECT url, realm_url, is_deleted FROM boxel_index WHERE realm_version = 2 ORDER BY url COLLATE "POSIX"',
        { coerceTypes: { is_deleted: 'BOOLEAN' } },
      )) as Pick<BoxelIndexTable, 'url' | 'realm_url' | 'is_deleted'>[];
      assert.deepEqual(
        invalidatedEntries,
        indexRows.map((indexRow) => ({
          url: indexRow.url,
          realm_url: indexRow.realm_url,
          is_deleted: true,
        })) as Pick<BoxelIndexTable, 'url' | 'realm_url' | 'is_deleted'>[],
        'the "work-in-progress" version of the index entries have been marked as deleted',
      );
      let realmVersions = await adapter.execute(
        'select * from realm_versions ORDER BY realm_url COLLATE "POSIX"',
      );
      assert.deepEqual(
        realmVersions,
        [
          {
            realm_url: `${testRealmURL}`,
            current_version: 1,
          },
        ],
        'the "production" realm versions are correct',
      );
    },

  'can get compiled module and source when requested with file extension':
    async (assert, { indexer }) => {
      await setupIndex(indexer);
      let batch = await indexer.createBatch(new URL(testRealmURL));
      let now = Date.now();
      await batch.updateEntry(new URL(`${testRealmURL}person.gts`), {
        type: 'module',
        source: cardSrc,
        lastModified: now,
        deps: new Set(),
      });
      await batch.done();

      let result = await indexer.getModule(
        new URL(`${testRealmURL}person.gts`),
      );
      if (result?.type === 'module') {
        let { executableCode, source, lastModified } = result;
        assert.codeEqual(
          stripModuleDebugInfo(stripScopedCSSGlimmerAttributes(executableCode)),
          stripModuleDebugInfo(compiledCard()),
          'compiled card is correct',
        );
        assert.strictEqual(cardSrc, source, 'source code is correct');
        assert.strictEqual(lastModified, now, 'lastModified is correct');
      } else {
        assert.ok(false, `expected module not to be an error document`);
      }
    },

  'can get compiled module and source when requested without file extension':
    async (assert, { indexer }) => {
      await setupIndex(indexer);
      let batch = await indexer.createBatch(new URL(testRealmURL));
      let now = Date.now();
      await batch.updateEntry(new URL(`${testRealmURL}person.gts`), {
        type: 'module',
        source: cardSrc,
        lastModified: now,
        deps: new Set(),
      });
      await batch.done();

      let result = await indexer.getModule(new URL(`${testRealmURL}person`));
      if (result?.type === 'module') {
        let { executableCode, source, lastModified } = result;
        assert.codeEqual(
          stripModuleDebugInfo(stripScopedCSSGlimmerAttributes(executableCode)),
          stripModuleDebugInfo(compiledCard()),
          'compiled card is correct',
        );
        assert.strictEqual(cardSrc, source, 'source code is correct');
        assert.strictEqual(lastModified, now, 'lastModified is correct');
      } else {
        assert.ok(false, `expected module not to be an error document`);
      }
    },

  'can get compiled module and source from WIP index': async (
    assert,
    { indexer },
  ) => {
    await setupIndex(indexer);
    let batch = await indexer.createBatch(new URL(testRealmURL));
    let now = Date.now();
    await batch.updateEntry(new URL(`${testRealmURL}person.gts`), {
      type: 'module',
      source: cardSrc,
      lastModified: now,
      deps: new Set(),
    });

    let result = await indexer.getModule(new URL(`${testRealmURL}person.gts`), {
      useWorkInProgressIndex: true,
    });
    if (result?.type === 'module') {
      let { executableCode, source, lastModified } = result;
      assert.codeEqual(
        stripModuleDebugInfo(stripScopedCSSGlimmerAttributes(executableCode)),
        stripModuleDebugInfo(compiledCard()),
        'compiled card is correct',
      );
      assert.strictEqual(cardSrc, source, 'source code is correct');
      assert.strictEqual(lastModified, now, 'lastModified is correct');
    } else {
      assert.ok(false, `expected module not to be an error document`);
    }

    let noResult = await indexer.getModule(
      new URL(`${testRealmURL}person.gts`),
    );
    assert.strictEqual(
      noResult,
      undefined,
      'module does not exist in production index',
    );
  },

  'can get error doc for module': async (assert, { indexer }) => {
    await setupIndex(indexer, [
      {
        url: `${testRealmURL}person.gts`,
        realm_version: 1,
        realm_url: testRealmURL,
        type: 'error',
        error_doc: {
          detail: 'test error',
          status: 500,
          additionalErrors: [],
        },
      },
    ]);
    let result = await indexer.getModule(new URL(`${testRealmURL}person.gts`));
    if (result?.type === 'error') {
      assert.deepEqual(result, {
        type: 'error',
        error: {
          detail: 'test error',
          status: 500,
          additionalErrors: [],
        },
      });
    } else {
      assert.ok(false, `expected an error document`);
    }
  },

  'returns undefined when getting a deleted module': async (
    assert,
    { indexer },
  ) => {
    await setupIndex(indexer, [
      {
        url: `${testRealmURL}person.gts`,
        type: 'module',
        realm_version: 1,
        realm_url: testRealmURL,
        is_deleted: true,
      },
    ]);

    let entry = await indexer.getModule(new URL(`${testRealmURL}person.gts`));
    assert.strictEqual(entry, undefined, 'deleted modules return undefined');
  },

  'can get css when requested with file extension': async (
    assert,
    { indexer },
  ) => {
    await setupIndex(indexer);
    let batch = await indexer.createBatch(new URL(testRealmURL));
    let now = Date.now();
    await batch.updateEntry(new URL(`${testRealmURL}person.gts`), {
      type: 'css',
      source: `.person { color: red; }`,
      lastModified: now,
      deps: new Set(),
    });
    await batch.done();

    let result = await indexer.getCSS(new URL(`${testRealmURL}person.gts`));
    if (result?.type === 'css') {
      let { source, lastModified } = result;
      assert.strictEqual(source, `.person { color: red; }`, 'css is correct');
      assert.strictEqual(lastModified, now, 'lastModified is correct');
    } else {
      assert.ok(false, `expected css not to be an error document`);
    }
  },

  'can get css when requested without file extension': async (
    assert,
    { indexer },
  ) => {
    await setupIndex(indexer);
    let batch = await indexer.createBatch(new URL(testRealmURL));
    let now = Date.now();
    await batch.updateEntry(new URL(`${testRealmURL}person.gts`), {
      type: 'css',
      source: `.person { color: red; }`,
      lastModified: now,
      deps: new Set(),
    });
    await batch.done();

    let result = await indexer.getCSS(new URL(`${testRealmURL}person`));
    if (result?.type === 'css') {
      let { source, lastModified } = result;
      assert.strictEqual(source, `.person { color: red; }`, 'css is correct');
      assert.strictEqual(lastModified, now, 'lastModified is correct');
    } else {
      assert.ok(false, `expected css not to be an error document`);
    }
  },

  'can get css from WIP index': async (assert, { indexer }) => {
    await setupIndex(indexer);
    let batch = await indexer.createBatch(new URL(testRealmURL));
    let now = Date.now();
    await batch.updateEntry(new URL(`${testRealmURL}person.gts`), {
      type: 'css',
      source: `.person { color: red; }`,
      lastModified: now,
      deps: new Set(),
    });

    let result = await indexer.getCSS(new URL(`${testRealmURL}person.gts`), {
      useWorkInProgressIndex: true,
    });
    if (result?.type === 'css') {
      let { source, lastModified } = result;
      assert.strictEqual(source, `.person { color: red; }`, 'css is correct');
      assert.strictEqual(lastModified, now, 'lastModified is correct');
    } else {
      assert.ok(false, `expected module not to be an error document`);
    }

    let noResult = await indexer.getCSS(new URL(`${testRealmURL}person.gts`));
    assert.strictEqual(
      noResult,
      undefined,
      'css does not exist in production index',
    );
  },

  'can get error doc for css': async (assert, { indexer }) => {
    await setupIndex(indexer, [
      {
        url: `${testRealmURL}person.gts`,
        realm_version: 1,
        realm_url: testRealmURL,
        type: 'error',
        error_doc: {
          detail: 'test error',
          status: 500,
          additionalErrors: [],
        },
      },
    ]);
    let result = await indexer.getCSS(new URL(`${testRealmURL}person.gts`));
    if (result?.type === 'error') {
      assert.deepEqual(result, {
        type: 'error',
        error: {
          detail: 'test error',
          status: 500,
          additionalErrors: [],
        },
      });
    } else {
      assert.ok(false, `expected an error document`);
    }
  },

  'returns undefined when getting deleted css': async (assert, { indexer }) => {
    await setupIndex(indexer, [
      {
        url: `${testRealmURL}person.gts`,
        type: 'css',
        realm_version: 1,
        realm_url: testRealmURL,
        is_deleted: true,
      },
    ]);

    let entry = await indexer.getCSS(new URL(`${testRealmURL}person.gts`));
    assert.strictEqual(entry, undefined, 'deleted css return undefined');
  },
} as SharedTests<{ indexer: Indexer; adapter: DBAdapter }>);

export default tests;

function stripModuleDebugInfo(code: string) {
  return code
    .replace(/\s*"id": [^\n]+,\n/m, '')
    .replace(/\s*"moduleName": [^\n]+,\n/m, '');
}
