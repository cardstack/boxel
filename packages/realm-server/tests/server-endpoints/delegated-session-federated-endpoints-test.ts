import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import jwt from 'jsonwebtoken';
import sinon from 'sinon';
import {
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
import { AuthenticationErrorMessages } from '@cardstack/runtime-common/router';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import {
  DELEGATED_USER_REALM_SESSION_SIGNATURE_HEADER,
  DELEGATED_USER_REALM_SESSION_TIMESTAMP_HEADER,
  delegatedUserRealmSessionSignature,
} from '@cardstack/runtime-common/user-delegated-realm-server-session';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../../handlers/handle-fetch-catalog-realms.ts';
import type { RealmHttpServer as Server } from '../../server.ts';
import { createJWT as createDelegatedJWT } from '../../jwt.ts';
import { createJWT as createRealmServerJWT } from '../../utils/jwt.ts';
import {
  aiBotDelegationSecret,
  closeServer,
  createVirtualNetwork,
  matrixURL,
  realmConfigCardJSON,
  realmSecretSeed,
  runTestRealmServerWithRealms,
  setupDB,
} from '../helpers/index.ts';
import { setupCatalogTestSubset } from '../helpers/catalog-test-subset.ts';

// ============================================================================
// A delegated session on the endpoints that answer for several realms at once.
//
// `/_delegate-session` mints a read-only session for a user on one realm. The
// federated endpoints hold it to that realm, as the realm itself does: it
// reads the realm it was minted for, and naming any other refuses the request.
//
// - Lib: anyone may read it, token or not. It holds the note type.
// - Home and Second: the user reads both outright.
// - Members: any registered Matrix user reads it, through its `users` grant.
// - Policy: the user may not read it, and its policy grants a `query` over its
//   open notes to every signed-in caller, so a full session for the user finds
//   one row there that a delegated session must never reach.
// ============================================================================

const SERVER = 'http://127.0.0.1:4444/';
const LIB = `${SERVER}lib/`;
const HOME = `${SERVER}home/`;
const SECOND = `${SERVER}second/`;
const POLICY = `${SERVER}policy/`;
const MEMBERS = `${SERVER}members/`;

const OWNER = '@owner:localhost';
const JANE = '@jane:localhost';
// Reads Home only, and has their sessions revoked partway through a test.
const KIM = '@kim:localhost';
// Holds no permission row anywhere, and reads Members through its `users`
// grant whenever the homeserver has a profile for them.
const LEE = '@lee:localhost';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const NOTE = { module: `${LIB}note`, name: 'Note' };
const NOTES = { 'item.on': NOTE };

const NOTE_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";

  export class Note extends CardDef {
    @field title = contains(StringField);
    @field status = contains(StringField);
  }
`;

function note(title: string, status: string) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { title, status },
      meta: {
        adoptsFrom: { module: rri(NOTE.module), name: NOTE.name },
      },
    },
  });
}

const POLICY_CARD = JSON.stringify({
  data: {
    type: 'card',
    attributes: {
      rules: [
        {
          targetType: NOTE,
          grants: [{ operation: 'query', where: '.status == "open"' }],
        },
      ],
    },
    meta: { adoptsFrom: REALM_POLICY },
  },
});

const HOME_NOTES = [`${HOME}notes/one`, `${HOME}notes/two`];
const SECOND_NOTES = [`${SECOND}notes/one`];
const POLICY_OPEN_NOTES = [`${POLICY}notes/open`];
const MEMBERS_NOTES = [`${MEMBERS}notes/one`];

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
  module('a delegated session on the federated endpoints', function (hooks) {
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
            realmURL: new URL(HOME),
            fileSystem: {
              'notes/one.json': note('Home one', 'open'),
              'notes/two.json': note('Home two', 'closed'),
            },
            permissions: { ...owner, [JANE]: ['read'], [KIM]: ['read'] },
          },
          {
            realmURL: new URL(SECOND),
            fileSystem: { 'notes/one.json': note('Second one', 'open') },
            permissions: { ...owner, [JANE]: ['read'] },
          },
          {
            realmURL: new URL(POLICY),
            fileSystem: {
              'realm.json': realmConfigCardJSON({
                name: 'Policy',
                policy: `${POLICY}policies/policy`,
              }),
              'policies/policy.json': POLICY_CARD,
              'notes/open.json': note('Policy open', 'open'),
              'notes/closed.json': note('Policy closed', 'closed'),
            },
            permissions: { ...owner },
          },
          {
            realmURL: new URL(MEMBERS),
            fileSystem: { 'notes/one.json': note('Members one', 'open') },
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
    }

    setupCatalogTestSubset(hooks);

    // One server for the whole module: only the revocation test changes
    // anything, and it changes only its own user. Booting it indexes five
    // realms inside the first test's budget, so that budget is extended.
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

    // A session minted the way the AI bot mints one.
    async function mintDelegatedSession(
      user: string,
      realmURL: string,
    ): Promise<string> {
      let rawBody = JSON.stringify({ onBehalfOf: user, realm: realmURL });
      let timestamp = String(Date.now());
      let response = await request
        .post('/_delegate-session')
        .set('Content-Type', 'application/json')
        .set(DELEGATED_USER_REALM_SESSION_TIMESTAMP_HEADER, timestamp)
        .set(
          DELEGATED_USER_REALM_SESSION_SIGNATURE_HEADER,
          delegatedUserRealmSessionSignature(
            aiBotDelegationSecret,
            timestamp,
            rawBody,
          ),
        )
        .send(rawBody);
      if (response.status !== 200) {
        throw new Error(
          `minting a delegated session for ${user} on ${realmURL} answered ${response.status}`,
        );
      }
      return response.body.token;
    }

    // A session for a user the realm refuses, which the endpoint won't mint,
    // signed with the claims the endpoint signs.
    function signDelegatedSession(user: string, realmURL: string) {
      return createDelegatedJWT(
        {
          user,
          realm: realmURL,
          permissions: ['read'],
          sessionRoom: undefined,
          realmServerURL: SERVER,
          delegated: true,
        },
        '30m',
        realmSecretSeed,
      );
    }

    function fullSession(user: string) {
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

    test('a delegated session searches the realm it was minted for', async function (assert) {
      let token = await mintDelegatedSession(JANE, HOME);

      let response = await federatedSearch([HOME], token);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.deepEqual(ids(response), HOME_NOTES, "the realm's rows");
    });

    test('a delegated session naming another realm its user reads is refused', async function (assert) {
      let token = await mintDelegatedSession(JANE, HOME);

      let alongside = await federatedSearch([HOME, SECOND], token);
      assert.strictEqual(alongside.status, 401, 'HTTP 401 status');
      assert.deepEqual(
        alongside.body.errors,
        [AuthenticationErrorMessages.TokenInvalid],
        'refused as the realm refuses a token minted for another realm',
      );

      let alone = await federatedSearch([SECOND], token);
      assert.strictEqual(
        alone.status,
        401,
        'and refused when it names only the other realm',
      );
    });

    test('a delegated session is refused a realm anyone may read', async function (assert) {
      let anonymous = await request
        .post('/_federated-search')
        .set('Accept', SupportedMimeType.CardJson)
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .send({ realms: [LIB] });
      assert.strictEqual(
        anonymous.status,
        200,
        'the realm answers a request that carries no token',
      );

      let token = await mintDelegatedSession(JANE, HOME);
      let delegated = await federatedSearch([LIB], token);
      assert.strictEqual(
        delegated.status,
        401,
        'and refuses one that carries a session minted for another realm',
      );
      assert.deepEqual(delegated.body.errors, [
        AuthenticationErrorMessages.TokenInvalid,
      ]);
    });

    test("a delegated session reads a realm its user reads through the realm's `users` grant", async function (assert) {
      sinon
        .stub(MatrixClient.prototype, 'getProfile')
        .resolves({ displayname: 'Lee' });
      let token = await mintDelegatedSession(LEE, MEMBERS);

      let response = await federatedSearch([MEMBERS], token);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.deepEqual(ids(response), MEMBERS_NOTES, "the realm's rows");
    });

    test('a delegated session whose user has no Matrix profile is refused a `users`-grant realm', async function (assert) {
      sinon.stub(MatrixClient.prototype, 'getProfile').resolves(undefined);
      let token = signDelegatedSession(LEE, MEMBERS);

      let response = await federatedSearch([MEMBERS], token);

      assert.strictEqual(response.status, 401, 'HTTP 401 status');
      assert.deepEqual(response.body.errors, [
        AuthenticationErrorMessages.PermissionMismatch,
      ]);
    });

    test('a full session for the same user searches every realm it reads', async function (assert) {
      let response = await federatedSearch([HOME, SECOND], fullSession(JANE));

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.deepEqual(
        ids(response),
        [...HOME_NOTES, ...SECOND_NOTES].sort(),
        'rows from both realms',
      );
    });

    test("a delegated session composes no grant from a policy realm its user can't read", async function (assert) {
      let full = await federatedSearch([HOME, POLICY], fullSession(JANE));
      assert.strictEqual(full.status, 200, 'a full session is answered');
      assert.deepEqual(
        ids(full),
        [...HOME_NOTES, ...POLICY_OPEN_NOTES].sort(),
        "a full session finds the rows the policy realm's grant admits",
      );

      let token = await mintDelegatedSession(JANE, HOME);
      let alongside = await federatedSearch([HOME, POLICY], token);
      assert.strictEqual(
        alongside.status,
        401,
        'a delegated session naming the policy realm beside its own is refused',
      );
      assert.deepEqual(alongside.body.errors, [
        AuthenticationErrorMessages.TokenInvalid,
      ]);

      // Bound to the policy realm itself, as a session minted while its user
      // still read the realm is.
      let bound = signDelegatedSession(JANE, POLICY);
      let unread = await federatedSearch([POLICY], bound);
      assert.strictEqual(
        unread.status,
        401,
        'a delegated session whose user does not read its realm is refused, not handed to the policy',
      );
      assert.deepEqual(
        unread.body.errors,
        [AuthenticationErrorMessages.PermissionMismatch],
        'refused as the realm refuses it',
      );
    });

    test('the endpoints that refuse an unreadable realm refuse the delegated session for another realm too', async function (assert) {
      let token = await mintDelegatedSession(JANE, HOME);

      for (let { path, accept } of REFUSING_ENDPOINTS) {
        let send = (realmURLs: string[]) =>
          request
            .post(path)
            .set('X-HTTP-Method-Override', 'QUERY')
            .set('Accept', accept)
            .set('Authorization', `Bearer ${token}`)
            .send({ realms: realmURLs });

        let own = await send([HOME]);
        assert.strictEqual(
          own.status,
          200,
          `${path} answers for the realm the session was minted for`,
        );

        let other = await send([SECOND]);
        assert.strictEqual(
          other.status,
          401,
          `${path} refuses the realm it was not minted for`,
        );
        assert.deepEqual(other.body.errors, [
          AuthenticationErrorMessages.TokenInvalid,
        ]);
      }
    });

    test("a revoked user's delegated session stays refused", async function (assert) {
      let token = await mintDelegatedSession(KIM, HOME);
      let before = await federatedSearch([HOME], token);
      assert.strictEqual(before.status, 200, 'answered before revocation');

      // Recorded a second after the session was issued, so the verdict does
      // not hang on which side of a second boundary the mint fell.
      let { iat } = jwt.decode(token) as { iat: number };
      await query(db, [
        'INSERT INTO users (matrix_user_id, sessions_revoked_at) VALUES (',
        param(KIM),
        ',',
        param(iat + 1),
        ') ON CONFLICT (matrix_user_id) DO UPDATE SET sessions_revoked_at = EXCLUDED.sessions_revoked_at',
      ]);

      let after = await federatedSearch([HOME], token);
      assert.strictEqual(after.status, 401, 'HTTP 401 status');
      assert.deepEqual(after.body.errors, [
        AuthenticationErrorMessages.SessionRevoked,
      ]);
    });
  });
});
