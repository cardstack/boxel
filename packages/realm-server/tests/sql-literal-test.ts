import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import { SqlLiteralError, sqlTextLiteral } from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';

// Text a query names, written into SQL as a literal where no bind parameter
// can go (sql-literal.ts). Each hostile string must come back from Postgres
// exactly as it went in, whether or not the server reads backslashes as
// escapes, and must never end the literal early.

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
      }
    });

    test('anything that is not text is refused', function (assert) {
      assert.throws(
        () => sqlTextLiteral(1 as unknown as string),
        SqlLiteralError,
      );
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
    }
  });
});
