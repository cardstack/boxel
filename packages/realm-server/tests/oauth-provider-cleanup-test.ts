import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { randomBytes } from 'crypto';
import type { PgAdapter } from '@cardstack/postgres';
import type {
  DefinitionLookup,
  IndexWriter,
  OAuthProviderCleanup,
  Prerenderer,
  QueuePublisher,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import { logger, oauthProviderCleanup } from '@cardstack/runtime-common';
import { insertUser, setupDB } from './helpers/index.ts';
import {
  DISCONNECTED_CLIENT_RETENTION_SECONDS,
  ENDED_GRANT_RETENTION_SECONDS,
  UNCONNECTED_CLIENT_RETENTION_SECONDS,
  deleteExpiredOAuthProviderRows,
} from '../lib/oauth-provider/cleanup.ts';
import { newDynamicClientId } from '../lib/oauth-provider/dynamic-client-id.ts';

const MINUTE = 60;
const DAY = 24 * 60 * 60;

// Every short-lived kind the provider stores in `oauth_provider_objects`.
const OBJECT_KINDS = [
  'Interaction',
  'Session',
  'AuthorizationCode',
  'ErrorReference',
  'ConsentDecision',
  'ConsentTicket',
];

// Times are given in seconds before now; a negative one is in the future.
// Each is applied by the database, as the cleanup's own `now()` is, so a
// boundary a minute either side of a retention period is exact.
type SecondsAgo = number;

module(basename(import.meta.filename), function (hooks) {
  let dbAdapter: PgAdapter;
  let userId: string;

  setupDB(hooks, {
    beforeEach: async (_dbAdapter: PgAdapter) => {
      dbAdapter = _dbAdapter;
      let matrixId = `@cleanup-${randomBytes(6).toString('hex')}:localhost`;
      ({ id: userId } = await insertUser(
        dbAdapter,
        matrixId,
        `cus_${matrixId}`,
        null,
      ));
    },
  });

  function cleanup() {
    return deleteExpiredOAuthProviderRows(dbAdapter);
  }

  async function insertObject(
    kind: string,
    expires: SecondsAgo,
  ): Promise<void> {
    await dbAdapter.execute(
      `INSERT INTO oauth_provider_objects (kind, id_hash, payload, expires_at)
         VALUES ($1, decode(md5(random()::text), 'hex'), '{}'::jsonb,
                 now() - make_interval(secs => $2))`,
      { bind: [kind, expires] },
    );
  }

  // A grant whose code was exchanged when it was created, unless `exchanged`
  // is false.
  async function insertGrant({
    clientId = newDynamicClientId(),
    created = 1 * DAY,
    expires,
    ended = null,
    exchanged = true,
  }: {
    clientId?: string;
    created?: SecondsAgo;
    expires: SecondsAgo;
    ended?: SecondsAgo | null;
    exchanged?: boolean;
  }): Promise<string> {
    let id = randomBytes(32).toString('base64url');
    await dbAdapter.execute(
      `INSERT INTO oauth_provider_grants
         (id, user_id, client_id, resources, renewing, created_at, expires_at,
          ended_at, ended_reason, exchanged_at)
         VALUES ($1, $2, $3, '{}'::jsonb, true,
                 now() - make_interval(secs => $4),
                 now() - make_interval(secs => $5),
                 CASE WHEN $6::float8 IS NULL THEN NULL
                      ELSE now() - make_interval(secs => $6::float8) END,
                 CASE WHEN $6::float8 IS NULL THEN NULL ELSE 'user' END,
                 CASE WHEN $7::boolean
                      THEN now() - make_interval(secs => $4) END)`,
      { bind: [id, userId, clientId, created, expires, ended, exchanged] },
    );
    return id;
  }

  async function insertTokens(
    grantId: string,
    kind: 'AccessToken' | 'RefreshToken',
    expires: SecondsAgo,
    count = 1,
  ): Promise<void> {
    await dbAdapter.execute(
      `INSERT INTO oauth_provider_tokens
         (id_hash, kind, grant_id, scope, payload, expires_at, rotation)
         SELECT decode(md5(random()::text || n::text), 'hex'), $1::varchar, $2, '',
                '{}'::jsonb, now() - make_interval(secs => $3),
                CASE WHEN $1::varchar = 'RefreshToken' THEN 0 END
           FROM generate_series(1, $4) AS n`,
      { bind: [kind, grantId, expires, count] },
    );
  }

  async function insertClient({
    registered,
    lastConnected = null,
  }: {
    registered: SecondsAgo;
    lastConnected?: SecondsAgo | null;
  }): Promise<string> {
    let clientId = newDynamicClientId();
    await dbAdapter.execute(
      `INSERT INTO oauth_provider_dynamic_clients
         (client_id, metadata, created_at, last_connected_at)
         VALUES ($1, '{}'::jsonb, now() - make_interval(secs => $2),
                 CASE WHEN $3::float8 IS NULL THEN NULL
                      ELSE now() - make_interval(secs => $3::float8) END)`,
      { bind: [clientId, registered, lastConnected] },
    );
    return clientId;
  }

  async function ids(table: string, column: string): Promise<string[]> {
    let rows = (await dbAdapter.execute(
      `SELECT ${column} AS id FROM ${table} ORDER BY ${column}`,
    )) as { id: string }[];
    return rows.map(({ id }) => id);
  }

  async function count(table: string): Promise<number> {
    let [{ n }] = (await dbAdapter.execute(
      `SELECT count(*)::int AS n FROM ${table}`,
    )) as { n: number }[];
    return n;
  }

  module('short-lived objects', function () {
    test('each kind is deleted once it expires, and kept a minute before', async function (assert) {
      for (let kind of OBJECT_KINDS) {
        await insertObject(kind, MINUTE);
        await insertObject(kind, -MINUTE);
      }
      let deleted = await cleanup();
      assert.deepEqual(
        deleted.objects,
        Object.fromEntries(OBJECT_KINDS.map((kind) => [kind, 1])),
        'one of each kind is deleted',
      );
      let kept = (await dbAdapter.execute(
        `SELECT kind, expires_at > now() AS current FROM oauth_provider_objects
          ORDER BY kind`,
      )) as { kind: string; current: boolean }[];
      assert.deepEqual(
        kept,
        [...OBJECT_KINDS].sort().map((kind) => ({ kind, current: true })),
        'the current one of each kind is kept',
      );
    });
  });

  module('tokens', function () {
    test('each kind is deleted once it expires, and kept a minute before', async function (assert) {
      let grantId = await insertGrant({ expires: -10 * DAY });
      for (let kind of ['AccessToken', 'RefreshToken'] as const) {
        await insertTokens(grantId, kind, MINUTE);
        await insertTokens(grantId, kind, -MINUTE);
      }
      let deleted = await cleanup();
      assert.deepEqual(deleted.tokens, { AccessToken: 1, RefreshToken: 1 });
      let [{ current }] = (await dbAdapter.execute(
        `SELECT count(*)::int AS current FROM oauth_provider_tokens
          WHERE expires_at > now()`,
      )) as { current: number }[];
      assert.strictEqual(current, 2, 'both current tokens are kept');
      assert.strictEqual(await count('oauth_provider_tokens'), 2);
    });

    test('expired tokens are deleted in batches until none is left', async function (assert) {
      let grantId = await insertGrant({ expires: -10 * DAY });
      await insertTokens(grantId, 'AccessToken', MINUTE, 5001);
      await insertTokens(grantId, 'RefreshToken', MINUTE, 3);
      let deleted = await cleanup();
      assert.deepEqual(deleted.tokens, { AccessToken: 5001, RefreshToken: 3 });
      assert.strictEqual(await count('oauth_provider_tokens'), 0);
    });
  });

  module('grants', function () {
    const RETENTION = ENDED_GRANT_RETENTION_SECONDS;

    test('an ended grant is deleted 90 days after it ended, and kept a minute before', async function (assert) {
      let gone = await insertGrant({
        created: RETENTION + 2 * DAY,
        expires: RETENTION - 20 * DAY,
        ended: RETENTION + MINUTE,
      });
      let kept = await insertGrant({
        created: RETENTION + 2 * DAY,
        expires: RETENTION - 20 * DAY,
        ended: RETENTION - MINUTE,
      });
      let deleted = await cleanup();
      assert.strictEqual(deleted.grants, 1);
      let left = await ids('oauth_provider_grants', 'id');
      assert.false(left.includes(gone), 'the older one is deleted');
      assert.true(left.includes(kept), 'the newer one is kept');
    });

    test('a grant that reached its expiry counts as ended then', async function (assert) {
      let gone = await insertGrant({
        created: RETENTION + 31 * DAY,
        expires: RETENTION + MINUTE,
      });
      let kept = await insertGrant({
        created: RETENTION + 29 * DAY,
        expires: RETENTION - MINUTE,
      });
      await cleanup();
      let left = await ids('oauth_provider_grants', 'id');
      assert.false(left.includes(gone), 'expired 90 days ago: deleted');
      assert.true(left.includes(kept), 'a minute short of that: kept');
    });

    test('ending a grant after it expired does not restart its clock', async function (assert) {
      // As a revocation after a password change ends every grant not yet
      // ended, including ones that expired long before.
      let gone = await insertGrant({
        created: RETENTION + 31 * DAY,
        expires: RETENTION + MINUTE,
        ended: 1 * DAY,
      });
      await cleanup();
      assert.false(
        (await ids('oauth_provider_grants', 'id')).includes(gone),
        'it is deleted 90 days after it expired',
      );
    });

    test('a current grant is kept, and a deleted grant takes its tokens', async function (assert) {
      let live = await insertGrant({ expires: -29 * DAY });
      let gone = await insertGrant({
        created: RETENTION + 2 * DAY,
        expires: RETENTION + DAY,
        ended: RETENTION + MINUTE,
      });
      await insertTokens(live, 'AccessToken', -MINUTE);
      // A token the cleanup's expiry sweep wouldn't reach, under the grant
      // it deletes.
      await insertTokens(gone, 'RefreshToken', -DAY);
      await cleanup();
      assert.deepEqual(await ids('oauth_provider_grants', 'id'), [live]);
      let [{ grant_id }] = (await dbAdapter.execute(
        `SELECT grant_id FROM oauth_provider_tokens`,
      )) as { grant_id: string }[];
      assert.strictEqual(grant_id, live, "only the live grant's token is left");
      assert.strictEqual(await count('oauth_provider_tokens'), 1);
    });
  });

  module('dynamic clients', function () {
    const UNCONNECTED = UNCONNECTED_CLIENT_RETENTION_SECONDS;
    const DISCONNECTED = DISCONNECTED_CLIENT_RETENTION_SECONDS;

    async function clients(): Promise<string[]> {
      return await ids('oauth_provider_dynamic_clients', 'client_id');
    }

    test('a client that never connected is deleted 7 days after it registered, and kept a minute before', async function (assert) {
      let gone = await insertClient({ registered: UNCONNECTED + MINUTE });
      let kept = await insertClient({ registered: UNCONNECTED - MINUTE });
      let deleted = await cleanup();
      assert.strictEqual(deleted.dynamicClients, 1);
      assert.deepEqual(await clients(), [kept]);
      assert.notOk((await clients()).includes(gone));
    });

    test('a connected client is deleted 30 days after its last grant ended, and kept a minute before', async function (assert) {
      let gone = await insertClient({
        registered: 90 * DAY,
        lastConnected: 60 * DAY,
      });
      await insertGrant({
        clientId: gone,
        created: 40 * DAY,
        expires: 10 * DAY,
        ended: DISCONNECTED + MINUTE,
      });
      let kept = await insertClient({
        registered: 90 * DAY,
        lastConnected: 60 * DAY,
      });
      await insertGrant({
        clientId: kept,
        created: 40 * DAY,
        expires: 10 * DAY,
        ended: DISCONNECTED - MINUTE,
      });
      // Its latest grant, not its first, says when it last connected.
      await insertGrant({
        clientId: kept,
        created: 89 * DAY,
        expires: 59 * DAY,
        ended: 80 * DAY,
      });
      await cleanup();
      assert.deepEqual(await clients(), [kept]);
    });

    test('a grant that reached its expiry ended the connection then', async function (assert) {
      let gone = await insertClient({
        registered: 90 * DAY,
        lastConnected: DISCONNECTED + 30 * DAY,
      });
      await insertGrant({
        clientId: gone,
        created: DISCONNECTED + 30 * DAY,
        expires: DISCONNECTED + MINUTE,
      });
      let kept = await insertClient({
        registered: 90 * DAY,
        lastConnected: DISCONNECTED + 30 * DAY,
      });
      await insertGrant({
        clientId: kept,
        created: DISCONNECTED + 30 * DAY,
        expires: DISCONNECTED - MINUTE,
      });
      await cleanup();
      assert.deepEqual(await clients(), [kept]);
    });

    test('a client with a current grant is never deleted', async function (assert) {
      // Marked connected long ago, as no client really is with a current
      // grant, so only the grant keeps it.
      let marked = await insertClient({
        registered: 365 * DAY,
        lastConnected: 300 * DAY,
      });
      await insertGrant({ clientId: marked, expires: -DAY });
      // Not marked at all, as a grant from a realm server on the previous
      // revision leaves it.
      let unmarked = await insertClient({ registered: 365 * DAY });
      await insertGrant({ clientId: unmarked, expires: -DAY });
      let deleted = await cleanup();
      assert.strictEqual(deleted.dynamicClients, 0);
      assert.deepEqual(await clients(), [marked, unmarked].sort());
    });

    test('a client whose grants are all gone is deleted 30 days after it last connected', async function (assert) {
      // Its grants were deleted with their user, say.
      let gone = await insertClient({
        registered: 90 * DAY,
        lastConnected: DISCONNECTED + MINUTE,
      });
      let kept = await insertClient({
        registered: 90 * DAY,
        lastConnected: DISCONNECTED - MINUTE,
      });
      await cleanup();
      assert.deepEqual(await clients(), [kept]);
      assert.notOk((await clients()).includes(gone));
    });

    test('a client with a grant but no mark has connected, and follows the 30-day rule', async function (assert) {
      let gone = await insertClient({ registered: 365 * DAY });
      await insertGrant({
        clientId: gone,
        created: 40 * DAY,
        expires: 10 * DAY,
        ended: DISCONNECTED + MINUTE,
      });
      let kept = await insertClient({ registered: 365 * DAY });
      await insertGrant({
        clientId: kept,
        created: 40 * DAY,
        expires: 10 * DAY,
        ended: DISCONNECTED - MINUTE,
      });
      await cleanup();
      assert.deepEqual(await clients(), [kept]);
    });

    test('a grant whose code was never exchanged connected nothing', async function (assert) {
      // The user approved it, and the app never exchanged the code, so the
      // client is as unused as one nobody approved, live grant or not.
      let gone = await insertClient({ registered: UNCONNECTED + MINUTE });
      await insertGrant({ clientId: gone, expires: -DAY, exchanged: false });
      let kept = await insertClient({ registered: UNCONNECTED - MINUTE });
      await insertGrant({ clientId: kept, expires: -DAY, exchanged: false });
      let deleted = await cleanup();
      assert.strictEqual(deleted.dynamicClients, 1);
      assert.deepEqual(await clients(), [kept]);
    });

    test('a grant with tokens but no exchange recorded has connected', async function (assert) {
      // As a realm server still on the previous revision leaves it.
      let client = await insertClient({ registered: 365 * DAY });
      let grantId = await insertGrant({
        clientId: client,
        expires: -DAY,
        exchanged: false,
      });
      await insertTokens(grantId, 'RefreshToken', -DAY);
      let deleted = await cleanup();
      assert.strictEqual(deleted.dynamicClients, 0);
      assert.deepEqual(await clients(), [client]);
    });

    test('a grant that names a client never registered here is left alone', async function (assert) {
      let documentClient = 'https://app.example/oauth/client.json';
      let grantId = await insertGrant({
        clientId: documentClient,
        created: 40 * DAY,
        expires: 10 * DAY,
        ended: DISCONNECTED + MINUTE,
      });
      let deleted = await cleanup();
      assert.strictEqual(deleted.dynamicClients, 0);
      assert.deepEqual(await ids('oauth_provider_grants', 'id'), [grantId]);
    });
  });

  module('the job', function () {
    function runJob(cleanupFn: OAuthProviderCleanup | undefined) {
      return oauthProviderCleanup({
        reportStatus: () => {},
        log: logger('oauth-provider-cleanup-test'),
        dbAdapter,
        oauthProviderCleanup: cleanupFn,
        queuePublisher: null as unknown as QueuePublisher,
        indexWriter: null as unknown as IndexWriter,
        prerenderer: null as unknown as Prerenderer,
        definitionLookup: null as unknown as DefinitionLookup,
        virtualNetwork: null as unknown as VirtualNetwork,
        matrixURL: 'http://localhost:8008',
        matrixServerName: 'localhost',
        getReader: () => {
          throw new Error('getReader is not used by oauth-provider-cleanup');
        },
        getAuthedFetch: async () => globalThis.fetch,
        createPrerenderAuth: () => '',
      })({});
    }

    test('answers what the cleanup deleted', async function (assert) {
      await insertObject('Interaction', MINUTE);
      await insertClient({
        registered: UNCONNECTED_CLIENT_RETENTION_SECONDS + MINUTE,
      });
      let result = await runJob(cleanup);
      assert.deepEqual(result, {
        objects: { Interaction: 1 },
        tokens: {},
        grants: 0,
        dynamicClients: 1,
      });
    });

    test('a worker without the cleanup deletes nothing', async function (assert) {
      await insertObject('Interaction', MINUTE);
      let result = await runJob(undefined);
      assert.deepEqual(result, {
        objects: {},
        tokens: {},
        grants: 0,
        dynamicClients: 0,
      });
      assert.strictEqual(await count('oauth_provider_objects'), 1);
    });

    test('a failure fails the job', async function (assert) {
      await assert.rejects(
        runJob(async () => {
          throw new Error('the database is gone');
        }),
        /the database is gone/,
      );
    });
  });
});
