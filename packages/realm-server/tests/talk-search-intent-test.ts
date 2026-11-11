import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  hasWarning,
  rri,
  type Query,
  type Realm,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import {
  setupPermissionedRealmCached,
  searchCardsForTest,
} from './helpers/index.ts';

// Search intent end to end on a recorded-talk card (`Moment`, hinted the way
// docs/search-intent.md's talk library is): the real
// render stamps each field's role, typo words and pattern values, the real
// index writer turns them into the weighted vector, the word list and
// `pattern_text`, and every query runs through the search-entry wire grammar
// the host and the CLI use.

const momentSource = `
  import {
    contains,
    containsMany,
    field,
    linksToMany,
    CardDef,
    FieldDef,
  } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import NumberField from "@cardstack/base/number";

  export class Concept extends CardDef {
    static displayName = 'Concept';
    @field name = contains(StringField, { search: { role: 'title' } });
    @field definition = contains(StringField);
    @field cardTitle = contains(StringField, {
      computeVia: function (this: Concept) {
        return this.name;
      },
    });
  }

  export class TranscriptSegment extends FieldDef {
    @field start = contains(NumberField);
    @field text = contains(StringField);
  }

  export class Moment extends CardDef {
    static displayName = 'Moment';
    static searchDefaults = {
      title: 'videoTitle',
      rank: { popularity: 'hnScore', recency: 'lastDiscussed' },
    };
    @field vid = contains(StringField, {
      search: { role: 'identifier', patterns: true },
    });
    @field videoTitle = contains(StringField);
    @field channel = contains(StringField, {
      search: { role: 'label', facet: true },
    });
    @field speakers = containsMany(StringField, {
      search: { role: 'name', facet: true, typos: true },
    });
    @field quote = contains(StringField, { search: { role: 'note' } });
    @field hnScore = contains(NumberField, {
      search: { rank: 'popularity', facet: true },
    });
    @field lastDiscussed = contains(NumberField, {
      search: { rank: 'recency', facet: true },
    });
    @field start = contains(NumberField, { search: false });
    @field segments = containsMany(TranscriptSegment, {
      search: { role: 'body' },
    });
    @field concepts = linksToMany(() => Concept, {
      searchable: true,
      search: { facet: true },
    });
    @field cardTitle = contains(StringField, {
      computeVia: function (this: Moment) {
        return this.videoTitle;
      },
    });
  }
`;

const JAN = 1704067200; // 2024-01-01, seconds
const MAR = 1709251200; // 2024-03-01
const JUN = 1717200000; // 2024-06-01

interface MomentData {
  vid: string;
  videoTitle: string;
  channel: string;
  speakers: string[];
  quote: string;
  hnScore: number;
  lastDiscussed: number;
  start: number;
  segments: { start: number; text: string }[];
}

const moments: Record<string, MomentData> = {
  'local-first': {
    vid: 'Exg8rMSvOkE',
    videoTitle: 'CRDTs: The Hard Parts',
    channel: 'Hydra',
    speakers: ['Martin Kleppmann'],
    quote: 'sync is hard',
    hnScore: 412,
    lastDiscussed: JUN,
    start: 61,
    segments: [
      { start: 0, text: 'conflict-free replicated data types merge edits' },
      { start: 90, text: 'interleaving text edits is the hard part' },
    ],
  },
  'simple-made-easy': {
    vid: 'SxdOUGdseq4',
    videoTitle: 'Simple Made Easy',
    channel: 'Strange Loop',
    speakers: ['Rich Hickey'],
    quote: 'simple is not easy',
    hnScore: 980,
    lastDiscussed: MAR,
    start: 0,
    segments: [
      { start: 0, text: 'complecting things together' },
      {
        start: 300,
        text: 'a CRDT is mentioned in passing, and CRDTs again, and once more crdt',
      },
    ],
  },
  wat: {
    vid: 'FqhZZNUyVFM',
    videoTitle: 'Wat',
    channel: 'CodeMash',
    speakers: ['Gary Bernhardt'],
    quote: 'javascript surprises',
    hnScore: 650,
    lastDiscussed: JAN,
    start: 12,
    segments: [{ start: 0, text: 'a lightning talk about javascript' }],
  },
  'turning-the-database': {
    vid: 'fU9hR3kiOK0',
    videoTitle: 'Turning the database inside out',
    channel: 'Strange Loop',
    speakers: ['Martin Kleppmann'],
    quote: 'streams',
    hnScore: 300,
    lastDiscussed: JAN,
    start: 5,
    segments: [{ start: 0, text: 'event sourcing and stream processing' }],
  },
};

const concepts: Record<string, { name: string; definition: string }> = {
  crdt: {
    name: 'CRDT',
    definition: 'a replicated data type that merges without conflicts',
  },
  'event-sourcing': {
    name: 'Event sourcing',
    definition: 'storing changes as an append-only log of events',
  },
  simplicity: { name: 'Simplicity', definition: 'one fold, one braid' },
};

// Which concepts each talk links to.
const momentConcepts: Record<string, string[]> = {
  'local-first': ['crdt'],
  'simple-made-easy': ['simplicity'],
  'turning-the-database': ['event-sourcing', 'crdt'],
};

function fileSystem() {
  let files: Record<string, unknown> = { 'moment.gts': momentSource };
  for (let [name, attributes] of Object.entries(concepts)) {
    files[`Concept/${name}.json`] = {
      data: {
        attributes,
        meta: { adoptsFrom: { module: rri('../moment'), name: 'Concept' } },
      },
    };
  }
  for (let [name, attributes] of Object.entries(moments)) {
    let linked = momentConcepts[name] ?? [];
    files[`Moment/${name}.json`] = {
      data: {
        attributes,
        relationships: Object.fromEntries(
          linked.map((concept, index) => [
            `concepts.${index}`,
            { links: { self: `../Concept/${concept}` } },
          ]),
        ),
        meta: { adoptsFrom: { module: rri('../moment'), name: 'Moment' } },
      },
    };
  }
  return files;
}

module(basename(import.meta.filename), function () {
  module('talk search intent', function (hooks) {
    let testRealm: Realm;
    let dbAdapter: PgAdapter;
    let realmHref: string;

    setupPermissionedRealmCached(hooks, {
      realmURL: new URL('http://127.0.0.1:4444/talks/'),
      permissions: { '*': ['read'] },
      fileSystem: fileSystem() as never,
      onRealmSetup(args: { testRealm: Realm; dbAdapter: PgAdapter }) {
        testRealm = args.testRealm;
        dbAdapter = args.dbAdapter;
        realmHref = new URL(testRealm.url).href;
      },
    });

    let moment = (): ResolvedCodeRef => ({
      module: rri(`${realmHref}moment`),
      name: 'Moment',
    });
    let idOf = (name: string) => rri(`${realmHref}Moment/${name}`);

    async function search(query: Query) {
      return await searchCardsForTest(testRealm.realmIndexQueryEngine, query);
    }
    async function ids(query: Query) {
      return (await search(query)).data.map((card) => card.id);
    }

    test('the index stores what the declarations say', async function (assert) {
      let rows = (await dbAdapter.execute(
        `SELECT search_doc, pattern_text,
                ts_filter(search_tsv, '{a}')::text AS title_words
           FROM boxel_index WHERE url = $1 AND type = 'instance'`,
        {
          bind: [`${idOf('local-first')}.json`],
          coerceTypes: { search_doc: 'JSON' },
        },
      )) as {
        search_doc: Record<string, unknown>;
        pattern_text: string | null;
        title_words: string;
      }[];
      assert.strictEqual(rows.length, 1, 'the talk is indexed');
      let [row] = rows;
      assert.false('start' in row.search_doc, 'search: false leaves it out');
      assert.false('_searchText' in row.search_doc, 'no tiered text is kept');
      assert.strictEqual(row.pattern_text, 'Exg8rMSvOkE');
      assert.true(
        row.title_words.includes("'crdts'"),
        `the title carries weight A: ${row.title_words}`,
      );
      assert.true(
        row.title_words.includes("'kleppmann'"),
        `a speaker's name carries weight A: ${row.title_words}`,
      );
      let words = (await dbAdapter.execute(
        `SELECT word FROM boxel_index_words WHERE realm_url = $1 ORDER BY word`,
        { bind: [realmHref] },
      )) as { word: string }[];
      let listed = words.map((w) => w.word);
      for (let word of ['kleppmann', 'hickey', 'bernhardt']) {
        assert.true(listed.includes(word), `a speaker's word: ${word}`);
      }
      for (let word of ['crdts', 'simple', 'database']) {
        assert.true(listed.includes(word), `a title's word: ${word}`);
      }
    });

    // "CRDTs", not "crdt": Postgres's English stemmer keeps "crdts" whole, so
    // the singular would not match the plural.
    test('a title match outranks a transcript that repeats the word', async function (assert) {
      assert.deepEqual(
        await ids({
          filter: { on: moment(), matches: 'CRDTs' },
          sort: [{ by: '_relevance', weights: { popularity: 0, recency: 0 } }],
        }),
        [idOf('local-first'), idOf('simple-made-easy')],
      );
      assert.deepEqual(
        await ids({
          filter: { on: moment(), matches: 'CRDTs', scope: 'title' },
        }),
        [idOf('local-first')],
        "scope: 'title' leaves out the transcript-only match",
      );
    });

    test('_relevance without a term ranks by the declared signals', async function (assert) {
      assert.deepEqual(
        await ids({
          filter: { type: moment() },
          sort: [{ by: '_relevance', weights: { recency: 0 } }],
        }),
        [
          idOf('simple-made-easy'),
          idOf('wat'),
          idOf('local-first'),
          idOf('turning-the-database'),
        ],
        'by hnScore, the popularity signal',
      );
    });

    test('a misspelt speaker still matches', async function (assert) {
      assert.deepEqual(
        (
          await ids({
            filter: { on: moment(), matches: 'kleppman', typos: true },
          })
        ).sort(),
        [idOf('local-first'), idOf('turning-the-database')].sort(),
      );
      assert.deepEqual(
        await ids({ filter: { on: moment(), matches: 'hicky', typos: true } }),
        [idOf('simple-made-easy')],
      );
    });

    test("searchable: a link carries its id and the linked card's own fields", async function (assert) {
      let [row] = (await dbAdapter.execute(
        `SELECT search_doc FROM boxel_index WHERE url = $1 AND type = 'instance'`,
        {
          bind: [`${idOf('turning-the-database')}.json`],
          coerceTypes: { search_doc: 'JSON' },
        },
      )) as { search_doc: Record<string, unknown> }[];
      let carried = row.search_doc.concepts as Record<string, unknown>[];
      assert.deepEqual(
        carried.map(({ id, name, definition }) => ({ id, name, definition })),
        [
          {
            id: `${realmHref}Concept/event-sourcing`,
            name: 'Event sourcing',
            definition: 'storing changes as an append-only log of events',
          },
          {
            id: `${realmHref}Concept/crdt`,
            name: 'CRDT',
            definition: 'a replicated data type that merges without conflicts',
          },
        ],
      );
    });

    test('a positive eq or in through a list is the index match alone, with no list walk', async function (assert) {
      let statements: string[] = [];
      let execute = dbAdapter.execute.bind(dbAdapter);
      (dbAdapter as any).execute = async (sql: string, ...rest: unknown[]) => {
        statements.push(String(sql));
        return await (execute as any)(sql, ...rest);
      };
      try {
        assert.deepEqual(
          (
            await ids({
              filter: { on: moment(), eq: { 'concepts.name': 'CRDT' } },
            })
          ).sort(),
          [idOf('local-first'), idOf('turning-the-database')].sort(),
          'eq finds the cards',
        );
        assert.deepEqual(
          (
            await ids({
              filter: { on: moment(), in: { 'concepts.name': ['CRDT'] } },
            })
          ).sort(),
          [idOf('local-first'), idOf('turning-the-database')].sort(),
          'in finds the same cards',
        );
      } finally {
        (dbAdapter as any).execute = execute;
      }
      let searches = statements.filter((s) => /FROM boxel_index/.test(s));
      assert.ok(searches.length > 0, 'the searches ran SQL');
      assert.notOk(
        searches.some((s) => /jsonb_tree/.test(s)),
        'no statement joins a jsonb_tree walk of the list',
      );
    });

    test('a plain page is an ordered LIMIT, and says whether more follows without counting', async function (assert) {
      let all = await ids({ filter: { type: moment() } });
      assert.ok(all.length >= 2, 'the fixture has at least two moments');
      let statements: string[] = [];
      let execute = dbAdapter.execute.bind(dbAdapter);
      (dbAdapter as any).execute = async (sql: string, ...rest: unknown[]) => {
        statements.push(String(sql));
        return await (execute as any)(sql, ...rest);
      };
      let newest, exact, whole;
      try {
        newest = await search({
          filter: { type: moment() },
          sort: [{ by: 'lastModified', direction: 'desc' }],
          page: { size: 1, total: 'none' },
        } as Query);
        exact = await search({
          filter: { type: moment() },
          sort: [{ by: 'lastModified', direction: 'desc' }],
          page: { size: 1 },
        } as Query);
        whole = await search({
          filter: { type: moment() },
          page: { size: all.length + 5, total: 'none' },
        } as Query);
      } finally {
        (dbAdapter as any).execute = execute;
      }
      assert.strictEqual(newest.data.length, 1, 'one row on the page');
      assert.true(newest.meta.page.hasMore, 'more follows the first row');
      assert.true(
        hasWarning(newest.meta, 'total-estimated'),
        "total: 'none' reports a lower bound",
      );
      assert.strictEqual(
        exact.meta.page.total,
        all.length,
        'the default total counts every match',
      );
      assert.notOk(
        hasWarning(exact.meta, 'total-estimated'),
        'the default total is exact',
      );
      assert.false(
        whole.meta.page.hasMore,
        'a page holding every match has no next page',
      );
      assert.strictEqual(
        whole.meta.page.total,
        all.length,
        'and is counted exactly from its own rows',
      );
      let searches = statements.filter((s) => /FROM boxel_index/.test(s));
      assert.ok(searches.length > 0, 'the searches ran SQL');
      assert.notOk(
        searches.some(
          (s) =>
            /MATERIALIZED|GROUP BY i\.url, i\.type\s*\)?\s*(SELECT|ORDER)/.test(
              s,
            ) && /LIMIT 2 OFFSET/.test(s),
        ),
        'the page query neither materializes nor groups',
      );
      assert.ok(
        searches.some(
          (s) =>
            /ORDER BY .*LIMIT 2 OFFSET 0/s.test(s) &&
            !/GROUP BY/.test(s.split('ORDER BY')[0]),
        ),
        'the page is read one row past its size, ungrouped',
      );
      assert.strictEqual(
        searches.filter((s) => /SELECT COUNT\(\*\)/.test(s)).length,
        1,
        "only the default page counted its matches; 'none' and the whole page did not",
      );
    });

    test("searchable: a filter reads the linked card's fields, and nothing it does not have", async function (assert) {
      assert.deepEqual(
        (
          await ids({
            filter: { on: moment(), eq: { 'concepts.name': 'CRDT' } },
          })
        ).sort(),
        [idOf('local-first'), idOf('turning-the-database')].sort(),
      );
      assert.deepEqual(
        (
          await ids({
            filter: {
              on: moment(),
              contains: { 'concepts.definition': 'merges' },
            },
          })
        ).sort(),
        [idOf('local-first'), idOf('turning-the-database')].sort(),
        'any field of the linked card is answerable',
      );
      await assert.rejects(
        search({
          filter: { on: moment(), eq: { 'concepts.nope': 'x' } },
        }),
        /nonexistent field|unknown/i,
        'a field the linked card does not have is refused',
      );
    });

    test('a link facet counts by id and labels each value with its title', async function (assert) {
      let { meta } = await search({
        filter: {
          every: [
            { type: moment() },
            {
              on: moment(),
              eq: { 'concepts.id': `${realmHref}Concept/simplicity` },
            },
          ],
        },
        facets: [{ by: 'concepts', own: 'ignore' }],
      });
      assert.strictEqual(meta.page.total, 1, 'the selection, by id');
      assert.deepEqual(meta.facets?.concepts, [
        { value: `${realmHref}Concept/crdt`, count: 2, label: 'CRDT' },
        {
          value: `${realmHref}Concept/event-sourcing`,
          count: 1,
          label: 'Event sourcing',
        },
        {
          value: `${realmHref}Concept/simplicity`,
          count: 1,
          label: 'Simplicity',
        },
      ]);
    });

    test('the search pane: facets by declaration, the channel list multi-select', async function (assert) {
      let { meta } = await search({
        filter: {
          every: [
            { type: moment() },
            { on: moment(), in: { channel: ['Strange Loop'] } },
          ],
        },
        sort: [{ by: '_relevance' }],
        facets: [
          { by: 'channel', own: 'ignore' },
          { by: 'speakers' },
          { by: 'hnScore' },
          { by: 'lastDiscussed', interval: 'month' },
        ],
      });
      assert.strictEqual(meta.page.total, 2, 'two Strange Loop talks');
      assert.deepEqual(
        meta.facets?.channel,
        [
          { value: 'Strange Loop', count: 2 },
          { value: 'CodeMash', count: 1 },
          { value: 'Hydra', count: 1 },
        ],
        'the channel list keeps its other values while one is picked',
      );
      assert.deepEqual(meta.facets?.speakers, [
        { value: 'Martin Kleppmann', count: 1 },
        { value: 'Rich Hickey', count: 1 },
      ]);
      assert.deepEqual(
        meta.facets?.hnScore,
        [
          { value: '200-400', count: 1 },
          { value: '400-600', count: 0 },
          { value: '600-800', count: 0 },
          { value: '800-1000', count: 1 },
        ],
        'a declared number facet comes back as buckets',
      );
      assert.deepEqual(
        {
          min: meta.facetStats?.hnScore?.min,
          max: meta.facetStats?.hnScore?.max,
        },
        { min: 300, max: 980 },
      );
      assert.deepEqual(
        meta.facets?.lastDiscussed,
        [
          { value: '2024-01-01', count: 1 },
          { value: '2024-03-01', count: 1 },
        ],
        'a number holding a timestamp counts by month when the query names an interval',
      );
    });
  });
});
