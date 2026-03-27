import { module, test } from 'qunit';
import { basename } from 'path';
import { dirSync } from 'tmp';

import { RealmServer } from '../server';

module(basename(__filename), function () {
  test('prefers MATRIX_SERVER_NAME over matrix URL hostname in host config', async function (assert) {
    let originalMatrixServerName = process.env.MATRIX_SERVER_NAME;
    let tempDir = dirSync({ unsafeCleanup: true });

    process.env.MATRIX_SERVER_NAME = 'stack.cards';

    try {
      let server = new RealmServer({
        serverURL: new URL('http://127.0.0.1:4448'),
        realms: [],
        virtualNetwork: {} as any,
        matrixClient: {
          matrixURL: new URL('http://localhost:8008/'),
        } as any,
        realmServerSecretSeed: 'test-realm-server-secret',
        realmSecretSeed: 'test-realm-secret',
        grafanaSecret: 'test-grafana-secret',
        realmsRootPath: tempDir.name,
        dbAdapter: {} as any,
        queue: {} as any,
        definitionLookup: {} as any,
        assetsURL: new URL('http://example.com/notional-assets-host/'),
        matrixRegistrationSecret: 'test-matrix-registration-secret',
        getIndexHTML: async () =>
          `<html><head><meta name="@cardstack/host/config/environment" content="${encodeURIComponent(
            JSON.stringify({
              matrixURL: 'http://localhost:8008',
              matrixServerName: 'localhost',
              realmServerURL: 'http://localhost:4201/',
              publishedRealmBoxelSpaceDomain: 'localhost:4201',
              publishedRealmBoxelSiteDomain: 'localhost:4201',
            }),
          )}"></head><body></body></html>`,
      });

      let html = await (server as any).retrieveIndexHTML();
      let match = html.match(
        /<meta name="@cardstack\/host\/config\/environment" content="([^"]+)">/,
      );

      assert.ok(match, 'host config environment meta tag is present');

      let config = JSON.parse(decodeURIComponent(match![1]));
      assert.strictEqual(
        config.matrixServerName,
        'stack.cards',
        'uses MATRIX_SERVER_NAME override in host config',
      );
    } finally {
      if (originalMatrixServerName == null) {
        delete process.env.MATRIX_SERVER_NAME;
      } else {
        process.env.MATRIX_SERVER_NAME = originalMatrixServerName;
      }
      tempDir.removeCallback();
    }
  });
});
