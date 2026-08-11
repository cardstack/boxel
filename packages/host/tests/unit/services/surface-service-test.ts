import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import type { SurfaceObservation } from '@cardstack/runtime-common';

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
      // Allocated mode: the surface's owner allocates the box; the surface
      // fills it and its own minimumHeight report never influences it.
      assert.strictEqual(element.style.height, '100%');
      assert.strictEqual(element.style.minHeight, '');
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

  test('a very tall intrinsic height report is clamped to the ceiling, not rejected — rejection strands the surface at its boot height and crops the card', function (assert) {
    let service = this.owner.lookup(
      'service:surface-service',
    ) as SurfaceService;
    let handle = service.register({
      mode: 'sandbox',
      principal: 'test-user',
      surfaceId: 'tall-card',
    });
    let element = document.createElement('div');
    document.body.appendChild(element);
    let detach = service.attach(handle, element);
    try {
      // The signet Proposal reported 7346px; the old validator threw
      // "outside the supported range" and the slot never grew past ~150px.
      service.layout(handle, { heightMode: 'intrinsic', minimumHeight: 7346 });
      assert.strictEqual(
        element.style.height,
        '2400px',
        'the ceiling applies; past it the child document scrolls',
      );
      // Genuinely malformed input still fails closed.
      assert.throws(
        () =>
          service.layout(handle, {
            heightMode: 'intrinsic',
            minimumHeight: Number.NaN,
          }),
        /outside the supported range/,
      );
      assert.throws(
        () =>
          service.layout(handle, {
            heightMode: 'intrinsic',
            minimumHeight: -1,
          }),
        /outside the supported range/,
      );
    } finally {
      detach();
      service.release(handle);
      element.remove();
    }
  });

  test('a replacement attachment on the same element owns teardown', function (assert) {
    let service = this.owner.lookup(
      'service:surface-service',
    ) as SurfaceService;
    let handle = service.register({
      mode: 'sandbox',
      principal: 'test-user',
      surfaceId: 'same-element-handoff',
    });
    let element = document.createElement('div');
    document.body.appendChild(element);
    let detachOld = service.attach(handle, element);
    let detachCurrent = service.attach(handle, element);

    try {
      detachOld();
      service.present(handle, { containerBackground: '#112233' });
      assert.strictEqual(
        element.style.getPropertyValue('--boxel-surface-container-background'),
        '#112233',
        "a superseded modifier's cleanup does not detach the current attachment",
      );
    } finally {
      detachCurrent();
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

  // MessagePort.start(), not a QUnit async callback.
  // eslint-disable-next-line qunit/resolve-async
  test('sandbox surface observation exists only while the child has subscribers', async function (assert) {
    let channel = new MessageChannel();
    let handle = 'surface:subscriber-test' as Parameters<
      SurfaceService['observe']
    >[0];
    let observed = 0;
    let released = 0;
    let publish: ((observation: SurfaceObservation) => void) | undefined;
    let service = {
      observe: (
        _handle: typeof handle,
        callback: (observation: SurfaceObservation) => void,
      ) => {
        observed++;
        publish = callback;
        return () => {
          released++;
          publish = undefined;
        };
      },
      present: () => undefined,
      layout: () => undefined,
    } as unknown as SurfaceService;
    let client = new SandboxSurfaceClient(channel.port1, handle);
    let server = new SandboxSurfaceServer(channel.port2, service, handle);
    channel.port1.start();
    channel.port2.start();

    try {
      await client.present({});
      assert.strictEqual(
        observed,
        0,
        'constructing and using a surface does not start observation',
      );
      let received = new Promise<void>((resolve) => {
        let stop = client.observe((observation) => {
          assert.deepEqual(observation, {
            width: 320,
            height: 180,
            visible: true,
          });
          stop();
          resolve();
        });
      });
      await client.present({});
      assert.strictEqual(
        observed,
        1,
        'the first subscriber starts observation',
      );
      publish?.({ width: 320, height: 180, visible: true });
      await received;
      await client.present({});
      assert.strictEqual(
        released,
        1,
        'removing the last subscriber releases the Host observers',
      );
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('silent and closed surface transports settle exactly once', async function (assert) {
    let channel = new MessageChannel();
    let handle = 'surface:timeout-test' as Parameters<
      SurfaceService['present']
    >[0];
    let client = new SandboxSurfaceClient(channel.port1, handle, 5);
    channel.port1.start();
    channel.port2.start();

    await assert.rejects(
      client.present({}),
      /timed out after 5ms/,
      'a silent peer cannot retain a pending surface request forever',
    );
    client.destroy();
    client.destroy();
    await assert.rejects(
      client.layout({ heightMode: 'intrinsic' }),
      /client is closed/,
      'new work fails immediately after teardown',
    );

    channel.port1.close();
    channel.port2.close();
  });
});
