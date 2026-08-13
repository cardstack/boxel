import { module, test } from 'qunit';

import {
  BOXEL_EXECUTION_TRANSPORT_VERSION,
  surfaceHeightModeFor,
  type BoxelInstanceHandle,
} from '@cardstack/runtime-common';

import {
  SandboxRenderClient,
  SandboxRenderServer,
  type SandboxRenderTarget,
} from '@cardstack/host/lib/sandbox-render-transport';

const instanceHandle = 'test-instance:1' as BoxelInstanceHandle;

module('Unit | rp-box-contract (RP-9.9)', function () {
  test('RP-9.9: the height mode derives from the Host box contract AND the format — never from the format alone', function (assert) {
    // The failure this encodes: a card root styled `height: 100%` (main's own
    // `.boxel-card-container` is one, so every card carries the pattern)
    // resolves its percentage only against a DEFINITE containing block.
    // Measure that container from its content instead and the percentage
    // resolves to `auto` — the card collapses to its own content height,
    // which is what produced full-page cards rendering at ~60px.
    assert.strictEqual(
      surfaceHeightModeFor('isolated', true),
      'allocated',
      'a declared Host box allocates: the card fills the box instead of dictating it',
    );
    assert.strictEqual(
      surfaceHeightModeFor('isolated'),
      'intrinsic',
      'the SAME format undeclared stays intrinsic — an isolated card in an auto-height panel must still measure itself',
    );
    assert.strictEqual(
      surfaceHeightModeFor('fitted', false),
      'allocated',
      'a fitted tile allocates on the format alone: its tile owner always sizes it',
    );
    assert.strictEqual(
      surfaceHeightModeFor('embedded', false),
      'intrinsic',
      'in-flow formats flow at content height, as an in-document card does',
    );
    assert.strictEqual(
      surfaceHeightModeFor('embedded', true),
      'allocated',
      'the Host declaration wins for any format — it describes the box that exists, not a preference',
    );
  });

  test('RP-9.9: the box contract crosses the render op so the child derives the same mode the parent laid out', async function (assert) {
    // It has to travel: the parent lays the surface out from this contract,
    // and a child that disagreed would keep reporting intrinsic measurements
    // and stomp the parent's allocated box back to a content-derived pixel
    // height. The child cannot re-derive it locally — the same format lands
    // in a stack item's definite box in one place and an auto-height panel
    // in another, and only the Host knows which.
    let channel = new MessageChannel();
    let seen: (boolean | undefined)[] = [];
    let target: SandboxRenderTarget = {
      render: (_card, _format, _generation, hostOwnsBox) => {
        seen.push(hostOwnsBox);
      },
      clear: () => {},
      draft: () => {},
      updateInstance: () => {},
      updateContext: () => {},
    };
    let server = new SandboxRenderServer(channel.port1, target);
    let client = new SandboxRenderClient(channel.port2);

    try {
      await client.render(instanceHandle, 'isolated', 1, true);
      await client.render(instanceHandle, 'isolated', 2);
      assert.deepEqual(
        seen,
        [true, undefined],
        'the contract crosses as sent — declared, or absent for the format default',
      );

      channel.port2.postMessage({
        kind: 'boxel-sandbox-render-request',
        transportVersion: BOXEL_EXECUTION_TRANSPORT_VERSION,
        requestId: 'bad-box',
        generation: 3,
        operation: 'render',
        card: instanceHandle,
        format: 'isolated',
        hostOwnsBox: 'yes',
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.strictEqual(
        seen.length,
        2,
        'a non-boolean box contract never dispatches — the envelope validator refuses it',
      );
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });
});
