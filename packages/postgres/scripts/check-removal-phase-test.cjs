/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');

for (const [name, sql, rejected] of [
  ['delete', 'DELETE FROM realm_meta', true],
  ['unlogged', 'ALTER TABLE realm_meta SET UNLOGGED', true],
  ['executed block', 'DO $$ BEGIN DELETE FROM realm_meta; END $$', true],
  [
    'stored trigger',
    'CREATE FUNCTION sync() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN DELETE FROM new_table; RETURN NULL; END $$;',
    false,
  ],
  [
    'delete after function',
    'CREATE FUNCTION sync() RETURNS void AS $body$ BEGIN RETURN; END $body$ LANGUAGE plpgsql; DELETE FROM realm_meta;',
    true,
  ],
  ['logged', 'ALTER TABLE realm_generations SET LOGGED', false],
]) {
  test(name, () => {
    const root = mkdtempSync(join(tmpdir(), 'migration-guard-'));
    try {
      mkdirSync(join(root, 'migrations'));
      const file = join(root, 'migrations', '1234567891234_fixture.js');
      writeFileSync(
        file,
        `exports.up = pgm => pgm.sql(${JSON.stringify(sql)});`,
      );
      const result = spawnSync(process.execPath, [
        join(__dirname, 'check-removal-phase.cjs'),
        file,
      ]);
      assert.equal(result.status, rejected ? 1 : 0, result.stderr.toString());
    } finally {
      rmSync(root, { recursive: true });
    }
  });
}
