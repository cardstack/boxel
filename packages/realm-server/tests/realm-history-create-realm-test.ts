import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Test, SuperTest } from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import type { PgAdapter } from '@cardstack/postgres';
import { param, query } from '@cardstack/runtime-common';
import {
  realmSecretSeed,
  setupPermissionedRealmCached,
  testRealmURLFor,
} from './helpers/index.ts';
import { FailableChangeJournal } from './helpers/failable-change-journal.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';

// Creating a realm writes its seed files straight to disk, outside the realm,
// so it appends one `scan` event by the realm's creator, which realm-historian
// records as the realm's first revision. The event obeys the journal's rule
// for which realms record, and a journal failure never fails the creation.

interface JournalRow {
  realmId: string;
  author: string;
  channel: string;
  intent: unknown;
  changes: unknown;
}

module(basename(import.meta.filename), function (hooks) {
  let journal = new FailableChangeJournal();
  let request: SuperTest<Test>;
  let dbAdapter: PgAdapter;

  // Below the server's root, which create-realm refuses to share with a realm.
  setupPermissionedRealmCached(hooks, {
    realmURL: testRealmURLFor('test/'),
    permissions: { '*': ['read'] },
    fileSystem: {},
    history: { journal },
    onRealmSetup(args: { request: SuperTest<Test>; dbAdapter: PgAdapter }) {
      request = args.request;
      dbAdapter = args.dbAdapter;
      journal.failNext = false;
    },
  });

  // Turns recording on for every realm registered from here on, as the
  // rollout does for new realms once it reaches an environment. Each test
  // starts from its own copy of the database, so the trigger ends with it.
  async function recordNewRealms() {
    await dbAdapter.execute(`
      CREATE FUNCTION record_new_realm() RETURNS trigger AS $$
      BEGIN
        INSERT INTO realm_history_state (realm_id, enabled) VALUES (NEW.id, true);
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql`);
    await dbAdapter.execute(`
      CREATE TRIGGER record_new_realm AFTER INSERT ON realm_registry
      FOR EACH ROW EXECUTE FUNCTION record_new_realm()`);
  }

  async function createRealm(ownerUserId: string): Promise<string> {
    let response = await request
      .post('/_create-realm')
      .set('Accept', 'application/vnd.api+json')
      .set('Content-Type', 'application/json')
      .set(
        'Authorization',
        `Bearer ${createRealmServerJWT(
          { user: ownerUserId, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        )}`,
      )
      .send(
        JSON.stringify({
          data: {
            type: 'realm',
            attributes: { name: 'History', endpoint: `realm-${uuidv4()}` },
          },
        }),
      );
    if (response.status !== 202) {
      throw new Error(
        `creating a realm answered ${response.status}: ${response.text}`,
      );
    }
    return response.body.data.id as string;
  }

  async function registryId(realmURL: string): Promise<string | undefined> {
    let [row] = await query(dbAdapter, [
      'SELECT id::text AS id FROM realm_registry WHERE url =',
      param(realmURL),
    ]);
    return row?.id as string | undefined;
  }

  async function events(realmURL: string): Promise<JournalRow[]> {
    let rows = await query(dbAdapter, [
      'SELECT realm_id::text AS realm_id, author, channel, intent, changes',
      'FROM realm_change_events WHERE realm_url =',
      param(realmURL),
      'ORDER BY seq',
    ]);
    return rows.map((row) => ({
      realmId: String(row.realm_id),
      author: String(row.author),
      channel: String(row.channel),
      intent: row.intent,
      changes: row.changes,
    }));
  }

  test('a new realm leaves one scan event, by its creator', async function (assert) {
    await recordNewRealms();
    let creator = `@user-${uuidv4()}:localhost`;

    let realmURL = await createRealm(creator);

    assert.deepEqual(await events(realmURL), [
      {
        realmId: (await registryId(realmURL))!,
        author: creator,
        channel: 'system',
        intent: { kind: 'scan' },
        changes: [],
      },
    ]);
  });

  test('a new realm whose recording is off leaves no event', async function (assert) {
    let realmURL = await createRealm(`@user-${uuidv4()}:localhost`);

    assert.ok(await registryId(realmURL), 'the realm is registered');
    assert.deepEqual(await events(realmURL), []);
  });

  test('a journal failure leaves no event and still creates the realm', async function (assert) {
    await recordNewRealms();
    journal.failNext = true;

    let realmURL = await createRealm(`@user-${uuidv4()}:localhost`);

    assert.ok(await registryId(realmURL), 'the realm is registered');
    assert.deepEqual(await events(realmURL), []);
  });
});
