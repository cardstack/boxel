import { module, test } from 'qunit';

import {
  isRealmIframeSandboxInbound,
  isRealmIframeSandboxOutbound,
  realmIframeSandboxProtocol,
} from '@cardstack/host/lib/realm-iframe-sandbox-protocol';

module('Unit | realm iframe sandbox protocol', function () {
  test('accepts well-formed renderer messages', function (assert) {
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
  });

  test('rejects malformed and oversized renderer messages', function (assert) {
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
  });
});
