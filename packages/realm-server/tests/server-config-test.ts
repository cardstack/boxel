import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  PrefixRealmNetwork,
  prefixRealmURLsOf,
} from '@cardstack/runtime-common/prefix-realm-network';
import { createServeIndex } from '../handlers/serve-index.ts';

module(basename(import.meta.filename), function () {
  test("names the realm server's configured Matrix server in host config, not the homeserver hostname", async function (assert) {
    let { retrieveIndexHTML } = createServeIndex({
      serverURL: new URL('http://127.0.0.1:4448'),
      assetsURL: new URL('http://example.com/notional-assets-host/'),
      realms: [],
      reconciler: {} as any,
      dbAdapter: {} as any,
      matrixClient: {
        matrixURL: new URL('http://matrix.example.test/'),
        serverName: 'example.test',
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
      virtualNetwork: new PrefixRealmNetwork(),
      cardSizeLimitBytes: 0,
      fileSizeLimitBytes: 0,
      audioSizeLimitBytes: 0,
      videoSizeLimitBytes: 0,
    });

    let html = await retrieveIndexHTML();
    let match = html.match(
      /<meta name="@cardstack\/host\/config\/environment" content="([^"]+)">/,
    );

    assert.ok(match, 'host config environment meta tag is present');

    let config = JSON.parse(decodeURIComponent(match![1]));
    assert.strictEqual(
      config.matrixServerName,
      'example.test',
      "uses the realm server's configured Matrix server name",
    );
  });

  test('serves the prefix map of its own network, not the build map', async function (assert) {
    let network = new PrefixRealmNetwork({
      '@cardstack/base/': 'http://127.0.0.1:4448/base/',
      '@cardstack/catalog/': 'http://127.0.0.1:4448/catalog/',
    });
    let { retrieveIndexHTML } = createServeIndex({
      serverURL: new URL('http://127.0.0.1:4448'),
      assetsURL: new URL('http://example.com/notional-assets-host/'),
      realms: [],
      reconciler: {} as any,
      dbAdapter: {} as any,
      matrixClient: {
        matrixURL: new URL('http://localhost:8008/'),
      } as any,
      // The build lists a prefix this server does not register, at the
      // build's own origin.
      getIndexHTML: async () =>
        `<html><head><meta name="@cardstack/host/config/environment" content="${encodeURIComponent(
          JSON.stringify({
            matrixURL: 'http://localhost:8008',
            realmServerURL: 'http://localhost:4201/',
            prefixRealmURLs: {
              '@cardstack/base/': 'http://localhost:4201/base/',
              '@cardstack/catalog/': 'http://localhost:4201/catalog/',
              '@cardstack/pretui/': 'http://localhost:4201/pretui/',
            },
          }),
        )}"></head><body></body></html>`,
      virtualNetwork: network,
      cardSizeLimitBytes: 0,
      fileSizeLimitBytes: 0,
      audioSizeLimitBytes: 0,
      videoSizeLimitBytes: 0,
    });

    let html = await retrieveIndexHTML();
    let match = html.match(
      /<meta name="@cardstack\/host\/config\/environment" content="([^"]+)">/,
    );
    assert.ok(match, 'host config environment meta tag is present');

    let config = JSON.parse(decodeURIComponent(match![1]));
    assert.deepEqual(
      config.prefixRealmURLs,
      prefixRealmURLsOf(network),
      'the served map is the one /_prefix-realms serves, with no build-only prefix',
    );
  });
});
