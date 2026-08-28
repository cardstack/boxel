import { clearRender, render, settled } from '@ember/test-helpers';

import { module, test } from 'qunit';
import { TrackedObject } from 'tracked-built-ins';

import type { SandboxRenderSlot } from '@cardstack/host/lib/sandbox-runtime-process';
import boxelSandboxSlot from '@cardstack/host/modifiers/boxel-sandbox-slot';
import type SurfaceService from '@cardstack/host/services/surface-service';

import { setupRenderingTest } from '../../helpers/setup';

module('Integration | Modifier | boxel-sandbox-slot', function (hooks) {
  setupRenderingTest(hooks);

  test('a format update transfers ownership before predecessor cleanup and preserves the child document', async function (assert) {
    let surfaceService = this.owner.lookup(
      'service:surface-service',
    ) as SurfaceService;
    let surface = surfaceService.register({
      mode: 'sandbox',
      principal: 'test-user',
      surfaceId: 'sandbox-format-handoff',
    });
    let iframe = document.createElement('iframe');
    let currentOwner: object | undefined;
    let mounts = 0;
    let destructiveUnmounts = 0;
    let process = {
      iframe,
      surface,
      mount(element: HTMLElement, owner: object) {
        mounts++;
        currentOwner = owner;
        element.append(iframe);
        return () => {
          if (currentOwner !== owner) {
            return;
          }
          destructiveUnmounts++;
          iframe.remove();
          iframe = document.createElement('iframe');
          process.iframe = iframe;
          currentOwner = undefined;
        };
      },
    };
    let firstOwner = {};
    let secondOwner = {};
    let state = new TrackedObject({
      slot: {
        owner: 'sandbox' as const,
        iframe: process.iframe,
        surface,
        mountToken: firstOwner,
        process,
      } as unknown as SandboxRenderSlot,
    });

    try {
      await render(
        <template>
          <div data-test-sandbox-slot {{boxelSandboxSlot state.slot}}></div>
        </template>,
      );
      let firstIframe = process.iframe;
      assert.strictEqual(
        firstIframe.parentElement?.dataset.testSandboxSlot,
        '',
      );

      state.slot = {
        owner: 'sandbox',
        iframe: process.iframe,
        surface,
        mountToken: secondOwner,
        process,
      } as unknown as SandboxRenderSlot;
      await settled();

      assert.strictEqual(mounts, 2, 'the successor format receives ownership');
      assert.strictEqual(
        destructiveUnmounts,
        0,
        'predecessor cleanup cannot destroy the successor child document',
      );
      assert.strictEqual(
        process.iframe,
        firstIframe,
        'the same iframe and child-local handle registry survive the switch',
      );
      assert.true(firstIframe.isConnected, 'the live iframe remains mounted');

      await clearRender();
      assert.strictEqual(
        destructiveUnmounts,
        1,
        'destroying the slot tears down the current owner exactly once',
      );
      assert.false(firstIframe.isConnected);
    } finally {
      surfaceService.release(surface);
    }
  });
});
