import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  type Expression,
  expressionToSql,
  param,
} from '@cardstack/runtime-common/expression';
import {
  dialectFor,
  hotDoc,
} from '@cardstack/runtime-common/query-engine/dialect';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
} from './helpers/index.ts';
import { syncSeededValueStore } from './helpers/seed-index-rows.ts';

// A read of the search doc at a path is served from the row's `search_keys`
// (the hot projection of its doc that add-boxel-index-search-keys generates)
// wherever it holds the doc's value there, and from the doc wherever it does
// not. These tests hold both reads the engine makes to the doc's own: a
// field's value (`docRead`, as text and as a number) and a list's tree
// (`jsonb_tree` at the list's root), for every path of a set of docs that
// covers each kind of value the projection keeps or cuts: numbers, numeric
// strings, booleans, JSON null and a missing key, strings around the 256-byte
// cut (in one-byte and two-byte characters), lists around the 512-byte cut
// (order, duplicates, objects in lists, an empty list), nested objects, an
// object holding the marker's own shape, docs over the 3,000-byte budget
// (whose largest values are marked), and paths into lists by index (which
// read the doc).

const pg = dialectFor('pg');

// Strings `n` bytes long, of one-byte and of two-byte characters.
const ascii = (n: number) => 'a'.repeat(n);
const twoByte = (n: number) =>
  'é'.repeat(Math.floor(n / 2)) + 'a'.repeat(n % 2);

const fixedDocs: unknown[] = [
  {},
  {
    n: 1,
    f: 1.5,
    neg: -2,
    exp: 1e21, // the double nearest 12345678901234567890
    big: 12345678901234567168,
    z: 0,
  },
  { s: '12', t: ' 3.5 ', u: '1e3', v: '-0', w: 'twelve', e: '' },
  { yes: true, no: false, nil: null },
  {
    a255: ascii(255),
    a256: ascii(256),
    a257: ascii(257),
    e255: twoByte(255),
    e256: twoByte(256),
    e257: twoByte(257),
  },
  {
    item: {
      hnScore: 8.5,
      title: 'Talk',
      deep: { deeper: { n: 3, s: ascii(300), nil: null } },
      empty: {},
    },
  },
  { marker: { $doc: true }, $doc: true, odd: { $doc: 'x' } },
  {
    list: [1, 2, 3],
    objs: [{ name: 'a' }, { name: 'b' }],
    nested: { tags: ['x', 'y'], rows: [{ n: 1 }] },
    emptyList: [],
  },
  { cardTitle: 'Title', cardInfo: { metrics: { score: 16.5, count: 3 } } },
  { 'dot.key': 1, 'with space': 'x', '0': 'zero', '-1': 'minus' },
  {
    ordered: [3, 1, 2, 1, 3],
    dupes: ['a', 'a', 'b', 'a'],
    mixed: [1, 'one', true, null, { k: 'v' }, [1, [2]]],
    people: [
      { name: 'Ann', tags: ['x'] },
      { name: 'Bo', age: 3 },
    ],
    empty: [],
    nothing: null,
  },
  {
    // lists around the 512-byte cut: their JSON is 512 and 513 bytes
    at512: [ascii(508)],
    at513: [ascii(509)],
    many: Array.from({ length: 200 }, (_, i) => i),
  },
  // over the budget: the largest values are marked until the rest fits
  Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [`s${i}`, ascii(150 + i * 5)]),
  ),
  Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [
      `l${i}`,
      Array.from({ length: 60 + i }, (_, j) => `w${j}`),
    ]),
  ),
  {
    deep: { a: { b: { c: [ascii(100), ascii(100)], d: ascii(250) } } },
    more: Array.from({ length: 10 }, () => ascii(180)),
  },
  // the shape of a theme card: objects of many short values, which marking
  // strings and lists cannot bring under the budget, so whole objects go
  {
    cardTitle: 'Theme',
    typography: Object.fromEntries(
      ['body', 'label', 'caption', 'eyebrow', 'heading', 'sub'].map((k) => [
        k,
        {
          fontSize: '0.9rem',
          fontWeight: '700',
          lineHeight: '1.2',
          sampleText: 'Add to cart',
        },
      ]),
    ),
    rootVariables: Object.fromEntries(
      Array.from({ length: 120 }, (_, i) => [`colorName${i}`, '#FFFFFF']),
    ),
    darkModeVariables: {},
  },
  // many short values at the top: only the whole projection fits
  Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, i])),
  // over the budget with the framework's own fields among the largest
  {
    id: `https://example.test/${ascii(200)}`,
    cardTitle: ascii(240),
    _title: ascii(240),
    ...Object.fromEntries(
      Array.from({ length: 16 }, (_, i) => [`f${i}`, ascii(190)]),
    ),
  },
];

// A seeded generator of nested docs, so a failure reproduces.
function generatedDocs(count: number, seed = 7): unknown[] {
  let state = seed;
  let next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  let pick = <T>(xs: T[]) => xs[Math.floor(next() * xs.length)];
  let value = (depth: number): unknown => {
    let kind = pick([
      'int',
      'float',
      'numstr',
      'bool',
      'null',
      'short',
      'edge',
      'long',
      'array',
      'biglist',
      'object',
    ]);
    switch (kind) {
      case 'int':
        return Math.floor(next() * 2000) - 1000;
      case 'float':
        return Math.round(next() * 1e6) / 1000;
      case 'numstr':
        return pick(['7', '0.25', ' 42 ', '1e-3', '-5', '3.']);
      case 'bool':
        return next() < 0.5;
      case 'null':
        return null;
      case 'short':
        return pick(['', 'x', 'hello world', 'Ünïcödé']);
      case 'edge':
        return pick([ascii, twoByte])(255 + Math.floor(next() * 3));
      case 'long':
        return ascii(400 + Math.floor(next() * 400));
      case 'array':
        return Array.from({ length: Math.floor(next() * 3) }, () =>
          depth < 3 ? value(depth + 1) : 1,
        );
      case 'biglist':
        return Array.from({ length: 20 + Math.floor(next() * 80) }, (_, i) =>
          pick([i, `w${i}`, { n: i }]),
        );
      default:
        return depth < 3 ? object(depth + 1) : {};
    }
  };
  let object = (depth: number) =>
    Object.fromEntries(
      Array.from({ length: 1 + Math.floor(next() * 9) }, (_, i) => [
        pick(['a', 'b', 'c', 'score', 'item', 'name']) + i,
        value(depth),
      ]),
    );
  return Array.from({ length: count }, () => object(0));
}

// Every path to a member of an object in `doc` (stepping into arrays through
// their elements' keys, and by index), plus a missing key under each.
function pathsOf(doc: unknown): string[][] {
  let paths: string[][] = [['missing']];
  let walk = (v: unknown, at: string[]) => {
    if (Array.isArray(v)) {
      paths.push([...at, '0'], [...at, 'missing']);
      v.forEach((e, i) => walk(e, [...at, String(i)]));
      for (let e of v) {
        if (e && typeof e === 'object' && !Array.isArray(e)) {
          for (let k of Object.keys(e)) paths.push([...at, k]);
        }
      }
    } else if (v && typeof v === 'object') {
      if (at.length) paths.push([...at, 'missing']);
      for (let [k, child] of Object.entries(v)) {
        paths.push([...at, k]);
        walk(child, [...at, k]);
      }
    }
  };
  walk(doc, []);
  return paths;
}

// The doc read the projection replaces: `search_doc -> … ->> 'last'`.
function docOnlyRead(names: string[]): Expression {
  return [
    'search_doc',
    ...names.flatMap((name, i) => [
      i < names.length - 1 ? '->' : '->>',
      param(name),
    ]),
  ];
}

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  // For each doc, each path: the keys read and the doc read, as text and as a
  // number, over a row whose `search_keys` is generated as production's is.
  async function mismatches(docs: unknown[]) {
    let wrong: string[] = [];
    let checked = 0;
    for (let doc of docs) {
      for (let names of pathsOf(doc)) {
        let keysRead = pg.docRead(names);
        let { text, values } = expressionToSql('pg', [
          'SELECT (',
          ...keysRead,
          ') AS k, (',
          ...docOnlyRead(names),
          ') AS d, (',
          ...pg.numericField(keysRead),
          ')::text AS kn, (',
          ...pg.numericField(docOnlyRead(names)),
          ')::text AS dn FROM (SELECT d AS search_doc, search_keys_of(d) AS search_keys FROM (SELECT',
          param(JSON.stringify(doc)),
          '::jsonb AS d) AS x) AS i',
        ]);
        let [row] = (await adapter.execute(text, { bind: values })) as {
          k: string | null;
          d: string | null;
          kn: string | null;
          dn: string | null;
        }[];
        checked++;
        let tree = (column: string) => [
          `(SELECT array_agg(t ORDER BY t) FROM (SELECT (x.fullkey, x.jsonb_value, x.text_value, x.level)::text AS t FROM jsonb_tree(${column},`,
          param(`$.${names.join('.')}`),
          ') AS x) AS q)',
        ];
        let lists = expressionToSql('pg', [
          'SELECT (',
          ...tree(hotDoc('pg', names)),
          ') IS NOT DISTINCT FROM (',
          ...tree('search_doc'),
          ') AS same FROM (SELECT d AS search_doc, search_keys_of(d) AS search_keys FROM (SELECT',
          param(JSON.stringify(doc)),
          '::jsonb AS d) AS x) AS i',
        ]);
        let [{ same }] = (await adapter.execute(lists.text, {
          bind: lists.values,
        })) as { same: boolean }[];
        if (!same) {
          wrong.push(
            `tree ${JSON.stringify(names)} in ${JSON.stringify(doc).slice(0, 120)}`,
          );
        }
        if (row.k !== row.d || row.kn !== row.dn) {
          wrong.push(
            `${JSON.stringify(names)} in ${JSON.stringify(doc).slice(0, 120)}: keys ${JSON.stringify([row.k, row.kn])}, doc ${JSON.stringify([row.d, row.dn])}`,
          );
        }
      }
    }
    return { wrong, checked };
  }

  test('the keys read equals the doc read at every path of the fixed docs', async function (assert) {
    let { wrong, checked } = await mismatches(fixedDocs);
    assert.deepEqual(wrong, [], `${checked} paths read the same`);
    assert.ok(checked > 80, `${checked} paths checked`);
  });

  test('the keys read equals the doc read at every path of generated docs', async function (assert) {
    let { wrong, checked } = await mismatches(generatedDocs(200));
    assert.deepEqual(wrong, [], `${checked} paths read the same`);
    assert.ok(checked > 1000, `${checked} paths checked`);
  });

  async function keysOf(doc: unknown) {
    let [{ keys }] = (await adapter.execute(
      `SELECT search_keys_of($1::jsonb) AS keys`,
      { bind: [JSON.stringify(doc)] },
    )) as { keys: Record<string, unknown> }[];
    return keys;
  }
  const marker = { $doc: true };

  test('the projection keeps strings to 256 bytes and lists to 512, as they are', async function (assert) {
    assert.deepEqual(await keysOf(fixedDocs[4]), {
      a255: ascii(255),
      a256: ascii(256),
      a257: marker,
      e255: twoByte(255),
      e256: twoByte(256),
      e257: marker,
    });
    assert.deepEqual(
      await keysOf(fixedDocs[10]),
      fixedDocs[10],
      'small lists keep their order, duplicates, nested objects and lists, and an empty list stays empty',
    );
    let lists = await keysOf(fixedDocs[11]);
    assert.deepEqual(
      lists.at512,
      (fixedDocs[11] as any).at512,
      '512 bytes is kept',
    );
    assert.deepEqual(lists.at513, marker, '513 bytes is marked');
    assert.deepEqual(lists.many, marker, 'a long list is marked');
  });

  test('a projection over the budget marks its largest values until it fits', async function (assert) {
    for (let doc of [fixedDocs[12], fixedDocs[13], fixedDocs[14]]) {
      let keys = await keysOf(doc);
      let size = Buffer.byteLength(
        (
          (await adapter.execute(`SELECT $1::jsonb::text AS t`, {
            bind: [JSON.stringify(keys)],
          })) as { t: string }[]
        )[0].t,
      );
      assert.ok(size <= 3000, `projection is ${size} bytes`);
      let marked = Object.entries(keys).filter(
        ([, v]) => JSON.stringify(v) === JSON.stringify(marker),
      );
      assert.ok(marked.length > 0, 'something was marked');
    }
    // the twenty strings of 150 to 245 bytes: the largest go first
    let keys = await keysOf(fixedDocs[12]);
    let markedNames = Object.keys(keys).filter(
      (k) => JSON.stringify(keys[k]) === JSON.stringify(marker),
    );
    let largest = Object.keys(fixedDocs[12] as object)
      .sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)))
      .slice(0, markedNames.length);
    assert.deepEqual(markedNames.sort(), largest.sort());
  });

  test('no projection is over the budget', async function (assert) {
    let docs = [...fixedDocs, ...generatedDocs(200)];
    let over: string[] = [];
    for (let doc of docs) {
      let [{ bytes }] = (await adapter.execute(
        `SELECT octet_length(search_keys_of($1::jsonb)::text) AS bytes`,
        { bind: [JSON.stringify(doc)] },
      )) as { bytes: number }[];
      if (Number(bytes) > 3000) {
        over.push(`${bytes} bytes: ${JSON.stringify(doc).slice(0, 80)}`);
      }
    }
    assert.deepEqual(over, []);
    assert.deepEqual(
      await keysOf(fixedDocs[16]),
      marker,
      'a doc of 300 top-level numbers is the marker',
    );
    let framework = await keysOf(fixedDocs[17]);
    let doc17 = fixedDocs[17] as Record<string, unknown>;
    assert.strictEqual(framework.id, doc17.id, 'id is never marked');
    assert.strictEqual(framework.cardTitle, doc17.cardTitle);
    assert.strictEqual(framework._title, doc17._title);
    let theme = await keysOf(fixedDocs[15]);
    assert.strictEqual(theme.cardTitle, 'Theme', 'a short value stays hot');
    assert.deepEqual(
      theme.rootVariables,
      marker,
      'the largest object is marked',
    );
  });

  test('a row with the widest projection is stored, whatever else it holds', async function (assert) {
    // search_keys is PLAIN, so it is never moved out of line: a row holds it
    // whole. The widest projection the budget allows, beside a value in
    // every other column, must still fit a page.
    let wide = Object.fromEntries(
      Array.from({ length: 210 }, (_, i) => [`k${i}`, i % 2 ? true : null]),
    );
    let doc = { ...wide, id: 'x' };
    let big = 'y'.repeat(20000);
    let url = 'http://test-realm/wide/' + 'u'.repeat(2000);
    // A value in every column the table has: the key columns, the doc, and a
    // large value in each other text or JSON column.
    let columns = (await adapter.execute(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'boxel_index' AND is_generated = 'NEVER'`,
    )) as { column_name: string; data_type: string }[];
    let fixed: Record<string, string | number | boolean> = {
      url,
      file_alias: url,
      type: 'instance',
      generation: 1,
      realm_url: 'http://test-realm/wide/',
      has_error: false,
      search_doc: JSON.stringify(doc),
    };
    let names: string[] = [];
    let slots: string[] = [];
    let values: (string | number | boolean)[] = [];
    for (let { column_name: name, data_type: type } of columns) {
      let value =
        name in fixed
          ? fixed[name]
          : type === 'jsonb'
            ? JSON.stringify([big])
            : type === 'text' || type === 'character varying'
              ? big
              : undefined;
      // search_keys is the projection under test: the table's trigger fills
      // it from search_doc, as it does for any writer that leaves it out.
      if (value === undefined || name === 'search_keys') continue;
      names.push(name);
      values.push(value);
      slots.push(
        type === 'jsonb' ? `$${values.length}::jsonb` : `$${values.length}`,
      );
    }
    await adapter.execute(
      `INSERT INTO boxel_index (${names.join(', ')}) VALUES (${slots.join(', ')})`,
      { bind: values },
    );
    await syncSeededValueStore(adapter, 'http://test-realm/wide/', [url]);
    let [{ bytes, stored }] = (await adapter.execute(
      `SELECT octet_length(search_keys::text) AS bytes, pg_column_size(search_keys) AS stored FROM boxel_index WHERE realm_url = 'http://test-realm/wide/'`,
    )) as { bytes: number; stored: number }[];
    assert.ok(Number(bytes) > 2500, `projection ${bytes} bytes, over 2500`);
    assert.ok(Number(bytes) <= 3000, `projection ${bytes} bytes, at most 3000`);
    assert.ok(Number(stored) < 8000, `stored ${stored} bytes`);
  });

  test('boxel_index fills search_keys from the search doc', async function (assert) {
    // An ordinary column (row 21a): a trigger fills it from search_doc
    // whenever a statement writes search_doc without it.
    let url = 'http://test-realm/fill/card';
    await adapter.execute(
      `INSERT INTO boxel_index (url, file_alias, type, generation, realm_url, has_error, search_doc)
        VALUES ($1, $1, 'instance', 1, 'http://test-realm/fill/', false, $2::jsonb)`,
      { bind: [url, JSON.stringify({ id: 'x', title: 'A title' })] },
    );
    let [{ same }] = (await adapter.execute(
      `SELECT search_keys IS NOT NULL AND search_keys = search_keys_of(search_doc) AS same
        FROM boxel_index WHERE url = $1`,
      { bind: [url] },
    )) as { same: boolean }[];
    assert.true(same, 'search_keys is the projection of search_doc');
  });
});
