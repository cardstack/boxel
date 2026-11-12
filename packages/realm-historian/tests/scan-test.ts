// `scripts/scan.ts` as the start scripts run it: a process against the
// database, appending one `scan` event per deployed realm whose recording is
// on.

import QUnit from 'qunit';
const { module, test } = QUnit;
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { insertRealm, setupTestDatabase } from './helpers.ts';

const SCAN = join(import.meta.dirname, '..', 'scripts', 'scan.ts');
const COMMIT = '0123456789abcdef0123456789abcdef01234567';

interface ScanRun {
  code: number | null;
  log: string;
}

interface ScanEvent {
  realmId: string;
  realmURL: string;
  author: string;
  channel: string;
  intent: unknown;
  changes: unknown;
}

module('scan', (hooks) => {
  let database = setupTestDatabase(hooks);

  async function scan(...args: string[]): Promise<ScanRun> {
    let child = spawn(process.execPath, [SCAN, ...args], {
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

  async function events(): Promise<ScanEvent[]> {
    let rows = await database.db.execute(
      `SELECT realm_id::text AS realm_id, realm_url, author, channel, intent,
              changes
       FROM realm_change_events ORDER BY seq`,
    );
    return rows.map((row) => ({
      realmId: row.realm_id as string,
      realmURL: row.realm_url as string,
      author: row.author as string,
      channel: row.channel as string,
      intent: row.intent,
      changes: row.changes,
    }));
  }

  async function eventPathCount(): Promise<number> {
    let [row] = await database.db.execute(
      `SELECT count(*)::int AS count FROM realm_change_event_paths`,
    );
    return row.count as number;
  }

  test("a deploy's scan is by the realm's bot and names the repository and commit", async (assert) => {
    let realm = await insertRealm(database.db, {
      url: 'https://realms.example.test/experiments/',
      kind: 'bootstrap',
      diskId: '/persistent/experiments',
    });

    let run = await scan(
      '--realm=/persistent/experiments:experiments_realm',
      '--matrixServerName=stack.cards',
      '--source=cardstack/boxel',
      `--commit=${COMMIT}`,
    );

    assert.strictEqual(run.code, 0, `the script succeeds (log: ${run.log})`);
    assert.deepEqual(await events(), [
      {
        realmId: realm.id,
        realmURL: realm.url,
        author: '@experiments_realm:stack.cards',
        channel: 'deploy',
        intent: { kind: 'scan', source: 'cardstack/boxel', commit: COMMIT },
        changes: [],
      },
    ]);
    assert.strictEqual(
      await eventPathCount(),
      0,
      'a scan names no paths, so it leaves no path rows',
    );
  });

  test('a realm named without a bot is scanned by boxel-system', async (assert) => {
    let realm = await insertRealm(database.db, {
      url: 'https://cardstack.com/base/',
      kind: 'bootstrap',
      diskId: '/persistent/base',
    });

    let run = await scan('--realm=/persistent/base');

    assert.strictEqual(run.code, 0, `the script succeeds (log: ${run.log})`);
    assert.deepEqual(await events(), [
      {
        realmId: realm.id,
        realmURL: realm.url,
        author: 'boxel-system',
        channel: 'deploy',
        intent: { kind: 'scan' },
        changes: [],
      },
    ]);
  });

  test('a directory is matched as the realm server registers it, resolved', async (assert) => {
    let realm = await insertRealm(database.db, {
      url: 'https://cardstack.com/base/',
      kind: 'bootstrap',
      diskId: '/persistent/base',
    });

    let run = await scan(
      '--realm=/persistent/./base/:base_realm',
      '--matrixServerName=stack.cards',
    );

    assert.strictEqual(run.code, 0, `the script succeeds (log: ${run.log})`);
    assert.deepEqual(
      (await events()).map((event) => [event.realmURL, event.author]),
      [[realm.url, '@base_realm:stack.cards']],
    );
  });

  test('only the realms whose recording is on get an event', async (assert) => {
    let recording = await insertRealm(database.db, {
      url: 'https://realms.example.test/pretui/',
      kind: 'bootstrap',
      diskId: '/persistent/pretui',
    });
    await insertRealm(database.db, {
      url: 'https://realms.example.test/openrouter/',
      kind: 'bootstrap',
      diskId: '/persistent/openrouter',
      enabled: false,
    });
    // A published realm is never a bootstrap realm, so naming its directory
    // finds nothing, whatever its recording flag says.
    await insertRealm(database.db, {
      url: 'https://published.example.test/',
      kind: 'published',
      diskId: '/persistent/published',
    });

    let run = await scan(
      '--realm=/persistent/pretui:pretui_realm',
      '--realm=/persistent/openrouter:openrouter_realm',
      '--realm=/persistent/published:published_realm',
      // A realm deployed for the first time has no registry row yet.
      '--realm=/persistent/choreo-gallery:choreo_gallery_realm',
      '--matrixServerName=boxel.ai',
      '--source=cardstack/boxel',
      `--commit=${COMMIT}`,
    );

    assert.strictEqual(run.code, 0, `the script succeeds (log: ${run.log})`);
    assert.deepEqual(
      (await events()).map((event) => [event.realmURL, event.author]),
      [[recording.url, '@pretui_realm:boxel.ai']],
    );
  });

  test('a directory two bootstrap rows share is scanned as the realm the last boot registered', async (assert) => {
    // Rows are upserted by URL, so a realm whose URL changed leaves its old
    // row on the same directory, no longer refreshed by each boot.
    let stale = await insertRealm(database.db, {
      url: 'https://realms.example.test/old-software-factory/',
      kind: 'bootstrap',
      diskId: '/persistent/software-factory',
    });
    await database.db.execute(
      `UPDATE realm_registry SET updated_at = now() - interval '1 day'
       WHERE id = $1`,
      { bind: [stale.id] },
    );
    let current = await insertRealm(database.db, {
      url: 'https://realms.example.test/software-factory/',
      kind: 'bootstrap',
      diskId: '/persistent/software-factory',
    });

    let run = await scan('--realm=/persistent/software-factory');

    assert.strictEqual(run.code, 0, `the script succeeds (log: ${run.log})`);
    assert.deepEqual(
      (await events()).map((event) => event.realmURL),
      [current.url],
    );
  });

  test('a realm named with its bot needs the Matrix server name', async (assert) => {
    await insertRealm(database.db, {
      url: 'https://cardstack.com/base/',
      kind: 'bootstrap',
      diskId: '/persistent/base',
    });

    let run = await scan('--realm=/persistent/base:base_realm');

    assert.strictEqual(run.code, 2, 'the script refuses its arguments');
    assert.deepEqual(await events(), [], 'and appends nothing');
  });
});
