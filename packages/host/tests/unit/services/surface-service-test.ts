import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import {
  SandboxSurfaceClient,
  SandboxSurfaceServer,
} from '@cardstack/host/lib/sandbox-surface-transport';

import type SurfaceService from '@cardstack/host/services/surface-service';

module('Unit | Service | surface-service', function (hooks) {
  setupTest(hooks);

  test('direct service calls and the sandbox client target the same Host-owned surface', async function (assert) {
    let service = this.owner.lookup(
      'service:surface-service',
    ) as SurfaceService;
    let handle = service.register({
      mode: 'capsule',
      principal: 'test-user',
      surfaceId: 'preview',
    });
    let element = document.createElement('div');
    document.body.appendChild(element);
    let detach = service.attach(handle, element);
    let channel = new MessageChannel();
    let sandbox = new SandboxSurfaceClient(channel.port1, handle);
    let server = new SandboxSurfaceServer(channel.port2, service, handle);
    channel.port1.start();
    channel.port2.start();

    try {
      service.present(handle, { headerColor: '#112233' });
      assert.strictEqual(
        element.style.getPropertyValue('--boxel-surface-header-color'),
        '#112233',
      );

      await sandbox.present({ containerBackground: '#f4f0e8' });
      assert.strictEqual(
        element.style.getPropertyValue('--boxel-surface-container-background'),
        '#f4f0e8',
      );

      await sandbox.layout({ heightMode: 'allocated', minimumHeight: 320 });
      assert.strictEqual(element.dataset.boxelSurfaceHeightMode, 'allocated');
      assert.strictEqual(element.style.minHeight, '320px');
      assert.deepEqual(service.identityFor(handle), {
        mode: 'capsule',
        principal: 'test-user',
        surfaceId: 'preview',
      });
    } finally {
      sandbox.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
      detach();
      service.release(handle);
      element.remove();
    }
  });

  test('released handles fail closed', function (assert) {
    let service = this.owner.lookup(
      'service:surface-service',
    ) as SurfaceService;
    let handle = service.register({
      mode: 'direct',
      principal: 'host',
      surfaceId: 'card',
    });
    service.release(handle);
    assert.throws(
      () => service.present(handle, { headerColor: 'red' }),
      /Unknown or released Surface handle/,
    );
  });
});
