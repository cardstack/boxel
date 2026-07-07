import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Test, SuperTest } from 'supertest';
import type { DirResult } from 'tmp';
import type { Realm } from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import type { RealmHttpServer as Server } from '../../server.ts';
import {
  realmSecretSeed,
  setupPermissionedRealmCached,
  setupMatrixRoom,
  testRealmHref,
  testRealmURL,
  waitForRealmEvent,
} from '../helpers/index.ts';
import {
  WORKER_REALM_EVENT_SIGNATURE_HEADER,
  WORKER_REALM_EVENT_TIMESTAMP_HEADER,
  workerRealmEventSignature,
} from '@cardstack/runtime-common/worker-realm-event';

function signedPost(
  request: SuperTest<Test>,
  rawBody: string,
  opts: {
    timestamp?: number;
    secret?: string;
    signature?: string;
    omitTimestamp?: boolean;
    omitSignature?: boolean;
  } = {},
) {
  let timestamp = String(opts.timestamp ?? Date.now());
  let signature =
    opts.signature ??
    workerRealmEventSignature(
      opts.secret ?? realmSecretSeed,
      timestamp,
      rawBody,
    );
  let req = request
    .post('/_worker-event')
    .set('Content-Type', 'application/json');
  if (!opts.omitTimestamp) {
    req = req.set(WORKER_REALM_EVENT_TIMESTAMP_HEADER, timestamp);
  }
  if (!opts.omitSignature) {
    req = req.set(WORKER_REALM_EVENT_SIGNATURE_HEADER, signature);
  }
  return req.send(rawBody);
}

module(`server-endpoints/${basename(import.meta.filename)}`, function () {
  module('POST /_worker-event', function (hooks) {
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let serverRequest: SuperTest<Test>;
    let dir: DirResult;
    let dbAdapter: PgAdapter;

    function onRealmSetup(args: {
      testRealm: Realm;
      testRealmHttpServer: Server;
      request: SuperTest<Test>;
      dir: DirResult;
      dbAdapter: PgAdapter;
    }) {
      testRealm = args.testRealm;
      testRealmHttpServer = args.testRealmHttpServer;
      serverRequest = args.request;
      dir = args.dir;
      dbAdapter = args.dbAdapter;
    }

    function getRealmSetup() {
      return {
        testRealm,
        testRealmHttpServer,
        request: serverRequest,
        serverRequest,
        dir,
        dbAdapter,
      };
    }

    setupPermissionedRealmCached(hooks, {
      fixture: 'simple',
      realmURL: testRealmURL,
      subscribeToRealmEvents: true,
      permissions: {
        '*': ['read'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
      },
      onRealmSetup,
    });

    let { getMessagesSince } = setupMatrixRoom(hooks, getRealmSetup);

    test('broadcasts a worker-originated realm event to subscribed hosts exactly once', async function (assert) {
      let clientRequestId = `worker-event-test-${Date.now()}`;
      let event = {
        eventName: 'index',
        indexType: 'incremental',
        invalidations: [`${testRealmHref}person.gts`],
        clientRequestId,
        realmURL: testRealmHref,
      };
      let since = Date.now();

      let response = await signedPost(serverRequest, JSON.stringify({ event }));
      assert.strictEqual(response.status, 200, 'HTTP 200');
      assert.deepEqual(response.body, { ok: true }, 'endpoint reports ok');

      let realmEvent = await waitForRealmEvent(getMessagesSince, since, {
        predicate: (e) =>
          e.content.eventName === 'index' &&
          (e.content as any).clientRequestId === clientRequestId,
        timeoutMessage:
          'timed out waiting for the worker-originated realm event to reach the matrix room',
      });
      assert.strictEqual(
        (realmEvent.content as any).indexType,
        'incremental',
        'event carries the indexType from the worker',
      );
      assert.deepEqual(
        (realmEvent.content as any).invalidations,
        [`${testRealmHref}person.gts`],
        'event carries the invalidations from the worker',
      );
      assert.strictEqual(
        realmEvent.content.realmURL,
        testRealmHref,
        'event is stamped with the resolved realm url',
      );

      // Exactly-once: only one event in the room carries our unique id.
      let messages = await getMessagesSince(since);
      let matching = messages.filter(
        (m) => (m.content as any)?.clientRequestId === clientRequestId,
      );
      assert.strictEqual(
        matching.length,
        1,
        'the event is delivered exactly once (no per-replica fan-out)',
      );
    });

    test('rejects a request with no signature or timestamp (401)', async function (assert) {
      let response = await signedPost(
        serverRequest,
        JSON.stringify({
          event: {
            eventName: 'index',
            indexType: 'incremental',
            invalidations: [],
            realmURL: testRealmHref,
          },
        }),
        { omitSignature: true, omitTimestamp: true },
      );
      assert.strictEqual(response.status, 401, 'HTTP 401');
    });

    test('rejects a request with an invalid signature (401)', async function (assert) {
      let response = await signedPost(
        serverRequest,
        JSON.stringify({
          event: {
            eventName: 'index',
            indexType: 'incremental',
            invalidations: [],
            realmURL: testRealmHref,
          },
        }),
        { signature: 'deadbeef'.repeat(8) },
      );
      assert.strictEqual(response.status, 401, 'HTTP 401');
    });

    test('rejects a request signed with the wrong secret (401)', async function (assert) {
      let response = await signedPost(
        serverRequest,
        JSON.stringify({
          event: {
            eventName: 'index',
            indexType: 'incremental',
            invalidations: [],
            realmURL: testRealmHref,
          },
        }),
        { secret: 'not-the-shared-secret' },
      );
      assert.strictEqual(response.status, 401, 'HTTP 401');
    });

    test('rejects a stale timestamp outside the ±60s window (401)', async function (assert) {
      let response = await signedPost(
        serverRequest,
        JSON.stringify({
          event: {
            eventName: 'index',
            indexType: 'incremental',
            invalidations: [],
            realmURL: testRealmHref,
          },
        }),
        { timestamp: Date.now() - 61_000 },
      );
      assert.strictEqual(response.status, 401, 'HTTP 401');
    });

    test('returns 404 for a realm not hosted on this server', async function (assert) {
      let response = await signedPost(
        serverRequest,
        JSON.stringify({
          event: {
            eventName: 'index',
            indexType: 'incremental',
            invalidations: [],
            realmURL: 'http://127.0.0.1:9999/does-not-exist/',
          },
        }),
      );
      assert.strictEqual(response.status, 404, 'HTTP 404');
    });

    test('returns 400 for a body missing the event realmURL', async function (assert) {
      let response = await signedPost(
        serverRequest,
        JSON.stringify({ event: { eventName: 'index' } }),
      );
      assert.strictEqual(response.status, 400, 'HTTP 400');
    });

    test('returns 400 for a body that is not valid JSON', async function (assert) {
      let response = await signedPost(serverRequest, 'this is not json');
      assert.strictEqual(response.status, 400, 'HTTP 400');
    });
  });
});
