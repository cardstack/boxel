import { type TestContext, getContext } from '@ember/test-helpers';

import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import {
  IndexQueryEngine,
  internalKeyFor,
  baseCardRef,
  rri,
  type CardResource,
  type IndexedInstance,
  type InstanceOrError,
  type RealmResourceIdentifier,
} from '@cardstack/runtime-common';
import { CachingDefinitionLookup } from '@cardstack/runtime-common/definition-lookup';
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

const testRealmURLObject = new URL(testRealmURL);

// Copy every boxel_index row for the realm into prerendered_html, seeding
// rendered_at from indexed_at, so a mirrored row reads identically whether the
// dual-read serves it from prerendered_html or from the boxel_index fallback.
async function mirrorPrerenderedHtml(adapter: SQLiteAdapter, realmURL: string) {
  await adapter.execute(
    `INSERT INTO prerendered_html (
       url, file_alias, realm_url, type,
       fitted_html, embedded_html, atom_html, head_html, isolated_html,
       markdown, deps, last_known_good_deps,
       generation, is_deleted, error_doc, rendered_at
     )
     SELECT
       url, file_alias, realm_url, type,
       fitted_html, embedded_html, atom_html, head_html, isolated_html,
       markdown, deps, last_known_good_deps,
       generation, is_deleted, error_doc, indexed_at
     FROM boxel_index WHERE realm_url = $1`,
    { bind: [realmURL] },
  );
}

const makeCardResource = (
  id: string,
  name: string,
  adoptsFrom: { module: RealmResourceIdentifier; name: string },
): CardResource => ({
  id: testRRI(id),
  type: 'card',
  attributes: { name },
  meta: { adoptsFrom },
});

module('Unit | prerendered-html dual-read', function (hooks) {
  let adapter: SQLiteAdapter;
  let indexQueryEngine: IndexQueryEngine;
  let virtualNetwork: VirtualNetwork;
  let personTypes: string[];
  setupTest(hooks);

  hooks.before(async function () {
    adapter = await getDbAdapter();
  });

  hooks.beforeEach(async function () {
    await adapter.reset();
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

    personTypes = [
      { module: rri(`./person`), name: 'Person' },
      baseCardRef,
    ].map((t) => internalKeyFor(t, testRealmURLObject, virtualNetwork));

    // Two instances + one file, each carrying every HTML format, markdown, and
    // the scoped-CSS deps. A fourth instance carries no HTML at all — the row
    // whose renderings never existed.
    let fittedFor = (label: string) =>
      Object.fromEntries(
        personTypes.map((t) => [t, `<div class="fitted">${label} ${t}</div>`]),
      );
    let embeddedFor = (label: string) =>
      Object.fromEntries(
        personTypes.map((t) => [
          t,
          `<div class="embedded">${label} ${t}</div>`,
        ]),
      );
    await setupIndex(
      adapter,
      [{ realm_url: testRealmURL, current_generation: 1 }],
      [
        {
          url: `${testRealmURL}1.json`,
          type: 'instance',
          generation: 1,
          realm_url: testRealmURL,
          pristine_doc: makeCardResource('1', 'Van Gogh', {
            module: rri(`./person`),
            name: 'Person',
          }),
          search_doc: { name: 'Van Gogh' },
          resource_created_at: String(1700000000000),
          display_names: ['Person', 'Card'],
          types: personTypes,
          deps: [
            `${testRealmURL}person`,
            `${testRealmURL}Person.gts.abc.glimmer-scoped.css`,
          ],
          fitted_html: fittedFor('Van Gogh'),
          embedded_html: embeddedFor('Van Gogh'),
          atom_html: `<span class="atom">Van Gogh</span>`,
          head_html: `<meta name="og:title" content="Van Gogh" />`,
          isolated_html: `<div class="isolated">Van Gogh</div>`,
          icon_html: `<svg>vg-icon</svg>`,
          markdown: 'Van Gogh painted sunflowers',
        },
        {
          url: `${testRealmURL}2.json`,
          type: 'instance',
          generation: 1,
          realm_url: testRealmURL,
          pristine_doc: makeCardResource('2', 'Mango', {
            module: rri(`./person`),
            name: 'Person',
          }),
          search_doc: { name: 'Mango' },
          resource_created_at: String(1700000000000),
          display_names: ['Person', 'Card'],
          types: personTypes,
          deps: [`${testRealmURL}person`],
          fitted_html: fittedFor('Mango'),
          embedded_html: embeddedFor('Mango'),
          atom_html: `<span class="atom">Mango</span>`,
          head_html: `<meta name="og:title" content="Mango" />`,
          isolated_html: `<div class="isolated">Mango</div>`,
          icon_html: `<svg>mango-icon</svg>`,
          markdown: 'Mango is a sweet fruit',
        },
        {
          // No HTML/markdown at all — a row whose renderings never existed.
          url: `${testRealmURL}3.json`,
          type: 'instance',
          generation: 1,
          realm_url: testRealmURL,
          pristine_doc: makeCardResource('3', 'Empty', {
            module: rri(`./person`),
            name: 'Person',
          }),
          search_doc: { name: 'Empty' },
          resource_created_at: String(1700000000000),
          display_names: ['Person', 'Card'],
          types: personTypes,
          deps: [`${testRealmURL}person`],
        },
        {
          url: `${testRealmURL}readme.md`,
          type: 'file',
          generation: 1,
          realm_url: testRealmURL,
          search_doc: { name: 'readme.md' },
          display_names: ['File'],
          types: personTypes,
          deps: [`${testRealmURL}Readme.gts.def.glimmer-scoped.css`],
          fitted_html: { [personTypes[0]]: `<div class="fitted">Readme</div>` },
          embedded_html: {
            [personTypes[0]]: `<div class="embedded">Readme</div>`,
          },
          atom_html: `<span class="atom">Readme</span>`,
          head_html: `<meta name="og:title" content="Readme" />`,
          isolated_html: `<div class="isolated">Readme</div>`,
          icon_html: `<svg>file-icon</svg>`,
          markdown: 'Readme markdown body',
        },
      ],
    );
  });

  // A normalized, order-stable snapshot of every HTML/markdown read path, so
  // the same battery can be compared across dual-read scenarios.
  async function snapshot() {
    let instanceUrls = [1, 2, 3].map((n) => new URL(`${testRealmURL}${n}`));
    let single: (InstanceOrError | undefined)[] = [];
    for (let url of instanceUrls) {
      single.push(await indexQueryEngine.getInstance(url));
    }
    let batched = await indexQueryEngine.getInstances(instanceUrls);
    let batchedEntries = [...batched.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );

    let file = await indexQueryEngine.getFile(
      new URL(`${testRealmURL}readme.md`),
    );

    let renderSet = await indexQueryEngine.search(
      testRealmURLObject,
      {},
      { includeErrors: true },
      { kind: 'renderSet' },
    );
    let files = await indexQueryEngine.searchFiles(testRealmURLObject, {}, {});
    let matched = await indexQueryEngine.searchCards(
      testRealmURLObject,
      { filter: { matches: 'sunflowers' } },
      {},
    );

    return {
      single,
      batchedEntries,
      file,
      renderSet,
      files: files.files,
      matchedUrls: matched.cards.map((c) => c.id as string).sort(),
    };
  }

  test('golden parity: prerendered_html mirror and boxel_index fallback return identical results', async function (assert) {
    // Fallback path: with no prerendered_html rows, every read falls back to
    // the boxel_index columns.
    let fallback = await snapshot();

    // Sanity: HTML actually flowed through the fallback (guards against a
    // snapshot that is trivially empty and would pass any comparison).
    let vg = fallback.single[0] as IndexedInstance;
    assert.strictEqual(
      vg.isolatedHtml,
      `<div class="isolated">Van Gogh</div>`,
      'fallback path serves boxel_index HTML',
    );
    assert.strictEqual(
      vg.markdown,
      'Van Gogh painted sunflowers',
      'fallback path serves boxel_index markdown',
    );
    assert.deepEqual(
      fallback.matchedUrls,
      [`${testRealmURL}1`],
      'fallback FTS matches over boxel_index.markdown',
    );

    // Prerendered path: mirror every row into prerendered_html; reads now come
    // from prerendered_html and must be byte-for-byte identical.
    await mirrorPrerenderedHtml(adapter, testRealmURL);
    let prerendered = await snapshot();
    assert.deepEqual(
      prerendered,
      fallback,
      'prerendered_html mirror returns identical results to the boxel_index fallback',
    );

    // A row deliberately missing from prerendered_html resolves via the
    // boxel_index fallback, while its neighbors are served from prerendered_html.
    await adapter.execute(`DELETE FROM prerendered_html WHERE url = $1`, {
      bind: [`${testRealmURL}2.json`],
    });
    let mixed = await snapshot();
    assert.deepEqual(
      mixed,
      fallback,
      'a row missing from prerendered_html is served identically from the fallback',
    );
  });

  test('reads prefer prerendered_html over boxel_index when a row exists', async function (assert) {
    await mirrorPrerenderedHtml(adapter, testRealmURL);
    // Diverge the prerendered_html rendering from the boxel_index column with a
    // sentinel. A correct dual-read serves the sentinel; only a stale read that
    // ignored prerendered_html would return the boxel_index value.
    await adapter.execute(
      `UPDATE prerendered_html
       SET isolated_html = $1, atom_html = $2, markdown = $3
       WHERE url = $4`,
      {
        bind: [
          `<div class="isolated">PRERENDERED</div>`,
          `<span class="atom">PRERENDERED</span>`,
          'prerendered markdown sentinel',
          `${testRealmURL}1.json`,
        ],
      },
    );

    let entry = (await indexQueryEngine.getInstance(
      new URL(`${testRealmURL}1`),
    )) as IndexedInstance;
    assert.strictEqual(
      entry.isolatedHtml,
      `<div class="isolated">PRERENDERED</div>`,
      'getInstance serves isolated_html from prerendered_html',
    );
    assert.strictEqual(
      entry.atomHtml,
      `<span class="atom">PRERENDERED</span>`,
      'getInstance serves atom_html from prerendered_html',
    );
    assert.strictEqual(
      entry.markdown,
      'prerendered markdown sentinel',
      'getInstance serves markdown from prerendered_html',
    );

    // A row with no prerendered_html row keeps serving the boxel_index column.
    await adapter.execute(`DELETE FROM prerendered_html WHERE url = $1`, {
      bind: [`${testRealmURL}2.json`],
    });
    let fallbackEntry = (await indexQueryEngine.getInstance(
      new URL(`${testRealmURL}2`),
    )) as IndexedInstance;
    assert.strictEqual(
      fallbackEntry.isolatedHtml,
      `<div class="isolated">Mango</div>`,
      'a row absent from prerendered_html falls back to boxel_index HTML',
    );
  });

  test('a present prerendered_html row is authoritative for a null column (no boxel_index fallback)', async function (assert) {
    await mirrorPrerenderedHtml(adapter, testRealmURL);
    // Null the prerendered rendering while boxel_index retains a value. A
    // present prerendered_html row is authoritative, so the read reports the
    // absence rather than leaking the boxel_index column — otherwise a row
    // absent from full-text search could serve stale markdown/HTML.
    await adapter.execute(
      `UPDATE prerendered_html SET markdown = NULL, isolated_html = NULL WHERE url = $1`,
      { bind: [`${testRealmURL}1.json`] },
    );
    let entry = (await indexQueryEngine.getInstance(
      new URL(`${testRealmURL}1`),
    )) as IndexedInstance;
    assert.strictEqual(
      entry.markdown,
      null,
      'a present-but-null prerendered markdown reads as absent, not the boxel_index value',
    );
    assert.strictEqual(
      entry.isolatedHtml,
      null,
      'a present-but-null prerendered isolated_html reads as absent',
    );
  });

  test('FTS matches reads prerendered_html.markdown with a boxel_index fallback', async function (assert) {
    await mirrorPrerenderedHtml(adapter, testRealmURL);

    // Membership tracks prerendered_html.markdown: rewrite row 2's markdown to
    // include a new term and confirm the matches query now finds it.
    await adapter.execute(
      `UPDATE prerendered_html SET markdown = $1 WHERE url = $2`,
      { bind: ['Mango and sunflowers together', `${testRealmURL}2.json`] },
    );
    // Confirm the mirror created row 2 and the update landed, so the membership
    // assertion below exercises the prerendered_html.markdown read (not a no-op).
    let [row2] = (await adapter.execute(
      `SELECT markdown FROM prerendered_html WHERE url = $1`,
      { bind: [`${testRealmURL}2.json`] },
    )) as { markdown: string | null }[];
    assert.strictEqual(
      row2?.markdown,
      'Mango and sunflowers together',
      'prerendered_html row 2 markdown was mirrored and updated',
    );
    let bothMatch = await indexQueryEngine.searchCards(
      testRealmURLObject,
      { filter: { matches: 'sunflowers' } },
      {},
    );
    assert.deepEqual(
      bothMatch.cards.map((c) => c.id as string).sort(),
      [`${testRealmURL}1`, `${testRealmURL}2`],
      'matches membership follows prerendered_html.markdown',
    );

    // Blanking a prerendered_html markdown drops the row from FTS even though
    // boxel_index retains its markdown (the ph row exists, so the guarded
    // boxel_index fallback does not re-add it).
    await adapter.execute(
      `UPDATE prerendered_html SET markdown = NULL WHERE url = $1`,
      { bind: [`${testRealmURL}1.json`] },
    );
    let afterBlank = await indexQueryEngine.searchCards(
      testRealmURLObject,
      { filter: { matches: 'sunflowers' } },
      {},
    );
    assert.deepEqual(
      afterBlank.cards.map((c) => c.id as string).sort(),
      [`${testRealmURL}2`],
      'a present-but-empty prerendered_html markdown is not re-matched via boxel_index',
    );

    // With no prerendered_html row at all, the guarded fallback reads
    // boxel_index.markdown so the row stays full-text findable.
    await adapter.execute(`DELETE FROM prerendered_html WHERE url = $1`, {
      bind: [`${testRealmURL}1.json`],
    });
    let afterDelete = await indexQueryEngine.searchCards(
      testRealmURLObject,
      { filter: { matches: 'sunflowers' } },
      {},
    );
    assert.deepEqual(
      afterDelete.cards.map((c) => c.id as string).sort(),
      [`${testRealmURL}1`, `${testRealmURL}2`],
      'a row missing from prerendered_html falls back to boxel_index.markdown for FTS',
    );
  });
});
