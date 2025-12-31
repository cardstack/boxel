import { type TestContext, getContext } from '@ember/test-helpers';

import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import {
  IndexQueryEngine,
  IndexWriter,
  internalKeyFor,
  baseCardRef,
  coerceTypes,
  type LooseCardResource,
  type IndexedInstance,
  type BoxelIndexTable,
  type CardResource,
  type RealmInfo,
} from '@cardstack/runtime-common';
import { CachingDefinitionLookup } from '@cardstack/runtime-common/definition-lookup';
import { VirtualNetwork } from '@cardstack/runtime-common/virtual-network';

import type SQLiteAdapter from '@cardstack/host/lib/sqlite-adapter';
import type LocalIndexer from '@cardstack/host/services/local-indexer';

import {
  getDbAdapter,
  testRealmURL,
  setupIndex,
  makeRenderer,
  createPrerenderAuth,
} from '../helpers';

import '@cardstack/runtime-common/helpers/code-equality-assertion';

const testRealmURL2 = `http://test-realm/test2/`;
const testRealmInfo: RealmInfo = {
  name: 'Test Realm',
  backgroundURL: null,
  iconURL: null,
  showAsCatalog: null,
  interactHome: null,
  hostHome: null,
  visibility: 'public',
  publishable: null,
  lastPublishedAt: null,
};
const testRealmURLObject = new URL(testRealmURL);

type RealmMetaValue = {
  code_ref: string;
  display_name: string;
  icon_html: string;
  total: number;
};

const internalKeysFor = (...refs: { module: string; name: string }[]) =>
  refs.map((ref) => internalKeyFor(ref, testRealmURLObject));

const makeCardResource = (
  id: string,
  name: string,
  adoptsFrom: { module: string; name: string },
): CardResource => ({
  id: `${testRealmURL}${id}`,
  type: 'card',
  attributes: {
    name,
  },
  meta: {
    adoptsFrom,
  },
});

const makeCardTypeSummary = (
  codeRef: string,
  displayName: string,
  iconHTML: string,
  total: number,
): RealmMetaValue => ({
  total,
  code_ref: codeRef,
  display_name: displayName,
  icon_html: iconHTML,
});

const fetchRealmMetaRows = async (adapter: SQLiteAdapter) =>
  adapter.execute(`SELECT value FROM realm_meta r WHERE r.realm_url = $1`, {
    bind: [testRealmURL],
    coerceTypes: {
      value: 'JSON',
    },
  });

const fetchRealmMeta = async (adapter: SQLiteAdapter) => {
  let rows = await fetchRealmMetaRows(adapter);
  return {
    rows,
    value: (rows[0]?.value ?? []) as RealmMetaValue[],
  };
};

module('Unit | index-writer', function (hooks) {
  let adapter: SQLiteAdapter;
  let indexWriter: IndexWriter;
  let indexQueryEngine: IndexQueryEngine;
  setupTest(hooks);

  hooks.before(async function () {
    adapter = await getDbAdapter();
  });

  hooks.beforeEach(async function () {
    await adapter.reset();
    indexWriter = new IndexWriter(adapter);
    let owner = (getContext() as TestContext).owner;
    await makeRenderer();
    let localIndexer = owner.lookup('service:local-indexer') as LocalIndexer;
    let virtualNetwork = new VirtualNetwork();

    let definitionLookup = new CachingDefinitionLookup(
      adapter,
      localIndexer.prerenderer,
      virtualNetwork,
      createPrerenderAuth,
    );

    definitionLookup.registerRealm({
      url: testRealmURL,
      async getRealmOwnerUserId() {
        return '@user1:localhost';
      },
      async visibility() {
        return 'private';
      },
    });

    indexQueryEngine = new IndexQueryEngine(adapter, definitionLookup);
  });

  test('can perform invalidations for a instance entry', async function (assert) {
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
    await batch.invalidate([new URL(`${testRealmURL}4.json`)]);
    let invalidations = batch.invalidations;

    assert.deepEqual(invalidations.sort(), [
      `${testRealmURL}1.json`,
      `${testRealmURL}2.json`,
      `${testRealmURL}3.json`,
      `${testRealmURL}4.json`,
    ]);

    let invalidatedEntries = await adapter.execute(
      'SELECT url, realm_url, is_deleted FROM boxel_index_working WHERE realm_version = 2 ORDER BY url COLLATE "POSIX"',
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
      `SELECT url, realm_url, realm_version, is_deleted FROM boxel_index_working WHERE realm_url != '${testRealmURL}'`,
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
  });

  test('can perform invalidations for a module entry', async function (assert) {
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
    await batch.invalidate([new URL(`${testRealmURL}person.gts`)]);
    let invalidations = batch.invalidations;

    assert.deepEqual(invalidations.sort(), [
      `${testRealmURL}1.json`,
      `${testRealmURL}2.json`,
      `${testRealmURL}employee.gts`,
      `${testRealmURL}person.gts`,
    ]);
  });

  test("invalidations don't cross realm boundaries", async function (assert) {
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
    await batch.invalidate([new URL(`${testRealmURL}person.gts`)]);
    let invalidations = batch.invalidations;

    // invalidations currently do not cross realm boundaries (probably they
    // will in the future--but via a different mechanism)
    assert.deepEqual(invalidations, [`${testRealmURL}person.gts`]);
  });

  test('can update an index entry', async function (assert) {
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
    await batch.invalidate([new URL(`${testRealmURL}1.json`)]);
    await batch.updateEntry(new URL(`${testRealmURL}1.json`), {
      type: 'instance',
      resource,
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

    let [liveVersion] = await adapter.execute(
      `SELECT realm_version, pristine_doc, search_doc, deps, types FROM boxel_index WHERE url = $1`,
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

    let [wipVersion] = await adapter.execute(
      `SELECT realm_version, pristine_doc, search_doc, deps, types FROM boxel_index_working WHERE url = $1`,
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

    let [finalVersion] = await adapter.execute(
      `SELECT realm_version, pristine_doc, search_doc, deps, types FROM boxel_index WHERE url = $1`,
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
  });

  test('can copy index entries', async function (assert) {
    let types = [{ module: `./person`, name: 'Person' }, baseCardRef].map((i) =>
      internalKeyFor(i, new URL(testRealmURL)),
    );
    let destTypes = [{ module: `./person`, name: 'Person' }, baseCardRef].map(
      (i) => internalKeyFor(i, new URL(testRealmURL2)),
    );
    let modified = Date.now();
    let resource: CardResource = {
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
    await setupIndex(
      adapter,
      [
        { realm_url: testRealmURL, current_version: 1 },
        { realm_url: testRealmURL2, current_version: 1 },
      ],
      [
        {
          url: `${testRealmURL}1.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          type: 'instance',
          pristine_doc: resource,
          search_doc: {
            id: `${testRealmURL}1`,
            name: 'Mango',
            friends: [
              { id: `${testRealmURL}2`, name: 'Van Gogh' },
              { id: `http://a-different-realm.com/hassan`, name: 'Hassan' },
            ],
          },
          display_names: [`Person`],
          deps: [`${testRealmURL}person`],
          types,
          last_modified: String(modified),
          resource_created_at: String(modified),
          embedded_html: Object.fromEntries(
            types.map((type) => [
              type,
              `<div class="embedded">Embedded HTML for ${type
                .split('/')
                .pop()!}</div>`,
            ]),
          ),
          fitted_html: Object.fromEntries(
            types.map((type) => [
              type,
              `<div class="fitted">Fitted HTML for ${type
                .split('/')
                .pop()!}</div>`,
            ]),
          ),
          isolated_html: `<div class="isolated">Isolated HTML</div>`,
          atom_html: `<span class="atom">Atom HTML</span>`,
          head_html: `<span class="head">Head HTML</span>`,
          icon_html: '<svg>test icon</svg>',
        },
        {
          url: `${testRealmURL}person.gts`,
          realm_version: 1,
          realm_url: testRealmURL,
          type: 'module',
          pristine_doc: null,
          search_doc: null,
          display_names: null,
          deps: [`https://cardstack.com/base/card-api.gts`],
          types: null,
          last_modified: String(modified),
          resource_created_at: String(modified),
          head_html: null,
          embedded_html: null,
          fitted_html: null,
          isolated_html: null,
          atom_html: null,
          icon_html: null,
        },
      ],
    );
    let batch = await indexWriter.createBatch(new URL(testRealmURL2));
    await batch.copyFrom(new URL(testRealmURL), testRealmInfo);
    await batch.done();

    let results = (await adapter.execute(
      'SELECT * FROM boxel_index WHERE realm_url = $1 ORDER BY url COLLATE "POSIX"',
      { coerceTypes, bind: [testRealmURL2] },
    )) as unknown as BoxelIndexTable[];
    assert.strictEqual(
      results.length,
      2,
      'correct number of items were copied',
    );

    let [copiedInstance, copiedModule] = results;
    assert.ok(copiedInstance.indexed_at, 'indexed_at was set');
    assert.ok(copiedModule.indexed_at, 'indexed_at was set');

    delete (copiedInstance as Partial<BoxelIndexTable>).indexed_at;
    delete (copiedModule as Partial<BoxelIndexTable>).indexed_at;

    assert.deepEqual(
      copiedInstance as Omit<BoxelIndexTable, 'indexed_at'>,
      {
        url: `${testRealmURL2}1.json`,
        file_alias: `${testRealmURL2}1`,
        realm_version: 2,
        realm_url: testRealmURL2,
        type: 'instance',
        pristine_doc: {
          ...resource,
          id: `${testRealmURL2}1`,
          meta: {
            ...resource.meta,
            realmURL: testRealmURL2,
            realmInfo: testRealmInfo,
          },
        },
        error_doc: null,
        search_doc: {
          id: `${testRealmURL2}1`,
          name: 'Mango',
          friends: [
            { id: `${testRealmURL2}2`, name: 'Van Gogh' },
            { id: `http://a-different-realm.com/hassan`, name: 'Hassan' },
          ],
        },
        display_names: [`Person`],
        deps: [`${testRealmURL2}person`],
        types: destTypes,
        last_modified: String(modified),
        resource_created_at: String(modified),
        embedded_html: Object.fromEntries(
          destTypes.map((type) => [
            type,
            `<div class="embedded">Embedded HTML for ${type
              .split('/')
              .pop()!}</div>`,
          ]),
        ),
        fitted_html: Object.fromEntries(
          destTypes.map((type) => [
            type,
            `<div class="fitted">Fitted HTML for ${type
              .split('/')
              .pop()!}</div>`,
          ]),
        ),
        isolated_html: `<div class="isolated">Isolated HTML</div>`,
        atom_html: `<span class="atom">Atom HTML</span>`,
        head_html: `<span class="head">Head HTML</span>`,
        icon_html: '<svg>test icon</svg>',
        is_deleted: null,
      },
      'the copied instance is correct',
    );
    assert.deepEqual(
      copiedModule as Omit<BoxelIndexTable, 'indexed_at'>,
      {
        url: `${testRealmURL2}person.gts`,
        file_alias: `${testRealmURL2}person`,
        realm_version: 2,
        realm_url: testRealmURL2,
        type: 'module',
        error_doc: null,
        pristine_doc: null,
        search_doc: null,
        display_names: null,
        deps: [`https://cardstack.com/base/card-api.gts`],
        types: null,
        last_modified: String(modified),
        resource_created_at: String(modified),
        embedded_html: null,
        fitted_html: null,
        isolated_html: null,
        atom_html: null,
        head_html: null,
        icon_html: null,
        is_deleted: null,
      },
      'the copied module is correct',
    );
  });

  test('throws when copy source realm is not present on the realm server', async function (assert) {
    assert.expect(1);

    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL2, current_version: 1 }],
      [],
    );
    let batch = await indexWriter.createBatch(new URL(testRealmURL2));
    try {
      await batch.copyFrom(new URL(testRealmURL), testRealmInfo);
      throw new Error('Expected error to be thrown');
    } catch (e: any) {
      assert.strictEqual(
        e.message,
        `nothing to copy from ${testRealmURL} - this realm is not present on the realm server`,
        'the correct exception was thrown',
      );
    }
  });

  test('error entry includes last known good state when available', async function (assert) {
    let types = [{ module: `./person`, name: 'Person' }, baseCardRef].map((i) =>
      internalKeyFor(i, new URL(testRealmURL)),
    );
    let modified = Date.now();
    let resource: CardResource = {
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
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_version: 1 }],
      [
        {
          url: `${testRealmURL}1.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          pristine_doc: resource,
          search_doc: { name: 'Mango' },
          display_names: [`Person`],
          deps: [`${testRealmURL}person`],
          types,
          last_modified: String(modified),
          resource_created_at: String(modified),
          embedded_html: Object.fromEntries(
            types.map((type) => [
              type,
              `<div class="embedded">Embedded HTML for ${type}</div>`,
            ]),
          ),
          fitted_html: Object.fromEntries(
            types.map((type) => [
              type,
              `<div class="fitted">Fitted HTML for ${type}</div>`,
            ]),
          ),
          isolated_html: `<div class="isolated">Isolated HTML</div>`,
          atom_html: `<span class="atom">Atom HTML</span>`,
          head_html: null,
          icon_html: '<svg>test icon</svg>',
        },
      ],
    );
    let batch = await indexWriter.createBatch(new URL(testRealmURL));
    await batch.updateEntry(new URL(`${testRealmURL}1.json`), {
      type: 'error',
      error: {
        message: 'test error',
        status: 500,
        additionalErrors: [],
      },
    });
    await batch.done();

    let [{ indexed_at: _remove, ...errorEntry }] = (await adapter.execute(
      'SELECT * FROM boxel_index WHERE realm_version = 2 ORDER BY url COLLATE "POSIX"',
      { coerceTypes },
    )) as unknown as BoxelIndexTable[];
    assert.deepEqual(
      errorEntry,
      {
        url: `${testRealmURL}1.json`,
        file_alias: `${testRealmURL}1`,
        realm_version: 2,
        realm_url: testRealmURL,
        type: 'error',
        pristine_doc: resource,
        error_doc: {
          message: 'test error',
          status: 500,
          id: `${testRealmURL}1.json`,
          additionalErrors: [],
        },
        search_doc: { name: 'Mango' },
        display_names: [`Person`],
        deps: [`${testRealmURL}person`],
        types,
        embedded_html: Object.fromEntries(
          types.map((type) => [
            type,
            `<div class="embedded">Embedded HTML for ${type}</div>`,
          ]),
        ),
        fitted_html: Object.fromEntries(
          types.map((type) => [
            type,
            `<div class="fitted">Fitted HTML for ${type}</div>`,
          ]),
        ),
        isolated_html: `<div class="isolated">Isolated HTML</div>`,
        atom_html: `<span class="atom">Atom HTML</span>`,
        head_html: null,
        last_modified: String(modified),
        resource_created_at: String(modified),
        is_deleted: null,
        icon_html: '<svg>test icon</svg>',
      },
      'the error entry includes last known good state of instance',
    );
  });

  test('error entry does not include last known good state when not available', async function (assert) {
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_version: 1 }],
      [],
    );
    let batch = await indexWriter.createBatch(new URL(testRealmURL));
    await batch.updateEntry(new URL(`${testRealmURL}1.json`), {
      type: 'error',
      error: {
        message: 'test error',
        status: 500,
        additionalErrors: [],
      },
    });
    await batch.done();

    let [{ indexed_at: _remove, ...errorEntry }] = (await adapter.execute(
      'SELECT * FROM boxel_index WHERE realm_version = 2 ORDER BY url COLLATE "POSIX"',
      { coerceTypes },
    )) as unknown as BoxelIndexTable[];
    assert.deepEqual(
      errorEntry,
      {
        url: `${testRealmURL}1.json`,
        file_alias: `${testRealmURL}1`,
        realm_version: 2,
        realm_url: testRealmURL,
        type: 'error',
        pristine_doc: null,
        error_doc: {
          message: 'test error',
          status: 500,
          id: `${testRealmURL}1.json`,
          additionalErrors: [],
        },
        search_doc: null,
        display_names: null,
        deps: [],
        types: null,
        embedded_html: null,
        fitted_html: null,
        isolated_html: null,
        atom_html: null,
        head_html: null,
        last_modified: null,
        resource_created_at: null,
        is_deleted: false,
        icon_html: null,
      },
      'the error entry does not include last known good state of instance',
    );
  });

  test('normalizes error doc id and deps', async function (assert) {
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_version: 1 }],
      [],
    );
    let batch = await indexWriter.createBatch(new URL(testRealmURL));
    await batch.updateEntry(new URL(`${testRealmURL}nested/1.json`), {
      type: 'error',
      error: {
        id: null,
        message: 'test error',
        status: 404,
        deps: ['../headless-skill-set', `${testRealmURL}other-card`],
        additionalErrors: null,
      },
    });
    await batch.done();

    let [{ error_doc: errorDoc, deps }] = (await adapter.execute(
      'SELECT error_doc, deps FROM boxel_index WHERE realm_version = 2 ORDER BY url COLLATE "POSIX"',
      { coerceTypes },
    )) as Pick<BoxelIndexTable, 'error_doc' | 'deps'>[];

    assert.strictEqual(
      errorDoc?.id,
      `${testRealmURL}nested/1.json`,
      'id defaults to entry url',
    );
    assert.deepEqual(
      errorDoc?.deps,
      [`${testRealmURL}headless-skill-set`, `${testRealmURL}other-card`],

      'error doc deps are canonicalized',
    );
    assert.deepEqual(
      deps,
      [`${testRealmURL}headless-skill-set`, `${testRealmURL}other-card`],
      'entry deps include normalized error deps',
    );
  });

  test('can get an error doc', async function (assert) {
    await setupIndex(adapter, [
      {
        url: `${testRealmURL}1.json`,
        realm_version: 1,
        realm_url: testRealmURL,
        type: 'error',
        error_doc: {
          message: 'test error',
          status: 500,
          id: `${testRealmURL}1.json`,
          additionalErrors: [],
        },
      },
    ]);
    let entry = await indexQueryEngine.getInstance(new URL(`${testRealmURL}1`));
    if (entry?.type === 'error') {
      assert.ok(entry.lastModified, 'lastModified exists');
      entry.lastModified = null;
      assert.deepEqual(entry, {
        type: 'error',
        error: {
          message: 'test error',
          status: 500,
          id: `${testRealmURL}1.json`,
          additionalErrors: [],
        },
        canonicalURL: `${testRealmURL}1.json`,
        realmVersion: 1,
        realmURL: testRealmURL,
        instance: null,
        lastModified: null,
        resourceCreatedAt: null,
        isolatedHtml: null,
        embeddedHtml: null,
        fittedHtml: null,
        atomHtml: null,
        headHtml: null,
        searchDoc: null,
        types: null,
        indexedAt: null,
        deps: null,
      });
    } else {
      assert.ok(false, `expected index entry to not be a card document`);
    }
  });

  test('can get "production" index entry', async function (assert) {
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
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_version: 1 }],
      [
        {
          url: `${testRealmURL}1.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          pristine_doc: originalResource,
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
    await batch.invalidate([new URL(`${testRealmURL}1.json`)]);
    await batch.updateEntry(new URL(`${testRealmURL}1.json`), {
      type: 'instance',
      resource,
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
        headHtml: null,
      });
    } else {
      assert.ok(false, `expected index entry to not be an error document`);
    }
  });

  test('can get work in progress card', async function (assert) {
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
    let batch = await indexWriter.createBatch(new URL(testRealmURL));
    let now = Date.now();
    await batch.invalidate([new URL(`${testRealmURL}1.json`)]);
    await batch.updateEntry(new URL(`${testRealmURL}1.json`), {
      type: 'instance',
      resource,
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
        lastModified: now,
        resourceCreatedAt: now,
        searchDoc: { name: 'Van Gogh' },
        deps: [],
        types: [],
        isolatedHtml: null,
        embeddedHtml: null,
        fittedHtml: null,
        atomHtml: null,
        headHtml: null,
      });
    } else {
      assert.ok(false, `expected index entry to not be an error document`);
    }
  });

  test('returns undefined when getting a deleted card', async function (assert) {
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
  });

  test('can perform invalidations for an instance with deps more than a thousand', async function (assert) {
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
    await batch.invalidate([new URL(`${testRealmURL}1.json`)]);
    let invalidations = batch.invalidations;

    assert.ok(invalidations.length > 1000, 'Can invalidate more than 1000');
    assert.deepEqual(
      invalidations.sort(),
      indexRows.map((r) => r.url),
    );

    let invalidatedEntries = (await adapter.execute(
      'SELECT url, realm_url, is_deleted FROM boxel_index_working WHERE realm_version = 2 ORDER BY url COLLATE "POSIX"',
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
  });

  test('can get compiled module and source when requested with file extension', async function (assert) {
    await setupIndex(adapter);
    let batch = await indexWriter.createBatch(new URL(testRealmURL));
    let now = Date.now();
    await batch.updateEntry(new URL(`${testRealmURL}person.gts`), {
      type: 'module',
      lastModified: now,
      resourceCreatedAt: now,
      deps: new Set(),
    });
    await batch.done();

    let result = await indexQueryEngine.getModule(
      new URL(`${testRealmURL}person.gts`),
    );
    if (result?.type === 'module') {
      let { lastModified } = result;
      assert.strictEqual(lastModified, now, 'lastModified is correct');
    } else {
      assert.ok(false, `expected module not to be an error document`);
    }
  });

  test('can get compiled module and source when requested without file extension', async function (assert) {
    await setupIndex(adapter);
    let batch = await indexWriter.createBatch(new URL(testRealmURL));
    let now = Date.now();
    await batch.updateEntry(new URL(`${testRealmURL}person.gts`), {
      type: 'module',
      lastModified: now,
      resourceCreatedAt: now,
      deps: new Set(),
    });
    await batch.done();

    let result = await indexQueryEngine.getModule(
      new URL(`${testRealmURL}person`),
    );
    if (result?.type === 'module') {
      let { lastModified } = result;
      assert.strictEqual(lastModified, now, 'lastModified is correct');
    } else {
      assert.ok(false, `expected module not to be an error document`);
    }
  });

  test('can get compiled module and source from WIP index', async function (assert) {
    await setupIndex(adapter);
    let batch = await indexWriter.createBatch(new URL(testRealmURL));
    let now = Date.now();
    await batch.updateEntry(new URL(`${testRealmURL}person.gts`), {
      type: 'module',
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
      let { lastModified } = result;
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
  });

  test('can get error doc for module', async function (assert) {
    await setupIndex(adapter, [
      {
        url: `${testRealmURL}person.gts`,
        realm_version: 1,
        realm_url: testRealmURL,
        type: 'error',
        error_doc: {
          message: 'test error',
          status: 500,
          id: `${testRealmURL}person.gts`,
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
          message: 'test error',
          status: 500,
          id: `${testRealmURL}person.gts`,
          additionalErrors: [],
        },
      });
    } else {
      assert.ok(false, `expected an error document`);
    }
  });

  test('returns undefined when getting a deleted module', async function (assert) {
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
  });

  test('update realm meta when indexing is done', async function (assert) {
    let iconHTML = '<svg>test icon</svg>';
    let personTypes = internalKeysFor(
      { module: './person', name: 'Person' },
      baseCardRef,
    );
    let fancyPersonTypes = internalKeysFor(
      { module: './fancy-person', name: 'FancyPerson' },
      { module: './person', name: 'Person' },
      baseCardRef,
    );
    let petTypes = internalKeysFor(
      { module: './pet', name: 'Pet' },
      { module: './card-api', name: 'CardDef' },
      baseCardRef,
    );
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
          types: personTypes,
          icon_html: iconHTML,
        },
      ],
    );

    let resource2 = makeCardResource('2', 'Van Gogh', {
      module: './fancy-person',
      name: 'FancyPerson',
    });
    let batch = await indexWriter.createBatch(new URL(testRealmURL));
    await batch.invalidate([new URL(`${testRealmURL}2.json`)]);
    let timestamp = Date.now();
    await batch.updateEntry(new URL(`${testRealmURL}2.json`), {
      type: 'instance',
      resource: resource2,
      lastModified: timestamp,
      resourceCreatedAt: timestamp,
      searchData: { name: 'Van Gogh' },
      deps: new Set([`${testRealmURL}fancy-person`]),
      displayNames: ['Fancy Person', 'Person', 'Card'],
      types: fancyPersonTypes,
      iconHTML,
    });

    let realmMeta = await fetchRealmMeta(adapter);
    assert.strictEqual(
      realmMeta.rows.length,
      0,
      'correct length of query result before indexing is done',
    );

    await batch.done();

    realmMeta = await fetchRealmMeta(adapter);
    assert.strictEqual(
      realmMeta.rows.length,
      1,
      'correct length of query result after indexing is done',
    );
    let value = realmMeta.value;
    assert.strictEqual(
      value.length,
      2,
      'correct length of card type summary after indexing is done',
    );
    assert.deepEqual(
      value,
      [
        makeCardTypeSummary(
          `${testRealmURL}fancy-person/FancyPerson`,
          'Fancy Person',
          iconHTML,
          1,
        ),
        makeCardTypeSummary(
          `${testRealmURL}person/Person`,
          'Person',
          iconHTML,
          1,
        ),
      ],
      'correct card type summary after indexing is done',
    );

    batch = await indexWriter.createBatch(new URL(testRealmURL));
    let resource3 = makeCardResource('3', 'Van Gogh2', {
      module: './fancy-person',
      name: 'FancyPerson',
    });
    await batch.invalidate([new URL(`${testRealmURL}3.json`)]);
    timestamp = Date.now();
    await batch.updateEntry(new URL(`${testRealmURL}3.json`), {
      type: 'instance',
      resource: resource3,
      lastModified: timestamp,
      resourceCreatedAt: timestamp,
      searchData: { name: 'Van Gogh2' },
      deps: new Set([`${testRealmURL}fancy-person`]),
      displayNames: ['Fancy Person', 'Person', 'Card'],
      types: fancyPersonTypes,
      iconHTML,
    });
    let resource4 = makeCardResource('4', 'Mango', {
      module: './pet',
      name: 'Pet',
    });
    await batch.invalidate([new URL(`${testRealmURL}4.json`)]);
    timestamp = Date.now();
    await batch.updateEntry(new URL(`${testRealmURL}4.json`), {
      type: 'instance',
      resource: resource4,
      lastModified: timestamp,
      resourceCreatedAt: timestamp,
      searchData: { name: 'Mango' },
      deps: new Set([`${testRealmURL}pet`]),
      displayNames: ['Pet', 'Card'],
      types: petTypes,
      iconHTML,
    });
    await batch.done();

    realmMeta = await fetchRealmMeta(adapter);
    assert.strictEqual(
      realmMeta.rows.length,
      1,
      'correct length of query result after indexing is done',
    );
    value = realmMeta.value;
    assert.strictEqual(
      value.length,
      3,
      'correct length of card type summary after indexing is done',
    );

    assert.deepEqual(
      value,
      [
        makeCardTypeSummary(
          `${testRealmURL}fancy-person/FancyPerson`,
          'Fancy Person',
          iconHTML,
          2,
        ),
        makeCardTypeSummary(
          `${testRealmURL}person/Person`,
          'Person',
          iconHTML,
          1,
        ),
        makeCardTypeSummary(`${testRealmURL}pet/Pet`, 'Pet', iconHTML, 1),
      ],
      'correct card type summary after indexing is done',
    );
  });

  test('update realm meta includes error entries with last known good state', async function (assert) {
    let iconHTML = '<svg>test icon</svg>';
    let personTypes = internalKeysFor(
      { module: './person', name: 'Person' },
      baseCardRef,
    );
    let personResource = makeCardResource('1', 'Mango', {
      module: './person',
      name: 'Person',
    });

    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_version: 1 }],
      [
        {
          url: `${testRealmURL}1.json`,
          realm_version: 1,
          realm_url: testRealmURL,
          pristine_doc: personResource as LooseCardResource,
          search_doc: { name: 'Mango' },
          display_names: [`Person`],
          deps: [`${testRealmURL}person`],
          types: personTypes,
          icon_html: iconHTML,
        },
      ],
    );

    let batch = await indexWriter.createBatch(new URL(testRealmURL));
    await batch.updateEntry(new URL(`${testRealmURL}1.json`), {
      type: 'error',
      error: {
        message: 'test error',
        status: 500,
        additionalErrors: [],
      },
    });
    await batch.done();

    let realmMeta = await fetchRealmMeta(adapter);
    assert.strictEqual(
      realmMeta.rows.length,
      1,
      'card type summary includes error entries',
    );
    let value = realmMeta.value;
    assert.deepEqual(
      value,
      [
        makeCardTypeSummary(
          `${testRealmURL}person/Person`,
          'Person',
          iconHTML,
          1,
        ),
      ],
      'card type summary uses last known good card type data',
    );
  });
});
