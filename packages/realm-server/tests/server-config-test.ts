import { module, test } from 'qunit';
import { basename } from 'path';

import { createServeIndex } from '../handlers/serve-index.ts';

module(basename(__filename), function () {
  test('prefers MATRIX_SERVER_NAME over matrix URL hostname in host config', async function (assert) {
    let originalMatrixServerName = process.env.MATRIX_SERVER_NAME;

    process.env.MATRIX_SERVER_NAME = 'stack.cards';

    try {
      let { retrieveIndexHTML } = createServeIndex({
        serverURL: new URL('http://127.0.0.1:4448'),
        assetsURL: new URL('http://example.com/notional-assets-host/'),
        realms: [],
        reconciler: {} as any,
        dbAdapter: {} as any,
        matrixClient: {
          matrixURL: new URL('http://localhost:8008/'),
        } as any,
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
        cardSizeLimitBytes: 0,
        fileSizeLimitBytes: 0,
      });

      let html = await retrieveIndexHTML();
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
    }
  });
});
