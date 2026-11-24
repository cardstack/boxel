import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  IndexQueryEngine,
  IndexWriter,
  VirtualNetwork,
  internalKeyFor,
  rri,
  type Definition,
  type DefinitionLookup,
  type Filter,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  STATS_MIN_COUNT,
  STATS_MIN_ROWS,
} from '@cardstack/runtime-common/query-engine/index-query-engine';
import type { PgAdapter } from '@cardstack/postgres';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
} from './helpers/index.ts';

// The small-count floor on typo corrections for a caller a realm policy
// scopes (`anonymizeStatistics`): a correction is offered only in a realm of
// at least STATS_MIN_ROWS ranked rows, and only for a word at least
// STATS_MIN_COUNT rows hold, so a suggestion never points at a word only a
// few cards (perhaps cards the caller cannot read) contain. A caller who
// reads the realm outright gets every correction.

const REALM = 'http://typo-floor.test/garden/';
const SMALL = 'http://typo-floor.test/small/';

const plantRef: ResolvedCodeRef = {
  module: 'http://typo-floor.test/garden/plant' as ResolvedCodeRef['module'],
  name: 'Plant',
};

const stringRef = { module: '@cardstack/base/string', name: 'default' };
const plantDef = {
  type: 'card-def',
  codeRef: plantRef,
  displayName: 'Plant',
  fields: { title: 'title', visibility: 'visibility' },
  fieldDefs: {
    title: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
      search: { role: 'title', typos: true },
    },
    visibility: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
    },
  },
} as unknown as Definition;

function lookup(): DefinitionLookup {
  const l = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      if (codeRef.name === plantRef.name) return plantDef;
      throw new Error(`unexpected definition lookup: ${codeRef.module}`);
    },
    async lookupCachedDefinition() {
      return undefined;
    },
    forRealm() {
      return l;
    },
  } as unknown as DefinitionLookup;
  return l;
}

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let network: VirtualNetwork;
  let engine: IndexQueryEngine;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    network = new VirtualNetwork();
    engine = new IndexQueryEngine(adapter, lookup(), network);
  });
  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  // `count` plants titled `title` in `realm`, from index `from`.
  async function plants(
    realm: string,
    rows: { title: string; count: number; visibility?: string }[],
  ) {
    let key = internalKeyFor(plantRef, undefined, network);
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(realm),
      network,
      undefined,
      { splitPrerenderHtml: false },
    );
    let n = 0;
    for (let { title, count, visibility = 'public' } of rows) {
      for (let i = 0; i < count; i++, n++) {
        let url = new URL(`${realm}p${n}.json`);
        await batch.updateEntry(url, {
          type: 'instance',
          resource: {
            id: rri(url.href),
            type: 'card',
            attributes: { title, visibility },
            meta: {
              adoptsFrom: { module: rri(plantRef.module), name: 'Plant' },
            },
          },
          lastModified: Date.now(),
          resourceCreatedAt: Date.now(),
          searchData: {
            title,
            visibility,
            _searchText: { A: title, typos: title },
          },
          markdown: title,
          deps: new Set(),
          displayNames: ['Plant'],
          types: [key],
          isolatedHtml: `<div>${n}</div>`,
        } as any);
      }
    }
    await batch.done();
    // A revision that kept realm word statistics read the floor from them,
    // built by a search in the background; built here so this test reads the
    // same floor on either side of their removal.
    let [legacy] = (await adapter.execute(
      `SELECT to_regclass('boxel_term_stats') IS NOT NULL AS present`,
    )) as { present: boolean }[];
    if (legacy?.present) {
      await adapter.execute(
        `DELETE FROM boxel_term_stats WHERE realm_url = $1`,
        { bind: [realm] },
      );
      await adapter.execute(
        `INSERT INTO boxel_term_stats (realm_url, lexeme, df)
         SELECT i.realm_url, u.lexeme, COUNT(*) FROM boxel_index AS i
         CROSS JOIN LATERAL unnest(i.rank_tsv) AS u
         WHERE i.realm_url = $1 AND i.rank_tsv IS NOT NULL AND i.is_deleted IS NOT TRUE
         GROUP BY i.realm_url, u.lexeme`,
        { bind: [realm] },
      );
      await adapter.execute(
        `INSERT INTO boxel_realm_text_stats (realm_url, doc_count, rebuilt_at)
         SELECT $1, COUNT(*), now() FROM boxel_index
         WHERE realm_url = $1 AND rank_tsv IS NOT NULL AND is_deleted IS NOT TRUE
         ON CONFLICT (realm_url) DO UPDATE SET doc_count = EXCLUDED.doc_count, rebuilt_at = now()`,
        { bind: [realm] },
      );
    }
  }

  // The words a `typos` term is widened to, as the engine resolves them.
  async function corrected(
    realm: string,
    words: string,
    anonymize: boolean,
  ): Promise<string> {
    let filter = (await (engine as any).resolveTypos(
      { on: plantRef, matches: words, typos: true } as Filter,
      new URL(realm),
      anonymize,
    )) as { typoQuery?: string };
    return filter.typoQuery ?? '';
  }

  async function titles(
    realm: string,
    words: string,
    opts: Record<string, unknown>,
  ): Promise<number> {
    let { meta } = await engine.search(
      new URL(realm),
      {
        filter: { on: plantRef, matches: words, typos: true },
        page: { size: 1 },
      } as unknown as Query,
      opts,
      { kind: 'dataOnly' },
    );
    return meta.page.total;
  }

  hooks.beforeEach(async function () {
    // a realm above the row floor: a common word, a rare one, and a word
    // only cards the caller cannot read hold
    await plants(REALM, [
      { title: 'orchard pear', count: 20 },
      { title: 'zephyrine lily', count: STATS_MIN_COUNT - 3 },
      {
        title: 'quillwort fern',
        count: STATS_MIN_COUNT - 2,
        visibility: 'private',
      },
      { title: 'meadow grass', count: STATS_MIN_ROWS },
    ]);
    // and a realm below it
    await plants(SMALL, [{ title: 'orchard pear', count: 20 }]);
  });

  const scoped = {
    anonymizeStatistics: true,
    grantFilter: {
      on: plantRef,
      eq: { visibility: 'public' },
    },
  };

  test('a policy-scoped caller gets a correction for a common word', async function (assert) {
    assert.true(
      (await corrected(REALM, 'orchrd', true)).includes('orchard'),
      'the misspelling widens to the common word',
    );
    assert.strictEqual(
      await titles(REALM, 'orchrd', scoped),
      20,
      'and finds its cards',
    );
  });

  test('a policy-scoped caller gets no correction for a word below the floor', async function (assert) {
    assert.false(
      (await corrected(REALM, 'zephyrne', true)).includes('zephyrine'),
      'a word fewer than STATS_MIN_COUNT rows hold is not offered',
    );
    assert.strictEqual(await titles(REALM, 'zephyrne', scoped), 0);
    assert.false(
      (await corrected(REALM, 'quilwort', true)).includes('quillwort'),
      'nor a word only cards the caller cannot read hold',
    );
  });

  test('a policy-scoped caller gets no corrections in a realm below the row floor', async function (assert) {
    assert.false((await corrected(SMALL, 'orchrd', true)).includes('orchard'));
  });

  test('a caller who reads the realm outright gets every correction', async function (assert) {
    assert.true((await corrected(REALM, 'orchrd', false)).includes('orchard'));
    assert.true(
      (await corrected(REALM, 'zephyrne', false)).includes('zephyrine'),
    );
    assert.true((await corrected(SMALL, 'orchrd', false)).includes('orchard'));
    assert.strictEqual(await titles(REALM, 'zephyrne', {}), 2);
  });
});
