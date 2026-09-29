import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest, Response } from 'supertest';
import { existsSync, readFileSync } from 'fs';
import { basename, join } from 'path';
import type { Realm } from '@cardstack/runtime-common';
import { archiveRealm, unarchiveRealm } from '@cardstack/runtime-common';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import {
  setupPermissionedRealmCached,
  testRealmHref,
  testRealmURLFor,
  createJWT,
  realmServerTestMatrix,
  realmSecretSeed,
} from '../helpers/index.ts';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import type { PgAdapter } from '@cardstack/postgres';

// An archived realm is sealed for everyone (owner included): every content
// request to its boundary returns 403 with an "archived" marker, while the
// operational `_readiness-check` stays reachable and unarchiving lifts the
// seal.
module(`realm-endpoints/${basename(import.meta.filename)}`, function () {
  module('archived realm seal', function (hooks) {
    let testRealm: Realm;
    let testRealmPath: string;
    let request: SuperTest<Test>;
    let dbAdapter: PgAdapter;

    setupPermissionedRealmCached(hooks, {
      fixture: 'blank',
      permissions: {
        owner: ['read', 'write', 'realm-owner'],
        member: ['read'],
        '*': ['read'],
      },
      onRealmSetup(args: {
        testRealm: Realm;
        testRealmPath: string;
        request: SuperTest<Test>;
        dbAdapter: PgAdapter;
      }) {
        testRealm = args.testRealm;
        testRealmPath = args.testRealmPath;
        request = args.request;
        dbAdapter = args.dbAdapter;
      },
    });

    function ownerJWT() {
      return `Bearer ${createJWT(testRealm, 'owner', [
        'read',
        'write',
        'realm-owner',
      ])}`;
    }

    function memberJWT() {
      return `Bearer ${createJWT(testRealm, 'member', ['read'])}`;
    }

    function assertArchived403(
      assert: Assert,
      response: Response,
      label: string,
    ) {
      assert.strictEqual(response.status, 403, `${label}: HTTP 403`);
      assert.strictEqual(
        response.get('X-Boxel-Realm-Archived'),
        'true',
        `${label}: carries the X-Boxel-Realm-Archived marker`,
      );
      assert.strictEqual(
        (response.body as any)?.errors?.[0]?.code,
        'archived',
        `${label}: JSON:API error code is "archived"`,
      );
    }

    test('content reads and writes are sealed for everyone while archived; readiness stays open; unarchive lifts the seal', async function (assert) {
      // Baseline: active realm serves content.
      let active = await request
        .get('/_info')
        .set('Accept', 'application/vnd.api+json')
        .set('Authorization', ownerJWT());
      assert.strictEqual(active.status, 200, 'active realm serves /_info');

      // Baseline for the header-less readiness probe on an active realm, so we
      // can assert below that archiving doesn't change how it's handled.
      let activeReadinessNoAccept = await request.get('/_readiness-check');

      await archiveRealm(dbAdapter, new URL(testRealmHref));

      // Reads are sealed for the owner, an authenticated non-owner, and the
      // anonymous public-read caller alike.
      assertArchived403(
        assert,
        await request
          .get('/_info')
          .set('Accept', 'application/vnd.api+json')
          .set('Authorization', ownerJWT()),
        'owner read',
      );
      assertArchived403(
        assert,
        await request
          .get('/_info')
          .set('Accept', 'application/vnd.api+json')
          .set('Authorization', memberJWT()),
        'non-owner read',
      );
      assertArchived403(
        assert,
        await request.get('/_info').set('Accept', 'application/vnd.api+json'),
        'anonymous (public-read) read',
      );

      // Writes are sealed too — the seal short-circuits before card creation,
      // so even the owner's write is refused with the archived marker.
      assertArchived403(
        assert,
        await request
          .post('/')
          .set('Accept', 'application/vnd.card+json')
          .set('Authorization', ownerJWT())
          .send({
            data: {
              attributes: { firstName: 'Mango' },
              meta: { adoptsFrom: { module: '../person.gts', name: 'Person' } },
            },
          }),
        'owner write',
      );

      // The operational readiness probe is exempt so health checks don't read
      // an archived realm as down.
      let readiness = await request
        .get('/_readiness-check')
        .set('Accept', 'application/vnd.api+json');
      assert.strictEqual(
        readiness.status,
        200,
        '_readiness-check stays reachable while archived',
      );

      // The exemption is path-based, not header-based: a bare health probe
      // that sends no `Accept` header is never sealed — it's handled exactly
      // as on an active realm, with no archived marker. (The router itself
      // gates `_readiness-check` on the `Accept` header, so a header-less probe
      // doesn't reach the handler on either an active or archived realm; the
      // point here is that the seal doesn't single it out.)
      let readinessNoAccept = await request.get('/_readiness-check');
      assert.strictEqual(
        readinessNoAccept.status,
        activeReadinessNoAccept.status,
        '_readiness-check with no Accept header is handled the same whether archived or active',
      );
      assert.strictEqual(
        readinessNoAccept.get('X-Boxel-Realm-Archived'),
        undefined,
        '_readiness-check with no Accept header is not given the archived seal',
      );

      // Unarchiving lifts the seal; the active realm is unaffected.
      await unarchiveRealm(dbAdapter, new URL(testRealmHref));
      let restored = await request
        .get('/_info')
        .set('Accept', 'application/vnd.api+json')
        .set('Authorization', ownerJWT());
      assert.strictEqual(
        restored.status,
        200,
        'content is served again after unarchive',
      );
    });

    test('a request for an operational endpoint that the router hands to another route meets the seal', async function (assert) {
      await archiveRealm(dbAdapter, new URL(testRealmHref));
      let card = {
        data: {
          type: 'card',
          attributes: {},
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/card-api',
              name: 'CardDef',
            },
          },
        },
      };

      // Each endpoint's path with a trailing slash is the directory of that
      // name, which the card+json create and the directory listing answer.
      for (let path of ['/_session/', '/_readiness-check/']) {
        assertArchived403(
          assert,
          await request
            .post(path)
            .set('Accept', 'application/vnd.card+json')
            .set('Authorization', ownerJWT())
            .send(card),
          `owner card+json POST ${path}`,
        );
        assertArchived403(
          assert,
          await request
            .get(path)
            .set('Accept', 'application/vnd.api+json')
            .set('Authorization', ownerJWT()),
          `owner directory listing of ${path}`,
        );
      }

      // The endpoints' own paths, asked for under a media type the endpoint
      // does not answer, reach the card+source routes.
      assertArchived403(
        assert,
        await request
          .post('/_session')
          .set('Accept', 'application/vnd.card+source')
          .set('Content-Type', 'text/plain')
          .set('Authorization', ownerJWT())
          .send('written while archived'),
        'owner card+source POST _session',
      );
      assertArchived403(
        assert,
        await request
          .get('/_readiness-check')
          .set('Accept', 'application/vnd.card+source')
          .set('Authorization', ownerJWT()),
        'owner card+source GET _readiness-check',
      );

      for (let path of ['_session', '_readiness-check']) {
        assert.false(
          existsSync(join(testRealmPath, path)),
          `nothing is written at or beneath ${path}`,
        );
      }
    });

    test('the operational endpoints themselves stay reachable while archived', async function (assert) {
      await archiveRealm(dbAdapter, new URL(testRealmHref));

      let matrixClient = new MatrixClient({
        matrixURL: realmServerTestMatrix.url,
        username: realmServerTestMatrix.username,
        seed: realmSecretSeed,
      });
      await matrixClient.login();
      let openIdToken = await matrixClient.getOpenIdToken();
      let session = await request
        .post('/_session')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(openIdToken));
      assert.strictEqual(session.status, 201, '_session authenticates');
      assert.ok(
        session.get('Authorization'),
        '_session issues a session token',
      );

      let readiness = await request
        .get('/_readiness-check')
        .set('Accept', 'application/vnd.api+json');
      assert.strictEqual(readiness.status, 200, '_readiness-check answers');
    });

    test('a readiness probe that no route answers reads nothing the realm stores at its path', async function (assert) {
      // A file stored at the probe's path, which the card+source read serves
      // while the realm is active.
      let stored = 'stored at the probe path';
      let write = await request
        .post('/_readiness-check')
        .set('Accept', 'application/vnd.card+source')
        .set('Content-Type', 'text/plain')
        .set('Authorization', ownerJWT())
        .send(stored);
      assert.strictEqual(write.status, 204, 'the owner stores the file');
      assert.strictEqual(
        readFileSync(join(testRealmPath, '_readiness-check'), 'utf8'),
        stored,
        'the file is stored at the probe path',
      );
      let source = await request
        .get('/_readiness-check')
        .set('Accept', 'application/vnd.card+source')
        .set('Authorization', ownerJWT());
      assert.strictEqual(source.status, 200, 'the card+source read serves it');

      // Probes a health checker sends: no `Accept`, and one that names no
      // media type in particular. Each is told nothing is there, whether the
      // realm is archived or active.
      let probes: [string, string | undefined][] = [
        ['GET', undefined],
        ['GET', '*/*'],
        ['HEAD', undefined],
      ];
      async function assertProbesReadNothing(state: string) {
        for (let [method, accept] of probes) {
          let req =
            method === 'HEAD'
              ? request.head('/_readiness-check')
              : request.get('/_readiness-check');
          if (accept) {
            req = req.set('Accept', accept);
          }
          let response = await req;
          let label = `${state}: ${method} _readiness-check (accept: ${accept ?? 'none'})`;
          assert.strictEqual(
            response.status,
            404,
            `${label} is told nothing is there rather than served the file`,
          );
          assert.strictEqual(
            response.get('X-Boxel-Realm-Archived'),
            undefined,
            `${label} is not given the archived seal`,
          );
        }
      }

      await assertProbesReadNothing('active');
      await archiveRealm(dbAdapter, new URL(testRealmHref));
      await assertProbesReadNothing('archived');
    });
  });

  // The seal must not leak a private realm's existence or archived state to
  // callers who can't prove access: the archived response is reserved for
  // callers who would otherwise reach the content. A caller who fails
  // authentication or authorization gets the same 401/403 they would on an
  // active private realm.
  module(
    'archived seal does not disclose to unauthorized callers',
    function (hooks) {
      let testRealm: Realm;
      let request: SuperTest<Test>;
      let dbAdapter: PgAdapter;

      setupPermissionedRealmCached(hooks, {
        fixture: 'simple',
        // A private realm: no `*` permission.
        realmURL: testRealmURLFor('private-archived/'),
        permissions: {
          owner: ['read', 'write', 'realm-owner'],
          reader: ['read'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        onRealmSetup(args: {
          testRealm: Realm;
          request: SuperTest<Test>;
          dbAdapter: PgAdapter;
        }) {
          testRealm = args.testRealm;
          request = args.request;
          dbAdapter = args.dbAdapter;
        },
      });

      // Address content under the realm's own path prefix (the realm is mounted
      // at `/private-archived/`, not the server root).
      function path(suffix: string) {
        return `${new URL(testRealm.url).pathname.replace(/\/$/, '')}${suffix}`;
      }

      // A `HEAD` passes the realm ACL whoever sends it, so it is the one
      // request a caller who cannot read the realm gets past the ACL with.
      // These are the `HEAD`s that read something from a caller who may read
      // the realm: a card, a module's source, and the raw file serve.
      const contentHeads: [string, string | undefined][] = [
        ['/person-1', 'application/vnd.card+json'],
        ['/person.gts', 'application/vnd.card+source'],
        ['/sample.md', '*/*'],
        ['/sample.md', undefined],
      ];
      // For each content `HEAD` in order, one that finds nothing to read: a
      // path with nothing behind it in the same bucket, and for the last, the
      // same file under an `Accept` no route claims. Each shares its twin's
      // extension, since the server names a content type from the path's
      // extension when a response carries none.
      const missingTwins: [string, string | undefined][] = [
        ['/no-such-card', 'application/vnd.card+json'],
        ['/no-such-module.gts', 'application/vnd.card+source'],
        ['/no-such-file.md', '*/*'],
        ['/sample.md', 'image/png'],
      ];
      // These read nothing even for a caller who may read the realm: the
      // buckets whose `HEAD` is the discovery answer for everyone, a file the
      // realm is part-way through writing, and the paths of the operational
      // endpoints.
      const otherHeads: [string, string | undefined][] = [
        ['/_info', 'application/vnd.api+json'],
        ['/_search', 'application/vnd.card+json'],
        ['/sample.md.boxel-partial', undefined],
        ['/_readiness-check', 'application/vnd.api+json'],
        ['/_session', undefined],
      ];

      interface HeadAnswer {
        label: string;
        status: number;
        headers: Record<string, string>;
      }

      async function head(
        heads: [string, string | undefined][],
        callers: [string, string | undefined][],
      ): Promise<HeadAnswer[]> {
        let answers: HeadAnswer[] = [];
        for (let [caller, authorization] of callers) {
          for (let [suffix, accept] of heads) {
            let req = request.head(path(suffix));
            if (accept) {
              req = req.set('Accept', accept);
            }
            if (authorization) {
              req = req.set('Authorization', authorization);
            }
            let response = await req;
            let headers = { ...(response.headers as Record<string, string>) };
            delete headers.date;
            answers.push({
              label: `${caller} HEAD ${suffix} (accept: ${accept ?? 'none'})`,
              status: response.status,
              headers,
            });
          }
        }
        return answers;
      }

      test('a HEAD from a caller who may not read the realm gets the answer it gets while the realm is active', async function (assert) {
        let callers: [string, string | undefined][] = [
          ['anonymous', undefined],
          ['unpermitted', `Bearer ${createJWT(testRealm, 'stranger', [])}`],
        ];
        let heads = [...contentHeads, ...missingTwins, ...otherHeads];
        // Where each caller's answer to `heads[index]` sits in a result.
        let at = (callerIndex: number, index: number) =>
          callerIndex * heads.length + index;
        let active = await head(heads, callers);
        for (let answer of active) {
          assert.strictEqual(
            answer.headers['x-boxel-realm-url'],
            testRealm.url,
            `active: ${answer.label} names the realm`,
          );
        }
        for (let callerIndex = 0; callerIndex < callers.length; callerIndex++) {
          for (let index = 0; index < contentHeads.length; index++) {
            let answer = active[at(callerIndex, index)];
            assert.strictEqual(
              answer.status,
              200,
              `active: ${answer.label} gets the discovery answer`,
            );
            assert.notOk(
              answer.headers['etag'],
              `active: ${answer.label} carries no validator`,
            );
          }
        }

        await archiveRealm(dbAdapter, new URL(testRealm.url));
        let archived = await head(heads, callers);
        assert.strictEqual(archived.length, active.length);
        for (let [index, answer] of archived.entries()) {
          assert.deepEqual(
            { status: answer.status, headers: answer.headers },
            {
              status: active[index].status,
              headers: active[index].headers,
            },
            `archived: ${answer.label} gets the answer it gets while the realm is active`,
          );
          assert.notOk(
            answer.headers['x-boxel-realm-archived'],
            `archived: ${answer.label} is not told the realm is archived`,
          );
        }
        for (let callerIndex = 0; callerIndex < callers.length; callerIndex++) {
          for (let index = 0; index < contentHeads.length; index++) {
            let hit = archived[at(callerIndex, index)];
            let miss = archived[at(callerIndex, contentHeads.length + index)];
            assert.deepEqual(
              { status: miss.status, headers: miss.headers },
              { status: hit.status, headers: hit.headers },
              `archived: ${miss.label} gets the answer ${hit.label} gets`,
            );
          }
        }
      });

      test('a HEAD from a caller who may read the realm meets the seal', async function (assert) {
        let callers: [string, string | undefined][] = [
          ['reader', `Bearer ${createJWT(testRealm, 'reader', ['read'])}`],
          [
            'owner',
            `Bearer ${createJWT(testRealm, 'owner', [
              'read',
              'write',
              'realm-owner',
            ])}`,
          ],
        ];
        let active = await head(contentHeads, callers);
        for (let answer of active) {
          assert.strictEqual(
            answer.status,
            200,
            `active: ${answer.label} is answered`,
          );
        }

        await archiveRealm(dbAdapter, new URL(testRealm.url));
        for (let answer of await head(contentHeads, callers)) {
          assert.strictEqual(answer.status, 403, `${answer.label}: HTTP 403`);
          assert.strictEqual(
            answer.headers['x-boxel-realm-archived'],
            'true',
            `${answer.label}: carries the X-Boxel-Realm-Archived marker`,
          );
        }
      });

      test('a private archived realm returns the normal 401/403 to callers who cannot prove access, and the archived marker only to authorized callers', async function (assert) {
        await archiveRealm(dbAdapter, new URL(testRealm.url));

        // Unauthenticated: the normal missing-auth 401, with no hint that the
        // realm exists or is archived.
        let anonymous = await request
          .get(path('/_info'))
          .set('Accept', 'application/vnd.api+json');
        assert.strictEqual(
          anonymous.status,
          401,
          'unauthenticated caller gets 401',
        );
        assert.notStrictEqual(
          anonymous.get('X-Boxel-Realm-Archived'),
          'true',
          'unauthenticated caller is not told the realm is archived',
        );

        // Authenticated but holding no permission on this realm: the normal 403
        // authorization failure, still with no archived disclosure.
        let stranger = await request
          .get(path('/_info'))
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'stranger', [])}`,
          );
        assert.strictEqual(
          stranger.status,
          403,
          'unauthorized caller gets 403',
        );
        assert.notStrictEqual(
          stranger.get('X-Boxel-Realm-Archived'),
          'true',
          'unauthorized caller is not told the realm is archived',
        );

        // The owner could otherwise reach the content, so they see the seal.
        let owner = await request
          .get(path('/_info'))
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'owner', [
              'read',
              'write',
              'realm-owner',
            ])}`,
          );
        assert.strictEqual(owner.status, 403, 'authorized owner gets 403');
        assert.strictEqual(
          owner.get('X-Boxel-Realm-Archived'),
          'true',
          'authorized owner sees the archived marker',
        );
      });
    },
  );
});
