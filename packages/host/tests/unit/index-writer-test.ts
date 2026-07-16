import { type TestContext, getContext } from '@ember/test-helpers';

import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import {
  IndexQueryEngine,
  IndexWriter,
  internalKeyFor,
  baseCardRef,
  coerceTypes,
  mergeErrorDetail,
  mergeErrorsByGeneration,
  ri,
  rri,
  type LooseCardResource,
  type IndexedInstance,
  type BoxelIndexTable,
  type PrerenderedHtmlTable,
  type CardResource,
  type RealmResourceIdentifier,
  type SerializedError,
} from '@cardstack/runtime-common';
import { CachingDefinitionLookup } from '@cardstack/runtime-common/definition-lookup';
import { persistFileMeta } from '@cardstack/runtime-common/file-meta';
import { VirtualNetwork } from '@cardstack/runtime-common/virtual-network';

import type SQLiteAdapter from '@cardstack/host/lib/sqlite-adapter';
import type LocalIndexer from '@cardstack/host/services/local-indexer';

import {
  getDbAdapter,
  testRealmURL,
  testRRI,
  setupIndex,
  makeRenderer,
  createPrerenderAuth,
} from '../helpers';

import '@cardstack/runtime-common/helpers/code-equality-assertion';

const testRealmURL2 = ri(`http://test-realm/test2/`);
const testRealmURLObject = new URL(testRealmURL);

type RealmMetaValue = {
  code_ref: string;
  display_name: string;
  icon_html: string;
  total: number;
};

const internalKeysFor = (
  vn: VirtualNetwork,
  ...refs: { module: RealmResourceIdentifier; name: string }[]
) => refs.map((ref) => internalKeyFor(ref, testRealmURLObject, vn));

const makeCardResource = (
  id: string,
  name: string,
  adoptsFrom: { module: RealmResourceIdentifier; name: string },
): CardResource => ({
  id: testRRI(id),
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
  let raw = rows[0]?.value as
    | { instances?: RealmMetaValue[]; files?: RealmMetaValue[] }
    | undefined;
  return {
    rows,
    value: (raw?.instances ?? []) as RealmMetaValue[],
    files: (raw?.files ?? []) as RealmMetaValue[],
  };
};

module('Unit | index-writer', function (hooks) {
  let adapter: SQLiteAdapter;
  let indexWriter: IndexWriter;
  let indexQueryEngine: IndexQueryEngine;
  let virtualNetwork: VirtualNetwork;
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
    virtualNetwork = new VirtualNetwork();

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

    indexQueryEngine = new IndexQueryEngine(
      adapter,
      definitionLookup,
      virtualNetwork,
    );
  });

  test('can perform invalidations for a instance entry', async function (assert) {
    await setupIndex(
      adapter,
      [
        { realm_url: testRealmURL, current_generation: 1 },
        { realm_url: testRealmURL2, current_generation: 5 },
      ],
      [
        {
          url: `${testRealmURL}1.json`,
          generation: 1,
          realm_url: testRealmURL,
          deps: [`${testRealmURL}2.json`],
        },
        {
          url: `${testRealmURL}2.json`,
          generation: 1,
          realm_url: testRealmURL,
          deps: [`${testRealmURL}4.json`],
        },
        {
          url: `${testRealmURL}3.json`,
          generation: 1,
          realm_url: testRealmURL,
          deps: [`${testRealmURL}2.json`],
        },
        {
          url: `${testRealmURL}4.json`,
          generation: 1,
          realm_url: testRealmURL,
          deps: [],
        },
        {
          url: `${testRealmURL}5.json`,
          generation: 1,
          realm_url: testRealmURL,
          deps: [],
        },
        {
          url: `${testRealmURL2}A.json`,
          generation: 5,
          realm_url: testRealmURL2,
          deps: [],
        },
      ],
    );

    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
    await batch.invalidate([new URL(`${testRealmURL}4.json`)]);
    let invalidations = batch.invalidations;

    assert.deepEqual(invalidations.sort(), [
      `${testRealmURL}1.json`,
      `${testRealmURL}2.json`,
      `${testRealmURL}3.json`,
      `${testRealmURL}4.json`,
    ]);

    let invalidatedEntries = await adapter.execute(
      'SELECT url, realm_url, is_deleted FROM boxel_index_working WHERE generation = 2 ORDER BY url COLLATE "POSIX"',
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
      `SELECT url, realm_url, generation, is_deleted FROM boxel_index_working WHERE realm_url != '${testRealmURL}'`,
      { coerceTypes: { is_deleted: 'BOOLEAN' } },
    );
    assert.deepEqual(
      otherRealms,
      [
        {
          url: `${testRealmURL2}A.json`,
          realm_url: testRealmURL2,
          generation: 5,
          is_deleted: null,
        },
      ],
      'the index entries from other realms are unchanged',
    );
    let generations = await adapter.execute(
      'select realm_url, current_generation from realm_generations ORDER BY realm_url COLLATE "POSIX"',
    );
    assert.deepEqual(
      generations,
      [
        {
          realm_url: `${testRealmURL}`,
          current_generation: 1,
        },
        {
          realm_url: `${testRealmURL2}`,
          current_generation: 5,
        },
      ],
      'the "production" realm generations are correct',
    );
  });

  test('prefetchFileMeta serves per-visit created-at + content-meta lookups from one batched read', async function (assert) {
    // Seed realm_file_meta the way the realm write path does: created_at for
    // every file, content hash/size for the files that have been hashed.
    let seeded = await persistFileMeta(adapter, testRealmURL, [
      { path: '1.json', contentHash: 'hash-1', contentSize: 11 },
      { path: '2.json', contentHash: 'hash-2', contentSize: 22 },
      { path: '3.json' }, // created_at only — no hash/size (e.g. a pre-hashing file)
    ]);

    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
    // '4.json' has no row at all, exercising the unprefetched fallback below.
    await batch.prefetchFileMeta(['1.json', '2.json', '3.json', '4.json']);

    // After the prefetch, the per-visit lookups the index loop makes are served
    // from memory: no further DB round-trips for the prefetched files.
    let executeCalls = 0;
    let origExecute = adapter.execute.bind(adapter);
    adapter.execute = ((sql: string, opts?: any) => {
      executeCalls++;
      return origExecute(sql, opts);
    }) as typeof adapter.execute;
    try {
      assert.deepEqual(await batch.getContentMeta('1.json'), {
        contentHash: 'hash-1',
        contentSize: 11,
      });
      assert.deepEqual(await batch.getContentMeta('2.json'), {
        contentHash: 'hash-2',
        contentSize: 22,
      });
      assert.deepEqual(
        await batch.getContentMeta('3.json'),
        { contentHash: undefined, contentSize: undefined },
        'a file with a row but no persisted hash/size is served as undefined from the cache',
      );
      assert.strictEqual(
        await batch.ensureFileCreatedAt('1.json'),
        seeded.get('1.json')!.createdAt,
        'created_at is served from the cache',
      );
      assert.strictEqual(
        executeCalls,
        0,
        'prefetched lookups make no DB round-trips',
      );
    } finally {
      adapter.execute = origExecute;
    }

    // A file the prefetch didn't cover falls back to the per-path read — which
    // for ensureFileCreatedAt still creates the row — so behavior is unchanged
    // when a lookup misses the cache.
    let created4 = await batch.ensureFileCreatedAt('4.json');
    assert.true(
      created4 > 0,
      'an unprefetched file still gets a created_at via the per-path fallback',
    );
    assert.deepEqual(
      await batch.getContentMeta('4.json'),
      { contentHash: undefined, contentSize: undefined },
      'an unprefetched file with no hash/size falls back to a per-path read',
    );
  });

  test('can perform invalidations for a module change via instance deps', async function (assert) {
    await setupIndex(
      adapter,
      [
        { realm_url: testRealmURL, current_generation: 1 },
        { realm_url: testRealmURL2, current_generation: 5 },
      ],
      [
        {
          url: `${testRealmURL}1.json`,
          file_alias: `${testRealmURL}1.json`,
          type: 'instance',
          generation: 1,
          realm_url: testRealmURL,
          deps: [`${testRealmURL}employee`, `${testRealmURL}person`],
        },
        {
          url: `${testRealmURL}2.json`,
          file_alias: `${testRealmURL}2.json`,
          type: 'instance',
          generation: 1,
          realm_url: testRealmURL,
          deps: [`${testRealmURL}1.json`],
        },
        {
          url: `${testRealmURL}3.json`,
          file_alias: `${testRealmURL}3.json`,
          type: 'instance',
          generation: 1,
          realm_url: testRealmURL,
          deps: [],
        },
      ],
    );

    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
    await batch.invalidate([new URL(`${testRealmURL}person.gts`)]);
    let invalidations = batch.invalidations;

    assert.deepEqual(invalidations.sort(), [
      `${testRealmURL}1.json`,
      `${testRealmURL}2.json`,
      `${testRealmURL}person.gts`,
    ]);
  });

  test("invalidations don't cross realm boundaries", async function (assert) {
    await setupIndex(
      adapter,
      [
        { realm_url: testRealmURL, current_generation: 1 },
        { realm_url: testRealmURL2, current_generation: 5 },
      ],
      [
        {
          url: `${testRealmURL2}luke.json`,
          file_alias: `${testRealmURL2}luke.json`,
          type: 'instance',
          generation: 1,
          realm_url: testRealmURL2,
          deps: [`${testRealmURL}person`],
        },
      ],
    );
    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
    await batch.invalidate([new URL(`${testRealmURL}person.gts`)]);
    let invalidations = batch.invalidations;

    // invalidations currently do not cross realm boundaries (probably they
    // will in the future--but via a different mechanism)
    assert.deepEqual(invalidations, [`${testRealmURL}person.gts`]);
  });

  test('can update an index entry', async function (assert) {
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      [
        {
          url: `${testRealmURL}1.json`,
          generation: 1,
          realm_url: testRealmURL,
          pristine_doc: {
            id: `${testRealmURL}1.json`,
            type: 'card',
            attributes: {
              name: 'Mango',
            },
            meta: {
              adoptsFrom: {
                module: rri(`./person`),
                name: 'Person',
              },
            },
          } as LooseCardResource,
          search_doc: { name: 'Mango' },
          deps: [`${testRealmURL}person`],
          types: [{ module: rri(`./person`), name: 'Person' }, baseCardRef].map(
            (i) => internalKeyFor(i, new URL(testRealmURL), virtualNetwork),
          ),
        },
      ],
    );

    let resource: CardResource = {
      id: testRRI('1.json'),
      type: 'card',
      attributes: {
        name: 'Van Gogh',
      },
      meta: {
        adoptsFrom: {
          module: rri(`./fancy-person`),
          name: 'FancyPerson',
        },
      },
    };
    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
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
        {
          module: rri(`./fancy-person`),
          name: 'FancyPerson',
        },
        { module: rri(`./person`), name: 'Person' },
        baseCardRef,
      ].map((i) => internalKeyFor(i, new URL(testRealmURL), virtualNetwork)),
    });

    let [liveVersion] = await adapter.execute(
      `SELECT generation, pristine_doc, search_doc, deps, types FROM boxel_index WHERE url = $1`,
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
        generation: 1,
        pristine_doc: {
          id: `${testRealmURL}1.json`,
          type: 'card',
          attributes: {
            name: 'Mango',
          },
          meta: {
            adoptsFrom: {
              module: rri(`./person`),
              name: 'Person',
            },
          },
        },
        search_doc: { name: 'Mango' },
        deps: [`${testRealmURL}person`],
        types: [{ module: rri(`./person`), name: 'Person' }, baseCardRef].map(
          (i) => internalKeyFor(i, new URL(testRealmURL), virtualNetwork),
        ),
      },
      'live version of the doc has not changed',
    );

    let [wipVersion] = await adapter.execute(
      `SELECT generation, pristine_doc, search_doc, deps, types FROM boxel_index_working WHERE url = $1`,
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
        generation: 2,
        pristine_doc: {
          id: `${testRealmURL}1.json`,
          type: 'card',
          attributes: {
            name: 'Van Gogh',
          },
          meta: {
            adoptsFrom: {
              module: rri(`./fancy-person`),
              name: 'FancyPerson',
            },
          },
        },
        search_doc: { name: 'Van Gogh' },
        deps: [`${testRealmURL}fancy-person`],
        types: [
          {
            module: rri(`./fancy-person`),
            name: 'FancyPerson',
          },
          { module: rri(`./person`), name: 'Person' },
          baseCardRef,
        ].map((i) => internalKeyFor(i, new URL(testRealmURL), virtualNetwork)),
      },
      'WIP version of the doc exists',
    );

    await batch.done();

    let [finalVersion] = await adapter.execute(
      `SELECT generation, pristine_doc, search_doc, deps, types FROM boxel_index WHERE url = $1`,
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
        generation: 2,
        pristine_doc: {
          id: `${testRealmURL}1.json`,
          type: 'card',
          attributes: {
            name: 'Van Gogh',
          },
          meta: {
            adoptsFrom: {
              module: rri(`./fancy-person`),
              name: 'FancyPerson',
            },
          },
        },
        search_doc: { name: 'Van Gogh' },
        deps: [`${testRealmURL}fancy-person`],
        types: [
          {
            module: rri(`./fancy-person`),
            name: 'FancyPerson',
          },
          { module: rri(`./person`), name: 'Person' },
          baseCardRef,
        ].map((i) => internalKeyFor(i, new URL(testRealmURL), virtualNetwork)),
      },
      'final version of the doc exists',
    );
  });

  test('sanitizes jsonb-illegal code points in content columns before write', async function (assert) {
    // Postgres rejects the NUL character and unpaired UTF-16 surrogate halves
    // inside a jsonb value's text (22P05), which aborts the whole upsert batch
    // — a single bad card strands an entire realm's from-scratch index. These
    // code points reach the writer inside rendered card content: a stray NUL
    // folded in from an upstream resolver, or a valid astral-plane emoji whose
    // surrogate pair was split by an upstream truncation. updateEntry must
    // strip them from every content column while leaving valid content intact.
    const NUL = '\u0000';
    const LONE_HIGH = '\uD83E'; // high surrogate with no trailing low
    const LONE_LOW = '\uDDE9'; // low surrogate with no leading high
    const VALID_EMOJI = '🧩'; // 🧩 — a well-formed surrogate pair
    const REPLACEMENT = '\uFFFD';

    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      [],
    );

    let resource: CardResource = {
      id: testRRI('1.json'),
      type: 'card',
      attributes: {
        name: `Van${NUL}Gogh`,
        bio: `high:${LONE_HIGH} emoji:${VALID_EMOJI} low:${LONE_LOW}`,
      },
      meta: {
        adoptsFrom: {
          module: rri(`./person`),
          name: 'Person',
        },
      },
    };
    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
    await batch.invalidate([new URL(`${testRealmURL}1.json`)]);
    await batch.updateEntry(new URL(`${testRealmURL}1.json`), {
      type: 'instance',
      resource,
      lastModified: Date.now(),
      resourceCreatedAt: Date.now(),
      searchData: {
        name: `Van${NUL}Gogh`,
        bio: `high:${LONE_HIGH} emoji:${VALID_EMOJI} low:${LONE_LOW}`,
      },
      markdown: `# Title${NUL} ${LONE_HIGH} keep ${VALID_EMOJI}`,
      deps: new Set([`${testRealmURL}person`]),
      displayNames: [`Person${NUL}`],
      types: [{ module: rri(`./person`), name: 'Person' }, baseCardRef].map(
        (i) => internalKeyFor(i, new URL(testRealmURL), virtualNetwork),
      ),
    });

    let [row] = await adapter.execute(
      `SELECT pristine_doc, search_doc, display_names FROM boxel_index_working WHERE url = $1`,
      {
        bind: [`${testRealmURL}1.json`],
        coerceTypes: {
          pristine_doc: 'JSON',
          search_doc: 'JSON',
          display_names: 'JSON',
        },
      },
    );

    let pristine = row.pristine_doc as unknown as LooseCardResource;
    let search = row.search_doc as unknown as Record<string, string>;
    let displayNames = row.display_names as unknown as string[];

    assert.strictEqual(
      pristine.attributes?.name,
      `Van${REPLACEMENT}Gogh`,
      'NUL in pristine_doc string is replaced',
    );
    assert.strictEqual(
      search.name,
      `Van${REPLACEMENT}Gogh`,
      'NUL in search_doc string is replaced',
    );
    assert.strictEqual(
      search.bio,
      `high:${REPLACEMENT} emoji:${VALID_EMOJI} low:${REPLACEMENT}`,
      'lone surrogates are replaced while the valid emoji pair is preserved',
    );
    let [renderedRow] = await adapter.execute(
      `SELECT markdown FROM prerendered_html_working WHERE url = $1`,
      { bind: [`${testRealmURL}1.json`] },
    );
    assert.strictEqual(
      renderedRow.markdown,
      `# Title${REPLACEMENT} ${REPLACEMENT} keep ${VALID_EMOJI}`,
      'markdown column is sanitized and keeps the valid emoji',
    );
    assert.deepEqual(
      displayNames,
      [`Person${REPLACEMENT}`],
      'display_names entries are sanitized',
    );
  });

  test('lands prerendered HTML on the prerendered_html channel and swaps it into production on done', async function (assert) {
    let types = [{ module: rri(`./person`), name: 'Person' }, baseCardRef].map(
      (i) => internalKeyFor(i, new URL(testRealmURL), virtualNetwork),
    );
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      [
        {
          url: `${testRealmURL}1.json`,
          generation: 1,
          realm_url: testRealmURL,
          type: 'instance',
        },
      ],
    );

    let resource: CardResource = {
      id: testRRI('1.json'),
      type: 'card',
      attributes: { name: 'Van Gogh' },
      meta: { adoptsFrom: { module: rri(`./person`), name: 'Person' } },
    };
    let embeddedHtml = Object.fromEntries(
      types.map((type) => [type, `<div class="embedded">${type}</div>`]),
    );
    let fittedHtml = Object.fromEntries(
      types.map((type) => [type, `<div class="fitted">${type}</div>`]),
    );
    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
    await batch.invalidate([new URL(`${testRealmURL}1.json`)]);
    await batch.updateEntry(new URL(`${testRealmURL}1.json`), {
      type: 'instance',
      resource,
      lastModified: Date.now(),
      resourceCreatedAt: Date.now(),
      searchData: { name: 'Van Gogh' },
      deps: new Set([`${testRealmURL}person`]),
      displayNames: ['Person', 'Card'],
      types,
      embeddedHtml,
      fittedHtml,
      isolatedHtml: `<div class="isolated">Isolated</div>`,
      atomHtml: `<span class="atom">Atom</span>`,
      headHtml: `<span class="head">Head</span>`,
      iconHTML: `<svg>icon</svg>`,
      markdown: 'Van Gogh markdown',
    });
    await batch.done();

    let [rendered] = (await adapter.execute(
      `SELECT url, realm_url, type, fitted_html, embedded_html, isolated_html, atom_html, head_html, markdown, deps, generation, is_deleted, error_doc
       FROM prerendered_html WHERE url = $1`,
      {
        bind: [`${testRealmURL}1.json`],
        coerceTypes: {
          fitted_html: 'JSON',
          embedded_html: 'JSON',
          deps: 'JSON',
          error_doc: 'JSON',
          is_deleted: 'BOOLEAN',
        },
      },
    )) as unknown as Partial<PrerenderedHtmlTable>[];

    assert.deepEqual(
      rendered,
      {
        url: `${testRealmURL}1.json`,
        realm_url: testRealmURL,
        type: 'instance',
        fitted_html: fittedHtml,
        embedded_html: embeddedHtml,
        isolated_html: `<div class="isolated">Isolated</div>`,
        atom_html: `<span class="atom">Atom</span>`,
        head_html: `<span class="head">Head</span>`,
        markdown: 'Van Gogh markdown',
        deps: [`${testRealmURL}person`],
        generation: 2,
        is_deleted: false,
        error_doc: null,
      },
      'prerendered_html carries the HTML at the job generation',
    );

    // icon_html renders in the index visit and lives on boxel_index; the
    // other formats live only on prerendered_html.
    let [indexRow] = (await adapter.execute(
      `SELECT icon_html FROM boxel_index WHERE url = $1`,
      { bind: [`${testRealmURL}1.json`] },
    )) as unknown as BoxelIndexTable[];
    assert.strictEqual(
      indexRow.icon_html,
      `<svg>icon</svg>`,
      'icon_html lives on boxel_index (not part of prerendered_html)',
    );
  });

  test('tombstones the prerendered_html row on delete, preserving last-known HTML', async function (assert) {
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      [
        {
          url: `${testRealmURL}1.json`,
          generation: 1,
          realm_url: testRealmURL,
          type: 'instance',
        },
      ],
    );
    let resource: CardResource = {
      id: testRRI('1.json'),
      type: 'card',
      attributes: { name: 'Van Gogh' },
      meta: { adoptsFrom: { module: rri(`./person`), name: 'Person' } },
    };

    // First index the instance with HTML so prerendered_html has a rendering.
    let batch1 = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
    await batch1.invalidate([new URL(`${testRealmURL}1.json`)]);
    await batch1.updateEntry(new URL(`${testRealmURL}1.json`), {
      type: 'instance',
      resource,
      lastModified: Date.now(),
      resourceCreatedAt: Date.now(),
      searchData: { name: 'Van Gogh' },
      deps: new Set([`${testRealmURL}person`]),
      displayNames: ['Person'],
      types: [{ module: rri(`./person`), name: 'Person' }, baseCardRef].map(
        (i) => internalKeyFor(i, new URL(testRealmURL), virtualNetwork),
      ),
      isolatedHtml: `<div class="isolated">Isolated</div>`,
      markdown: 'Van Gogh markdown',
    });
    await batch1.done();

    // Then delete it: invalidate + done with no updateEntry (file removed).
    let batch2 = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
    await batch2.invalidate([new URL(`${testRealmURL}1.json`)]);
    await batch2.done();

    let [rendered] = (await adapter.execute(
      `SELECT is_deleted, isolated_html, markdown, generation FROM prerendered_html WHERE url = $1`,
      {
        bind: [`${testRealmURL}1.json`],
        coerceTypes: { is_deleted: 'BOOLEAN' },
      },
    )) as unknown as PrerenderedHtmlTable[];
    assert.true(rendered.is_deleted, 'prerendered_html row is tombstoned');
    assert.strictEqual(
      rendered.isolated_html,
      `<div class="isolated">Isolated</div>`,
      'last-known HTML is preserved on the tombstone',
    );
    assert.strictEqual(
      rendered.generation,
      3,
      'tombstone stamped at the deleting job generation',
    );

    let [indexRow] = (await adapter.execute(
      `SELECT is_deleted FROM boxel_index WHERE url = $1`,
      {
        bind: [`${testRealmURL}1.json`],
        coerceTypes: { is_deleted: 'BOOLEAN' },
      },
    )) as unknown as BoxelIndexTable[];
    assert.true(
      indexRow.is_deleted,
      'boxel_index row is tombstoned in lockstep',
    );
  });

  test('copyFrom copies prerendered_html rows for the copied realm', async function (assert) {
    let types = [{ module: rri(`./person`), name: 'Person' }, baseCardRef].map(
      (i) => internalKeyFor(i, new URL(testRealmURL), virtualNetwork),
    );
    let resource: CardResource = {
      id: testRRI('1'),
      type: 'card',
      attributes: { name: 'Mango' },
      meta: { adoptsFrom: { module: rri(`./person`), name: 'Person' } },
    };
    await setupIndex(
      adapter,
      [
        { realm_url: testRealmURL, current_generation: 1 },
        { realm_url: testRealmURL2, current_generation: 1 },
      ],
      [
        {
          url: `${testRealmURL}1.json`,
          generation: 1,
          realm_url: testRealmURL,
          type: 'instance',
          pristine_doc: resource,
          search_doc: { id: `${testRealmURL}1`, name: 'Mango' },
          display_names: ['Person'],
          deps: [`${testRealmURL}person`],
          last_known_good_deps: [`${testRealmURL}person`],
          types,
          isolated_html: `<div class="isolated">Isolated HTML</div>`,
          icon_html: '<svg>test icon</svg>',
          markdown: 'Mango markdown',
        },
      ],
    );
    // setupIndex seeds the source realm's prerendered_html, so the copy has a
    // rendering to source.
    let batch = await indexWriter.createBatch(
      new URL(testRealmURL2),
      virtualNetwork,
    );
    await batch.copyFrom(new URL(testRealmURL));
    await batch.done();

    let rows = (await adapter.execute(
      `SELECT url, realm_url, isolated_html, markdown, generation FROM prerendered_html WHERE realm_url = $1`,
      { bind: [testRealmURL2] },
    )) as unknown as PrerenderedHtmlTable[];
    assert.strictEqual(rows.length, 1, 'one prerendered_html row copied');
    let [rendered] = rows;
    assert.strictEqual(
      rendered.url,
      `${testRealmURL2}1.json`,
      'copied prerendered_html row has the dest-realm URL',
    );
    assert.strictEqual(
      rendered.isolated_html,
      `<div class="isolated">Isolated HTML</div>`,
      'HTML copied into the dest realm',
    );
    assert.strictEqual(rendered.markdown, 'Mango markdown', 'markdown copied');
    assert.strictEqual(
      rendered.generation,
      2,
      'copied rows stamped at the dest-realm job generation',
    );
  });

  test('copyFrom rewrites realm keys in copied prerendered_html rows', async function (assert) {
    let types = [{ module: rri(`./person`), name: 'Person' }, baseCardRef].map(
      (i) => internalKeyFor(i, new URL(testRealmURL), virtualNetwork),
    );
    let destTypes = [
      { module: rri(`./person`), name: 'Person' },
      baseCardRef,
    ].map((i) => internalKeyFor(i, new URL(testRealmURL2), virtualNetwork));
    let resource: CardResource = {
      id: testRRI('1'),
      type: 'card',
      attributes: { name: 'Mango' },
      meta: { adoptsFrom: { module: rri(`./person`), name: 'Person' } },
    };
    await setupIndex(
      adapter,
      [
        { realm_url: testRealmURL, current_generation: 1 },
        { realm_url: testRealmURL2, current_generation: 1 },
      ],
      [
        {
          url: `${testRealmURL}1.json`,
          generation: 1,
          realm_url: testRealmURL,
          type: 'instance',
          pristine_doc: resource,
          search_doc: { id: `${testRealmURL}1`, name: 'Mango' },
          display_names: ['Person'],
          deps: [`${testRealmURL}person`],
          last_known_good_deps: [`${testRealmURL}person`],
          types,
          embedded_html: Object.fromEntries(
            types.map((type) => [type, `<div class="embedded">${type}</div>`]),
          ),
          fitted_html: Object.fromEntries(
            types.map((type) => [type, `<div class="fitted">${type}</div>`]),
          ),
          isolated_html: `<div class="isolated">Isolated HTML</div>`,
          markdown: 'source markdown',
        },
      ],
    );

    let batch = await indexWriter.createBatch(
      new URL(testRealmURL2),
      virtualNetwork,
    );
    await batch.copyFrom(new URL(testRealmURL));
    await batch.done();

    let [rendered] = (await adapter.execute(
      `SELECT url, file_alias, realm_url, isolated_html, markdown, fitted_html, embedded_html, deps, last_known_good_deps, generation, is_deleted
       FROM prerendered_html WHERE realm_url = $1`,
      {
        bind: [testRealmURL2],
        coerceTypes: {
          fitted_html: 'JSON',
          embedded_html: 'JSON',
          deps: 'JSON',
          last_known_good_deps: 'JSON',
          is_deleted: 'BOOLEAN',
        },
      },
    )) as unknown as Partial<PrerenderedHtmlTable>[];

    assert.deepEqual(
      rendered,
      {
        url: `${testRealmURL2}1.json`,
        file_alias: `${testRealmURL2}1`,
        realm_url: testRealmURL2,
        isolated_html: `<div class="isolated">Isolated HTML</div>`,
        markdown: 'source markdown',
        // Render-type keys rewritten to the destination realm.
        fitted_html: Object.fromEntries(
          destTypes.map((type, i) => [
            type,
            `<div class="fitted">${types[i]}</div>`,
          ]),
        ),
        embedded_html: Object.fromEntries(
          destTypes.map((type, i) => [
            type,
            `<div class="embedded">${types[i]}</div>`,
          ]),
        ),
        deps: [`${testRealmURL2}person`],
        last_known_good_deps: [`${testRealmURL2}person`],
        generation: 2,
        // Preserved from the source row (a live row; the copy carries its
        // is_deleted through, matching the boxel_index copy).
        is_deleted: null,
      },
      'copied prerendered_html carries realm keys/deps rewritten and the dest generation stamped',
    );
  });

  test('copyFrom leaves an unrendered source URL unrendered at the destination', async function (assert) {
    // The source row is indexed but has no prerendered_html row (no rendering
    // exists). The copy carries only the prerendered_html rows the source
    // has, so the destination URL reads as unrendered — the catch-up sweep is
    // what enqueues its render.
    let resource: CardResource = {
      id: testRRI('1'),
      type: 'card',
      attributes: { name: 'Mango' },
      meta: { adoptsFrom: { module: rri(`./person`), name: 'Person' } },
    };
    await setupIndex(
      adapter,
      [
        { realm_url: testRealmURL, current_generation: 1 },
        { realm_url: testRealmURL2, current_generation: 1 },
      ],
      [
        {
          url: `${testRealmURL}1.json`,
          generation: 1,
          realm_url: testRealmURL,
          type: 'instance',
          pristine_doc: resource,
          search_doc: { id: `${testRealmURL}1`, name: 'Mango' },
          display_names: ['Person'],
          deps: [`${testRealmURL}person`],
        },
      ],
      // Leave prerendered_html empty — the source URL has no rendering.
      { prerenderedHtml: false },
    );

    let batch = await indexWriter.createBatch(
      new URL(testRealmURL2),
      virtualNetwork,
    );
    await batch.copyFrom(new URL(testRealmURL));
    await batch.done();

    let [indexRow] = (await adapter.execute(
      `SELECT url FROM boxel_index WHERE url = $1`,
      { bind: [`${testRealmURL2}1.json`] },
    )) as unknown as Partial<BoxelIndexTable>[];
    assert.strictEqual(
      indexRow?.url,
      `${testRealmURL2}1.json`,
      'the boxel_index row is copied',
    );
    let rendered = (await adapter.execute(
      `SELECT url FROM prerendered_html WHERE url = $1`,
      { bind: [`${testRealmURL2}1.json`] },
    )) as unknown as Partial<PrerenderedHtmlTable>[];
    assert.strictEqual(
      rendered.length,
      0,
      'no prerendered_html row is created for an unrendered source URL',
    );
  });

  test('copyFrom copies only the (url, type) rows the source prerendered_html has', async function (assert) {
    // The same URL can carry both an instance and a file boxel_index row. The
    // copy carries a prerendered_html row per (url, type) the source has one
    // for; a type with no source rendering stays unrendered at the
    // destination.
    let resource: LooseCardResource = {
      id: `${testRealmURL}1`,
      type: 'card',
      attributes: { name: 'Mango' },
      meta: { adoptsFrom: { module: rri(`./person`), name: 'Person' } },
    };
    await setupIndex(
      adapter,
      [
        { realm_url: testRealmURL, current_generation: 1 },
        { realm_url: testRealmURL2, current_generation: 1 },
      ],
      [
        {
          url: `${testRealmURL}1.json`,
          type: 'instance',
          generation: 1,
          realm_url: testRealmURL,
          pristine_doc: resource,
          search_doc: { id: `${testRealmURL}1`, name: 'Mango' },
          deps: [`${testRealmURL}person`],
          isolated_html: `<div class="isolated">instance rendering</div>`,
        },
        {
          url: `${testRealmURL}1.json`,
          type: 'file',
          generation: 1,
          realm_url: testRealmURL,
          search_doc: { name: '1.json' },
          isolated_html: `<div class="isolated">file rendering</div>`,
        },
      ],
    );
    // setupIndex seeds prerendered_html for both types; drop the file row so
    // the source covers only the instance.
    await adapter.execute(
      `DELETE FROM prerendered_html WHERE url = $1 AND realm_url = $2 AND type = 'file'`,
      { bind: [`${testRealmURL}1.json`, testRealmURL] },
    );

    let batch = await indexWriter.createBatch(
      new URL(testRealmURL2),
      virtualNetwork,
    );
    await batch.copyFrom(new URL(testRealmURL));
    await batch.done();

    let rows = (await adapter.execute(
      `SELECT type, isolated_html, generation FROM prerendered_html WHERE url = $1 ORDER BY type COLLATE "POSIX"`,
      { bind: [`${testRealmURL2}1.json`] },
    )) as unknown as Partial<PrerenderedHtmlTable>[];
    assert.deepEqual(
      rows,
      [
        {
          type: 'instance',
          isolated_html: `<div class="isolated">instance rendering</div>`,
          generation: 2,
        },
      ],
      'only the type the source prerendered_html covers lands a row; the file type stays unrendered',
    );
  });

  test('promotes prerendered_html_working rows resumed from a prior job attempt', async function (assert) {
    let url = `${testRealmURL}1.json`;
    // Seed both working tables as if a prior attempt of job 42 wrote this row
    // (a fused visit writes each entry's index half to boxel_index_working and
    // its HTML half to prerendered_html_working). A resuming batch pre-seeds
    // the URL into its invalidation set without re-running updateEntry, so the
    // swap on done() must promote both channels' working rows.
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      {
        working: [
          {
            url,
            generation: 1,
            realm_url: testRealmURL,
            type: 'instance',
            job_id: 42,
            last_modified: String(1700000000),
            is_deleted: false,
            deps: [],
            types: [],
            isolated_html: `<div class="isolated">Resumed</div>`,
            markdown: 'Resumed markdown',
          },
        ],
        production: [],
      },
    );

    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
      { jobId: 42, reservationId: 1, priority: 0 },
    );
    await batch.done();

    let [rendered] = (await adapter.execute(
      `SELECT isolated_html, markdown FROM prerendered_html WHERE url = $1`,
      { bind: [url] },
    )) as unknown as Partial<PrerenderedHtmlTable>[];
    assert.strictEqual(
      rendered?.isolated_html,
      `<div class="isolated">Resumed</div>`,
      'resumed row HTML is promoted to prerendered_html',
    );
    assert.strictEqual(
      rendered?.markdown,
      'Resumed markdown',
      'resumed row markdown is promoted to prerendered_html',
    );

    let [indexRow] = (await adapter.execute(
      `SELECT url FROM boxel_index WHERE url = $1`,
      { bind: [url] },
    )) as unknown as Partial<BoxelIndexTable>[];
    assert.strictEqual(
      indexRow?.url,
      url,
      'the boxel_index row is promoted in lockstep for resumed rows',
    );
  });

  test('mirrors an error entry onto prerendered_html, preserving last-known-good HTML', async function (assert) {
    let url = `${testRealmURL}1.json`;
    let types = [{ module: rri(`./person`), name: 'Person' }, baseCardRef].map(
      (i) => internalKeyFor(i, new URL(testRealmURL), virtualNetwork),
    );
    let resource: CardResource = {
      id: testRRI('1'),
      type: 'card',
      attributes: { name: 'Mango' },
      meta: { adoptsFrom: { module: rri(`./person`), name: 'Person' } },
    };
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      [
        {
          url,
          generation: 1,
          realm_url: testRealmURL,
          type: 'instance',
          is_deleted: false,
          pristine_doc: resource,
          search_doc: { name: 'Mango' },
          display_names: ['Person'],
          deps: [`${testRealmURL}person`],
          last_known_good_deps: [`${testRealmURL}person`],
          types,
          isolated_html: `<div class="isolated">Last known good</div>`,
          markdown: 'Last known good markdown',
        },
      ],
    );

    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
    await batch.updateEntry(new URL(url), {
      type: 'instance-error',
      error: { message: 'boom', status: 500, additionalErrors: [] },
    });
    await batch.done();

    let [rendered] = (await adapter.execute(
      `SELECT isolated_html, markdown, error_doc, is_deleted FROM prerendered_html WHERE url = $1`,
      {
        bind: [url],
        coerceTypes: { error_doc: 'JSON', is_deleted: 'BOOLEAN' },
      },
    )) as unknown as Partial<PrerenderedHtmlTable>[];
    assert.strictEqual(
      (rendered?.error_doc as SerializedError | null)?.message,
      'boom',
      'the error rides on prerendered_html.error_doc',
    );
    assert.strictEqual(
      rendered?.isolated_html,
      `<div class="isolated">Last known good</div>`,
      'last-known-good HTML is preserved on the error row',
    );
    assert.strictEqual(
      rendered?.markdown,
      'Last known good markdown',
      'last-known-good markdown is preserved on the error row',
    );
    assert.false(rendered?.is_deleted, 'an error row is not a tombstone');
  });

  test('can copy index entries', async function (assert) {
    let types = [{ module: rri(`./person`), name: 'Person' }, baseCardRef].map(
      (i) => internalKeyFor(i, new URL(testRealmURL), virtualNetwork),
    );
    let destTypes = [
      { module: rri(`./person`), name: 'Person' },
      baseCardRef,
    ].map((i) => internalKeyFor(i, new URL(testRealmURL2), virtualNetwork));
    let modified = Date.now();
    let resource: CardResource = {
      id: testRRI('1'),
      type: 'card',
      attributes: {
        name: 'Mango',
      },
      meta: {
        adoptsFrom: {
          module: rri(`./person`),
          name: 'Person',
        },
      },
    };
    await setupIndex(
      adapter,
      [
        { realm_url: testRealmURL, current_generation: 1 },
        { realm_url: testRealmURL2, current_generation: 1 },
      ],
      [
        {
          url: `${testRealmURL}1.json`,
          generation: 1,
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
          last_known_good_deps: [`${testRealmURL}person`],
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
      ],
    );
    let batch = await indexWriter.createBatch(
      new URL(testRealmURL2),
      virtualNetwork,
    );
    await batch.copyFrom(new URL(testRealmURL));
    await batch.done();

    let results = (await adapter.execute(
      'SELECT * FROM boxel_index WHERE realm_url = $1 ORDER BY url COLLATE "POSIX"',
      { coerceTypes, bind: [testRealmURL2] },
    )) as unknown as BoxelIndexTable[];
    assert.strictEqual(
      results.length,
      1,
      'correct number of items were copied',
    );

    let [copiedInstance] = results;
    assert.ok(copiedInstance.indexed_at, 'indexed_at was set');

    delete (copiedInstance as Partial<BoxelIndexTable>).indexed_at;

    assert.deepEqual(
      copiedInstance as Omit<BoxelIndexTable, 'indexed_at'>,
      {
        url: `${testRealmURL2}1.json`,
        file_alias: `${testRealmURL2}1`,
        generation: 2,
        realm_url: testRealmURL2,
        type: 'instance',
        has_error: false,
        pristine_doc: {
          ...resource,
          id: rri(`${testRealmURL2}1`),
          meta: {
            ...resource.meta,
            realmURL: testRealmURL2,
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
        last_known_good_deps: [`${testRealmURL2}person`],
        types: destTypes,
        last_modified: String(modified),
        resource_created_at: String(modified),
        icon_html: '<svg>test icon</svg>',
        is_deleted: null,
        diagnostics: null,
      },
      'the copied instance is correct',
    );
  });

  test('throws when copy source realm is not present on the realm server', async function (assert) {
    assert.expect(1);

    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL2, current_generation: 1 }],
      [],
    );
    let batch = await indexWriter.createBatch(
      new URL(testRealmURL2),
      virtualNetwork,
    );
    try {
      await batch.copyFrom(new URL(testRealmURL));
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
    let types = [{ module: rri(`./person`), name: 'Person' }, baseCardRef].map(
      (i) => internalKeyFor(i, new URL(testRealmURL), virtualNetwork),
    );
    let modified = Date.now();
    let resource: CardResource = {
      id: testRRI('1'),
      type: 'card',
      attributes: {
        name: 'Mango',
      },
      meta: {
        adoptsFrom: {
          module: rri(`./person`),
          name: 'Person',
        },
      },
    };
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      [
        {
          url: `${testRealmURL}1.json`,
          generation: 1,
          realm_url: testRealmURL,
          pristine_doc: resource,
          search_doc: { name: 'Mango' },
          display_names: [`Person`],
          deps: [`${testRealmURL}person`],
          last_known_good_deps: [`${testRealmURL}person`],
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
    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
    await batch.updateEntry(new URL(`${testRealmURL}1.json`), {
      type: 'instance-error',
      error: {
        message: 'test error',
        status: 500,
        additionalErrors: [],
      },
    });
    await batch.done();

    let [rawErrorEntry] = (await adapter.execute(
      'SELECT * FROM boxel_index WHERE generation = 2 AND type = \'instance\' AND has_error = TRUE ORDER BY url COLLATE "POSIX"',
      { coerceTypes },
    )) as unknown as BoxelIndexTable[];
    // Strip non-deterministic write-time stamps from both the row and
    // the error_doc (the indexer mirrors diagnostics onto
    // error_doc.diagnostics for UI compat); they're verified
    // separately below.
    let { indexed_at: _remove, diagnostics, ...errorEntry } = rawErrorEntry;
    assert.ok(errorEntry.error_doc, 'row has an error_doc');
    // The indexer mirrors `diagnostics` onto `error_doc.diagnostics`
    // for UI compat. Strip it out before the deep-equal (and verify the
    // mirror relationship separately below). `diagnostics` is a declared
    // optional field on `SerializedError`, so this is a plain destructure
    // — no cast needed.
    let { diagnostics: errorDocDiagnostics, ...errorDocWithoutDiagnostics } =
      errorEntry.error_doc!;
    errorEntry.error_doc = errorDocWithoutDiagnostics;
    assert.deepEqual(
      errorEntry,
      {
        url: `${testRealmURL}1.json`,
        file_alias: `${testRealmURL}1`,
        generation: 2,
        realm_url: testRealmURL,
        type: 'instance',
        has_error: true,
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
        last_known_good_deps: [`${testRealmURL}person`],
        types,
        last_modified: String(modified),
        resource_created_at: String(modified),
        is_deleted: null,
        icon_html: '<svg>test icon</svg>',
      },
      'the error entry includes last known good state of instance',
    );
    assert.ok(diagnostics, 'diagnostics populated on error row');
    assert.strictEqual(
      typeof diagnostics,
      'object',
      'diagnostics is an object',
    );
    assert.deepEqual(
      errorDocDiagnostics,
      diagnostics,
      'error_doc.diagnostics mirrors diagnostics',
    );
  });

  test('error entry keeps freshly-stamped synthetic search keys over the last-known-good doc', async function (assert) {
    // Rollout case: a `file` row indexed before `_isCardInstanceFile` / `_title`
    // existed, then hit by a dependency-error reindex. The fresh searchData
    // carries the synthetic keys and must survive rather than being clobbered
    // by the production doc, while last-known-good fields (here `extra`) still
    // carry forward.
    let timestamp = Date.now();
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      [
        {
          url: `${testRealmURL}1.json`,
          generation: 1,
          realm_url: testRealmURL,
          type: 'file',
          search_doc: { name: '1.json', extra: 'keep-me' },
          last_modified: String(timestamp),
          resource_created_at: String(timestamp),
        },
      ],
    );

    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
    await batch.updateEntry(new URL(`${testRealmURL}1.json`), {
      type: 'file-error',
      error: { message: 'dep in error', status: 500, additionalErrors: [] },
      searchData: {
        name: '1.json',
        _isCardInstanceFile: true,
        _title: '1.json',
      },
    });
    await batch.done();

    let [row] = (await adapter.execute(
      "SELECT search_doc FROM boxel_index WHERE generation = 2 AND type = 'file' AND has_error = TRUE",
      { coerceTypes },
    )) as unknown as BoxelIndexTable[];
    assert.deepEqual(
      row.search_doc,
      {
        name: '1.json',
        extra: 'keep-me',
        _isCardInstanceFile: true,
        _title: '1.json',
      },
      'error row merges freshly-stamped synthetic keys onto the last-known-good doc',
    );
  });

  test('strips jsonb-illegal code points from error_doc and diagnostics on write', async function (assert) {
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      [],
    );
    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
    // A NUL and an unpaired surrogate in the error message + diagnostics:
    // Postgres rejects both in jsonb, so without sanitization this write
    // aborts the whole batch.
    await batch.updateEntry(new URL(`${testRealmURL}1.json`), {
      type: 'instance-error',
      error: {
        message: 'Unexpected token \u0000\uD800 JFIF is not valid JSON',
        status: 500,
        additionalErrors: [
          {
            message: 'nested \u0000 binary',
            status: 500,
            additionalErrors: [],
          } as any,
        ],
      },
      diagnostics: { renderStage: 'load\u0000links' },
    });
    // Must not throw — the un-sanitized write rejected the upsert.
    await batch.done();

    let [row] = (await adapter.execute(
      'SELECT * FROM boxel_index WHERE has_error = TRUE AND generation = 2',
      { coerceTypes },
    )) as unknown as BoxelIndexTable[];
    assert.ok(row?.error_doc, 'error row persisted despite binary in message');

    let nul = String.fromCharCode(0);
    let hasIllegalCodePoint = (s: string) =>
      s.includes(nul) ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
        s,
      );
    assert.notOk(
      hasIllegalCodePoint(row.error_doc!.message),
      'illegal code points stripped from the error message',
    );
    assert.true(
      row.error_doc!.message.includes('JFIF'),
      'the readable remainder of the message is preserved',
    );
    assert.notOk(
      hasIllegalCodePoint(
        (row.error_doc!.additionalErrors as any[])[0].message,
      ),
      'illegal code points stripped from nested additionalErrors too',
    );
    assert.strictEqual(
      (row.diagnostics as any).renderStage,
      'load\uFFFDlinks',
      'illegal code points stripped from diagnostics strings too',
    );
  });

  test('error entry does not include last known good state when not available', async function (assert) {
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      [],
    );
    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
    await batch.updateEntry(new URL(`${testRealmURL}1.json`), {
      type: 'instance-error',
      error: {
        message: 'test error',
        status: 500,
        additionalErrors: [],
      },
    });
    await batch.done();

    let [rawErrorEntry] = (await adapter.execute(
      'SELECT * FROM boxel_index WHERE generation = 2 AND type = \'instance\' AND has_error = TRUE ORDER BY url COLLATE "POSIX"',
      { coerceTypes },
    )) as unknown as BoxelIndexTable[];
    let { indexed_at: _remove, diagnostics, ...errorEntry } = rawErrorEntry;
    assert.ok(errorEntry.error_doc, 'row has an error_doc');
    // The indexer mirrors `diagnostics` onto `error_doc.diagnostics`
    // for UI compat. Strip it out before the deep-equal (and verify the
    // mirror relationship separately below). `diagnostics` is a declared
    // optional field on `SerializedError`, so this is a plain destructure
    // — no cast needed.
    let { diagnostics: errorDocDiagnostics, ...errorDocWithoutDiagnostics } =
      errorEntry.error_doc!;
    errorEntry.error_doc = errorDocWithoutDiagnostics;
    assert.deepEqual(
      errorEntry,
      {
        url: `${testRealmURL}1.json`,
        file_alias: `${testRealmURL}1`,
        generation: 2,
        realm_url: testRealmURL,
        type: 'instance',
        has_error: true,
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
        last_known_good_deps: null,
        types: null,
        last_modified: null,
        resource_created_at: null,
        is_deleted: false,
        icon_html: null,
      },
      'the error entry does not include last known good state of instance',
    );
    assert.ok(diagnostics, 'diagnostics populated on error row');
    assert.strictEqual(
      typeof diagnostics,
      'object',
      'diagnostics is an object',
    );
    assert.deepEqual(
      errorDocDiagnostics,
      diagnostics,
      'error_doc.diagnostics mirrors diagnostics',
    );
  });

  test('normalizes error doc id and deps', async function (assert) {
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      [],
    );
    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
    await batch.updateEntry(new URL(`${testRealmURL}nested/1.json`), {
      type: 'instance-error',
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
      'SELECT error_doc, deps FROM boxel_index WHERE generation = 2 AND type = \'instance\' AND has_error = TRUE ORDER BY url COLLATE "POSIX"',
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

  test('error_doc within budget is persisted unchanged', async function (assert) {
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      [],
    );
    let inputError = {
      message: 'small parent error',
      status: 500,
      title: 'Render error',
      stack: 'Error: small\n    at thing (/x.js:1:1)',
      additionalErrors: [
        {
          status: 500,
          message: 'inner err',
          stack: 'Error: inner\n    at inner (/y.js:1:1)',
          additionalErrors: [
            {
              status: 500,
              message: 'inner inner — preserved end-to-end',
              additionalErrors: null,
            },
          ],
        },
      ],
    };
    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
    await batch.updateEntry(new URL(`${testRealmURL}1.json`), {
      type: 'instance-error',
      error: { ...inputError },
    });
    await batch.done();

    let [{ error_doc: errorDoc }] = (await adapter.execute(
      "SELECT error_doc FROM boxel_index WHERE has_error = TRUE AND type = 'instance'",
      { coerceTypes },
    )) as Pick<BoxelIndexTable, 'error_doc'>[];

    assert.ok(errorDoc, 'error_doc was persisted');
    assert.strictEqual(
      errorDoc!.message,
      inputError.message,
      'message preserved verbatim',
    );
    assert.strictEqual(
      errorDoc!.stack,
      inputError.stack,
      'top-level stack preserved verbatim',
    );
    assert.strictEqual(
      errorDoc!.additionalErrors!.length,
      1,
      'additionalErrors length preserved',
    );
    let kept = errorDoc!.additionalErrors![0];
    assert.strictEqual(
      kept.message,
      'inner err',
      'inherited message preserved',
    );
    assert.ok(
      Array.isArray(kept.additionalErrors),
      'nested additionalErrors retained for in-budget docs',
    );
    assert.strictEqual(
      kept.additionalErrors![0].message,
      'inner inner — preserved end-to-end',
      'second-level nesting preserved verbatim',
    );
  });

  test('oversized error_doc is shed progressively until it fits', async function (assert) {
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      [],
    );
    // Deliberately pathological: 50 entries × ~1 MiB stacks (≈50 MiB)
    // plus an inflated top-level stack. Step 1 of the clamp is enough
    // to bring this back under 8 MiB; later steps must NOT run.
    let entries = Array.from({ length: 50 }, (_, i) => ({
      status: 500,
      message: `dep err ${i}`,
      stack: 'x'.repeat(1024 * 1024),
      additionalErrors: [
        {
          status: 500,
          message: 'inherited nested',
          additionalErrors: null,
        },
      ],
    }));
    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
    await batch.updateEntry(new URL(`${testRealmURL}1.json`), {
      type: 'instance-error',
      error: {
        message: 'parent',
        status: 500,
        stack: 'short',
        additionalErrors: entries,
      },
    });
    await batch.done();

    let [{ error_doc: errorDoc }] = (await adapter.execute(
      "SELECT error_doc FROM boxel_index WHERE has_error = TRUE AND type = 'instance'",
      { coerceTypes },
    )) as Pick<BoxelIndexTable, 'error_doc'>[];

    assert.ok(errorDoc, 'error_doc was persisted');
    assert.ok(
      JSON.stringify(errorDoc).length <= 8 * 1024 * 1024,
      'persisted error_doc fits the 8 MiB budget',
    );
    assert.strictEqual(
      errorDoc!.message,
      'parent',
      'top-level message untouched',
    );
    assert.strictEqual(
      errorDoc!.additionalErrors!.length,
      50,
      'entry count preserved (no late-stage capping)',
    );
    assert.strictEqual(
      errorDoc!.additionalErrors![0].message,
      'dep err 0',
      'per-entry message untouched',
    );
    assert.ok(
      Array.isArray(errorDoc!.additionalErrors![0].additionalErrors),
      'nested additionalErrors retained (step 4 did not run)',
    );
    assert.ok(
      errorDoc!.additionalErrors![0].stack.length < 1024 * 1024,
      'per-entry stacks were trimmed (step 1 ran)',
    );
  });

  test('can get an error doc', async function (assert) {
    await setupIndex(adapter, [
      {
        url: `${testRealmURL}1.json`,
        generation: 1,
        realm_url: testRealmURL,
        type: 'instance',
        has_error: true,
        error_doc: {
          message: 'test error',
          status: 500,
          id: `${testRealmURL}1.json`,
          additionalErrors: [],
        },
      },
    ]);
    let entry = await indexQueryEngine.getInstance(new URL(`${testRealmURL}1`));
    if (entry?.type === 'instance-error') {
      assert.ok(entry.lastModified, 'lastModified exists');
      entry.lastModified = null;
      assert.deepEqual(entry, {
        type: 'instance-error',
        error: {
          message: 'test error',
          status: 500,
          id: `${testRealmURL}1.json`,
          additionalErrors: [],
        },
        canonicalURL: `${testRealmURL}1.json`,
        generation: 1,
        realmURL: testRealmURL,
        instance: null,
        lastModified: null,
        resourceCreatedAt: null,
        isolatedHtml: null,
        embeddedHtml: null,
        fittedHtml: null,
        atomHtml: null,
        headHtml: null,
        markdown: null,
        searchDoc: null,
        types: null,
        indexedAt: null,
        deps: null,
      });
    } else {
      assert.ok(false, `expected index entry to not be a card document`);
    }
  });

  test('allows multiple index entries for the same url with different types', async function (assert) {
    let timestamp = Date.now();
    let resource: LooseCardResource = {
      id: `${testRealmURL}1`,
      type: 'card',
      attributes: {
        name: 'Mango',
      },
      meta: {
        adoptsFrom: {
          module: rri(`./person`),
          name: 'Person',
        },
      },
    };
    await setupIndex(adapter, [
      {
        url: `${testRealmURL}1.json`,
        type: 'instance',
        pristine_doc: resource,
        last_modified: String(timestamp),
        resource_created_at: String(timestamp),
      },
      {
        url: `${testRealmURL}1.json`,
        type: 'file',
        search_doc: { name: '1.json' },
      },
    ]);

    let rows = await adapter.execute(
      'SELECT url, type FROM boxel_index WHERE url = $1 ORDER BY type COLLATE "POSIX"',
      { bind: [`${testRealmURL}1.json`] },
    );
    assert.deepEqual(
      rows,
      [
        { url: `${testRealmURL}1.json`, type: 'file' },
        { url: `${testRealmURL}1.json`, type: 'instance' },
      ],
      'index rows include file and instance entries',
    );

    let entry = await indexQueryEngine.getInstance(new URL(`${testRealmURL}1`));
    assert.strictEqual(entry?.type, 'instance', 'instance entry is accessible');
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
          module: rri(`./person`),
          name: 'Person',
        },
      },
    };
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      [
        {
          url: `${testRealmURL}1.json`,
          generation: 1,
          realm_url: testRealmURL,
          pristine_doc: originalResource,
          last_modified: String(originalModified),
          resource_created_at: String(originalModified),
        },
      ],
    );

    let resource: CardResource = {
      id: testRRI('1.json'),
      type: 'card',
      attributes: {
        name: 'Van Gogh',
      },
      meta: {
        adoptsFrom: {
          module: rri(`./person`),
          name: 'Person',
        },
      },
    };
    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
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
        generation: 1,
        realmURL: testRealmURL,
        canonicalURL: `${testRealmURL}1.json`,
        instance: {
          id: testRRI('1'),
          type: 'card',
          attributes: {
            name: 'Mango',
          },
          meta: {
            adoptsFrom: {
              module: rri(`./person`),
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
        markdown: null,
      });
    } else {
      assert.ok(false, `expected index entry to not be an error document`);
    }
  });

  test('can get work in progress card', async function (assert) {
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      [
        {
          url: `${testRealmURL}1.json`,
          generation: 1,
          realm_url: testRealmURL,
          pristine_doc: {
            attributes: {
              name: 'Mango',
            },
            meta: {
              adoptsFrom: {
                module: rri(`./person`),
                name: 'Person',
              },
            },
          } as LooseCardResource,
        },
      ],
    );

    let resource: CardResource = {
      id: testRRI('1.json'),
      type: 'card',
      attributes: {
        name: 'Van Gogh',
      },
      meta: {
        adoptsFrom: {
          module: rri(`./person`),
          name: 'Person',
        },
      },
    };
    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
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
        generation: 2,
        realmURL: testRealmURL,
        canonicalURL: `${testRealmURL}1.json`,
        instance: {
          id: testRRI('1.json'),
          type: 'card',
          attributes: {
            name: 'Van Gogh',
          },
          meta: {
            adoptsFrom: {
              module: rri(`./person`),
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
        markdown: null,
      });
    } else {
      assert.ok(false, `expected index entry to not be an error document`);
    }
  });

  test('persists and reads back markdown for an instance entry', async function (assert) {
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      [],
    );
    let resource: CardResource = {
      id: testRRI('1.json'),
      type: 'card',
      attributes: { name: 'Van Gogh' },
      meta: {
        adoptsFrom: {
          module: rri(`./person`),
          name: 'Person',
        },
      },
    };
    let now = Date.now();
    let markdown = '# Van Gogh\n\n- email: vangogh@example.com';
    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
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
      markdown,
    });

    let entry = await indexQueryEngine.getInstance(
      new URL(`${testRealmURL}1`),
      { useWorkInProgressIndex: true },
    );
    if (entry?.type === 'instance') {
      assert.strictEqual(
        entry.markdown,
        markdown,
        'markdown round-trips through updateEntry + getInstance',
      );
    } else {
      assert.ok(
        false,
        `expected index entry to be an instance (got ${entry?.type})`,
      );
    }
  });

  test('returns undefined when getting a deleted card', async function (assert) {
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      [
        {
          url: `${testRealmURL}1.json`,
          generation: 1,
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
        generation: 1,
        realm_url: testRealmURL,
        deps: [...(i <= 1 ? [] : [`${testRealmURL}1.json`])],
      });
    }
    indexRows.sort((a, b) => a.url.localeCompare(b.url));
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      indexRows,
    );

    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
    await batch.invalidate([new URL(`${testRealmURL}1.json`)]);
    let invalidations = batch.invalidations;

    assert.ok(invalidations.length > 1000, 'Can invalidate more than 1000');
    assert.deepEqual(
      invalidations.sort(),
      indexRows.map((r) => r.url),
    );

    let invalidatedEntries = (await adapter.execute(
      'SELECT url, realm_url, is_deleted FROM boxel_index_working WHERE generation = 2 ORDER BY url COLLATE "POSIX"',
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
    let generations = await adapter.execute(
      'select realm_url, current_generation from realm_generations ORDER BY realm_url COLLATE "POSIX"',
    );
    assert.deepEqual(
      generations,
      [
        {
          realm_url: `${testRealmURL}`,
          current_generation: 1,
        },
      ],
      'the "production" realm generations are correct',
    );
  });

  test('update realm meta when indexing is done', async function (assert) {
    let iconHTML = '<svg>test icon</svg>';
    let personTypes = internalKeysFor(
      virtualNetwork,
      { module: rri('./person'), name: 'Person' },
      baseCardRef,
    );
    let fancyPersonTypes = internalKeysFor(
      virtualNetwork,
      {
        module: rri('./fancy-person'),
        name: 'FancyPerson',
      },
      { module: rri('./person'), name: 'Person' },
      baseCardRef,
    );
    let petTypes = internalKeysFor(
      virtualNetwork,
      { module: rri('./pet'), name: 'Pet' },
      { module: rri('./card-api'), name: 'CardDef' },
      baseCardRef,
    );
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      [
        {
          url: `${testRealmURL}1.json`,
          generation: 1,
          realm_url: testRealmURL,
          pristine_doc: {
            id: `${testRealmURL}1`,
            type: 'card',
            attributes: {
              name: 'Mango',
            },
            meta: {
              adoptsFrom: {
                module: rri(`./person`),
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
      module: rri('./fancy-person'),
      name: 'FancyPerson',
    });
    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
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

    batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
    let resource3 = makeCardResource('3', 'Van Gogh2', {
      module: rri('./fancy-person'),
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
      module: rri('./pet'),
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

  test('update realm meta partitions file rows into the files array', async function (assert) {
    // CS-prep for "Include FileDefs in CardsGrid": file rows in boxel_index
    // (type='file') should be aggregated into `realm_meta.value.files`,
    // independently of the cards group. This is what powers CardsGrid's
    // "All Files" sidebar leaves.
    let iconHTML = '<svg>file icon</svg>';
    let baseFileTypes = internalKeysFor(virtualNetwork, {
      module: rri('./card-api'),
      name: 'FileDef',
    });
    let markdownTypes = internalKeysFor(
      virtualNetwork,
      {
        module: rri('./markdown-file-def'),
        name: 'MarkdownDef',
      },
      { module: rri('./card-api'), name: 'FileDef' },
    );

    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      [
        // Plain instance row — should land in `instances`.
        {
          url: `${testRealmURL}1.json`,
          generation: 1,
          realm_url: testRealmURL,
          type: 'instance',
          pristine_doc: makeCardResource('1', 'Mango', {
            module: rri('./person'),
            name: 'Person',
          }) as LooseCardResource,
          search_doc: { name: 'Mango' },
          display_names: ['Person'],
          deps: [`${testRealmURL}person`],
          types: internalKeysFor(
            virtualNetwork,
            { module: rri('./person'), name: 'Person' },
            baseCardRef,
          ),
          icon_html: iconHTML,
        },
        // Two markdown files — same code_ref so they collapse into one
        // summary row with total: 2.
        {
          url: `${testRealmURL}notes/a.md`,
          generation: 1,
          realm_url: testRealmURL,
          type: 'file',
          search_doc: { name: 'a.md', url: `${testRealmURL}notes/a.md` },
          display_names: ['Markdown', 'File'],
          types: markdownTypes,
          icon_html: iconHTML,
        },
        {
          url: `${testRealmURL}notes/b.md`,
          generation: 1,
          realm_url: testRealmURL,
          type: 'file',
          search_doc: { name: 'b.md', url: `${testRealmURL}notes/b.md` },
          display_names: ['Markdown', 'File'],
          types: markdownTypes,
          icon_html: iconHTML,
        },
        // A bare-FileDef file — base type used when the extension isn't mapped.
        {
          url: `${testRealmURL}misc/raw.bin`,
          generation: 1,
          realm_url: testRealmURL,
          type: 'file',
          search_doc: { name: 'raw.bin', url: `${testRealmURL}misc/raw.bin` },
          display_names: ['File'],
          types: baseFileTypes,
          icon_html: iconHTML,
        },
      ],
    );

    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
    // No new writes — just finalize so updateRealmMeta runs against the
    // working table that setupIndex seeded.
    await batch.done();

    let realmMeta = await fetchRealmMeta(adapter);
    assert.strictEqual(
      realmMeta.rows.length,
      1,
      'one realm_meta row was written',
    );
    assert.deepEqual(
      realmMeta.value,
      [
        makeCardTypeSummary(
          `${testRealmURL}person/Person`,
          'Person',
          iconHTML,
          1,
        ),
      ],
      'instance summaries only reflect CardDef rows',
    );
    // Files are ordered by display_name ASC; "File" sorts before "Markdown".
    assert.deepEqual(
      realmMeta.files,
      [
        makeCardTypeSummary(
          `${testRealmURL}card-api/FileDef`,
          'File',
          iconHTML,
          1,
        ),
        makeCardTypeSummary(
          `${testRealmURL}markdown-file-def/MarkdownDef`,
          'Markdown',
          iconHTML,
          2,
        ),
      ],
      'file summaries collapse duplicates and live in their own arm',
    );
  });

  test('update realm meta collapses rows with the same code_ref but mixed display_names', async function (assert) {
    // Regression: when a realm has been partially re-indexed across a code
    // change (some file rows have populated `display_names`, some still
    // have `[]` from the previous indexer), the aggregation must collapse
    // them into one summary per code_ref — using `MAX(display_name)` so
    // the populated label wins over the empty/null one. Without the
    // collapse, CardsGrid's sidebar shows two entries for the same type
    // (e.g., "Markdown" and "MarkdownDef") that resolve to identical
    // searches and confuse the user.
    let iconHTML = '<svg>icon</svg>';
    let markdownTypes = internalKeysFor(
      virtualNetwork,
      { module: rri('./markdown-file-def'), name: 'MarkdownDef' },
      { module: rri('./card-api'), name: 'FileDef' },
    );

    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      [
        // Two markdown files with the same code_ref but different
        // display_names — simulates the rolling-deploy state where the
        // new extractor populated names for one file but not the other.
        {
          url: `${testRealmURL}notes/new.md`,
          generation: 1,
          realm_url: testRealmURL,
          type: 'file',
          search_doc: { name: 'new.md', url: `${testRealmURL}notes/new.md` },
          display_names: ['Markdown', 'File'],
          types: markdownTypes,
          icon_html: iconHTML,
        },
        {
          url: `${testRealmURL}notes/old.md`,
          generation: 1,
          realm_url: testRealmURL,
          type: 'file',
          search_doc: { name: 'old.md', url: `${testRealmURL}notes/old.md` },
          display_names: [],
          types: markdownTypes,
          icon_html: iconHTML,
        },
      ],
    );

    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
    await batch.done();

    let realmMeta = await fetchRealmMeta(adapter);
    assert.deepEqual(
      realmMeta.files,
      [
        makeCardTypeSummary(
          `${testRealmURL}markdown-file-def/MarkdownDef`,
          'Markdown',
          iconHTML,
          2,
        ),
      ],
      'one summary per code_ref, with the populated display_name picked over the empty one',
    );
  });

  test('fetchCardTypeSummary returns the realm_meta row at realm_generations.current_generation', async function (assert) {
    // Regression: the read path JOINs realm_meta against
    // realm_generations.current_generation so it always picks the row that
    // matches the realm's authoritative current version. Without the JOIN,
    // a naive SELECT returns an arbitrary realm_meta row when stale rows
    // linger (e.g., after a from-scratch reindex resets the version) and
    // CardsGrid's "All Files" group silently vanishes for any realm whose
    // physical row order happens to surface a legacy array-shape row.
    let iconHTML = '<svg>icon</svg>';
    let personTypes = internalKeysFor(
      virtualNetwork,
      { module: rri('./person'), name: 'Person' },
      baseCardRef,
    );

    // Seed a CARD row at version 1 — that's the version we'll mark as
    // current. updateRealmMeta() will aggregate this into realm_meta.value
    // (new partitioned shape) for v1.
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      [
        {
          url: `${testRealmURL}1.json`,
          generation: 1,
          realm_url: testRealmURL,
          type: 'instance',
          pristine_doc: makeCardResource('1', 'Mango', {
            module: rri('./person'),
            name: 'Person',
          }) as LooseCardResource,
          search_doc: { name: 'Mango' },
          display_names: ['Person'],
          deps: [`${testRealmURL}person`],
          types: personTypes,
          icon_html: iconHTML,
        },
      ],
    );

    // Have the index writer aggregate v1 into realm_meta.value with the
    // new partitioned shape.
    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
    await batch.done();

    // Now plant a *stale* legacy-shape row at a HIGHER version number. This
    // is exactly the layout you get after a from-scratch reindex: the prune
    // predicate `generation < current` doesn't reach v999, so it lingers.
    // The naive `SELECT … WHERE realm_url=…` (no ORDER BY) would happily
    // return this row first.
    await adapter.execute(
      `INSERT INTO realm_meta (realm_url, generation, value, indexed_at)
       VALUES ($1, $2, $3, $4)`,
      {
        bind: [
          testRealmURL,
          999,
          JSON.stringify([
            {
              code_ref: `${testRealmURL}stale/Stale`,
              display_name: 'Stale',
              total: 42,
              icon_html: iconHTML,
            },
          ]),
          String(Date.now() - 1000),
        ],
      },
    );

    let summary = await indexQueryEngine.fetchCardTypeSummary(
      new URL(testRealmURL),
    );
    assert.deepEqual(
      summary.instances.map((s) => s.code_ref),
      [`${testRealmURL}person/Person`],
      'fetchCardTypeSummary returns the row at realm_generations.current_generation even when a higher-numbered stale row is present',
    );
    assert.notOk(
      summary.instances.find((s) => s.display_name === 'Stale'),
      'stale row contents do not leak through',
    );
  });

  test('done() prunes realm_meta rows at any version, including ones higher than the current', async function (assert) {
    // Regression: pruneObsoleteEntries uses != instead of < so a
    // from-scratch reindex (which resets the generation to a low
    // number) doesn't leave older high-version rows orphaned in
    // realm_meta forever.
    let iconHTML = '<svg>icon</svg>';

    // realm_generations starts at 0, so the next batch will write at v1.
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 0 }],
      [],
    );

    // Plant stale realm_meta rows at high version numbers — the kind of
    // residue a long-running realm accumulates before its first
    // from-scratch reindex.
    for (let version of [50, 100, 200, 999]) {
      await adapter.execute(
        `INSERT INTO realm_meta (realm_url, generation, value, indexed_at)
         VALUES ($1, $2, $3, $4)`,
        {
          bind: [
            testRealmURL,
            version,
            JSON.stringify([
              {
                code_ref: `${testRealmURL}stale-${version}/Stale`,
                display_name: `Stale-${version}`,
                total: version,
                icon_html: iconHTML,
              },
            ]),
            String(Date.now() - version * 1000),
          ],
        },
      );
    }

    let rowsBefore = await adapter.execute(
      `SELECT generation FROM realm_meta WHERE realm_url = $1 ORDER BY generation`,
      { bind: [testRealmURL] },
    );
    assert.deepEqual(
      rowsBefore.map((r) => r.generation),
      [50, 100, 200, 999],
      'stale rows are seeded before the batch runs',
    );

    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
    await batch.done();

    let rowsAfter = await adapter.execute(
      `SELECT generation FROM realm_meta WHERE realm_url = $1 ORDER BY generation`,
      { bind: [testRealmURL] },
    );
    assert.deepEqual(
      rowsAfter.map((r) => r.generation),
      [1],
      'pruneObsoleteEntries deletes every row that is not the current version, including higher-numbered stale ones',
    );
  });

  test('update realm meta includes error entries with last known good state', async function (assert) {
    let iconHTML = '<svg>test icon</svg>';
    let personTypes = internalKeysFor(
      virtualNetwork,
      { module: rri('./person'), name: 'Person' },
      baseCardRef,
    );
    let personResource = makeCardResource('1', 'Mango', {
      module: rri('./person'),
      name: 'Person',
    });

    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      [
        {
          url: `${testRealmURL}1.json`,
          generation: 1,
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

    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
    );
    await batch.updateEntry(new URL(`${testRealmURL}1.json`), {
      type: 'instance-error',
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

  test('resumes URLs already processed by a previous attempt of the same job', async function (assert) {
    let url = `${testRealmURL}1.json`;
    let lastModified = 1700000000;
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      {
        working: [
          {
            url,
            generation: 1,
            realm_url: testRealmURL,
            type: 'instance',
            job_id: 42,
            last_modified: String(lastModified),
            is_deleted: false,
            deps: [],
            types: [],
          },
        ],
        production: [],
      },
    );

    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
      {
        jobId: 42,
        reservationId: 1,
        priority: 0,
      },
    );
    assert.strictEqual(
      batch.resumedRows.size,
      1,
      'resumed rows from prior attempt of same job_id are loaded',
    );
    assert.strictEqual(
      batch.resumedRows.get(url),
      lastModified,
      'last_modified value is preserved as a number',
    );
    assert.deepEqual(
      batch.invalidations,
      [url],
      'resumed URLs are pre-seeded into the invalidation set so done() promotes them',
    );
  });

  test('does not resume rows with has_error=true so the retry can re-attempt them', async function (assert) {
    let url = `${testRealmURL}errored.json`;
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      {
        working: [
          {
            url,
            generation: 1,
            realm_url: testRealmURL,
            type: 'instance',
            job_id: 42,
            last_modified: '1700000000',
            is_deleted: false,
            has_error: true,
            error_doc: {
              message: 'transient',
              status: 500,
              additionalErrors: [],
            },
            deps: [],
            types: [],
          },
        ],
        production: [],
      },
    );

    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
      {
        jobId: 42,
        reservationId: 1,
        priority: 0,
      },
    );
    assert.strictEqual(
      batch.resumedRows.size,
      0,
      'errored rows are not resumed — the retry exists to re-attempt them',
    );
    assert.deepEqual(
      batch.invalidations,
      [],
      'errored URLs are not pre-seeded into the invalidation set',
    );
  });

  test('does not resume rows from a different job', async function (assert) {
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      {
        working: [
          {
            url: `${testRealmURL}from-other-job.json`,
            generation: 1,
            realm_url: testRealmURL,
            type: 'instance',
            job_id: 99,
            last_modified: '1700000000',
            is_deleted: false,
            deps: [],
            types: [],
          },
        ],
        production: [],
      },
    );

    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
      {
        jobId: 42,
        reservationId: 1,
        priority: 0,
      },
    );
    assert.strictEqual(
      batch.resumedRows.size,
      0,
      'rows tagged with a different job_id are not resumed',
    );
  });

  test('working rows from another job are visible to dependency-walk queries but not to resumedRows', async function (assert) {
    // The cumulative working table is the source of truth for the
    // reverse-deps walk in `Batch.invalidate` (via
    // `itemsThatReference`). Rows from completed prior batches must
    // stay so subsequent jobs can find them. The `job_id` filter in
    // `loadResumedRows` is what isolates the *current* job's
    // resume-handoff from those rows.
    let otherUrl = `${testRealmURL}other-job-row.json`;
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      {
        working: [
          {
            url: otherUrl,
            generation: 1,
            realm_url: testRealmURL,
            type: 'instance',
            job_id: 99,
            last_modified: '1700000000',
            is_deleted: false,
            deps: [],
            types: [],
          },
        ],
        production: [],
      },
    );

    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
      {
        jobId: 42,
        reservationId: 1,
        priority: 0,
      },
    );
    assert.strictEqual(
      batch.resumedRows.size,
      0,
      'rows tagged with a different job_id are NOT in resumedRows',
    );
    let surviving = await adapter.execute(
      'SELECT url FROM boxel_index_working WHERE realm_url = $1',
      { bind: [testRealmURL] },
    );
    assert.deepEqual(
      surviving.map((r) => r.url),
      [otherUrl],
      'cumulative working state is preserved (it is the source for reverse-deps walks)',
    );
  });

  test('forgetResumedRows drops a URL from resumedRows so future tombstoning is no longer guarded', async function (assert) {
    let url = `${testRealmURL}1.json`;
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      {
        working: [
          {
            url,
            generation: 1,
            realm_url: testRealmURL,
            type: 'instance',
            job_id: 42,
            last_modified: '1700000000',
            deps: [],
            types: [],
          },
        ],
        production: [],
      },
    );

    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
      {
        jobId: 42,
        reservationId: 1,
        priority: 0,
      },
    );
    assert.true(
      batch.resumedRows.has(url),
      'precondition: row is initially resumed',
    );
    batch.forgetResumedRows([url]);
    assert.false(
      batch.resumedRows.has(url),
      'after forgetResumedRows the URL is no longer protected',
    );
    batch.forgetResumedRows([`${testRealmURL}does-not-exist.json`]);
    assert.strictEqual(
      batch.resumedRows.size,
      0,
      'forgetResumedRows on a URL that is not present is a no-op',
    );
  });

  test('done() promotes resumed rows even though they were never visited in this attempt', async function (assert) {
    let url = `${testRealmURL}1.json`;
    let resumedDoc = {
      id: url,
      type: 'card' as const,
      attributes: { name: 'Resumed' },
      meta: { adoptsFrom: { module: rri(`./person`), name: 'Person' } },
    };
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      {
        working: [
          {
            url,
            generation: 1,
            realm_url: testRealmURL,
            type: 'instance',
            job_id: 42,
            last_modified: '1700000000',
            is_deleted: false,
            has_error: false,
            deps: [],
            types: [],
            pristine_doc: resumedDoc as LooseCardResource,
            search_doc: { name: 'Resumed' },
          },
        ],
        production: [],
      },
    );

    let batch = await indexWriter.createBatch(
      new URL(testRealmURL),
      virtualNetwork,
      {
        jobId: 42,
        reservationId: 1,
        priority: 0,
      },
    );
    // Note: no updateEntry / invalidate call — simulating a retry that
    // discovers all its work was already done by the previous attempt.
    await batch.done();

    let [promoted] = await adapter.execute(
      `SELECT pristine_doc, search_doc FROM boxel_index WHERE url = $1`,
      {
        bind: [url],
        coerceTypes: { pristine_doc: 'JSON', search_doc: 'JSON' },
      },
    );
    assert.deepEqual(
      promoted?.pristine_doc,
      resumedDoc,
      'resumed row was promoted to boxel_index by done()',
    );
    assert.deepEqual(
      promoted?.search_doc,
      { name: 'Resumed' },
      'resumed row search_doc landed in boxel_index',
    );
  });

  module('getOrderingDependencyRows', function () {
    test('returns production row when URL exists only in boxel_index', async function (assert) {
      let url = `${testRealmURL}prod-only.json`;
      let depUrl = `${testRealmURL}prod-only-dep.json`;
      await setupIndex(
        adapter,
        [{ realm_url: testRealmURL, current_generation: 1 }],
        {
          working: [],
          production: [
            {
              url,
              generation: 1,
              realm_url: testRealmURL,
              type: 'instance',
              deps: [depUrl],
              types: [],
            },
          ],
        },
      );

      let batch = await indexWriter.createBatch(
        new URL(testRealmURL),
        virtualNetwork,
      );
      let rows = await batch.getOrderingDependencyRows([url]);
      assert.deepEqual(
        rows,
        [{ url, type: 'instance', deps: [depUrl] }],
        'returns the production row deps',
      );
    });

    test('returns working row when URL exists only in boxel_index_working and is not deleted', async function (assert) {
      let url = `${testRealmURL}working-only.json`;
      let depUrl = `${testRealmURL}working-only-dep.json`;
      await setupIndex(
        adapter,
        [{ realm_url: testRealmURL, current_generation: 1 }],
        {
          working: [
            {
              url,
              generation: 1,
              realm_url: testRealmURL,
              type: 'instance',
              is_deleted: false,
              deps: [depUrl],
              types: [],
            },
          ],
          production: [],
        },
      );

      let batch = await indexWriter.createBatch(
        new URL(testRealmURL),
        virtualNetwork,
      );
      let rows = await batch.getOrderingDependencyRows([url]);
      assert.deepEqual(
        rows,
        [{ url, type: 'instance', deps: [depUrl] }],
        'returns the working row deps',
      );
    });

    test('working non-deleted wins over production when both exist', async function (assert) {
      let url = `${testRealmURL}both.json`;
      let workingDep = `${testRealmURL}working-dep.json`;
      let productionDep = `${testRealmURL}production-dep.json`;
      await setupIndex(
        adapter,
        [{ realm_url: testRealmURL, current_generation: 1 }],
        {
          working: [
            {
              url,
              generation: 1,
              realm_url: testRealmURL,
              type: 'instance',
              is_deleted: false,
              deps: [workingDep],
              types: [],
            },
          ],
          production: [
            {
              url,
              generation: 1,
              realm_url: testRealmURL,
              type: 'instance',
              deps: [productionDep],
              types: [],
            },
          ],
        },
      );

      let batch = await indexWriter.createBatch(
        new URL(testRealmURL),
        virtualNetwork,
      );
      let rows = await batch.getOrderingDependencyRows([url]);
      assert.deepEqual(
        rows,
        [{ url, type: 'instance', deps: [workingDep] }],
        'working-non-deleted beat production',
      );
    });

    test('production wins over deleted working row', async function (assert) {
      let url = `${testRealmURL}deleted-working.json`;
      let workingDep = `${testRealmURL}should-not-appear.json`;
      let productionDep = `${testRealmURL}production-dep.json`;
      await setupIndex(
        adapter,
        [{ realm_url: testRealmURL, current_generation: 1 }],
        {
          working: [
            {
              url,
              generation: 1,
              realm_url: testRealmURL,
              type: 'instance',
              is_deleted: true,
              deps: [workingDep],
              types: [],
            },
          ],
          production: [
            {
              url,
              generation: 1,
              realm_url: testRealmURL,
              type: 'instance',
              deps: [productionDep],
              types: [],
            },
          ],
        },
      );

      let batch = await indexWriter.createBatch(
        new URL(testRealmURL),
        virtualNetwork,
      );
      let rows = await batch.getOrderingDependencyRows([url]);
      assert.deepEqual(
        rows,
        [{ url, type: 'instance', deps: [productionDep] }],
        'production picked when working row is deleted',
      );
    });

    test('falls back to deleted working row when no production exists', async function (assert) {
      let url = `${testRealmURL}deleted-only.json`;
      let depUrl = `${testRealmURL}deleted-only-dep.json`;
      await setupIndex(
        adapter,
        [{ realm_url: testRealmURL, current_generation: 1 }],
        {
          working: [
            {
              url,
              generation: 1,
              realm_url: testRealmURL,
              type: 'instance',
              is_deleted: true,
              deps: [depUrl],
              types: [],
            },
          ],
          production: [],
        },
      );

      let batch = await indexWriter.createBatch(
        new URL(testRealmURL),
        virtualNetwork,
      );
      let rows = await batch.getOrderingDependencyRows([url]);
      assert.deepEqual(
        rows,
        [{ url, type: 'instance', deps: [depUrl] }],
        'returns deleted working row as last-resort fallback',
      );
    });

    test('mixed input returns the correct provenance per URL', async function (assert) {
      let workingOnlyUrl = `${testRealmURL}mixed-working.json`;
      let workingOnlyDep = `${testRealmURL}mixed-working-dep.json`;
      let productionOnlyUrl = `${testRealmURL}mixed-production.json`;
      let productionOnlyDep = `${testRealmURL}mixed-production-dep.json`;
      let bothUrl = `${testRealmURL}mixed-both.json`;
      let bothWorkingDep = `${testRealmURL}mixed-both-working-dep.json`;
      let bothProductionDep = `${testRealmURL}mixed-both-production-dep.json`;
      await setupIndex(
        adapter,
        [{ realm_url: testRealmURL, current_generation: 1 }],
        {
          working: [
            {
              url: workingOnlyUrl,
              generation: 1,
              realm_url: testRealmURL,
              type: 'instance',
              is_deleted: false,
              deps: [workingOnlyDep],
              types: [],
            },
            {
              url: bothUrl,
              generation: 1,
              realm_url: testRealmURL,
              type: 'instance',
              is_deleted: false,
              deps: [bothWorkingDep],
              types: [],
            },
          ],
          production: [
            {
              url: productionOnlyUrl,
              generation: 1,
              realm_url: testRealmURL,
              type: 'instance',
              deps: [productionOnlyDep],
              types: [],
            },
            {
              url: bothUrl,
              generation: 1,
              realm_url: testRealmURL,
              type: 'instance',
              deps: [bothProductionDep],
              types: [],
            },
          ],
        },
      );

      let batch = await indexWriter.createBatch(
        new URL(testRealmURL),
        virtualNetwork,
      );
      let rows = await batch.getOrderingDependencyRows([
        workingOnlyUrl,
        productionOnlyUrl,
        bothUrl,
      ]);
      let byUrl = new Map(rows.map((r) => [r.url, r]));
      assert.deepEqual(
        byUrl.get(workingOnlyUrl),
        { url: workingOnlyUrl, type: 'instance', deps: [workingOnlyDep] },
        'working-only URL returns working deps',
      );
      assert.deepEqual(
        byUrl.get(productionOnlyUrl),
        {
          url: productionOnlyUrl,
          type: 'instance',
          deps: [productionOnlyDep],
        },
        'production-only URL returns production deps',
      );
      assert.deepEqual(
        byUrl.get(bothUrl),
        { url: bothUrl, type: 'instance', deps: [bothWorkingDep] },
        'URL present in both returns working deps (working wins)',
      );
      assert.strictEqual(rows.length, 3, 'one row returned per requested URL');
    });

    test('projection excludes error_doc, has_error, and is_deleted', async function (assert) {
      let url = `${testRealmURL}projection.json`;
      await setupIndex(
        adapter,
        [{ realm_url: testRealmURL, current_generation: 1 }],
        {
          working: [
            {
              url,
              generation: 1,
              realm_url: testRealmURL,
              type: 'instance',
              is_deleted: false,
              has_error: true,
              error_doc: {
                id: url,
                status: 500,
                title: 'kaboom',
                message: 'should not be returned',
                additionalErrors: null,
              },
              deps: [],
              types: [],
            },
          ],
          production: [],
        },
      );

      let batch = await indexWriter.createBatch(
        new URL(testRealmURL),
        virtualNetwork,
      );
      let rows = await batch.getOrderingDependencyRows([url]);
      assert.strictEqual(rows.length, 1, 'one row returned');
      let row = rows[0]!;
      assert.deepEqual(
        Object.keys(row).sort(),
        ['deps', 'type', 'url'],
        'row exposes only url, type, deps — no error_doc / has_error / is_deleted',
      );
    });
  });
});

module('Unit | index-writer | error doc merge', function () {
  function err(
    message: string,
    extra: Partial<SerializedError> = {},
  ): SerializedError {
    return { message, status: 500, additionalErrors: null, ...extra };
  }

  test('a higher-generation error doc supersedes a lower-generation one', function (assert) {
    let recent = err('recent', {
      id: 'x',
      additionalErrors: [err('recent-dep')],
    });
    let stale = err('stale', { id: 'x', additionalErrors: [err('stale-dep')] });

    assert.strictEqual(
      mergeErrorsByGeneration(recent, 5, stale, 4).message,
      'recent',
      'the newer generation wins when it is the first argument',
    );
    assert.strictEqual(
      mergeErrorsByGeneration(stale, 4, recent, 5).message,
      'recent',
      'the newer generation wins when it is the second argument',
    );
    assert.deepEqual(
      mergeErrorsByGeneration(recent, 5, stale, 4).additionalErrors,
      [err('recent-dep')],
      'the stale document contributes nothing — it is not merged in',
    );
  });

  test('equal-generation error docs merge their detail, keeping the primary message', function (assert) {
    let primary = err('primary message', {
      id: 'card',
      deps: ['dep-a'],
      additionalErrors: [err('existing-dep', { id: 'existing' })],
    });
    let secondary = err('secondary message', {
      id: 'module',
      deps: ['dep-b'],
      additionalErrors: [err('missing middle-field', { id: 'middle' })],
    });

    let merged = mergeErrorsByGeneration(primary, 3, secondary, 3);

    assert.strictEqual(
      merged.message,
      'primary message',
      'the primary envelope message is preserved',
    );
    let messages = (merged.additionalErrors ?? []).map((e) => e.message);
    assert.ok(
      messages.includes('existing-dep'),
      "the primary's own additionalErrors are kept",
    );
    assert.ok(
      messages.includes('missing middle-field'),
      "the secondary's nested dependency detail is folded in flat",
    );
    assert.ok(
      messages.includes('secondary message'),
      "the secondary's own top-level error is folded in as a flat entry",
    );
    assert.deepEqual(merged.deps, ['dep-a', 'dep-b'], 'deps are unioned');
  });

  test('merging an error doc identical to the primary adds nothing', function (assert) {
    let primary = err('same failure', { id: 'x', status: 500 });
    let secondary = err('same failure', { id: 'x', status: 500 });
    assert.strictEqual(
      mergeErrorDetail(primary, secondary).additionalErrors,
      null,
      'a secondary that matches the primary (id, message, status) is deduped away',
    );
  });

  test("the secondary's nested detail is folded flat, not nested", function (assert) {
    let primary = err('primary', { id: 'p' });
    let secondary = err('secondary', {
      id: 's',
      additionalErrors: [err('leaf detail', { id: 'leaf' })],
    });
    let merged = mergeErrorDetail(primary, secondary);
    assert.deepEqual(
      (merged.additionalErrors ?? []).map((e) => e.message),
      ['secondary', 'leaf detail'],
      'both the secondary envelope and its nested detail sit at the top level',
    );
    let secondaryEntry = (merged.additionalErrors ?? []).find(
      (e) => e.id === 's',
    );
    assert.strictEqual(
      secondaryEntry.additionalErrors,
      null,
      'the folded secondary entry does not carry its own nested list',
    );
  });
});
