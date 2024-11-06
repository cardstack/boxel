import {
  IndexWriter,
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
import { IndexQueryEngine } from '../index-query-engine';

const testRealmURL2 = `http://test-realm/test2/`;

const tests = Object.freeze({
  'can perform invalidations for a instance entry': async (
    assert,
    { indexWriter, adapter },
  ) => {
    await setupIndex(
      adapter,
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

    let batch = await indexWriter.createBatch(new URL(testRealmURL));
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
    { indexWriter, adapter },
  ) => {
    await setupIndex(
      adapter,
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

    let batch = await indexWriter.createBatch(new URL(testRealmURL));
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

  "invalidations don't cross realm boundaries": async (
    assert,
    { indexWriter, adapter },
  ) => {
    await setupIndex(
      adapter,
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
          url: `${testRealmURL2}luke.json`,
          file_alias: `${testRealmURL2}luke.json`,
          type: 'instance',
          realm_version: 1,
          realm_url: testRealmURL2,
          deps: [`${testRealmURL}person`],
        },
      ],
    );
    let batch = await indexWriter.createBatch(new URL(testRealmURL));
    let invalidations = await batch.invalidate(
      new URL(`${testRealmURL}person.gts`),
    );

    // invalidations currently do not cross realm boundaries (probably they
    // will in the future--but via a different mechanism)
    assert.deepEqual(invalidations, [`${testRealmURL}person.gts`]);
  },

  'only invalidates latest version of content': async (
    assert,
    { indexWriter, adapter },
  ) => {
    await setupIndex(
      adapter,
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

    let batch = await indexWriter.createBatch(new URL(testRealmURL));
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

  'can update an index entry': async (assert, { indexWriter, adapter }) => {
    await setupIndex(
      adapter,
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
    let batch = await indexWriter.createBatch(new URL(testRealmURL));
    await batch.invalidate(new URL(`${testRealmURL}1.json`));
    await batch.updateEntry(new URL(`${testRealmURL}1.json`), {
      type: 'instance',
      resource,
      source: JSON.stringify(resource),
      lastModified: Date.now(),
      resourceCreatedAt: Date.now(),
      searchData: { name: 'Van Gogh' },
      deps: new Set([`${testRealmURL}fancy-person`]),
      displayNames: ['Fancy Person', 'Person', 'Card'],
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

  'can get an error doc': async (assert, { indexQueryEngine, adapter }) => {
    await setupIndex(adapter, [
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
    let entry = await indexQueryEngine.getInstance(new URL(`${testRealmURL}1`));
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

  'can get "production" index entry': async (
    assert,
    { indexWriter, indexQueryEngine, adapter },
  ) => {
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
      adapter,
      [{ realm_url: testRealmURL, current_version: 1 }],
      [
        {
          url: `${testRealmURL}1.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          pristine_doc: originalResource,
          source: originalSource,
          last_modified: String(originalModified),
          resource_created_at: String(originalModified),
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
    let batch = await indexWriter.createBatch(new URL(testRealmURL));
    await batch.invalidate(new URL(`${testRealmURL}1.json`));
    await batch.updateEntry(new URL(`${testRealmURL}1.json`), {
      type: 'instance',
      resource,
      source: JSON.stringify(resource),
      lastModified: Date.now(),
      resourceCreatedAt: Date.now(),
      searchData: { name: 'Van Gogh' },
      deps: new Set(),
      displayNames: [],
      types: [],
    });

    let entry = await indexQueryEngine.getInstance(new URL(`${testRealmURL}1`));
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
        resourceCreatedAt: originalModified,
        searchDoc: null,
        deps: null,
        types: null,
        indexedAt: null,
        isolatedHtml: null,
        atomHtml: null,
        embeddedHtml: null,
        fittedHtml: null,
      });
    } else {
      assert.ok(false, `expected index entry to not be an error document`);
    }
  },

  'can get work in progress card': async (
    assert,
    { indexWriter, indexQueryEngine, adapter },
  ) => {
    await setupIndex(
      adapter,
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
    let batch = await indexWriter.createBatch(new URL(testRealmURL));
    let now = Date.now();
    await batch.invalidate(new URL(`${testRealmURL}1.json`));
    await batch.updateEntry(new URL(`${testRealmURL}1.json`), {
      type: 'instance',
      resource,
      source,
      lastModified: now,
      resourceCreatedAt: now,
      searchData: { name: 'Van Gogh' },
      deps: new Set(),
      displayNames: [],
      types: [],
    });

    let entry = await indexQueryEngine.getInstance(
      new URL(`${testRealmURL}1`),
      {
        useWorkInProgressIndex: true,
      },
    );
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
        resourceCreatedAt: now,
        searchDoc: { name: 'Van Gogh' },
        deps: [],
        types: [],
        isolatedHtml: null,
        embeddedHtml: null,
        fittedHtml: null,
        atomHtml: null,
      });
    } else {
      assert.ok(false, `expected index entry to not be an error document`);
    }
  },

  'returns undefined when getting a deleted card': async (
    assert,
    { adapter, indexQueryEngine },
  ) => {
    await setupIndex(
      adapter,
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

    let entry = await indexQueryEngine.getInstance(new URL(`${testRealmURL}1`));
    assert.strictEqual(entry, undefined, 'deleted entries return undefined');
  },

  'can perform invalidations for an instance with deps more than a thousand':
    async (assert, { indexWriter, adapter }) => {
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
        adapter,
        [{ realm_url: testRealmURL, current_version: 1 }],
        indexRows,
      );

      let batch = await indexWriter.createBatch(new URL(testRealmURL));
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
    async (assert, { indexWriter, indexQueryEngine, adapter }) => {
      await setupIndex(adapter);
      let batch = await indexWriter.createBatch(new URL(testRealmURL));
      let now = Date.now();
      await batch.updateEntry(new URL(`${testRealmURL}person.gts`), {
        type: 'module',
        source: cardSrc,
        lastModified: now,
        resourceCreatedAt: now,
        deps: new Set(),
      });
      await batch.done();

      let result = await indexQueryEngine.getModule(
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
    async (assert, { indexWriter, indexQueryEngine, adapter }) => {
      await setupIndex(adapter);
      let batch = await indexWriter.createBatch(new URL(testRealmURL));
      let now = Date.now();
      await batch.updateEntry(new URL(`${testRealmURL}person.gts`), {
        type: 'module',
        source: cardSrc,
        lastModified: now,
        resourceCreatedAt: now,
        deps: new Set(),
      });
      await batch.done();

      let result = await indexQueryEngine.getModule(
        new URL(`${testRealmURL}person`),
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

  'can get compiled module and source from WIP index': async (
    assert,
    { indexWriter, indexQueryEngine, adapter },
  ) => {
    await setupIndex(adapter);
    let batch = await indexWriter.createBatch(new URL(testRealmURL));
    let now = Date.now();
    await batch.updateEntry(new URL(`${testRealmURL}person.gts`), {
      type: 'module',
      source: cardSrc,
      lastModified: now,
      resourceCreatedAt: now,
      deps: new Set(),
    });

    let result = await indexQueryEngine.getModule(
      new URL(`${testRealmURL}person.gts`),
      {
        useWorkInProgressIndex: true,
      },
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

    let noResult = await indexQueryEngine.getModule(
      new URL(`${testRealmURL}person.gts`),
    );
    assert.strictEqual(
      noResult,
      undefined,
      'module does not exist in production index',
    );
  },

  'can get error doc for module': async (
    assert,
    { indexQueryEngine, adapter },
  ) => {
    await setupIndex(adapter, [
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
    let result = await indexQueryEngine.getModule(
      new URL(`${testRealmURL}person.gts`),
    );
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
    { indexQueryEngine, adapter },
  ) => {
    await setupIndex(adapter, [
      {
        url: `${testRealmURL}person.gts`,
        type: 'module',
        realm_version: 1,
        realm_url: testRealmURL,
        is_deleted: true,
      },
    ]);

    let entry = await indexQueryEngine.getModule(
      new URL(`${testRealmURL}person.gts`),
    );
    assert.strictEqual(entry, undefined, 'deleted modules return undefined');
  },

  'update realm meta when indexing is done': async (
    assert,
    { indexWriter, adapter },
  ) => {
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_version: 1 }],
      [
        {
          url: `${testRealmURL}1.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          pristine_doc: {
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
          } as LooseCardResource,
          search_doc: { name: 'Mango' },
          display_names: [`Person`],
          deps: [`${testRealmURL}person`],
          types: [{ module: `./person`, name: 'Person' }, baseCardRef].map(
            (i) => internalKeyFor(i, new URL(testRealmURL)),
          ),
        },
      ],
    );

    let resource2: CardResource = {
      id: `${testRealmURL}2`,
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
    let batch = await indexWriter.createBatch(new URL(testRealmURL));
    await batch.invalidate(new URL(`${testRealmURL}2.json`));
    await batch.updateEntry(new URL(`${testRealmURL}2.json`), {
      type: 'instance',
      resource: resource2,
      source: JSON.stringify(resource2),
      lastModified: Date.now(),
      resourceCreatedAt: Date.now(),
      searchData: { name: 'Van Gogh' },
      deps: new Set([`${testRealmURL}fancy-person`]),
      displayNames: ['Fancy Person', 'Person', 'Card'],
      types: [
        { module: `./fancy-person`, name: 'FancyPerson' },
        { module: `./person`, name: 'Person' },
        baseCardRef,
      ].map((i) => internalKeyFor(i, new URL(testRealmURL))),
    });

    let results = await adapter.execute(
      `SELECT value FROM realm_meta r INNER JOIN realm_versions rv ON r.realm_url = rv.realm_url WHERE r.realm_url = $1 AND r.realm_version = 1`,
      {
        bind: [testRealmURL],
        coerceTypes: {
          value: 'JSON',
        },
      },
    );
    assert.strictEqual(
      results.length,
      0,
      'correct length of query result before indexing is done',
    );

    await batch.done();

    results = await adapter.execute(
      `SELECT value FROM realm_meta r INNER JOIN realm_versions rv ON r.realm_url = rv.realm_url WHERE r.realm_url = $1`,
      {
        bind: [testRealmURL],
        coerceTypes: {
          value: 'JSON',
        },
      },
    );

    assert.strictEqual(
      results.length,
      1,
      'correct length of query result after indexing is done',
    );
    let value = results[0].value as [
      { code_ref: string; display_name: string; total: number },
    ];
    assert.strictEqual(
      value.length,
      2,
      'correct length of card type summary after indexing is done',
    );
    assert.deepEqual(
      value,
      [
        {
          total: 1,
          code_ref: `${testRealmURL}fancy-person/FancyPerson`,
          display_name: 'Fancy Person',
        },
        {
          total: 1,
          code_ref: `${testRealmURL}person/Person`,
          display_name: 'Person',
        },
      ],
      'correct card type summary after indexing is done',
    );

    batch = await indexWriter.createBatch(new URL(testRealmURL));
    let resource3: CardResource = {
      id: `${testRealmURL}3`,
      type: 'card',
      attributes: {
        name: 'Van Gogh2',
      },
      meta: {
        adoptsFrom: {
          module: `./fancy-person`,
          name: 'FancyPerson',
        },
      },
    };
    await batch.invalidate(new URL(`${testRealmURL}3.json`));
    await batch.updateEntry(new URL(`${testRealmURL}3.json`), {
      type: 'instance',
      resource: resource3,
      source: JSON.stringify(resource3),
      lastModified: Date.now(),
      resourceCreatedAt: Date.now(),
      searchData: { name: 'Van Gogh2' },
      deps: new Set([`${testRealmURL}fancy-person`]),
      displayNames: ['Fancy Person', 'Person', 'Card'],
      types: [
        { module: `./fancy-person`, name: 'FancyPerson' },
        { module: `./person`, name: 'Person' },
        baseCardRef,
      ].map((i) => internalKeyFor(i, new URL(testRealmURL))),
    });
    let resource4: CardResource = {
      id: `${testRealmURL}4`,
      type: 'card',
      attributes: {
        name: 'Mango',
      },
      meta: {
        adoptsFrom: {
          module: `./pet`,
          name: 'Pet',
        },
      },
    };
    await batch.invalidate(new URL(`${testRealmURL}4.json`));
    await batch.updateEntry(new URL(`${testRealmURL}4.json`), {
      type: 'instance',
      resource: resource4,
      source: JSON.stringify(resource4),
      lastModified: Date.now(),
      resourceCreatedAt: Date.now(),
      searchData: { name: 'Mango' },
      deps: new Set([`${testRealmURL}pet`]),
      displayNames: ['Pet', 'Card'],
      types: [
        { module: `./pet`, name: 'Pet' },
        { module: `./card-api`, name: 'CardDef' },
        baseCardRef,
      ].map((i) => internalKeyFor(i, new URL(testRealmURL))),
    });
    await batch.done();

    results = await adapter.execute(
      `SELECT value FROM realm_meta r INNER JOIN realm_versions rv ON r.realm_url = rv.realm_url WHERE r.realm_url = $1`,
      {
        bind: [testRealmURL],
        coerceTypes: {
          value: 'JSON',
        },
      },
    );
    assert.strictEqual(
      results.length,
      1,
      'correct length of query result after indexing is done',
    );
    value = results[0].value as [
      { code_ref: string; display_name: string; total: number },
    ];
    assert.strictEqual(
      value.length,
      3,
      'correct length of card type summary after indexing is done',
    );
    assert.deepEqual(
      value,
      [
        {
          total: 2,
          code_ref: `${testRealmURL}fancy-person/FancyPerson`,
          display_name: 'Fancy Person',
        },
        {
          total: 1,
          code_ref: `${testRealmURL}person/Person`,
          display_name: 'Person',
        },
        {
          total: 1,
          code_ref: `${testRealmURL}pet/Pet`,
          display_name: 'Pet',
        },
      ],
      'correct card type summary after indexing is done',
    );
  },
} as SharedTests<{
  indexWriter: IndexWriter;
  indexQueryEngine: IndexQueryEngine;
  adapter: DBAdapter;
}>);

export default tests;

function stripModuleDebugInfo(code: string) {
  return code
    .replace(/\s*"id": [^\n]+,\n/m, '')
    .replace(/\s*"moduleName": [^\n]+,\n/m, '');
}
