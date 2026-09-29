import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest, Response } from 'supertest';
import { existsSync } from 'fs';
import { basename, join } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import type { Realm } from '@cardstack/runtime-common';
import {
  SupportedMimeType,
  archiveRealm,
  baseCardRef,
  unarchiveRealm,
} from '@cardstack/runtime-common';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import {
  setupPermissionedRealmCached,
  createJWT,
  realmServerTestMatrix,
  realmSecretSeed,
} from '../helpers/index.ts';

// The realm ACL's decision is recorded on the request and answered after
// routing, so every route — those that consume the recorded outcome and those
// that do not — must refuse a declined caller with the same status and body
// the ACL's refusal carries, before the route does any work of its own.

const MISSING_AUTH = 'Missing Authorization header';
const INSUFFICIENT = 'Insufficient permissions to perform this action';

// Each route by the family and method that selects it, with a body that would
// be answered as a 4xx of the route's own if the route were reached — so a
// refusal that arrives after the route's own work shows up as that 4xx rather
// than as the ACL's answer.
interface Probe {
  label: string;
  // Whether the route this probe lands on consumes the ACL's outcome.
  consumes: boolean;
  send: (request: SuperTest<Test>) => Test;
}

const readProbes: Probe[] = [
  // Routes that do not consume the ACL's outcome.
  {
    label: 'GET /_info',
    consumes: false,
    send: (r) => r.get('/_info').set('Accept', SupportedMimeType.RealmInfo),
  },
  {
    label: 'GET /_mtimes',
    consumes: false,
    send: (r) => r.get('/_mtimes').set('Accept', SupportedMimeType.Mtimes),
  },
  {
    label: 'GET /_screenshot/',
    consumes: false,
    send: (r) => r.get('/_screenshot/person-1').set('Accept', 'image/png'),
  },
  {
    label: 'GET a directory listing',
    consumes: false,
    send: (r) => r.get('/').set('Accept', SupportedMimeType.DirectoryListing),
  },
  // Routes that consume it.
  {
    label: 'QUERY /_search',
    consumes: true,
    send: (r) =>
      r
        .post('/_search')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', SupportedMimeType.CardJson)
        .send('not json'),
  },
  {
    label: 'GET card+json',
    consumes: true,
    send: (r) => r.get('/person-1').set('Accept', SupportedMimeType.CardJson),
  },
  {
    label: 'GET card+json of a .json path',
    consumes: true,
    send: (r) =>
      r.get('/person-1.json').set('Accept', SupportedMimeType.CardJson),
  },
  {
    label: 'GET card+source',
    consumes: false,
    send: (r) =>
      r.get('/person.gts').set('Accept', SupportedMimeType.CardSource),
  },
  {
    label: 'GET raw file',
    consumes: false,
    send: (r) => r.get('/sample.md'),
  },
  {
    label: 'GET transpiled module',
    consumes: false,
    send: (r) => r.get('/person'),
  },
  {
    label: 'QUERY /_operations',
    consumes: true,
    send: (r) =>
      r
        .post('/_operations')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', SupportedMimeType.BoxelOperations)
        .set('Content-Type', SupportedMimeType.BoxelOperations)
        .send('not json'),
  },
  // A read probe although it is a `POST`: the capability check writes nothing,
  // so the realm asks the read question of it rather than the one the method
  // would otherwise choose.
  {
    label: 'POST /_capabilities',
    consumes: true,
    send: (r) =>
      r
        .post('/_capabilities')
        .set('Accept', SupportedMimeType.JSON)
        .set('Content-Type', SupportedMimeType.JSON)
        .send('not json'),
  },
];

const writeProbes: Probe[] = [
  // Routes that do not consume the ACL's outcome.
  {
    label: 'POST /_reindex',
    consumes: false,
    send: (r) =>
      r
        .post('/_reindex')
        .set('Accept', SupportedMimeType.JSON)
        .send('not json'),
  },
  {
    label: 'POST /_atomic',
    consumes: false,
    send: (r) =>
      r.post('/_atomic').set('Accept', SupportedMimeType.JSONAPI).send('{}'),
  },
  {
    label: 'POST into the reserved _screenshot/ subtree',
    consumes: false,
    send: (r) =>
      r
        .post('/_screenshot/foo.gts')
        .set('Accept', SupportedMimeType.CardSource)
        .send('export const x = 1;'),
  },
  {
    label: 'POST card+source',
    consumes: false,
    send: (r) =>
      r
        .post('/new-file.gts')
        .set('Accept', SupportedMimeType.CardSource)
        .send('export const x = 1;'),
  },
  {
    label: 'POST octet-stream',
    consumes: false,
    send: (r) =>
      r
        .post('/new-file.bin')
        .set('Content-Type', SupportedMimeType.OctetStream)
        .send(Buffer.from([1, 2, 3])),
  },
  {
    label: 'DELETE card+source',
    consumes: false,
    send: (r) =>
      r.delete('/person.gts').set('Accept', SupportedMimeType.CardSource),
  },
  // Routes that consume it.
  {
    label: 'POST card+json',
    consumes: true,
    send: (r) =>
      r.post('/').set('Accept', SupportedMimeType.CardJson).send('not json'),
  },
  {
    label: 'PATCH card+json',
    consumes: true,
    send: (r) =>
      r
        .patch('/person-1')
        .set('Accept', SupportedMimeType.CardJson)
        .send('not json'),
  },
  {
    label: 'DELETE card+json',
    consumes: true,
    send: (r) =>
      r.delete('/person-1').set('Accept', SupportedMimeType.CardJson),
  },
  {
    label: 'POST /_operations',
    consumes: true,
    send: (r) =>
      r
        .post('/_operations')
        .set('Accept', SupportedMimeType.BoxelOperations)
        .set('Content-Type', SupportedMimeType.BoxelOperations)
        .send('not json'),
  },
];

// A well-formed request for each route that consumes the ACL's outcome, so a
// caller it admits reaches the operation the route resolves. The card+json
// `HEAD` is not among them: the ACL lets every `HEAD` through, and the route
// asks the read question itself.
interface GatedProbe {
  route: string;
  send: (request: SuperTest<Test>, realmURL: string) => Test;
}

function operationsBatch(realmURL: string, name: string) {
  return JSON.stringify({
    'boxel:operations': [
      { op: 'invoke', 'boxel:name': name, href: `${realmURL}person-1` },
    ],
  });
}

const gatedProbes: GatedProbe[] = [
  {
    route: `GET ${SupportedMimeType.CardJson}`,
    send: (r) => r.get('/person-1').set('Accept', SupportedMimeType.CardJson),
  },
  {
    route: `POST ${SupportedMimeType.CardJson}`,
    send: (r, realmURL) =>
      r
        .post('/')
        .set('Accept', SupportedMimeType.CardJson)
        .send(
          JSON.stringify({
            data: {
              type: 'card',
              attributes: { firstName: 'Mango' },
              meta: {
                adoptsFrom: { module: `${realmURL}person`, name: 'Person' },
              },
            },
          }),
        ),
  },
  {
    route: `PATCH ${SupportedMimeType.CardJson}`,
    send: (r, realmURL) =>
      r
        .patch('/person-1')
        .set('Accept', SupportedMimeType.CardJson)
        .send(
          JSON.stringify({
            data: {
              type: 'card',
              attributes: { firstName: 'Mango' },
              meta: {
                adoptsFrom: { module: `${realmURL}person`, name: 'Person' },
              },
            },
          }),
        ),
  },
  {
    route: `DELETE ${SupportedMimeType.CardJson}`,
    send: (r) =>
      r.delete('/person-1').set('Accept', SupportedMimeType.CardJson),
  },
  ...[SupportedMimeType.BoxelOperations, SupportedMimeType.JSONAPI].flatMap(
    (accept) => [
      {
        route: `QUERY ${accept}`,
        send: (r: SuperTest<Test>, realmURL: string) =>
          r
            .post('/_operations')
            .set('X-HTTP-Method-Override', 'QUERY')
            .set('Accept', accept)
            .set('Content-Type', SupportedMimeType.BoxelOperations)
            .send(operationsBatch(realmURL, 'read')),
      },
      {
        route: `POST ${accept}`,
        send: (r: SuperTest<Test>, realmURL: string) =>
          r
            .post('/_operations')
            .set('Accept', accept)
            .set('Content-Type', SupportedMimeType.BoxelOperations)
            .send(operationsBatch(realmURL, 'delete')),
      },
    ],
  ),
];

// Requests for an operational endpoint's path that the router hands to another
// route, each sendable with any `Content-Type`. Sent with the one the
// endpoint's own route is registered under, a request still reaches the route
// its `Accept` names, so it needs that route's credentials, not the endpoint's
// none.
interface Lookalike {
  label: string;
  endpointContentType: SupportedMimeType;
  write: boolean;
  send: (request: SuperTest<Test>, contentType: string) => Test;
}

const lookalikes: Lookalike[] = [
  {
    label: 'POST card+source of _session',
    endpointContentType: SupportedMimeType.Session,
    write: true,
    send: (r, contentType) =>
      r
        .post('/_session')
        .set('Accept', SupportedMimeType.CardSource)
        .set('Content-Type', contentType)
        .send('written without credentials'),
  },
  {
    label: 'POST octet-stream of _session',
    endpointContentType: SupportedMimeType.Session,
    write: true,
    send: (r, contentType) =>
      r
        .post('/_session')
        .set('Accept', SupportedMimeType.OctetStream)
        .set('Content-Type', contentType)
        .send('written without credentials'),
  },
  {
    label: 'GET card+source of _readiness-check',
    endpointContentType: SupportedMimeType.JSONAPI,
    write: false,
    send: (r, contentType) =>
      r
        .get('/_readiness-check')
        .set('Accept', SupportedMimeType.CardSource)
        .set('Content-Type', contentType),
  },
];

function assertRefusal(
  assert: Assert,
  response: Response,
  expected: { status: 401 | 403; body: string },
  label: string,
) {
  assert.strictEqual(response.status, expected.status, `${label}: status`);
  assert.strictEqual(response.text, expected.body, `${label}: body`);
}

module(`realm-endpoints/${basename(import.meta.filename)}`, function () {
  module('on a private realm', function (hooks) {
    let testRealm: Realm;
    let testRealmPath: string;
    let request: SuperTest<Test>;
    let dbAdapter: PgAdapter;

    setupPermissionedRealmCached(hooks, {
      fixture: 'simple',
      permissions: {
        owner: ['read', 'write', 'realm-owner'],
        reader: ['read'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
      },
      onRealmSetup(args) {
        testRealm = args.testRealm;
        testRealmPath = args.testRealmPath;
        request = args.request;
        dbAdapter = args.dbAdapter;
      },
    });

    function readerAuth() {
      return `Bearer ${createJWT(testRealm, 'reader', ['read'])}`;
    }

    test('an anonymous caller is refused with 401 on every route, before the route runs', async function (assert) {
      for (let probe of [...readProbes, ...writeProbes]) {
        let response = await probe.send(request);
        assertRefusal(
          assert,
          response,
          { status: 401, body: MISSING_AUTH },
          probe.label,
        );
        assert.strictEqual(
          response.get('X-Boxel-Realm-Url'),
          testRealm.url,
          `${probe.label}: carries the realm URL header`,
        );
      }
    });

    test('a reader is refused with 403 on every write route, before the route runs', async function (assert) {
      for (let probe of writeProbes) {
        assertRefusal(
          assert,
          await probe.send(request).set('Authorization', readerAuth()),
          { status: 403, body: INSUFFICIENT },
          probe.label,
        );
      }
    });

    test('a reader is refused with 403 on the realm-owner permissions route', async function (assert) {
      assertRefusal(
        assert,
        await request
          .get('/_permissions')
          .set('Accept', SupportedMimeType.Permissions)
          .set('Authorization', readerAuth()),
        { status: 403, body: INSUFFICIENT },
        'GET /_permissions',
      );
      assertRefusal(
        assert,
        await request
          .patch('/_permissions')
          .set('Accept', SupportedMimeType.Permissions)
          .set('Authorization', readerAuth())
          .send('not json'),
        { status: 403, body: INSUFFICIENT },
        'PATCH /_permissions',
      );
    });

    test('a reader the ACL allows still reaches the routes it may read', async function (assert) {
      let card = await request
        .get('/person-1')
        .set('Accept', SupportedMimeType.CardJson)
        .set('Authorization', readerAuth());
      assert.strictEqual(card.status, 200, 'card+json read is served');
      let raw = await request
        .get('/sample.md')
        .set('Authorization', readerAuth());
      assert.strictEqual(raw.status, 200, 'raw file is served');
    });

    test('a caller the ACL refused on an archived realm gets the refusal, not the seal', async function (assert) {
      await archiveRealm(dbAdapter, new URL(testRealm.url));
      for (let probe of [...readProbes, ...writeProbes]) {
        let response = await probe.send(request);
        assertRefusal(
          assert,
          response,
          { status: 401, body: MISSING_AUTH },
          `archived: ${probe.label}`,
        );
        assert.notOk(
          response.get('X-Boxel-Realm-Archived'),
          `archived: ${probe.label}: carries no archived marker`,
        );
      }
      for (let probe of writeProbes) {
        let response = await probe
          .send(request)
          .set('Authorization', readerAuth());
        assertRefusal(
          assert,
          response,
          { status: 403, body: INSUFFICIENT },
          `archived reader: ${probe.label}`,
        );
        assert.notOk(
          response.get('X-Boxel-Realm-Archived'),
          `archived reader: ${probe.label}: carries no archived marker`,
        );
      }
      await unarchiveRealm(dbAdapter, new URL(testRealm.url));
    });

    test('exactly the routes that hand the outcome to the policy gate consume it', async function (assert) {
      let consumers = testRealm
        .routeDescriptions()
        .filter((route) => route.consumesCoarseOutcome)
        .map((route) => `${route.method} ${route.mimeType} ${route.path}`)
        .sort();
      assert.deepEqual(
        consumers,
        [
          `GET ${SupportedMimeType.CardJson} /.*`,
          `HEAD ${SupportedMimeType.CardJson} /.*`,
          `POST ${SupportedMimeType.CardJson} (/|/.+/)`,
          `PATCH ${SupportedMimeType.CardJson} /.+(?<!.json)`,
          `DELETE ${SupportedMimeType.CardJson} /|/.+(?<!.json)`,
          `GET ${SupportedMimeType.CardJson} /_search`,
          `QUERY ${SupportedMimeType.CardJson} /_search`,
          `POST ${SupportedMimeType.BoxelOperations} /_operations`,
          `POST ${SupportedMimeType.JSONAPI} /_operations`,
          `POST ${SupportedMimeType.JSON} /_capabilities`,
          `QUERY ${SupportedMimeType.BoxelOperations} /_operations`,
          `QUERY ${SupportedMimeType.JSONAPI} /_operations`,
        ].sort(),
        'the consumer set is the card+json read and writes, the search, the operations envelope and the capability check',
      );
      let nonConsumers = testRealm
        .routeDescriptions()
        .filter((route) => !route.consumesCoarseOutcome);
      assert.true(
        nonConsumers.length > 0,
        'the remaining routes are enumerated as non-consumers',
      );
      assert.deepEqual(
        nonConsumers
          .filter((route) => route.path === '*')
          .map((route) => route.method)
          .sort(),
        ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'QUERY'],
        'the fallback file and module serve does not consume it for any method',
      );
    });

    test('exactly the routes that serve code and the file tree are coarse-read-only', async function (assert) {
      assert.deepEqual(
        testRealm
          .routeDescriptions()
          .filter((route) => route.coarseReadOnly)
          .map((route) => `${route.method} ${route.mimeType} ${route.path}`)
          .sort(),
        [
          `GET ${SupportedMimeType.CardSource} /.*`,
          `HEAD ${SupportedMimeType.CardSource} /.*`,
          `GET ${SupportedMimeType.DirectoryListing} .*/`,
          'GET * *',
          'HEAD * *',
        ].sort(),
        'the card+source read, the directory listing and the fallback file and module serve',
      );
    });

    test('exactly the operational endpoints answer a caller without credentials and pass the archived seal', async function (assert) {
      // The probe's `HEAD` is its own route in every media type whose `HEAD`
      // is the realm's discovery answer, which is every one but card+source
      // and card+json, whose `HEAD` reads what is stored at the path.
      let probeHeads = [
        ...new Set(
          Object.values(SupportedMimeType).filter(
            (mimeType) =>
              mimeType !== SupportedMimeType.CardSource &&
              mimeType !== SupportedMimeType.CardJson,
          ),
        ),
      ].map((mimeType) => `HEAD ${mimeType} /_readiness-check`);
      assert.deepEqual(
        testRealm
          .routeDescriptions()
          .filter((route) => route.operationalEndpoint)
          .map((route) => `${route.method} ${route.mimeType} ${route.path}`)
          .sort(),
        [
          `POST ${SupportedMimeType.Session} /_session`,
          `GET ${SupportedMimeType.RealmInfo} /_readiness-check`,
          ...probeHeads,
        ].sort(),
        'the session sign-in and the health probe, and none of the routes that read or write what the realm stores',
      );
    });

    test('the sign-in and the readiness check answer an anonymous caller', async function (assert) {
      let matrixClient = new MatrixClient({
        matrixURL: realmServerTestMatrix.url,
        username: realmServerTestMatrix.username,
        seed: realmSecretSeed,
      });
      await matrixClient.login();
      let openIdToken = await matrixClient.getOpenIdToken();
      let session = await request
        .post('/_session')
        .set('Accept', SupportedMimeType.Session)
        .set('Content-Type', SupportedMimeType.Session)
        .send(JSON.stringify(openIdToken));
      assert.strictEqual(session.status, 201, '_session authenticates');
      assert.ok(
        session.get('Authorization'),
        '_session issues a session token',
      );

      let readiness = await request
        .get('/_readiness-check')
        .set('Accept', SupportedMimeType.RealmInfo);
      assert.strictEqual(readiness.status, 200, '_readiness-check answers');
    });

    test('a readiness probe that reaches none of its routes asks an anonymous caller for credentials', async function (assert) {
      // Sent with no `Accept`, the probe passes an archived realm's seal as an
      // operational endpoint, but no route of the endpoint answers it, so it
      // meets the realm ACL as any other read does.
      assertRefusal(
        assert,
        await request.get('/_readiness-check'),
        { status: 401, body: MISSING_AUTH },
        'GET _readiness-check with no Accept',
      );
    });

    test('a request for an operational endpoint’s path that the router hands to another route needs that route’s credentials, whatever its Content-Type', async function (assert) {
      // Something for the card+source read of `_readiness-check` to find.
      let stored = await request
        .post('/_readiness-check')
        .set('Accept', SupportedMimeType.CardSource)
        .set('Content-Type', 'text/plain')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'owner', ['read', 'write', 'realm-owner'])}`,
        )
        .send('stored at the probe path');
      assert.strictEqual(stored.status, 204, 'the owner stores the file');

      for (let lookalike of lookalikes) {
        for (let contentType of [lookalike.endpointContentType, 'text/plain']) {
          let label = `${lookalike.label} (Content-Type: ${contentType})`;
          assertRefusal(
            assert,
            await lookalike.send(request, contentType),
            { status: 401, body: MISSING_AUTH },
            `anonymous ${label}`,
          );
          if (lookalike.write) {
            assertRefusal(
              assert,
              await lookalike
                .send(request, contentType)
                .set('Authorization', readerAuth()),
              { status: 403, body: INSUFFICIENT },
              `reader ${label}`,
            );
          }
        }
      }
      assert.false(
        existsSync(join(testRealmPath, '_session')),
        'nothing is written at _session',
      );
    });

    test('every consuming route hands an admitted caller to the policy gate', async function (assert) {
      // Two consumers answer an admitted caller with something other than a
      // refusal, and each is pinned on its own. The search hands them to the
      // policy's query lane, which answers with rows (below). The capability
      // check answers a decision per pair, a 200 with denials in it (its own
      // module).
      let consumers = testRealm
        .routeDescriptions()
        .filter((route) => route.consumesCoarseOutcome)
        .filter(
          (route) =>
            route.path !== '/_search' && route.path !== '/_capabilities',
        )
        .map((route) => `${route.method} ${route.mimeType}`)
        .filter((route) => route !== `HEAD ${SupportedMimeType.CardJson}`)
        .sort();
      assert.deepEqual(
        gatedProbes.map((probe) => probe.route).sort(),
        consumers,
        'there is a probe for every consuming route',
      );
      testRealm.__testOnlySetCoarseAdmission(() => true);
      try {
        for (let probe of gatedProbes) {
          let before = testRealm.__testOnlyPolicyGateStats().policyLoads;
          let response = await probe.send(request, testRealm.url);
          // The caller is anonymous, so the ACL would not let them read the
          // realm, and the gate's refusal reaches them as a not-found.
          assert.strictEqual(response.status, 404, `${probe.route}: status`);
          assert.strictEqual(
            testRealm.__testOnlyPolicyGateStats().policyLoads,
            before + 1,
            `${probe.route}: the refusal is the gate’s, for a realm with no policy`,
          );
        }
      } finally {
        testRealm.__testOnlySetCoarseAdmission(undefined);
      }
      let person = await request
        .get('/person-1')
        .set('Accept', SupportedMimeType.CardJson)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'owner', ['read', 'write', 'realm-owner'])}`,
        );
      assert.strictEqual(person.status, 200, 'and nothing was deleted');
    });

    test('the search hands an admitted caller to the query lane, which a realm with no policy answers with no rows', async function (assert) {
      testRealm.__testOnlySetCoarseAdmission(() => true);
      try {
        let response = await request
          .post('/_search')
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Accept', SupportedMimeType.CardJson)
          .set('Content-Type', 'application/json')
          .set('Authorization', `Bearer ${createJWT(testRealm, 'stranger')}`)
          .send(JSON.stringify({ filter: { 'item.on': baseCardRef } }));
        assert.strictEqual(response.status, 200, 'admitting: status');
        assert.deepEqual(
          response.body.data,
          [],
          'admitting: no rows, since no grant admits the caller to any',
        );
        assert.strictEqual(response.body.meta.page.total, 0);

        await archiveRealm(dbAdapter, new URL(testRealm.url));
        try {
          let sealed = await request
            .post('/_search')
            .set('X-HTTP-Method-Override', 'QUERY')
            .set('Accept', SupportedMimeType.CardJson)
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${createJWT(testRealm, 'stranger')}`)
            .send('{}');
          assert.strictEqual(
            sealed.get('X-Boxel-Realm-Archived'),
            'true',
            'admitting: an admitted search of an archived realm meets the seal',
          );
        } finally {
          await unarchiveRealm(dbAdapter, new URL(testRealm.url));
        }
      } finally {
        testRealm.__testOnlySetCoarseAdmission(undefined);
      }
    });

    test('an admission reaches only consuming routes, and never a refusal of realm-owner authority', async function (assert) {
      testRealm.__testOnlySetCoarseAdmission(() => true);
      try {
        for (let probe of [...readProbes, ...writeProbes]) {
          if (probe.consumes) {
            continue;
          }
          assertRefusal(
            assert,
            await probe.send(request),
            { status: 401, body: MISSING_AUTH },
            `admitting: anonymous ${probe.label}`,
          );
        }
        for (let probe of writeProbes) {
          if (probe.consumes) {
            continue;
          }
          assertRefusal(
            assert,
            await probe.send(request).set('Authorization', readerAuth()),
            { status: 403, body: INSUFFICIENT },
            `admitting: reader ${probe.label}`,
          );
        }
        assertRefusal(
          assert,
          await request
            .post('/sample.md')
            .set('Accept', 'text/plain')
            .set('Content-Type', 'text/plain')
            .set('Authorization', readerAuth())
            .send('overwritten'),
          { status: 403, body: INSUFFICIENT },
          'admitting: a write no route claims falls to the fallback and is refused',
        );
        assertRefusal(
          assert,
          await request
            .get('/_permissions')
            .set('Accept', SupportedMimeType.CardJson)
            .set('Authorization', readerAuth()),
          { status: 403, body: INSUFFICIENT },
          'admitting: _permissions reached through the card+json catch-all is refused',
        );

        let before = testRealm.__testOnlyPolicyGateStats().policyLoads;
        let card = await request
          .get('/person-1')
          .set('Accept', SupportedMimeType.CardJson);
        assert.strictEqual(
          card.status,
          404,
          'admitting: an anonymous card+json read reaches its handler, and the policy gate refuses it for a realm with no policy',
        );
        assert.strictEqual(
          testRealm.__testOnlyPolicyGateStats().policyLoads,
          before + 1,
          'admitting: the refusal is the gate’s',
        );

        await archiveRealm(dbAdapter, new URL(testRealm.url));
        try {
          let sealed = await request
            .get('/person-1')
            .set('Accept', SupportedMimeType.CardJson);
          assert.strictEqual(
            sealed.status,
            403,
            'admitting: an admitted read of an archived realm is refused',
          );
          assert.strictEqual(
            sealed.get('X-Boxel-Realm-Archived'),
            'true',
            'admitting: the refusal is the archived seal',
          );
        } finally {
          await unarchiveRealm(dbAdapter, new URL(testRealm.url));
        }
      } finally {
        testRealm.__testOnlySetCoarseAdmission(undefined);
      }
    });
  });
});
