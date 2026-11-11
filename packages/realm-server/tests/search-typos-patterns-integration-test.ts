import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  SEARCH_TEXT_KEY,
  editDistance,
  typoBudget,
  typoCorrections,
  VirtualNetwork,
  assertQuery,
  internalKeyFor,
  rri,
  type Definition,
  type DefinitionLookup,
  type Query,
  type ResolvedCodeRef,
  type SearchText,
} from '@cardstack/runtime-common';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';

// Typo-tolerant matching and pattern filters on Postgres
// (docs/search-intent.md, Text): the words of `typos` fields fill the realm's
// word list, which widens a misspelt term to its closest words; the values of
// pattern fields fill the trigram-indexed `pattern_text`, which narrows glob
// and regex filters before the field decides.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const talkRef = ref(`${testRealm}talk`, 'Talk');

const talkDef: Definition = {
  type: 'card-def',
  codeRef: talkRef,
  displayName: 'Talk',
  fields: { title: 'f0', text: 'f1', vid: 'f4', speaker: 'f5', note: 'f6' },
  fieldDefs: {
    f0: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
      search: { role: 'title' },
    },
    f1: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
      search: { role: 'body' },
    },
    f4: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
      search: { role: 'identifier', patterns: true },
    },
    f5: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
      search: { role: 'name', typos: true },
    },
    f6: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
    },
    f2: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: numberRef,
      serializerName: 'number',
      search: { rank: 'popularity' },
    },
    f3: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: numberRef,
      serializerName: 'number',
    },
  },
} as Definition;

function makeDefinitionLookup(): DefinitionLookup {
  const lookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      if (codeRef.module === talkRef.module && codeRef.name === talkRef.name) {
        return talkDef;
      }
      throw new Error(
        `unexpected definition lookup: ${codeRef.module}/${codeRef.name}`,
      );
    },
    async lookupDefinitionEntry(): Promise<never> {
      throw new Error('lookupDefinitionEntry is not used by these tests');
    },
    async lookupCachedDefinition() {
      return undefined;
    },
    async invalidate() {
      return [];
    },
    async clearRealmDefinitions() {},
    async clearAllDefinitions() {},
    registerRealm() {},
    async getCachedDefinitions() {
      return undefined;
    },
    async populateDefinitionCacheEntry() {
      return undefined;
    },
    async getCachedDefinitionsBatch() {
      return {};
    },
    forRealm() {
      return lookup;
    },
  } as unknown as DefinitionLookup;
  return lookup;
}

const url = (name: string) => `${testRealm}Talk/${name}.json`;

interface TalkData {
  title: string;
  text: string;
  vid: string;
  speaker: string;
  note: string;
}

// What the render stamps for these declarations.
function searchTextFor(data: TalkData): SearchText {
  return {
    A: `${data.title}\n${data.speaker}`,
    D: data.text,
    typos: data.speaker,
    patterns: data.vid,
  };
}

const corpus: Record<string, TalkData> = {
  crdt: {
    title: 'Local-first software',
    text: 'conflict-free replicated data types',
    vid: 'dQw4w9WgXcQ',
    speaker: 'Martin Kleppmann',
    note: 'dQw4 mentioned in a note',
  },
  rust: {
    title: 'Ownership in practice',
    text: 'borrow checker stories',
    vid: 'dQx9ZZ_1abc',
    speaker: 'Niko Matsakis',
    note: 'plain',
  },
  go: {
    title: 'Concurrency patterns',
    text: 'goroutines and channels',
    vid: 'f00BAR42xyz',
    speaker: 'Rob Pike',
    note: 'plain',
  },
  // A long word that shares most of its trigrams with a misspelling of
  // another: "concurency" must not be corrected to "cryptocurrency".
  coins: {
    title: 'Ledgers',
    text: 'blocks and chains',
    vid: 'zzCoins0001',
    speaker: 'Cryptocurrency Club',
    note: 'plain',
  },
  kit: {
    title: 'Lock-free queues',
    text: 'atomics',
    vid: 'zzKit000001',
    speaker: 'Concurrency Kit',
    note: 'plain',
  },
};

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let virtualNetwork: VirtualNetwork;
  let engine: IndexQueryEngine;
  let talkKey: string;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    virtualNetwork = new VirtualNetwork();
    engine = new IndexQueryEngine(
      adapter,
      makeDefinitionLookup(),
      virtualNetwork,
    );
    talkKey = internalKeyFor(talkRef, undefined, virtualNetwork);
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    for (let [name, data] of Object.entries(corpus)) {
      let cardURL = new URL(url(name));
      await batch.updateEntry(cardURL, {
        type: 'instance',
        resource: {
          id: rri(cardURL.href),
          type: 'card',
          attributes: {},
          meta: { adoptsFrom: { module: rri(talkRef.module), name: 'Talk' } },
        },
        lastModified: Date.now(),
        resourceCreatedAt: Date.now(),
        searchData: {
          ...data,
          [SEARCH_TEXT_KEY]: searchTextFor(data),
          // What the render stamps for type-ahead: the card's title.
          _typeahead: data.title,
        },
        markdown: `# ${data.title}\n\n${data.speaker}\n\n${data.text}`,
        deps: new Set(),
        displayNames: ['Talk'],
        types: [talkKey],
        isolatedHtml: `<div>${name}</div>`,
      });
    }
    await batch.done();
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  const on = talkRef;
  async function ids(query: Query) {
    let { cards } = await engine.searchCards(new URL(testRealm), query);
    return cards.map((card) => String(card.id).split('/').pop()).sort();
  }

  test("the word list holds the typo fields' and titles' words", async function (assert) {
    let rows = (await adapter.execute(
      `SELECT word FROM boxel_index_words WHERE realm_url = $1 ORDER BY word`,
      { bind: [testRealm] },
    )) as { word: string }[];
    let words = rows.map((r) => r.word);
    for (let word of ['kleppmann', 'matsakis', 'cryptocurrency', 'club']) {
      assert.true(words.includes(word), `a typos field's word: ${word}`);
    }
    for (let word of ['ownership', 'practice', 'ledgers', 'patterns']) {
      assert.true(words.includes(word), `a title's word: ${word}`);
    }
    assert.false(
      words.includes('in'),
      'words under three letters are left out',
    );
  });

  test('type-ahead (prefix, title scope) with typos: a misspelt title word still suggests the card', async function (assert) {
    assert.deepEqual(
      await ids({
        filter: { on, prefix: true, scope: 'title', matches: 'ownrship' },
      }),
      [],
      'without the flag a misspelling suggests nothing',
    );
    assert.deepEqual(
      await ids({
        filter: {
          on,
          prefix: true,
          scope: 'title',
          matches: 'ownrship',
          typos: true,
        },
      }),
      ['rust.json'],
      'a fully typed misspelling is corrected',
    );
    assert.deepEqual(
      await ids({
        filter: {
          on,
          prefix: true,
          scope: 'title',
          matches: 'ownrship in prac',
          typos: true,
        },
      }),
      ['rust.json'],
      'the last word still matches as a prefix',
    );
    assert.deepEqual(
      await ids({
        filter: {
          on,
          prefix: true,
          scope: 'title',
          matches: 'concurency',
          typos: true,
        },
      }),
      ['go.json'],
      'concurrency patterns, and not the cryptocurrency card',
    );
  });

  test('a word still being typed takes corrections only from five letters', async function (assert) {
    for (let partial of ['k', 'kl', 'kle', 'klep']) {
      assert.deepEqual(
        await ids({
          filter: { on, matches: partial, prefix: true, typos: true },
        }),
        await ids({ filter: { on, matches: partial, prefix: true } }),
        `"${partial}" matches exactly as without typos`,
      );
      assert.deepEqual(
        await ids({
          filter: {
            on,
            prefix: true,
            scope: 'title',
            matches: partial,
            typos: true,
          },
        }),
        await ids({
          filter: { on, prefix: true, scope: 'title', matches: partial },
        }),
        `type-ahead "${partial}" matches exactly as without typos`,
      );
    }
    assert.deepEqual(
      await ids({
        filter: { on, matches: 'kleppman', prefix: true, typos: true },
      }),
      ['crdt.json'],
      'a long partial is corrected as well as prefix-matched',
    );
    assert.deepEqual(
      await ids({
        filter: { on, matches: 'martn klepp', prefix: true, typos: true },
      }),
      ['crdt.json'],
      'a finished word is corrected; a short partial stays a prefix',
    );
    assert.deepEqual(
      await ids({
        filter: {
          on,
          prefix: true,
          scope: 'title',
          matches: 'concurency',
          typos: true,
        },
      }),
      ['go.json'],
    );
  });

  test('typo budget and edit distance', function (assert) {
    assert.strictEqual(typoBudget('rob'), 0, 'under four letters: none');
    assert.strictEqual(typoBudget('kleppman'), 2, 'eight letters: two');
    assert.strictEqual(typoBudget('pike'), 1);
    assert.strictEqual(editDistance('kleppman', 'kleppmann'), 1);
    assert.strictEqual(editDistance('teh', 'the'), 1, 'a swap is one edit');
    assert.true(editDistance('concurency', 'cryptocurrency') > 2);
    assert.deepEqual(
      typoCorrections('concurency', [
        'cryptocurrency',
        'concurrency',
        'concurrent',
      ]),
      ['concurrency'],
      'concurrent is three edits away',
    );
    assert.deepEqual(typoCorrections('rob', ['bob']), [], 'no budget');
  });

  test('the wire grammar checks typos, pattern and regex', function (assert) {
    assert.throws(
      () => assertQuery({ filter: { eq: { title: 'x' }, typos: true } }),
      /typos belongs beside matches/,
    );
    assert.throws(
      () => assertQuery({ filter: { pattern: { vid: '' } } }),
      /non-empty string/,
    );
    assert.throws(
      () => assertQuery({ filter: { regex: {} } }),
      /needs a field/,
    );
    assert.throws(
      () => assertQuery({ filter: { matches: 'x', typoQuery: 'x' } as never }),
      /set by the engine/,
    );
    assertQuery({ filter: { matches: 'x', typos: true } });
    assert.ok(true, 'typos beside matches is accepted');
  });
});
