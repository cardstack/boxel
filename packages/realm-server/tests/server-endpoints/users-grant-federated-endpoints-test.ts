import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import sinon from 'sinon';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
  RealmPermissions,
} from '@cardstack/runtime-common';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
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
import { setupCatalogTestSubset } from '../helpers/catalog-test-subset.ts';

// ============================================================================
// A signed-in session on the endpoints that answer for several realms at once,
// for a realm it reads only through the realm's `users` grant.
//
// A realm's `users` grant lets every caller with a Matrix account read it, and
// the federated endpoints read it to such a caller as the realm itself does.
//
// - Lib: anyone may read it, token or not. It holds the note type.
// - Members: any registered Matrix user reads it, through its `users` grant.
//   It names no policy.
// - Private: only its owner reads it. It names no policy.
// ============================================================================

const SERVER = 'http://127.0.0.1:4444/';
const LIB = `${SERVER}lib/`;
const MEMBERS = `${SERVER}members/`;
const PRIVATE = `${SERVER}private/`;

const OWNER = '@owner:localhost';
// Holds no permission row anywhere.
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

      async function start({
        dbAdapter,
        publisher,
        runner,
      }: {
        dbAdapter: PgAdapter;
        publisher: QueuePublisher;
        runner: QueueRunner;
      }) {
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
          ],
          dbAdapter,
          publisher,
          runner,
          matrixURL,
        });
        server = result.testRealmHttpServer;
        request = supertest(server);
        realms = result.realms;
      }

      setupCatalogTestSubset(hooks);

      // One server for the whole module: no test changes any realm. Booting it
      // indexes three realms inside the first test's budget, so that budget is
      // extended.
      hooks.before(function (assert) {
        assert.timeout(300_000);
      });

      hooks.afterEach(function () {
        sinon.restore();
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

      function hasProfile() {
        sinon
          .stub(MatrixClient.prototype, 'getProfile')
          .resolves({ displayname: 'Lee' });
      }

      function hasNoProfile() {
        sinon.stub(MatrixClient.prototype, 'getProfile').resolves(undefined);
      }

      test('a signed-in user searches a realm they read through its `users` grant, with no policy to grant them `query`', async function (assert) {
        hasProfile();

        let response = await federatedSearch([MEMBERS], session(LEE));

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          ids(response),
          MEMBERS_NOTES,
          "every one of the realm's rows",
        );
      });

      test("a `users`-grant realm answers alongside a realm the user can't read", async function (assert) {
        hasProfile();

        let response = await federatedSearch([MEMBERS, PRIVATE], session(LEE));

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          ids(response),
          MEMBERS_NOTES,
          'the rows of the realm the user reads, and none of the other',
        );
      });

      test('a user with no Matrix profile finds no rows in a `users`-grant realm', async function (assert) {
        hasNoProfile();

        let response = await federatedSearch([MEMBERS], session(LEE));

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(ids(response), [], 'no rows');
      });

      test('the endpoints that refuse an unreadable realm answer a user who reads it through its `users` grant', async function (assert) {
        hasProfile();
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

      test('the endpoints that refuse an unreadable realm refuse a `users`-grant realm to a user with no Matrix profile', async function (assert) {
        hasNoProfile();
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
    },
  );
});
