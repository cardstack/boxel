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
  send: (request: SuperTest<Test>) => Test;
}

const readProbes: Probe[] = [
  // Routes that do not consume the ACL's outcome.
  {
    label: 'GET /_info',
    send: (r) => r.get('/_info').set('Accept', SupportedMimeType.RealmInfo),
  },
  {
    label: 'GET /_mtimes',
    send: (r) => r.get('/_mtimes').set('Accept', SupportedMimeType.Mtimes),
  },
  {
    label: 'QUERY /_search',
    send: (r) =>
      r
        .post('/_search')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', SupportedMimeType.CardJson)
        .send('not json'),
  },
  {
    label: 'GET /_screenshot/',
    send: (r) => r.get('/_screenshot/person-1').set('Accept', 'image/png'),
  },
  {
    label: 'GET a directory listing',
    send: (r) => r.get('/').set('Accept', SupportedMimeType.DirectoryListing),
  },
  // Routes that consume it.
  {
    label: 'GET card+json',
    send: (r) => r.get('/person-1').set('Accept', SupportedMimeType.CardJson),
  },
  {
    label: 'GET card+json of a .json path',
    send: (r) =>
      r.get('/person-1.json').set('Accept', SupportedMimeType.CardJson),
  },
  {
    label: 'GET card+source',
    send: (r) =>
      r.get('/person.gts').set('Accept', SupportedMimeType.CardSource),
  },
  {
    label: 'GET raw file',
    send: (r) => r.get('/sample.md'),
  },
  {
    label: 'GET transpiled module',
    send: (r) => r.get('/person'),
  },
  {
    label: 'QUERY /_operations',
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
    send: (r) =>
      r
        .post('/_reindex')
        .set('Accept', SupportedMimeType.JSON)
        .send('not json'),
  },
  {
    label: 'POST /_atomic',
    send: (r) =>
      r.post('/_atomic').set('Accept', SupportedMimeType.JSONAPI).send('{}'),
  },
  {
    label: 'POST into the reserved _screenshot/ subtree',
    send: (r) =>
      r
        .post('/_screenshot/foo.gts')
        .set('Accept', SupportedMimeType.CardSource)
        .send('export const x = 1;'),
  },
  // Routes that consume it.
  {
    label: 'POST card+json',
    send: (r) =>
      r.post('/').set('Accept', SupportedMimeType.CardJson).send('not json'),
  },
  {
    label: 'PATCH card+json',
    send: (r) =>
      r
        .patch('/person-1')
        .set('Accept', SupportedMimeType.CardJson)
        .send('not json'),
  },
  {
    label: 'DELETE card+json',
    send: (r) =>
      r.delete('/person-1').set('Accept', SupportedMimeType.CardJson),
  },
  {
    label: 'POST card+source',
    send: (r) =>
      r
        .post('/new-file.gts')
        .set('Accept', SupportedMimeType.CardSource)
        .send('export const x = 1;'),
  },
  {
    label: 'POST octet-stream',
    send: (r) =>
      r
        .post('/new-file.bin')
        .set('Content-Type', SupportedMimeType.OctetStream)
        .send(Buffer.from([1, 2, 3])),
  },
  {
    label: 'DELETE card+source',
    send: (r) =>
      r.delete('/person.gts').set('Accept', SupportedMimeType.CardSource),
  },
  {
    label: 'POST /_operations',
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
        ].sort(),
        'the consumer set is the card+json verbs, the card+source routes and the operations envelope',
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
    });
  });
});
