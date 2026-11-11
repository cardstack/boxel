import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  SqlLiteralError,
  arrayElement,
  jsonPathOfKeys,
  sqlJsonPathLiteral,
  sqlTextArrayLiteral,
  sqlTextLiteral,
} from '@cardstack/runtime-common';
import { exprSortSql } from '@cardstack/runtime-common/formula-sql';
import { setupDB } from './helpers/index.ts';

// The one place text a query names is written into SQL as a literal, where
// no bind parameter can go (sql-literal.ts). Each hostile string must come
// back from Postgres exactly as it went in, whether or not the server reads
// backslashes as escapes, and must never end the literal early.

const MARK = 'DROP TABLE boxel_index';
const HOSTILE = [
  `'`,
  `''`,
  `it's`,
  `'; ${MARK}; --`,
  `x' OR '1'='1'); ${MARK}; /*`,
  `\\`,
  `\\'`,
  `\\\\'; ${MARK}; --`,
  `ends in a backslash\\`,
  `$$; ${MARK}; $$`,
  `$1 $2`,
  `$tag$ ${MARK} $tag$`,
  `-- a comment`,
  `/* a comment */`,
  `*/ ${MARK} /*`,
  `"`,
  `"}'::text[]); ${MARK}; --`,
  `{a,b}`,
  `null`,
  `NULL`,
  `a,b`,
  `tab\there\nnewline\r`,
  `crème brûlée`,
  `日本語`,
  `emoji 👩🏽‍💻`,
  `${'\u200b'} zero width`,
  `${'\u2028'} line separator`,
  'x'.repeat(100_000),
  `'`.repeat(10_000),
  `\\`.repeat(10_000),
];

module(basename(import.meta.filename), function () {
  module('the literals as text', function () {
    test('plain text is quoted as it always was', function (assert) {
      assert.strictEqual(sqlTextLiteral('price'), `'price'`);
      assert.strictEqual(sqlTextLiteral(`it's`), `'it''s'`);
      assert.strictEqual(
        sqlTextArrayLiteral(['a', 'b']),
        `'{"a","b"}'::text[]`,
      );
      assert.strictEqual(jsonPathOfKeys(['a', 'b[]', 'c']), '$."a"."b"[*]."c"');
      assert.strictEqual(
        sqlJsonPathLiteral(['concepts[]', 'id']),
        `'$."concepts"[*]."id"'::jsonpath`,
      );
    });

    test('a backslash makes an escape string on Postgres, not on SQLite', function (assert) {
      assert.strictEqual(sqlTextLiteral('a\\b'), `E'a\\\\b'`);
      assert.strictEqual(sqlTextLiteral(`a\\'b`), `E'a\\\\''b'`);
      assert.strictEqual(sqlTextLiteral('a\\b', 'sqlite'), `'a\\b'`);
    });

    test('a NUL is refused, never cut short', function (assert) {
      for (let value of ['\0', `a\0' ; ${MARK}`]) {
        assert.throws(() => sqlTextLiteral(value), SqlLiteralError);
        assert.throws(() => sqlTextLiteral(value, 'sqlite'), SqlLiteralError);
        assert.throws(() => sqlTextArrayLiteral([value]), SqlLiteralError);
      }
    });

    test('anything that is not text is refused', function (assert) {
      assert.throws(
        () => sqlTextLiteral(1 as unknown as string),
        SqlLiteralError,
      );
    });

    test('an array element escapes its quotes and backslashes for the array parser', function (assert) {
      assert.strictEqual(arrayElement('a"b'), '"a\\"b"');
      assert.strictEqual(arrayElement('a\\b'), '"a\\\\b"');
      assert.strictEqual(arrayElement('a,b}'), '"a,b}"');
    });
  });

  module('the literals in Postgres', function (hooks) {
    let adapter: PgAdapter;
    setupDB(hooks, {
      before: async (dbAdapter) => {
        adapter = dbAdapter;
      },
    });

    // each statement in its own transaction, with backslash escapes read
    // the way the server is set
    async function read(sql: string, conforming: boolean) {
      return await adapter.withTransaction(async (q) => {
        await q([
          `SET LOCAL standard_conforming_strings = ${conforming ? 'on' : 'off'}`,
        ]);
        await q(['SET LOCAL escape_string_warning = off']);
        return await q([sql]);
      });
    }

    async function tableIsIntact(assert: Assert) {
      let rows = await adapter.execute(
        `SELECT to_regclass('boxel_index') IS NOT NULL AS present`,
      );
      assert.true(rows[0].present as boolean, 'boxel_index is still there');
    }

    for (let conforming of [true, false]) {
      let setting = `standard_conforming_strings ${conforming ? 'on' : 'off'}`;

      test(`a text literal reads back as written (${setting})`, async function (assert) {
        for (let value of HOSTILE) {
          let rows = await read(
            `SELECT ${sqlTextLiteral(value)}::text AS v`,
            conforming,
          );
          assert.strictEqual(rows.length, 1);
          assert.strictEqual(
            rows[0].v,
            value,
            `${JSON.stringify(value.slice(0, 40))} (${value.length} chars)`,
          );
        }
        await tableIsIntact(assert);
      });

      test(`a text-array literal reads back as its keys (${setting})`, async function (assert) {
        for (let value of HOSTILE) {
          let parts = [value, 'b', value];
          let rows = await read(
            `SELECT ${sqlTextArrayLiteral(parts)} AS v`,
            conforming,
          );
          assert.deepEqual(
            rows[0].v,
            parts,
            JSON.stringify(value.slice(0, 40)),
          );
        }
        await tableIsIntact(assert);
      });

      test(`a path through those keys reads the value under them (${setting})`, async function (assert) {
        for (let value of HOSTILE.filter((v) => v.length < 1_000)) {
          let doc = sqlTextLiteral(JSON.stringify({ [value]: { b: 7 } }));
          let rows = await read(
            `SELECT (${doc}::jsonb #> ${sqlTextArrayLiteral([value, 'b'])})::text AS by_keys, jsonb_path_query_array(${doc}::jsonb, ${sqlJsonPathLiteral([value, 'b'])})::text AS by_path`,
            conforming,
          );
          assert.strictEqual(
            rows[0].by_keys,
            '7',
            `#> ${JSON.stringify(value)}`,
          );
          assert.strictEqual(
            rows[0].by_path,
            '[7]',
            `jsonpath ${JSON.stringify(value)}`,
          );
        }
      });
    }

    // A compiled expression's own patterns (a number, a stored date) are
    // written for the server's default, standard_conforming_strings on, as
    // every constant pattern in the engine is; so these run under it alone.
    // A binding's value longer than the compiled SQL may be refuses the
    // expression ("too deeply nested"), so the hostile values here are the
    // short ones; the long ones are pinned below.
    const SHORT_HOSTILE = HOSTILE.filter((v) => v.length < 1_000);

    test(`a binding's value in a compiled expression is data`, async function (assert) {
      // A `let` binding's card is read in place of a field, as a jsonb
      // literal (formula-sql.ts). Text that is no number reads as no score;
      // the statement still runs.
      for (let value of SHORT_HOSTILE) {
        let sql = exprSortSql('mine.amount + 1', { mine: { amount: value } });
        let rows = await read(`SELECT ${sql} AS v`, true);
        assert.strictEqual(rows[0].v, null, JSON.stringify(value.slice(0, 40)));
      }
      let sql = exprSortSql('mine.amount + 1', { mine: { amount: ' 41 ' } });
      let rows = await read(`SELECT ${sql} AS v`, true);
      assert.strictEqual(Number(rows[0].v), 42, 'text that spells a number');
      await tableIsIntact(assert);
    });

    test(`NOW() reads the query's one instant, and a binding's text is no date `, async function (assert) {
      let now = new Date('2026-11-10T12:00:00.000Z');
      let days = (when: string) =>
        exprSortSql('DAYS(NOW(), mine.when)', { mine: { when } }, now);
      assert.false(/now\(\)/.test(days('x')), 'no clock is read');
      let rows = await read(
        `SELECT ${days('2026-11-09T12:00:00Z')} AS v`,
        true,
      );
      assert.strictEqual(Number(rows[0].v), 1, 'one day before the instant');
      for (let value of SHORT_HOSTILE) {
        let [row] = await read(`SELECT ${days(value)} AS v`, true);
        assert.strictEqual(row.v, null, JSON.stringify(value.slice(0, 40)));
      }
    });

    test('a binding value longer than a compiled expression may be refuses the expression', function (assert) {
      assert.throws(
        () =>
          exprSortSql('mine.amount + 1', {
            mine: { amount: 'x'.repeat(100_000) },
          }),
        /too deeply nested/,
      );
    });
  });
});
