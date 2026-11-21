import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  type Expression,
  expressionToSql,
  param,
} from '@cardstack/runtime-common/expression';
import { hotIndexedTest } from '@cardstack/runtime-common/query-engine/dialect';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
} from './helpers/index.ts';

// The containment and jsonpath tests of a field run on `search_keys` (with
// its GIN index, add-boxel-index-search-keys / index-boxel-index-search-keys)
// and fall to the doc only where the projection holds the `$doc` marker at or
// above the path (dialect.ts `hotIndexedTest`). These tests hold each
// rewritten test to the same test of the doc, row for row and under NOT, for
// docs covering what the projection keeps and cuts: scalars, strings at the
// 256-byte cut, lists in and over the 512-byte cut, nested objects, objects
// the budget marks whole, a doc the budget marks entirely, a JSON null doc
// and docs that are not objects; and for each test, values the doc holds and
// one it doesn't.

const ascii = (n: number) => 'a'.repeat(n);

const docs: unknown[] = [
  {},
  { area: 'Software', kind: 'talk', n: 3, yes: true, nil: null },
  { area: ascii(255), long: ascii(257), mid: ascii(256) },
  { tags: ['x', 'y', 'x'], big: Array.from({ length: 80 }, (_, i) => `w${i}`) },
  { item: { area: 'Science', deep: { name: 'Bo', long: ascii(300) } } },
  { list: [{ name: 'a' }, { name: 'b' }], empty: [] },
  // objects the budget marks whole: many short values
  {
    area: 'Design',
    theme: Object.fromEntries(
      Array.from({ length: 150 }, (_, i) => [`c${i}`, '#FFFFFF']),
    ),
    small: { name: 'kept' },
  },
  // a doc the budget marks entirely
  Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, `v${i}`])),
  { $doc: true, area: 'Marker-shaped' },
  null,
  [1, 2],
  'a string doc',
];

// Every path to a string (and to a list of strings) in an object doc.
function stringPaths(doc: unknown): { path: string[]; value: string }[] {
  let out: { path: string[]; value: string }[] = [];
  let walk = (v: unknown, at: string[]) => {
    if (typeof v === 'string' && at.length) out.push({ path: at, value: v });
    else if (Array.isArray(v)) {
      for (let e of v)
        if (typeof e === 'string') out.push({ path: at, value: e });
    } else if (v && typeof v === 'object') {
      for (let [k, child] of Object.entries(v)) walk(child, [...at, k]);
    }
  };
  walk(doc, []);
  return out;
}

// The tests the compiler makes, each as a function of the column it reads.
function testsFor(path: string[], value: string) {
  let nested = path.reduceRight<unknown>((acc, s) => ({ [s]: acc }), value);
  let keys = path.map((x) => `."${x.replace(/"/g, '\\"')}"`).join('');
  return {
    contains: (column: string): Expression => [
      column,
      '@>',
      param(nested as never),
      '::jsonb',
    ],
    containsAny: (column: string): Expression => [
      `${column} @> ANY(ARRAY[`,
      param(nested as never),
      '::jsonb ])',
    ],
    strictPath: (column: string): Expression => [
      `${column} @?`,
      param(`strict $${keys} ? (@ == ${JSON.stringify(value)})`),
      '::jsonpath',
    ],
    laxList: (column: string): Expression => [
      `(${column} @? CAST(`,
      param(`$${keys} ? (@ == ${JSON.stringify(value)})`),
      'AS jsonpath))',
    ],
  };
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

  test('each test on search_keys answers as the same test on the doc', async function (assert) {
    let wrong: string[] = [];
    let checked = 0;
    let candidates = docs.flatMap((doc) => {
      let paths = stringPaths(doc);
      return [
        ...paths.map((p) => ({ doc, ...p })),
        ...paths.map((p) => ({ doc, path: p.path, value: 'not-there' })),
        { doc, path: ['area'], value: 'Software' },
        { doc, path: ['missing', 'deeper'], value: 'x' },
      ];
    });
    for (let { doc, path, value } of candidates) {
      for (let [name, t] of Object.entries(testsFor(path, value))) {
        let hot = hotIndexedTest('pg', path, t, 'i', name === 'strictPath');
        let { text, values } = expressionToSql('pg', [
          'SELECT (',
          ...hot,
          ') AS h, (',
          ...t('i.search_doc'),
          ') AS d, (NOT (',
          ...hot,
          ')) AS nh, (NOT (',
          ...t('i.search_doc'),
          ')) AS nd FROM (SELECT d AS search_doc, search_keys_of(d) AS search_keys FROM (SELECT',
          param(JSON.stringify(doc)),
          '::jsonb AS d) AS x) AS i',
        ]);
        let [row] = (await adapter.execute(text, { bind: values })) as {
          h: boolean | null;
          d: boolean | null;
          nh: boolean | null;
          nd: boolean | null;
        }[];
        checked++;
        if (row.h !== row.d || row.nh !== row.nd) {
          wrong.push(
            `${name} ${JSON.stringify(path)}=${value.slice(0, 20)} on ${JSON.stringify(doc)?.slice(0, 60)}: keys ${row.h}/${row.nh}, doc ${row.d}/${row.nd}`,
          );
        }
      }
    }
    assert.deepEqual(wrong, [], `${checked} tests answered the same`);
    assert.ok(checked > 400, `${checked} tests checked`);
  });

  test('the index on search_keys serves a containment test', async function (assert) {
    let [index] = (await adapter.execute(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'boxel_index_search_keys_idx'`,
    )) as { indexdef: string }[];
    assert.ok(
      index?.indexdef.includes('gin (search_keys jsonb_path_ops)'),
      `defined as ${index?.indexdef}`,
    );
  });
});
