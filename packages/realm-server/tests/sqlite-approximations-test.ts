import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { ResolvedCodeRef } from '@cardstack/runtime-common';
import {
  approximateForSqlite,
  regexAsGlob,
} from '@cardstack/runtime-common/query-engine/sqlite-approximations';

// The browser index (SQLite) has no regular expressions, no formula
// functions and no value store. A query that asks for them is answered with
// the closest thing SQLite can run, and every approximation is named in
// `meta.warnings`; it is never refused. These pin the query rewrite.
const Person = {
  module: 'http://test/person',
  name: 'Person',
} as ResolvedCodeRef;
const codes = (warnings: { code: string }[]) => warnings.map((w) => w.code);

module(basename(import.meta.filename), function () {
  module('a regex as a glob', function () {
    test('a literal regex is a substring glob', function (assert) {
      assert.strictEqual(regexAsGlob('ang'), '**ang**');
    });
    test('anchors pin the ends', function (assert) {
      assert.strictEqual(regexAsGlob('^Man'), 'Man**');
      assert.strictEqual(regexAsGlob('go$'), '**go');
      assert.strictEqual(regexAsGlob('^Mango$'), 'Mango');
    });
    test('`.` is any one character and `.*` any run', function (assert) {
      assert.strictEqual(regexAsGlob('^M.ngo$'), 'M?ngo');
      assert.strictEqual(regexAsGlob('^M.*o$'), 'M**o');
      assert.strictEqual(regexAsGlob('^M.+o$'), 'M?**o');
    });
    test('an escaped punctuation mark is itself', function (assert) {
      assert.strictEqual(regexAsGlob('^v1\\.2$'), 'v1.2');
    });
    test('anything else has no glob form', function (assert) {
      for (let regex of [
        '^(a|b)$',
        '[abc]',
        'a+',
        'colou?r',
        '\\d',
        'a{2}',
        '\\*',
        'a*',
      ]) {
        assert.strictEqual(regexAsGlob(regex), undefined, regex);
      }
    });
  });

  module('a regex filter', function () {
    test('a regex with a glob form runs as that pattern, with a warning', function (assert) {
      let out = approximateForSqlite({
        filter: { on: Person, regex: { sku: '^AB-' } },
      });
      assert.deepEqual(out.filter, { on: Person, pattern: { sku: 'AB-**' } });
      assert.deepEqual(codes(out.warnings), ['sqlite-regex-as-pattern']);
      assert.ok(out.warnings[0].message.includes('"sku"'));
    });

    // The path is the caller's: as a key of the pattern it stays a key, so
    // the engine reads it (and refuses a field the type lacks) as it does on
    // Postgres, instead of it setting the pattern's prototype and vanishing.
    test("a regex on a path that names an object's own machinery keeps its path", function (assert) {
      for (let path of ['__proto__', 'constructor', 'toString']) {
        let regex = JSON.parse(`{${JSON.stringify(path)}:"^AB-"}`);
        let out = approximateForSqlite({ filter: { on: Person, regex } });
        let pattern = (out.filter as { pattern: Record<string, string> })
          .pattern;
        assert.deepEqual(
          [
            Object.keys(pattern),
            Object.getOwnPropertyDescriptor(pattern, path)?.value,
          ],
          [[path], 'AB-**'],
          `${path}: the pattern holds it as its own key`,
        );
      }
    });

    test('a regex with no glob form is left out of an every', function (assert) {
      let out = approximateForSqlite({
        filter: {
          every: [
            { on: Person, eq: { name: 'Mango' } },
            { on: Person, regex: { sku: '^(a|b)$' } },
          ],
        },
      });
      assert.deepEqual(out.filter, {
        every: [{ on: Person, eq: { name: 'Mango' } }, { type: Person }],
      });
      assert.deepEqual(codes(out.warnings), ['sqlite-regex-dropped']);
    });

    test('left out of an any, it never widens the any', function (assert) {
      let out = approximateForSqlite({
        filter: {
          any: [
            { on: Person, eq: { name: 'Mango' } },
            { on: Person, regex: { sku: '[xy]' } },
          ],
        },
      });
      assert.deepEqual(out.filter, {
        any: [{ on: Person, eq: { name: 'Mango' } }],
      });
    });

    test('an any left empty is dropped, not matched as nothing', function (assert) {
      let out = approximateForSqlite({
        filter: {
          every: [
            { on: Person, eq: { name: 'Mango' } },
            { any: [{ on: Person, regex: { sku: '[xy]' } }] },
          ],
        },
      });
      assert.deepEqual(out.filter, {
        every: [{ on: Person, eq: { name: 'Mango' } }],
      });
    });

    test('under not, it is dropped with its not: never "match nothing"', function (assert) {
      let out = approximateForSqlite({
        filter: {
          every: [
            { on: Person, eq: { name: 'Mango' } },
            { not: { on: Person, regex: { sku: '[xy]' } } },
          ],
        },
      });
      assert.deepEqual(out.filter, {
        every: [{ on: Person, eq: { name: 'Mango' } }],
      });
    });

    test('a node with a type whose not is dropped keeps the type', function (assert) {
      let out = approximateForSqlite({
        filter: { on: Person, not: { regex: { sku: '[xy]' } } },
      });
      assert.deepEqual(out.filter, { type: Person });
    });

    test('under a double not, it is dropped as well', function (assert) {
      let out = approximateForSqlite({
        filter: { not: { not: { on: Person, regex: { sku: '[xy]' } } } },
      });
      assert.strictEqual(out.filter, undefined);
    });

    test('a negated regex with a glob form stays negated', function (assert) {
      let out = approximateForSqlite({
        filter: { not: { on: Person, regex: { sku: '^AB' } } },
      });
      assert.deepEqual(out.filter, {
        not: { on: Person, pattern: { sku: 'AB**' } },
      });
    });

    test('a lone regex with no glob form keeps its type', function (assert) {
      let out = approximateForSqlite({
        filter: { on: Person, regex: { sku: '[xy]' } },
      });
      assert.deepEqual(out.filter, { type: Person });
    });

    test('a regex with no type at the root leaves no filter', function (assert) {
      let out = approximateForSqlite({ filter: { regex: { sku: '[xy]' } } });
      assert.strictEqual(out.filter, undefined);
    });

    test('of two paths, the one with a glob form is kept', function (assert) {
      let out = approximateForSqlite({
        filter: { on: Person, regex: { sku: '^AB', code: '[xy]' } },
      });
      assert.deepEqual(out.filter, { on: Person, pattern: { sku: 'AB**' } });
      assert.deepEqual(codes(out.warnings), [
        'sqlite-regex-as-pattern',
        'sqlite-regex-dropped',
      ]);
    });

    test('the paths left out are returned for the field checks', function (assert) {
      let out = approximateForSqlite({
        filter: {
          type: Person,
          every: [{ regex: { sku: '[xy]' } }],
        },
      });
      assert.deepEqual(out.dropped, [{ on: Person, path: 'sku' }]);
    });

    test('an invalid regex is still refused', function (assert) {
      assert.throws(
        () =>
          approximateForSqlite({
            filter: { on: Person, regex: { sku: '(' } },
          }),
        (e: any) => e.code === 'invalid-value',
      );
    });

    test('a query with no regex is the same object', function (assert) {
      let filter = { on: Person, eq: { name: 'Mango' } };
      let out = approximateForSqlite({ filter });
      assert.strictEqual(out.filter, filter);
      assert.deepEqual(out.warnings, []);
    });
  });

  module('sorts', function () {
    test('a formula sort entry is left out; the rest of the order stays', function (assert) {
      let out = approximateForSqlite({
        sort: [
          { by: '_expr', expr: 'price * 2' },
          { by: 'name', on: Person },
        ] as any,
      });
      assert.deepEqual(out.sort, [{ by: 'name', on: Person }]);
      assert.deepEqual(codes(out.warnings), ['sqlite-formula-sort-dropped']);
    });

    test('a blend keeps the signals SQLite can rank by', function (assert) {
      let out = approximateForSqlite({
        sort: [
          {
            by: '_blend',
            of: [
              { by: '_expr', expr: 'price' },
              { by: 'name', on: Person },
            ],
          },
        ] as any,
      });
      assert.deepEqual(out.sort, [
        { by: '_blend', of: [{ by: 'name', on: Person }] },
      ]);
    });

    test('a blend of formulas alone is left out', function (assert) {
      let out = approximateForSqlite({
        sort: [{ by: '_blend', of: [{ by: '_expr', expr: 'price' }] }] as any,
      });
      assert.strictEqual(out.sort, undefined);
    });

    test('a rerank is skipped and the base order kept', function (assert) {
      let out = approximateForSqlite({
        sort: [{ by: 'name', on: Person }] as any,
        rerank: {
          expression: 'PERCENTRANK_INC(peers.rating, rating)',
          top: 20,
          compare: { near: 'embedding' },
        } as any,
      });
      assert.strictEqual(out.rerank, undefined);
      assert.deepEqual(out.sort, [{ by: 'name', on: Person }]);
      assert.deepEqual(codes(out.warnings), ['sqlite-rerank-skipped']);
    });
  });
});
