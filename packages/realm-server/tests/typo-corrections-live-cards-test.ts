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
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
} from './helpers/index.ts';

// A typo correction is offered only if a live card of the realm holds it,
// for every caller. The realm's word list only grows: a card's words stay
// listed after the card goes, and survive an index emptied by a crash, so a
// word only the list holds must never be suggested.
const REALM = 'http://typo-floor.test/garden/';

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

  hooks.beforeEach(async function () {
    await plants(REALM, [{ title: 'orchard pear', count: 3 }]);
    // A word no card holds: what a deleted card, or a crash, leaves listed.
    await adapter.execute(
      `INSERT INTO boxel_index_words (realm_url, word) VALUES ($1, 'lantern')`,
      { bind: [REALM] },
    );
  });

  test('a correction a live card holds is offered', async function (assert) {
    assert.true(
      (await corrected(REALM, 'orchrd', false)).includes('orchard'),
      'orchrd is widened to orchard',
    );
  });

  test('a correction only the word list holds is not offered', async function (assert) {
    assert.false(
      (await corrected(REALM, 'lantrn', false)).includes('lantern'),
      'no live card holds lantern',
    );
    assert.false(
      (await corrected(REALM, 'lantrn', true)).includes('lantern'),
      'nor for a caller a policy scopes',
    );
  });

  test("a deleted card's words are not offered", async function (assert) {
    await plants(REALM, [{ title: 'quillwort fern', count: 1 }]);
    assert.true(
      (await corrected(REALM, 'quilwort', false)).includes('quillwort'),
      'offered while a card holds it',
    );
    await adapter.execute(
      `UPDATE boxel_index SET is_deleted = TRUE WHERE realm_url = $1 AND search_doc ->> 'title' = 'quillwort fern'`,
      { bind: [REALM] },
    );
    assert.false(
      (await corrected(REALM, 'quilwort', false)).includes('quillwort'),
      'not once the card is gone',
    );
  });
});
