import { module, test } from 'qunit';

import SandboxMediaBridge from '@cardstack/host/lib/sandbox-media-bridge';

module('Unit | Sandbox media bridge', function () {
  test('RP-20.4: a rejected bounded media read preserves the ordinary image-error fallback contract', async function (assert) {
    let privateSource = 'https://realm.example/assets/missing-artwork.png';
    let root = document.createElement('div');
    let image = document.createElement('img');
    image.src = privateSource;
    root.append(image);
    document.body.append(root);

    let failures = 0;
    let errorReceived = new Promise<void>((resolve) => {
      image.addEventListener('error', () => {
        failures++;
        resolve();
      });
    });
    let bridge = new SandboxMediaBridge(
      root,
      async () => new Response(null, { status: 404 }),
    );
    try {
      bridge.start();
      await errorReceived;

      assert.strictEqual(
        failures,
        1,
        'the authored component receives the same failure signal as an ordinary image request',
      );
      assert.false(
        image.hasAttribute('src'),
        'the private authored URL is not restored after the bounded read fails',
      );
    } finally {
      bridge.stop();
      root.remove();
    }
  });
});
