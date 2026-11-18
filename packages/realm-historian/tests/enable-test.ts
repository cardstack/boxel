// `scripts/enable.ts` as an operator runs it: a process against the database
// that turns one realm's recording on or off.

import QUnit from 'qunit';
const { module, test } = QUnit;
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { insertRealm, setCursor, setupTestDatabase } from './helpers.ts';

const ENABLE = join(import.meta.dirname, '..', 'scripts', 'enable.ts');
const REALM_URL = 'http://localhost:4201/test-user/test-realm/';

interface EnableRun {
  code: number | null;
  log: string;
}

interface StateRow {
  enabled: boolean;
  cursor: string;
  head: string | null;
  status: string;
}

module('enable', (hooks) => {
  let database = setupTestDatabase(hooks);

  async function enable(...args: string[]): Promise<EnableRun> {
    let child = spawn(process.execPath, [ENABLE, ...args], {
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    child.stdout.on('data', (chunk) => (log += chunk));
    child.stderr.on('data', (chunk) => (log += chunk));
    let code = await new Promise<number | null>((resolve) =>
      child.once('exit', resolve),
    );
    return { code, log };
  }

  async function stateOf(realmId: string): Promise<StateRow | undefined> {
    let [row] = await database.db.execute(
      `SELECT enabled, cursor_xid::text || ':' || cursor_seq AS cursor, head,
              status
       FROM realm_history_state WHERE realm_id = $1`,
      { bind: [realmId] },
    );
    return row
      ? {
          enabled: row.enabled as boolean,
          cursor: row.cursor as string,
          head: row.head as string | null,
          status: row.status as string,
        }
      : undefined;
  }

  test("on creates the state row of a realm that has none, from the registry's id", async (assert) => {
    let realm = await insertRealm(database.db, {
      url: REALM_URL,
      stateRow: false,
    });

    let run = await enable(REALM_URL, 'on');

    assert.strictEqual(run.code, 0, `the script succeeds (log: ${run.log})`);
    assert.deepEqual(await stateOf(realm.id), {
      enabled: true,
      cursor: '0:0',
      head: null,
      status: 'ok',
    });
    assert.true(
      run.log.includes('was off (no state row), now on'),
      `it reports the change (log: ${run.log})`,
    );

    let again = await enable(REALM_URL, 'on');
    assert.strictEqual(again.code, 0, 'turning it on again succeeds');
    assert.true(
      again.log.includes('is already on'),
      `it reports nothing changed (log: ${again.log})`,
    );
  });

  test("off clears the flag and keeps the realm's place in its history; on resumes it", async (assert) => {
    let realm = await insertRealm(database.db, { url: REALM_URL });
    await setCursor(database.db, realm, { xid: '1234', seq: 56 });
    await database.db.execute(
      `UPDATE realm_history_state SET head = 'abc123' WHERE realm_id = $1`,
      { bind: [realm.id] },
    );

    let off = await enable(REALM_URL, 'off');
    assert.strictEqual(
      off.code,
      0,
      `turning it off succeeds (log: ${off.log})`,
    );
    assert.deepEqual(await stateOf(realm.id), {
      enabled: false,
      cursor: '1234:56',
      head: 'abc123',
      status: 'ok',
    });
    assert.true(
      off.log.includes('was on, now off'),
      `it reports the change (log: ${off.log})`,
    );

    let offAgain = await enable(REALM_URL, 'off');
    assert.strictEqual(offAgain.code, 0, 'turning it off again succeeds');
    assert.true(
      offAgain.log.includes('is already off'),
      `it reports nothing changed (log: ${offAgain.log})`,
    );

    let on = await enable(REALM_URL, 'on');
    assert.strictEqual(on.code, 0, `turning it on succeeds (log: ${on.log})`);
    assert.deepEqual(await stateOf(realm.id), {
      enabled: true,
      cursor: '1234:56',
      head: 'abc123',
      status: 'ok',
    });
  });

  test('off on a realm with no state row creates none', async (assert) => {
    let realm = await insertRealm(database.db, {
      url: REALM_URL,
      stateRow: false,
    });

    let run = await enable(REALM_URL, 'off');

    assert.strictEqual(run.code, 0, `the script succeeds (log: ${run.log})`);
    assert.strictEqual(await stateOf(realm.id), undefined, 'no row is created');
    assert.true(
      run.log.includes('is already off (no state row)'),
      `it reports nothing changed (log: ${run.log})`,
    );
  });

  test('a realm URL without its trailing slash names the realm', async (assert) => {
    let realm = await insertRealm(database.db, {
      url: REALM_URL,
      stateRow: false,
    });

    let run = await enable(REALM_URL.slice(0, -1), 'on');

    assert.strictEqual(run.code, 0, `the script succeeds (log: ${run.log})`);
    assert.true((await stateOf(realm.id))?.enabled, 'recording is on');
  });

  test('a bootstrap realm can be recorded', async (assert) => {
    let realm = await insertRealm(database.db, {
      url: 'http://localhost:4201/base/',
      kind: 'bootstrap',
      diskId: '/persistent/base',
      stateRow: false,
    });

    let run = await enable('http://localhost:4201/base/', 'on');

    assert.strictEqual(run.code, 0, `the script succeeds (log: ${run.log})`);
    assert.true((await stateOf(realm.id))?.enabled, 'recording is on');
  });

  test('a published realm is refused, and gets no state row', async (assert) => {
    let realm = await insertRealm(database.db, {
      url: 'http://test-user.localhost:4201/source/',
      kind: 'published',
      diskId: 'published/source',
      stateRow: false,
    });

    let run = await enable(realm.url, 'on');

    assert.strictEqual(run.code, 1, 'the script fails');
    assert.true(
      run.log.includes(
        'is a published realm, and published realms record no history',
      ),
      `it says why (log: ${run.log})`,
    );
    assert.true(
      run.log.includes('http://localhost:4201/test-user/source/'),
      `it names the source realm to record instead (log: ${run.log})`,
    );
    assert.strictEqual(await stateOf(realm.id), undefined, 'no row is created');
  });

  test('a URL no realm is registered at is refused', async (assert) => {
    let run = await enable('http://localhost:4201/nobody/nothing/', 'on');

    assert.strictEqual(run.code, 1, 'the script fails');
    assert.true(
      run.log.includes(
        'no realm is registered at http://localhost:4201/nobody/nothing/',
      ),
      `it says why (log: ${run.log})`,
    );
    let [{ count }] = await database.db.execute(
      `SELECT count(*)::int AS count FROM realm_history_state`,
    );
    assert.strictEqual(count, 0, 'no row is created');
  });

  test('a usage error exits 2 without touching the database', async (assert) => {
    let realm = await insertRealm(database.db, {
      url: REALM_URL,
      stateRow: false,
    });

    let usages = [
      [],
      [REALM_URL],
      [REALM_URL, 'yes'],
      ['not a url', 'on'],
      [REALM_URL, 'on', 'extra'],
    ];
    let runs = await Promise.all(usages.map((args) => enable(...args)));
    for (let [index, args] of usages.entries()) {
      let run = runs[index];
      assert.strictEqual(
        run.code,
        2,
        `${JSON.stringify(args)} is a usage error (log: ${run.log})`,
      );
    }
    assert.strictEqual(await stateOf(realm.id), undefined, 'no row is created');
  });
});
