import { module, test } from 'qunit';
import { basename, join } from 'path';
import { existsSync } from 'fs-extra';
import type { Realm } from '@cardstack/runtime-common';
import type { DirResult } from 'tmp';
import type { Server } from 'http';
import type { PgAdapter } from '@cardstack/postgres';
import {
  setupPermissionedRealmAtURL,
  closeServer,
  type RealmRequest,
  withRealmPath,
  testRealmHref,
} from './helpers';

module(basename(__filename), function () {
  module('Async Index (X-Boxel-Async-Index header)', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4444/test/');
    let testRealmHttpServer: Server;
    let request: RealmRequest;
    let dir: DirResult;

    function onRealmSetup(args: {
      testRealm: Realm;
      testRealmHttpServer: Server;
      request: any;
      dir: DirResult;
      dbAdapter: PgAdapter;
    }) {
      testRealmHttpServer = args.testRealmHttpServer;
      request = withRealmPath(args.request, realmURL);
      dir = args.dir;
    }

    setupPermissionedRealmAtURL(hooks, realmURL, {
      permissions: {
        '*': ['read', 'write'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
      },
      onRealmSetup,
    });

    hooks.afterEach(async function () {
      await closeServer(testRealmHttpServer);
    });

    test('returns 201 with card ID when X-Boxel-Async-Index header is set', async function (assert) {
      let response = await request
        .post('/')
        .send({
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
        })
        .set('Accept', 'application/vnd.card+json')
        .set('X-Boxel-Async-Index', 'true');

      assert.strictEqual(
        response.status,
        201,
        'HTTP 201 status for async index',
      );

      let json = response.body;
      assert.ok(json.data, 'response has data');
      assert.ok(json.data.id, 'response has card id');
      assert.ok(
        json.data.id.startsWith(testRealmHref),
        `card id starts with realm URL: ${json.data.id}`,
      );
      assert.ok(response.get('location'), 'location header is set');
      assert.strictEqual(
        response.get('location'),
        json.data.id,
        'location header matches card id',
      );
    });

    test('card file is persisted on disk even though indexing is async', async function (assert) {
      let response = await request
        .post('/')
        .send({
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
        })
        .set('Accept', 'application/vnd.card+json')
        .set('X-Boxel-Async-Index', 'true');

      assert.strictEqual(response.status, 201, 'HTTP 201 status');

      let cardId = response.body.data.id;
      // Extract the file path from the card ID
      // e.g. http://127.0.0.1:4444/test/CardDef/abc123 -> CardDef/abc123.json
      let cardPath = new URL(cardId).pathname.replace(realmURL.pathname, '');
      let cardFile = join(
        dir.name,
        'realm_server_1',
        'test',
        `${cardPath}.json`,
      );

      assert.ok(
        existsSync(cardFile),
        `card file exists on disk at ${cardFile}`,
      );
    });

    test('returns 201 with full card document when X-Boxel-Async-Index is NOT set', async function (assert) {
      let response = await request
        .post('/')
        .send({
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
        })
        .set('Accept', 'application/vnd.card+json');

      assert.strictEqual(
        response.status,
        201,
        'HTTP 201 status for normal POST',
      );

      let json = response.body;
      assert.ok(json.data, 'response has data');
      assert.ok(json.data.id, 'response has card id');
      assert.ok(json.data.attributes, 'response has full card attributes');
      assert.ok(json.data.meta, 'response has card meta');
      assert.ok(json.data.meta.lastModified, 'response has lastModified');
    });

    test('201 async response does NOT include full card attributes (only id)', async function (assert) {
      let response = await request
        .post('/')
        .send({
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
        })
        .set('Accept', 'application/vnd.card+json')
        .set('X-Boxel-Async-Index', 'true');

      assert.strictEqual(response.status, 201, 'HTTP 201 status');

      let json = response.body;
      assert.ok(json.data.id, 'response has card id');
      assert.strictEqual(
        json.data.attributes,
        undefined,
        'response does NOT include attributes for async index',
      );
      assert.strictEqual(
        json.data.meta,
        undefined,
        'response does NOT include meta for async index',
      );
    });

    test('card is eventually indexed and retrievable after async creation', async function (assert) {
      let createResponse = await request
        .post('/')
        .send({
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
        })
        .set('Accept', 'application/vnd.card+json')
        .set('X-Boxel-Async-Index', 'true');

      assert.strictEqual(createResponse.status, 201, 'HTTP 201 status');

      let cardId = createResponse.body.data.id;
      let cardPath = new URL(cardId).pathname.replace(realmURL.pathname, '');

      // Wait for async indexing to complete (poll with timeout)
      let maxRetries = 20;
      let retryInterval = 200; // ms
      let getResponse;
      for (let i = 0; i < maxRetries; i++) {
        getResponse = await request
          .get(`/${cardPath}`)
          .set('Accept', 'application/vnd.card+json');

        if (getResponse.status === 200) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, retryInterval));
      }

      assert.strictEqual(
        getResponse?.status,
        200,
        'card is eventually retrievable after async index completes',
      );
      assert.ok(getResponse?.body?.data?.id, 'retrieved card has an id');
    });
  });
});
