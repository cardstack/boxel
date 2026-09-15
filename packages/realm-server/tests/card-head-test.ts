import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import type { RealmHttpServer as Server } from '../server.ts';
import type { DirResult } from 'tmp';
import { rri, type Realm } from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  closeServer,
  createJWT,
  withRealmPath,
  type RealmRequest,
} from './helpers/index.ts';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import type { PgAdapter } from '@cardstack/postgres';

// A card+json `HEAD` answers the headers its `GET` would carry, worked out
// from the index row alone: no card document is assembled and no link is
// expanded, because a caller that wanted the body would have sent the `GET`.
// The assertions are written against the `GET` of the same URL rather than
// against literals — agreement between the two is the requirement, and a
// literal would let them drift together.
//
// Realm discovery arrives as a `HEAD` as well, on any path and without
// credentials, and reads only the realm-identity headers every response
// carries. So both answers live in this one bucket: permission is asked rather
// than enforced, and a caller who cannot read the realm gets the discovery
// answer instead of a refusal that would confirm the realm and the path.
module(basename(import.meta.filename), function () {
  module('card HEAD request', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4444/test/');
    let testRealmHref = realmURL.href;
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let request: RealmRequest;

    function onRealmSetup(args: {
      testRealm: Realm;
      testRealmHttpServer: Server;
      request: SuperTest<Test>;
      dir: DirResult;
      dbAdapter: PgAdapter;
    }) {
      testRealm = args.testRealm;
      testRealmHttpServer = args.testRealmHttpServer;
      request = withRealmPath(args.request, realmURL);
    }

    hooks.afterEach(async function () {
      await closeServer(testRealmHttpServer);
      resetCatalogRealms();
    });

    module('public readable realm', function (hooks) {
      setupPermissionedRealmCached(hooks, {
        fixture: 'simple',
        realmURL,
        permissions: {
          '*': ['read'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        onRealmSetup,
      });

      test('carries the validator, modification time and content type the GET carries', async function (assert) {
        let getResponse = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(getResponse.status, 200, 'the GET succeeds');

        let response = await request
          .head('/person-1')
          .set('Accept', 'application/vnd.card+json');

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.ok(getResponse.get('etag'), 'the GET carries a validator');
        assert.strictEqual(
          response.get('etag'),
          getResponse.get('etag'),
          'the HEAD reports the same validator',
        );
        assert.strictEqual(
          response.get('last-modified'),
          getResponse.get('last-modified'),
          'the HEAD reports the same modification time',
        );
        assert.strictEqual(
          response.get('content-type'),
          'application/vnd.card+json',
          'the HEAD is typed as card+json',
        );
        assert.strictEqual(
          response.get('cache-control'),
          getResponse.get('cache-control'),
          'the HEAD reports the same cache directive',
        );
        assert.strictEqual(
          response.get('x-created'),
          getResponse.get('x-created'),
          'the HEAD reports the same creation time',
        );
      });

      test('carries no body, and no Content-Length describing one', async function (assert) {
        let response = await request
          .head('/person-1')
          .set('Accept', 'application/vnd.card+json');

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        // `response.body` can be `{}` when supertest cannot decode an empty
        // buffer, so the body check reads `response.text`.
        assert.notOk(response.text, 'no body');
        assert.strictEqual(
          response.get('content-length'),
          undefined,
          'no Content-Length: knowing one means serializing the document',
        );
      });

      test('never assembles a card document', async function (assert) {
        let engine = testRealm.realmIndexQueryEngine;
        let original = engine.cardDocument;
        let calls = 0;
        engine.cardDocument = ((...args: Parameters<typeof original>) => {
          calls++;
          return original.apply(engine, args);
        }) as typeof original;
        try {
          let response = await request
            .head('/person-1')
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          assert.ok(response.get('etag'), 'the headers are real');
          assert.strictEqual(
            calls,
            0,
            'the index row alone answered — no document was assembled',
          );
        } finally {
          engine.cardDocument = original;
        }
      });

      test('a matching If-None-Match answers 304, as it does on the GET', async function (assert) {
        let firstResponse = await request
          .head('/person-1')
          .set('Accept', 'application/vnd.card+json');
        let etag = firstResponse.get('etag') ?? '';
        assert.ok(etag, 'the first HEAD carries a validator');

        let response = await request
          .head('/person-1')
          .set('Accept', 'application/vnd.card+json')
          .set('If-None-Match', etag);

        assert.strictEqual(response.status, 304, 'HTTP 304 status');
        assert.strictEqual(
          response.get('etag'),
          etag,
          'the 304 repeats the validator that matched',
        );
      });

      test('a path the realm serves no card at answers in step with its GET', async function (assert) {
        // The stub answered 200 for any path; a permitted caller now gets a
        // read, so what it answers is whatever the GET of the same URL
        // answers. That includes paths that are not cards at all — a realm
        // endpoint the card+json bucket has no route for reaches the card read
        // the same way a missing card does.
        for (let path of ['/no-such-card', '/_search', '/some/nested/path']) {
          let getResponse = await request
            .get(path)
            .set('Accept', 'application/vnd.card+json');
          let response = await request
            .head(path)
            .set('Accept', 'application/vnd.card+json');

          assert.strictEqual(
            response.status,
            getResponse.status,
            `HEAD ${path} answers the status its GET answers`,
          );
        }
      });

      test('a path that names nothing answers 404', async function (assert) {
        let getResponse = await request
          .get('/no-such-card')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(getResponse.status, 404, 'the GET is a 404');

        let response = await request
          .head('/no-such-card')
          .set('Accept', 'application/vnd.card+json');

        assert.strictEqual(
          response.status,
          404,
          'a permitted caller is told the card is not there',
        );
      });

      test('a file URL answers as its card+json GET does', async function (assert) {
        // A file's metadata document is derived from the bytes on disk and has
        // no index row behind it, so its GET sends neither a validator nor a
        // cache directive — and neither does the HEAD.
        let getResponse = await request
          .get('/sample.md')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(getResponse.status, 200, 'the GET succeeds');
        assert.strictEqual(
          getResponse.body?.data?.type,
          'file-meta',
          'the GET answers with the file-metadata document',
        );

        let response = await request
          .head('/sample.md')
          .set('Accept', 'application/vnd.card+json');

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          response.get('content-type'),
          getResponse.get('content-type'),
          'the HEAD reports the content type the GET sends',
        );
        assert.strictEqual(
          response.get('etag'),
          getResponse.get('etag'),
          'neither carries a validator',
        );
        assert.strictEqual(
          response.get('last-modified'),
          getResponse.get('last-modified'),
          'neither carries a modification time',
        );
      });

      test('the .json spelling redirects to the card, as the GET does', async function (assert) {
        let getResponse = await request
          .get('/person-1.json')
          .set('Accept', 'application/vnd.card+json')
          .redirects(0);

        let response = await request
          .head('/person-1.json')
          .set('Accept', 'application/vnd.card+json')
          .redirects(0);

        assert.strictEqual(getResponse.status, 302, 'the GET redirects');
        assert.strictEqual(response.status, 302, 'so does the HEAD');
        assert.strictEqual(
          response.get('location'),
          getResponse.get('location'),
          'to the same canonical URL — the only one that carries a validator',
        );
      });

      test('an Accept the read does not claim is answered by realm discovery', async function (assert) {
        let response = await request.head('/person-1').set('Accept', '*/*');

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          response.get('X-boxel-realm-url'),
          testRealmHref,
          'the response names the realm serving the URL',
        );
        assert.strictEqual(
          response.get('etag'),
          undefined,
          'and reports nothing about the card',
        );
      });
    });

    // A card's id normally comes from a UUID and carries no extension, but
    // nothing enforces that: a source write names the path it writes, and the
    // indexer makes an instance row out of any `.json` holding a card
    // resource. `notes.md.json` is therefore a card at `notes.md`, whose id
    // ends in an extension the realm also registers for files. The index is
    // what decides whether a path is a card, and every read has to reach that
    // answer the same way — the plain GET, the conditional GET that peeks the
    // row directly, and the HEAD.
    module('a card whose id carries a file extension', function (hooks) {
      setupPermissionedRealmCached(hooks, {
        realmURL,
        permissions: {
          '*': ['read'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        fileSystem: {
          'notes.md.json': {
            data: {
              type: 'card',
              attributes: { title: 'Release notes' },
              meta: {
                adoptsFrom: {
                  module: rri('@cardstack/base/card-api'),
                  name: 'CardDef',
                },
              },
            },
          },
          'reference.md': '# a file that is really a file',
        },
        onRealmSetup,
      });

      test('the plain GET, the conditional GET and the HEAD all serve it as a card', async function (assert) {
        let getResponse = await request
          .get('/notes.md')
          .set('Accept', 'application/vnd.card+json');

        assert.strictEqual(
          getResponse.status,
          200,
          `the GET serves the card: ${getResponse.text}`,
        );
        assert.strictEqual(
          getResponse.body?.data?.type,
          'card',
          'as a card, not as file metadata',
        );
        assert.strictEqual(
          getResponse.body?.data?.attributes?.title,
          'Release notes',
          'with the stored attributes',
        );
        let etag = getResponse.get('etag') ?? '';
        assert.ok(etag, 'and a validator');

        let conditional = await request
          .get('/notes.md')
          .set('Accept', 'application/vnd.card+json')
          .set('If-None-Match', etag);
        assert.strictEqual(
          conditional.status,
          304,
          'the conditional GET agrees the card is there and unchanged',
        );

        let response = await request
          .head('/notes.md')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(response.status, 200, 'so does the HEAD');
        assert.strictEqual(
          response.get('etag'),
          etag,
          'reporting the same validator',
        );
      });

      test('a path that really does hold bytes still reads as file metadata', async function (assert) {
        let getResponse = await request
          .get('/reference.md')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(getResponse.status, 200, 'the GET succeeds');
        assert.strictEqual(
          getResponse.body?.data?.type,
          'file-meta',
          'a file with no index row behind it reads as its metadata',
        );

        let response = await request
          .head('/reference.md')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          response.get('etag'),
          undefined,
          'and carries no validator, as its GET does not',
        );
      });
    });

    module('permissioned realm', function (hooks) {
      setupPermissionedRealmCached(hooks, {
        fixture: 'simple',
        realmURL,
        permissions: {
          john: ['read'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        onRealmSetup,
      });

      test('without credentials, answers realm identity and nothing about the card', async function (assert) {
        let response = await request
          .head('/person-1')
          .set('Accept', 'application/vnd.card+json'); // no Authorization header

        assert.strictEqual(
          response.status,
          200,
          'discovery does not require authentication',
        );
        assert.strictEqual(
          response.get('X-boxel-realm-url'),
          testRealmHref,
          'the response names the realm serving the URL',
        );
        assert.strictEqual(
          response.get('X-boxel-realm-public-readable'),
          undefined,
          'the realm is not public readable',
        );
        assert.strictEqual(
          response.get('etag'),
          undefined,
          'no validator reaches a caller who may not read the card',
        );
        assert.strictEqual(
          response.get('last-modified'),
          undefined,
          'and no modification time either',
        );
      });

      test('a path that names nothing is indistinguishable from one that does, without credentials', async function (assert) {
        // The discovery answer is existence-blind on purpose: a caller who
        // cannot read the realm learns which realm serves the URL and nothing
        // about what is stored there.
        let onACard = await request
          .head('/person-1')
          .set('Accept', 'application/vnd.card+json');
        let onNothing = await request
          .head('/no-such-card')
          .set('Accept', 'application/vnd.card+json');

        assert.strictEqual(onACard.status, 200, 'the card answers 200');
        assert.strictEqual(
          onNothing.status,
          200,
          'and so does a path with nothing at it',
        );
      });

      test('with credentials, answers the headers the GET carries', async function (assert) {
        let jwt = createJWT(testRealm, 'john', ['read']);
        let getResponse = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json')
          .set('Authorization', `Bearer ${jwt}`);
        assert.strictEqual(getResponse.status, 200, 'the GET succeeds');

        let response = await request
          .head('/person-1')
          .set('Accept', 'application/vnd.card+json')
          .set('Authorization', `Bearer ${jwt}`);

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.ok(getResponse.get('etag'), 'the GET carries a validator');
        assert.strictEqual(
          response.get('etag'),
          getResponse.get('etag'),
          'the HEAD reports the same validator',
        );
        assert.strictEqual(
          response.get('content-type'),
          'application/vnd.card+json',
          'the HEAD is typed as card+json',
        );
      });
    });
  });
});
