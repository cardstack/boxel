import { module, test } from 'qunit';

import {
  iframeFetchResponseLimitBytes,
  isRealmIframeSandboxInbound,
  isRealmIframeSandboxOutbound,
  realmIframeSandboxProtocol,
} from '@cardstack/host/lib/realm-iframe-sandbox-protocol';

module('Unit | realm iframe sandbox protocol', function () {
  test('accepts well-formed renderer messages', function (assert) {
    assert.true(
      isRealmIframeSandboxInbound({
        protocol: realmIframeSandboxProtocol,
        type: 'fetch-response',
        requestId: 'realm-image-1',
        response: {
          body: new ArrayBuffer(32),
          headers: [['content-type', 'image/png']],
          status: 200,
          statusText: 'OK',
          url: 'https://realm.example/assets/poster.png',
        },
      }),
      'bounded binary Realm assets can cross the private channel',
    );
    assert.true(
      isRealmIframeSandboxInbound({
        protocol: realmIframeSandboxProtocol,
        type: 'render',
        presentation: {
          format: 'embedded',
          displayContainer: false,
          fieldName: 'description',
          codeRef: {
            module: 'https://realm.example/card.gts',
            name: 'Embedded',
          },
        },
      }),
      'format and presentation updates stay on the channel',
    );
    assert.true(
      isRealmIframeSandboxOutbound({
        protocol: realmIframeSandboxProtocol,
        type: 'resize',
        width: 640,
        height: 480,
      }),
    );
    assert.true(
      isRealmIframeSandboxOutbound({
        protocol: realmIframeSandboxProtocol,
        type: 'fetch-request',
        requestId: 'fetch-1',
        url: 'https://realm.example/card.gts',
        init: { method: 'GET', headers: [['accept', 'text/plain']] },
      }),
    );
    assert.true(
      isRealmIframeSandboxOutbound({
        protocol: realmIframeSandboxProtocol,
        type: 'ready',
        cardID: 'https://realm.example/Card/sample',
        typePresentation: {
          displayName: 'Wide iframe card',
          headerColor: '#123456',
          prefersWideFormat: true,
        },
      }),
      'a renderer can publish bounded inert type presentation',
    );
  });

  test('rejects malformed and oversized renderer messages', function (assert) {
    assert.false(
      isRealmIframeSandboxInbound({
        protocol: realmIframeSandboxProtocol,
        type: 'fetch-response',
        requestId: 'oversized-realm-image',
        response: {
          body: new ArrayBuffer(iframeFetchResponseLimitBytes + 1),
          headers: [['content-type', 'image/png']],
          status: 200,
          statusText: 'OK',
          url: 'https://realm.example/assets/poster.png',
        },
      }),
      'binary responses remain bounded',
    );
    assert.false(
      isRealmIframeSandboxInbound({
        protocol: realmIframeSandboxProtocol,
        type: 'render',
        presentation: {
          format: 'fitted',
          displayContainer: true,
        },
      }),
      'iframe-only presentation updates reject composable SES formats',
    );
    assert.false(
      isRealmIframeSandboxOutbound({
        protocol: realmIframeSandboxProtocol,
        type: 'resize',
        width: 640,
        height: Number.NaN,
      }),
      'resize dimensions must be finite',
    );
    assert.false(
      isRealmIframeSandboxOutbound({
        protocol: realmIframeSandboxProtocol,
        type: 'fetch-request',
        requestId: 'fetch-1',
        url: 'https://realm.example/card.gts',
        init: { method: 'GET', headers: [['accept']] },
      }),
      'headers must be string pairs',
    );
    assert.false(
      isRealmIframeSandboxOutbound({
        protocol: realmIframeSandboxProtocol,
        type: 'fetch-request',
        requestId: 'x'.repeat(257),
        url: 'https://realm.example/card.gts',
        init: { method: 'GET', headers: [] },
      }),
      'request identifiers are bounded',
    );
    assert.false(
      isRealmIframeSandboxOutbound({
        protocol: realmIframeSandboxProtocol,
        type: 'ready',
        typePresentation: {
          displayName: 'Card',
          headerColor: '#123456',
          prefersWideFormat: 'yes',
        },
      }),
      'type presentation cannot smuggle non-boolean policy values',
    );
    assert.false(
      isRealmIframeSandboxOutbound({
        protocol: realmIframeSandboxProtocol,
        type: 'ready',
        typePresentation: {
          displayName: 'x'.repeat(1_025),
          headerColor: null,
          prefersWideFormat: false,
        },
      }),
      'type presentation strings are bounded',
    );
  });
});
