import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest, Response } from 'supertest';
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import type { Realm } from '@cardstack/runtime-common';
import {
  SupportedMimeType,
  archiveRealm,
  unarchiveRealm,
} from '@cardstack/runtime-common';
import { setupPermissionedRealmCached, createJWT } from '../helpers/index.ts';

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
    label: 'QUERY /_search',
    consumes: false,
    send: (r) =>
      r
        .post('/_search')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', SupportedMimeType.CardJson)
        .send('not json'),
  },
  {
    label: 'GET /_capture/',
    consumes: false,
    send: (r) => r.get('/_capture/person-1').set('Accept', 'image/png'),
  },
  {
    label: 'GET a directory listing',
    consumes: false,
    send: (r) => r.get('/').set('Accept', SupportedMimeType.DirectoryListing),
  },
  // Routes that consume it.
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
    consumes: true,
    send: (r) =>
      r.get('/person.gts').set('Accept', SupportedMimeType.CardSource),
  },
  {
    label: 'GET raw file',
    consumes: true,
    send: (r) => r.get('/sample.md'),
  },
  {
    label: 'GET transpiled module',
    consumes: true,
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
    label: 'POST into the reserved _capture/ subtree',
    consumes: false,
    send: (r) =>
      r
        .post('/_capture/foo.gts')
        .set('Accept', SupportedMimeType.CardSource)
        .send('export const x = 1;'),
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
    label: 'POST card+source',
    consumes: true,
    send: (r) =>
      r
        .post('/new-file.gts')
        .set('Accept', SupportedMimeType.CardSource)
        .send('export const x = 1;'),
  },
  {
    label: 'POST octet-stream',
    consumes: true,
    send: (r) =>
      r
        .post('/new-file.bin')
        .set('Content-Type', SupportedMimeType.OctetStream)
        .send(Buffer.from([1, 2, 3])),
  },
  {
    label: 'DELETE card+source',
    consumes: true,
    send: (r) =>
      r.delete('/person.gts').set('Accept', SupportedMimeType.CardSource),
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

    test('exactly the operation routes consume the recorded outcome', async function (assert) {
      let consumers = testRealm
        .routeDescriptions()
        .filter((route) => route.consumesCoarseOutcome)
        .map((route) => `${route.method} ${route.mimeType} ${route.path}`)
        .sort();
      assert.deepEqual(
        consumers,
        [
          `DELETE ${SupportedMimeType.CardJson} /|/.+(?<!.json)`,
          `DELETE ${SupportedMimeType.CardSource} /.+`,
          `GET ${SupportedMimeType.CardJson} /.*`,
          `GET ${SupportedMimeType.CardSource} /.*`,
          `HEAD ${SupportedMimeType.CardJson} /.*`,
          `HEAD ${SupportedMimeType.CardSource} /.*`,
          `PATCH ${SupportedMimeType.CardJson} /.+(?<!.json)`,
          `POST ${SupportedMimeType.BoxelOperations} /_operations`,
          `POST ${SupportedMimeType.CardJson} (/|/.+/)`,
          `POST ${SupportedMimeType.CardSource} /.*`,
          `POST ${SupportedMimeType.JSONAPI} /_operations`,
          `POST ${SupportedMimeType.OctetStream} /.*`,
          `QUERY ${SupportedMimeType.BoxelOperations} /_operations`,
          `QUERY ${SupportedMimeType.JSONAPI} /_operations`,
          'GET * *',
          'HEAD * *',
        ].sort(),
        'the consumer set is the card+json verbs, the card+source routes, the operations envelope, and the fallback file and module serve for reads',
      );
      let nonConsumers = testRealm
        .routeDescriptions()
        .filter((route) => !route.consumesCoarseOutcome);
      assert.true(
        nonConsumers.length > 0,
        'the remaining routes are enumerated as non-consumers',
      );
      assert.true(
        nonConsumers.some(
          (route) =>
            route.path === '/_search' &&
            route.mimeType === SupportedMimeType.CardJson,
        ),
        'the card+json search routes, registered ahead of the card+json catch-alls, do not consume it',
      );
      assert.deepEqual(
        nonConsumers
          .filter((route) => route.path === '*')
          .map((route) => route.method)
          .sort(),
        ['DELETE', 'PATCH', 'POST', 'QUERY'],
        'the fallback does not consume it for any method but a read',
      );
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

        let card = await request
          .get('/person-1')
          .set('Accept', SupportedMimeType.CardJson);
        assert.strictEqual(
          card.status,
          200,
          'admitting: an anonymous card+json read reaches its handler',
        );
        let raw = await request.get('/sample.md');
        assert.strictEqual(
          raw.status,
          200,
          'admitting: an anonymous raw file read reaches the fallback',
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
