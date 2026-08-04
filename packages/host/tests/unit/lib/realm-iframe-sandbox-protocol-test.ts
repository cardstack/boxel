import { module, test } from 'qunit';

import {
  iframeFetchResponseLimitBytes,
  isRealmIframeSandboxConnect,
  isRealmIframeSandboxInbound,
  isRealmIframeSandboxOutbound,
  realmIframeSandboxProtocol,
} from '@cardstack/host/lib/realm-iframe-sandbox-protocol';

module('Unit | realm iframe sandbox protocol', function () {
  test('accepts well-formed renderer messages', function (assert) {
    assert.true(
      isRealmIframeSandboxConnect({
        protocol: realmIframeSandboxProtocol,
        type: 'connect',
        rootModuleURL: 'https://realm.example/card.gts',
        canWrite: true,
        presentation: { format: 'edit', displayContainer: true },
      }),
      'write permission is an explicit capability bit on connect',
    );
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
      isRealmIframeSandboxInbound({
        protocol: realmIframeSandboxProtocol,
        type: 'permissions',
        canWrite: false,
      }),
      'permission changes stay on the existing capability channel',
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
    assert.true(
      isRealmIframeSandboxOutbound({
        protocol: realmIframeSandboxProtocol,
        type: 'card-update',
        revision: 1,
        document: {
          data: {
            type: 'card',
            id: 'https://realm.example/Card/sample',
            attributes: { rating: 4 },
            meta: {
              adoptsFrom: {
                module: 'https://realm.example/card.gts',
                name: 'Card',
              },
            },
          },
        },
      }),
      'a bounded data-only card update may leave the child',
    );
    assert.true(
      isRealmIframeSandboxInbound({
        protocol: realmIframeSandboxProtocol,
        type: 'card-update-result',
        revision: 1,
      }),
      'the Host can acknowledge a persisted update',
    );
  });

  test('rejects malformed and oversized renderer messages', function (assert) {
    assert.false(
      isRealmIframeSandboxConnect({
        protocol: realmIframeSandboxProtocol,
        type: 'connect',
        rootModuleURL: 'https://realm.example/card.gts',
        presentation: { format: 'edit', displayContainer: true },
      }),
      'connect cannot omit the Host permission decision',
    );
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
      isRealmIframeSandboxInbound({
        protocol: realmIframeSandboxProtocol,
        type: 'permissions',
        canWrite: 'sometimes',
      }),
      'permission updates require an explicit boolean',
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
    assert.false(
      isRealmIframeSandboxOutbound({
        protocol: realmIframeSandboxProtocol,
        type: 'card-update',
        revision: 1,
        document: {
          data: {
            type: 'card',
            id: 'https://realm.example/Card/other',
            attributes: { body: 'x'.repeat(2_000_001) },
          },
        },
      }),
      'card update documents are bounded',
    );
  });
});
