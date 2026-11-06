import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  SEARCH_TEXT_KEY,
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
        searchData: { ...data, [SEARCH_TEXT_KEY]: searchTextFor(data) },
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

  test("the word list holds the typo fields' words", async function (assert) {
    let rows = (await adapter.execute(
      `SELECT word FROM boxel_index_words WHERE realm_url = $1 ORDER BY word`,
      { bind: [testRealm] },
    )) as { word: string }[];
    assert.deepEqual(
      rows.map((r) => r.word),
      ['kleppmann', 'martin', 'matsakis', 'niko', 'pike', 'rob'],
    );
  });

  test('typos: true finds a misspelt word', async function (assert) {
    assert.deepEqual(
      await ids({ filter: { on, matches: 'kleppman' } }),
      [],
      'without the flag a misspelling finds nothing',
    );
    assert.deepEqual(
      await ids({ filter: { on, matches: 'kleppman', typos: true } }),
      ['crdt.json'],
    );
    assert.deepEqual(
      await ids({ filter: { on, matches: 'martn kleppman', typos: true } }),
      ['crdt.json'],
      'every word is widened, and all must match',
    );
    assert.deepEqual(
      await ids({ filter: { on, matches: 'matsakis', typos: true } }),
      ['rust.json'],
      'a correctly spelt word still matches',
    );
    assert.deepEqual(
      await ids({ filter: { on, matches: 'xyzzyq', typos: true } }),
      [],
      'a word with nothing close matches nothing',
    );
  });

  test('pattern: a glob over a pattern field, ignoring case', async function (assert) {
    assert.deepEqual(await ids({ filter: { on, pattern: { vid: 'dQ*' } } }), [
      'crdt.json',
      'rust.json',
    ]);
    assert.deepEqual(await ids({ filter: { on, pattern: { vid: 'dqw4*' } } }), [
      'crdt.json',
    ]);
    assert.deepEqual(
      await ids({ filter: { on, pattern: { vid: '*42???' } } }),
      ['go.json'],
      '? is exactly one character',
    );
    assert.deepEqual(
      await ids({ filter: { on, pattern: { vid: 'dQx9ZZ_*' } } }),
      ['rust.json'],
      'an underscore is literal',
    );
    assert.deepEqual(
      await ids({ filter: { on, pattern: { vid: 'w9WgXcQ' } } }),
      [],
      'a glob matches the whole value',
    );
  });

  test('regex: a regular expression over a pattern field', async function (assert) {
    assert.deepEqual(
      await ids({ filter: { on, regex: { vid: '^dQ[a-z]\\d' } } }),
      ['crdt.json', 'rust.json'],
    );
    assert.deepEqual(await ids({ filter: { on, regex: { vid: 'xyz$' } } }), [
      'go.json',
    ]);
    assert.deepEqual(
      await ids({ filter: { on, not: { regex: { vid: '^dQ' } } } }),
      ['go.json'],
      'a regex negates',
    );
  });

  test('pattern and regex refuse a field not searched by pattern', async function (assert) {
    await assert.rejects(
      engine.searchCards(new URL(testRealm), {
        filter: { on, pattern: { note: 'dQw4*' } },
      }),
      /needs a field searched by pattern/,
    );
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
