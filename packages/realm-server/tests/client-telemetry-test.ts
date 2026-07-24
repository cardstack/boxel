import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import { logger } from '@cardstack/runtime-common';
import {
  setupDB,
  runTestRealmServer,
  createVirtualNetwork,
  fixtureDir,
  matrixURL,
  closeServer,
  realmSecretSeed,
} from './helpers/index.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
import type { SuperTest, Test } from 'supertest';
import supertest from 'supertest';
import type { RealmHttpServer as Server } from '../server.ts';
import { dirSync, type DirResult } from 'tmp';
import fsExtra from 'fs-extra';
const { copySync, ensureDirSync } = fsExtra;

const testRealmURL = new URL('http://127.0.0.1:0/test/');
const AUTHED_USER = 'matrix-user-id';

// Collect the JSON lines the handler emits on the boxel:client-perf channel
// while `fn` runs. The handler and this test share the same named-logger
// singleton, so overriding its methodFactory taps exactly its output.
async function withPerfLogCapture(
  fn: (captured: string[]) => Promise<void>,
): Promise<void> {
  let perfLog = logger('boxel:client-perf');
  let captured: string[] = [];
  let originalFactory = perfLog.methodFactory;
  let originalLevel = perfLog.getLevel();
  perfLog.methodFactory = (methodName, level, loggerName) => {
    let raw = originalFactory(methodName, level, loggerName);
    return (...args) => {
      if (methodName === 'info' && typeof args[0] === 'string') {
        captured.push(args[0]);
      }
      raw(...args);
    };
  };
  perfLog.setLevel('info'); // rebuild the method bindings with the tap installed
  try {
    await fn(captured);
  } finally {
    perfLog.methodFactory = originalFactory;
    perfLog.setLevel(originalLevel);
  }
}

function perfLines(captured: string[]): Record<string, any>[] {
  return captured
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, any>;
      } catch {
        return null;
      }
    })
    .filter(
      (o): o is Record<string, any> =>
        o != null && o.channel === 'boxel:client-perf',
    );
}

module(basename(import.meta.filename), function () {
  module('client telemetry endpoint', function (hooks) {
    let testRealmServer: Server;
    let request: SuperTest<Test>;
    let dir: DirResult;
    let dbAdapter: PgAdapter;
    let token: RealmServerTokenClaim;

    hooks.beforeEach(async function () {
      dir = dirSync();
    });

    setupDB(hooks, {
      beforeEach: async (_dbAdapter, publisher, runner) => {
        dbAdapter = _dbAdapter;
        let testRealmDir = join(dir.name, 'realm_server_telemetry', 'test');
        ensureDirSync(testRealmDir);
        copySync(fixtureDir('simple'), testRealmDir);

        testRealmServer = (
          await runTestRealmServer({
            virtualNetwork: createVirtualNetwork(),
            testRealmDir,
            realmsRootPath: join(dir.name, 'realm_server_telemetry'),
            realmURL: testRealmURL,
            dbAdapter,
            publisher,
            runner,
            matrixURL,
          })
        ).testRealmHttpServer;
        request = supertest(testRealmServer);
        token = { user: AUTHED_USER, sessionRoom: 'test-session' };
      },
      afterEach: async () => {
        await closeServer(testRealmServer);
      },
    });

    function post(opts?: { authed?: boolean }) {
      let builder = request
        .post('/_client-telemetry')
        .set('Content-Type', 'application/json');
      if (opts?.authed !== false) {
        builder = builder.set(
          'Authorization',
          `Bearer ${createRealmServerJWT(token, realmSecretSeed)}`,
        );
      }
      return builder;
    }

    test('rejects an unauthenticated beacon', async function (assert) {
      let response = await post({ authed: false }).send(
        JSON.stringify({ events: [{ event_type: 'card-load' }] }),
      );
      assert.strictEqual(response.status, 401, 'no token is rejected');
    });

    test('accepts a batch and emits one line per event', async function (assert) {
      await withPerfLogCapture(async (captured) => {
        let response = await post().send(
          JSON.stringify({
            session_id: 'sess-1',
            env: 'test',
            events: [
              { event_type: 'card-load', card_id: 'a', settle_ms: 5 },
              { event_type: 'wedge', blocked_ms: 10 },
            ],
          }),
        );
        assert.strictEqual(response.status, 204, 'a valid batch returns 204');
        let lines = perfLines(captured);
        assert.strictEqual(lines.length, 2, 'one JSON line per event');
        assert.deepEqual(
          lines.map((l) => l.event_type).sort(),
          ['card-load', 'wedge'],
          'both event types were emitted',
        );
        assert.true(
          lines.every((l) => l.session_id === 'sess-1'),
          'the envelope session id is stamped on each line',
        );
      });
    });

    test('applies the authenticated user over a spoofed one and cannot be forced to forge the channel', async function (assert) {
      await withPerfLogCapture(async (captured) => {
        let response = await post().send(
          JSON.stringify({
            // Client-supplied envelope claiming to be someone else.
            matrix_user_id: '@attacker:evil',
            channel: 'forged-channel',
            events: [
              {
                event_type: 'wedge',
                // A per-event field trying to overwrite the trusted envelope.
                channel: 'forged-channel',
                matrix_user_id: '@attacker:evil',
                blocked_ms: 1,
              },
            ],
          }),
        );
        assert.strictEqual(response.status, 204);
        let lines = perfLines(captured);
        assert.strictEqual(lines.length, 1, 'one line emitted');
        assert.strictEqual(
          lines[0].matrix_user_id,
          AUTHED_USER,
          'the JWT-authenticated user wins over the client-supplied id',
        );
        assert.strictEqual(
          lines[0].channel,
          'boxel:client-perf',
          'the trusted channel cannot be overwritten by a per-event field',
        );
      });
    });

    test('rejects a beacon with no declared length', async function (assert) {
      // An empty body carries Content-Length: 0, which must not slip past the
      // pre-read size gate as a zero-length payload.
      let response = await post();
      assert.strictEqual(response.status, 411, 'a length is required');
    });

    test('rejects an oversized beacon before parsing', async function (assert) {
      let response = await post().send(
        JSON.stringify({ events: [], pad: 'x'.repeat(300 * 1024) }),
      );
      assert.strictEqual(
        response.status,
        413,
        'a declared length over the cap is rejected',
      );
    });

    test('rejects malformed JSON', async function (assert) {
      let response = await post().send('{ not valid json ');
      assert.strictEqual(response.status, 400, 'unparseable body is a 400');
    });

    test('rejects a body without an events array', async function (assert) {
      let response = await post().send(JSON.stringify({ session_id: 'x' }));
      assert.strictEqual(
        response.status,
        400,
        'a missing events array is a 400',
      );
    });

    test('rejects a batch over the event-count cap', async function (assert) {
      let events = Array.from({ length: 501 }, () => ({
        event_type: 'keepalive',
      }));
      let response = await post().send(JSON.stringify({ events }));
      assert.strictEqual(
        response.status,
        400,
        'too many events in one batch is a 400',
      );
    });
  });
});
