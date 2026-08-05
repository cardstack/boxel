import { module, test } from 'qunit';

import type { SurfaceHandle } from '@cardstack/runtime-common';

import SandboxRuntimeProcess from '@cardstack/host/lib/sandbox-runtime-process';

import type SurfaceService from '@cardstack/host/services/surface-service';

module('Unit | Sandbox runtime process', function () {
  test('owns a credentialless cross-origin iframe and releases it deterministically', async function (assert) {
    let iframe = document.createElement('iframe');
    document.body.append(iframe);
    let surface = 'surface:sandbox-test' as SurfaceHandle;
    let released: SurfaceHandle[] = [];
    let surfaceService = {
      register: () => surface,
      release: (handle: SurfaceHandle) => released.push(handle),
    } as unknown as SurfaceService;
    let runtime = new SandboxRuntimeProcess({
      iframe,
      childURL: 'https://sandbox.example.test/_boxel-sandbox-runtime',
      childOrigin: 'https://sandbox.example.test',
      surfaceService,
      fetch: globalThis.fetch,
      resolveModuleURL: (identifier) => identifier,
      isTrustedModuleURL: () => false,
      identity: {
        mode: 'sandbox',
        principal: 'user:test',
        surfaceId: 'sandbox-test',
      },
      connectTimeout: 60_000,
    });

    assert.strictEqual(
      iframe.getAttribute('sandbox'),
      'allow-scripts allow-same-origin',
    );
    assert.true(iframe.hasAttribute('credentialless'));
    assert.true(iframe.isConnected);

    runtime.destroy();

    assert.false(
      iframe.isConnected,
      'the process removes its browsing context',
    );
    assert.deepEqual(released, [surface], 'the Host capability is released');
    await assert.rejects(
      runtime.loadBoxel({
        module: 'https://realm.example/card.gts' as never,
        name: 'Card',
      }),
      /closed/,
      'released processes fail closed',
    );
  });
});
