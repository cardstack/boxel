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

// prerendered_html is the sole home of rendered output: every HTML/markdown
// read path sources it from the prerendered_html row joined to the
// boxel_index row, and a row with no prerendered_html row reads as
// unrendered — null HTML, no full-text membership.
module('Unit | prerendered-html read path', function (hooks) {
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
    // the scoped-CSS deps (setupIndex lands the HTML half on
    // prerendered_html). A third instance carries no HTML at all — the row
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

  test('every read path serves HTML and markdown from prerendered_html', async function (assert) {
    let entry = (await indexQueryEngine.getInstance(
      new URL(`${testRealmURL}1`),
    )) as IndexedInstance;
    assert.strictEqual(
      entry.isolatedHtml,
      `<div class="isolated">Van Gogh</div>`,
      'getInstance serves isolated_html from prerendered_html',
    );
    assert.strictEqual(
      entry.atomHtml,
      `<span class="atom">Van Gogh</span>`,
      'getInstance serves atom_html from prerendered_html',
    );
    assert.strictEqual(
      entry.markdown,
      'Van Gogh painted sunflowers',
      'getInstance serves markdown from prerendered_html',
    );

    let batched = await indexQueryEngine.getInstances([
      new URL(`${testRealmURL}1`),
      new URL(`${testRealmURL}2`),
    ]);
    let mango = batched.get(`${testRealmURL}2`) as IndexedInstance;
    assert.strictEqual(
      mango.isolatedHtml,
      `<div class="isolated">Mango</div>`,
      'getInstances serves isolated_html from prerendered_html',
    );

    let file = await indexQueryEngine.getFile(
      new URL(`${testRealmURL}readme.md`),
    );
    assert.strictEqual(
      file?.isolatedHtml,
      `<div class="isolated">Readme</div>`,
      'getFile serves isolated_html from prerendered_html',
    );
    assert.strictEqual(
      file?.iconHtml,
      `<svg>file-icon</svg>`,
      'getFile serves icon_html from boxel_index',
    );

    let { results } = await indexQueryEngine.search(
      testRealmURLObject,
      {},
      { includeErrors: true },
      { kind: 'renderSet' },
    );
    let row1 = results.find((r) => r.url === `${testRealmURL}1.json`);
    assert.strictEqual(
      row1?.atom_html,
      `<span class="atom">Van Gogh</span>`,
      'the renderSet projection serves atom_html from prerendered_html',
    );
    assert.deepEqual(
      row1?.deps,
      [
        `${testRealmURL}person`,
        `${testRealmURL}Person.gts.abc.glimmer-scoped.css`,
      ],
      'the renderSet projection serves deps from prerendered_html',
    );
    assert.strictEqual(
      row1?.html_generation,
      1,
      'the renderSet projection carries the rendering generation',
    );

    let { files } = await indexQueryEngine.searchFiles(
      testRealmURLObject,
      {},
      {},
    );
    let readme = files.find(
      (f) => f.canonicalURL === `${testRealmURL}readme.md`,
    );
    assert.strictEqual(
      readme?.markdown,
      'Readme markdown body',
      'searchFiles serves markdown from prerendered_html',
    );

    let matched = await indexQueryEngine.searchCards(
      testRealmURLObject,
      { filter: { matches: 'sunflowers' } },
      {},
    );
    assert.deepEqual(
      matched.cards.map((c) => c.id as string),
      [`${testRealmURL}1`],
      'FTS matches over prerendered_html.markdown',
    );
  });

  test('a row with no prerendered_html row reads as unrendered', async function (assert) {
    let entry = (await indexQueryEngine.getInstance(
      new URL(`${testRealmURL}3`),
    )) as IndexedInstance;
    assert.strictEqual(entry.isolatedHtml, null, 'isolated_html is absent');
    assert.strictEqual(entry.markdown, null, 'markdown is absent');

    let { results } = await indexQueryEngine.search(
      testRealmURLObject,
      {},
      { includeErrors: true },
      { kind: 'renderSet' },
    );
    let row3 = results.find((r) => r.url === `${testRealmURL}3.json`);
    assert.ok(row3, 'the unrendered row is still a search member');
    assert.strictEqual(
      row3?.fitted_html,
      null,
      'the renderSet projection has no renderings for it',
    );
    assert.strictEqual(
      row3?.html_generation,
      null,
      'it has no rendering generation',
    );

    // Deleting a row's prerendered_html row removes its renderings — the
    // remaining rows keep serving theirs.
    await adapter.execute(`DELETE FROM prerendered_html WHERE url = $1`, {
      bind: [`${testRealmURL}2.json`],
    });
    let mango = (await indexQueryEngine.getInstance(
      new URL(`${testRealmURL}2`),
    )) as IndexedInstance;
    assert.strictEqual(
      mango.isolatedHtml,
      null,
      'a row without a prerendered_html row has no HTML',
    );
    let vanGogh = (await indexQueryEngine.getInstance(
      new URL(`${testRealmURL}1`),
    )) as IndexedInstance;
    assert.strictEqual(
      vanGogh.isolatedHtml,
      `<div class="isolated">Van Gogh</div>`,
      'other rows keep serving their prerendered_html',
    );
  });

  test('FTS membership follows prerendered_html.markdown', async function (assert) {
    // Membership tracks prerendered_html.markdown: rewrite row 2's markdown to
    // include a new term and confirm the matches query now finds it.
    await adapter.execute(
      `UPDATE prerendered_html SET markdown = $1 WHERE url = $2`,
      { bind: ['Mango and sunflowers together', `${testRealmURL}2.json`] },
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

    // Blanking a prerendered_html markdown drops the row from FTS.
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
      'a null prerendered_html markdown is not full-text findable',
    );

    // Deleting the prerendered_html row entirely likewise removes membership —
    // an unrendered row is not full-text findable until its render lands.
    await adapter.execute(`DELETE FROM prerendered_html WHERE url = $1`, {
      bind: [`${testRealmURL}2.json`],
    });
    let afterDelete = await indexQueryEngine.searchCards(
      testRealmURLObject,
      { filter: { matches: 'sunflowers' } },
      {},
    );
    assert.deepEqual(
      afterDelete.cards.map((c) => c.id as string),
      [],
      'a row with no prerendered_html row has no full-text membership',
    );
  });
});
