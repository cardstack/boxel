import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Test, SuperTest } from 'supertest';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import {
  PREFIX_REALMS_ENDPOINT,
  prefixRealmURLsFromDocument,
} from '@cardstack/runtime-common/prefix-realm-network';
import {
  localBaseRealm,
  localCatalogRealm,
  setupPermissionedRealmCached,
} from '../helpers/index.ts';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(`server-endpoints/${basename(import.meta.filename)}`, function () {
  module('Realm Server Endpoints (not specific to one realm)', function () {
    module(PREFIX_REALMS_ENDPOINT, function (hooks) {
      let request: SuperTest<Test>;

      setupPermissionedRealmCached(hooks, {
        fixture: 'blank',
        permissions: {
          '*': ['read'],
        },
        onRealmSetup(args) {
          request = args.request;
        },
      });

      test('serves the prefixes registered on the server network, unauthenticated', async function (assert) {
        let response = await request
          .get(`/${PREFIX_REALMS_ENDPOINT}`)
          .set('Accept', 'application/vnd.api+json');
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          response.headers['content-type'],
          'application/vnd.api+json',
          'answers as JSON:API',
        );

        let json = response.body;
        assert.deepEqual(
          json,
          {
            data: [
              {
                type: 'prefix-realm',
                id: '@cardstack/base/',
                attributes: { realmURL: ensureTrailingSlash(localBaseRealm) },
              },
              {
                type: 'prefix-realm',
                id: '@cardstack/catalog/',
                attributes: {
                  realmURL: ensureTrailingSlash(localCatalogRealm),
                },
              },
            ],
          },
          'each registered prefix names the URL its realm is served at',
        );

        // The document round-trips through the parser clients build their
        // network from, so a shape change here is caught on both sides.
        assert.deepEqual(
          prefixRealmURLsFromDocument(json, 'test'),
          {
            '@cardstack/base/': ensureTrailingSlash(localBaseRealm),
            '@cardstack/catalog/': ensureTrailingSlash(localCatalogRealm),
          },
          'a client reads the same map back',
        );
      });
    });
  });
});
