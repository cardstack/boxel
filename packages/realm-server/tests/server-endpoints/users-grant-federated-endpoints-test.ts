import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  getOrCreateUser,
  param,
  query,
  rri,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
  RealmPermissions,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../../handlers/handle-fetch-catalog-realms.ts';
import type { RealmHttpServer as Server } from '../../server.ts';
import { createJWT as createRealmServerJWT } from '../../utils/jwt.ts';
import {
  closeServer,
  createVirtualNetwork,
  matrixURL,
  realmSecretSeed,
  runTestRealmServerWithRealms,
  setupDB,
} from '../helpers/index.ts';

// ============================================================================
// A signed-in session on the endpoints that answer for several realms at once,
// for a realm it reads only through a grant the realm shares with callers.
//
// A realm's `users` grant lets every caller with a Boxel account read it, and
// its `*` grant lets anyone read it. The federated endpoints read such a realm
// to a caller as the realm itself does. No realm here names a policy.
//
// - Lib: anyone may read it, token or not. It holds the note type.
// - Members: any user with a Boxel account reads it, through its `users` grant.
// - Private: only its owner reads it.
// - Own: Lee reads it through a row of their own.
// - Open: anyone may read it, and Lee has a row of their own on it that grants
//   `write` but not `read`.
// - Archived: any user with a Boxel account would read it through its `users`
//   grant, but it is archived.
// ============================================================================

const SERVER = 'http://127.0.0.1:4444/';
const LIB = `${SERVER}lib/`;
const MEMBERS = `${SERVER}members/`;
const PRIVATE = `${SERVER}private/`;
const OWN = `${SERVER}own/`;
const OPEN = `${SERVER}open/`;
const ARCHIVED = `${SERVER}archived/`;

const OWNER = '@owner:localhost';
// Holds a permission row only on Own and Open.
const LEE = '@lee:localhost';

const NOTE = { module: `${LIB}note`, name: 'Note' };
const NOTES = { 'item.on': NOTE };

const NOTE_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";

  export class Note extends CardDef {
    @field title = contains(StringField);
  }
`;

function note(title: string) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { title },
      meta: {
        adoptsFrom: { module: rri(NOTE.module), name: NOTE.name },
      },
    },
  });
}

const MEMBERS_NOTES = [`${MEMBERS}notes/one`, `${MEMBERS}notes/two`];
const OPEN_NOTES = [`${OPEN}notes/one`];

// The endpoints that refuse a realm the caller may not read, rather than
// carrying it to its policy as `_federated-search` does.
const REFUSING_ENDPOINTS = [
  { path: '/_federated-types', accept: 'application/json' },
  { path: '/_federated-info', accept: SupportedMimeType.JSONAPI },
  { path: '/_federated-index-counts', accept: SupportedMimeType.JSONAPI },
];

function ids(response: { body: { data: { id: string }[] } }): string[] {
  return response.body.data.map((entry) => entry.id).sort();
}

module(`server-endpoints/${basename(import.meta.filename)}`, function () {
  module(
    "a realm's `users` grant on the federated endpoints",
    function (hooks) {
      let realms: Realm[] = [];
      let request: SuperTest<Test>;
      let server: Server;
      let db: PgAdapter;

      async function start({
        dbAdapter,
        publisher,
        runner,
      }: {
        dbAdapter: PgAdapter;
        publisher: QueuePublisher;
        runner: QueueRunner;
      }) {
        db = dbAdapter;
        let owner: RealmPermissions = {
          [OWNER]: ['read', 'write', 'realm-owner'],
        };
        let result = await runTestRealmServerWithRealms({
          virtualNetwork: createVirtualNetwork(),
          realmsRootPath: join(dirSync().name, 'realm_server_1'),
          realms: [
            {
              realmURL: new URL(LIB),
              fileSystem: { 'note.gts': NOTE_MODULE },
              permissions: { ...owner, '*': ['read'] },
            },
            {
              realmURL: new URL(MEMBERS),
              fileSystem: {
                'notes/one.json': note('Members one'),
                'notes/two.json': note('Members two'),
              },
              permissions: { ...owner, users: ['read'] },
            },
            {
              realmURL: new URL(PRIVATE),
              fileSystem: { 'notes/one.json': note('Private one') },
              permissions: { ...owner },
            },
            {
              realmURL: new URL(OWN),
              fileSystem: { 'notes/one.json': note('Own one') },
              permissions: { ...owner, [LEE]: ['read'] },
            },
            {
              realmURL: new URL(OPEN),
              fileSystem: { 'notes/one.json': note('Open one') },
              permissions: { ...owner, '*': ['read'], [LEE]: ['write'] },
            },
            {
              realmURL: new URL(ARCHIVED),
              fileSystem: { 'notes/one.json': note('Archived one') },
              permissions: { ...owner, users: ['read'] },
            },
          ],
          dbAdapter,
          publisher,
          runner,
          matrixURL,
        });
        server = result.testRealmHttpServer;
        request = supertest(server);
        realms = result.realms;
        await query(dbAdapter, [
          'INSERT INTO realm_metadata (url, archived_at) VALUES (',
          param(ARCHIVED),
          ', NOW()) ON CONFLICT (url) DO UPDATE SET archived_at = EXCLUDED.archived_at',
        ]);
      }

      // One server for the whole module: no test changes any realm. Booting it
      // indexes six realms inside the first test's budget, so that budget is
      // extended.
      hooks.before(function (assert) {
        assert.timeout(300_000);
      });

      setupDB(hooks, {
        before: async (dbAdapter, publisher, runner) => {
          await start({ dbAdapter, publisher, runner });
        },
        after: async () => {
          // Guarded, so a boot that failed partway still closes what it opened.
          for (let realm of realms) {
            realm?.unsubscribe();
          }
          if (server) {
            await closeServer(server);
          }
          resetCatalogRealms();
        },
      });

      function session(user: string) {
        return createRealmServerJWT(
          { user, sessionRoom: `session-room-${user}` },
          realmSecretSeed,
        );
      }

      function federatedSearch(realmURLs: string[], token: string) {
        return request
          .post('/_federated-search')
          .set('Accept', SupportedMimeType.CardJson)
          .set('Content-Type', 'application/json')
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Authorization', `Bearer ${token}`)
          .send({ filter: NOTES, realms: realmURLs });
      }

      // Whether Lee holds a Boxel account: a row in the realm server's
      // `users` table, which a person gets on their first sign-in. The server
      // is shared by the module, so each test says which it wants.
      async function hasAccount() {
        await getOrCreateUser(db, LEE);
      }

      // A session a realm renders its own cards under.
      function renderSession(user: string) {
        return createRealmServerJWT(
          {
            user,
            sessionRoom: `session-room-${user}`,
            realmAuthority: true as const,
          },
          realmSecretSeed,
        );
      }

      async function hasNoAccount() {
        await query(db, [
          'DELETE FROM users WHERE matrix_user_id =',
          param(LEE),
        ]);
      }

      test('a signed-in user searches a realm they read through its `users` grant, with no policy to grant them `query`', async function (assert) {
        await hasAccount();

        let response = await federatedSearch([MEMBERS], session(LEE));

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          ids(response),
          MEMBERS_NOTES,
          "every one of the realm's rows",
        );
      });

      test("a `users`-grant realm answers alongside a realm the user can't read", async function (assert) {
        await hasAccount();

        let response = await federatedSearch([MEMBERS, PRIVATE], session(LEE));

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          ids(response),
          MEMBERS_NOTES,
          'the rows of the realm the user reads, and none of the other',
        );
      });

      test('a user with no Boxel account finds no rows in a `users`-grant realm', async function (assert) {
        await hasNoAccount();

        let response = await federatedSearch([MEMBERS], session(LEE));

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(ids(response), [], 'no rows');
      });

      test('the endpoints that refuse an unreadable realm answer a user who reads it through its `users` grant', async function (assert) {
        await hasAccount();
        let token = session(LEE);

        for (let { path, accept } of REFUSING_ENDPOINTS) {
          let send = (realmURLs: string[]) =>
            request
              .post(path)
              .set('X-HTTP-Method-Override', 'QUERY')
              .set('Accept', accept)
              .set('Authorization', `Bearer ${token}`)
              .send({ realms: realmURLs });

          let members = await send([MEMBERS]);
          assert.strictEqual(
            members.status,
            200,
            `${path} answers for the realm the user reads through its \`users\` grant`,
          );

          let both = await send([MEMBERS, PRIVATE]);
          assert.strictEqual(
            both.status,
            403,
            `${path} still refuses a realm the user can't read`,
          );
        }
      });

      test('the endpoints that refuse an unreadable realm refuse a `users`-grant realm to a user with no Boxel account', async function (assert) {
        await hasNoAccount();
        let token = session(LEE);

        for (let { path, accept } of REFUSING_ENDPOINTS) {
          let response = await request
            .post(path)
            .set('X-HTTP-Method-Override', 'QUERY')
            .set('Accept', accept)
            .set('Authorization', `Bearer ${token}`)
            .send({ realms: [MEMBERS] });
          assert.strictEqual(response.status, 403, `${path} refuses the realm`);
        }
      });

      test("a realm's render finds no rows in a `users`-grant realm, since what it renders is served to callers who aren't signed in", async function (assert) {
        await hasAccount();

        let response = await federatedSearch([MEMBERS], renderSession(LEE));

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(ids(response), [], 'no rows');
      });

      test('an archived realm reads to no one through its `users` grant', async function (assert) {
        await hasAccount();

        let search = await federatedSearch([ARCHIVED], session(LEE));
        assert.strictEqual(search.status, 200, 'HTTP 200 status');
        assert.deepEqual(ids(search), [], 'no rows');

        let types = await request
          .post('/_federated-types')
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Accept', 'application/json')
          .set('Authorization', `Bearer ${session(LEE)}`)
          .send({ realms: [ARCHIVED] });
        assert.strictEqual(types.status, 403, 'a refusing endpoint refuses it');
      });

      test("a realm anyone may read answers a user whose own row on it doesn't grant `read`", async function (assert) {
        await hasNoAccount();

        let response = await federatedSearch([OPEN], session(LEE));

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(ids(response), OPEN_NOTES, "the realm's rows");
      });
    },
  );
});
