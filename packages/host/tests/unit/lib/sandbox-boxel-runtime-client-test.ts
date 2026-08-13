import { module, test } from 'qunit';

import type { BoxelRuntime } from '@cardstack/host/lib/boxel-runtime';
import SandboxBoxelRuntimeClient from '@cardstack/host/lib/sandbox-boxel-runtime-client';
import SandboxBoxelRuntimeServer from '@cardstack/host/lib/sandbox-boxel-runtime-server';

module('Unit | Sandbox Boxel runtime client', function () {
  test('a request resolves once the child responds', async function (assert) {
    let channel = new MessageChannel();
    let runtime = {
      loadBoxel: async (ref: { name: string }) => `type:${ref.name}`,
    } as unknown as BoxelRuntime;
    let server = new SandboxBoxelRuntimeServer(channel.port1, runtime);
    let client = new SandboxBoxelRuntimeClient(channel.port2);

    try {
      let handle = await client.loadBoxel({
        module: 'https://realm.example/card.gts' as never,
        name: 'Card',
      });
      assert.strictEqual(handle, 'type:Card');
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('an admitted cold materialization has a completion budget independent of peer silence', async function (assert) {
    let channel = new MessageChannel();
    let runtime = {
      createFromSerialized: async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return 'instance:ready';
      },
    } as unknown as BoxelRuntime;
    let server = new SandboxBoxelRuntimeServer(channel.port1, runtime);
    let client = new SandboxBoxelRuntimeClient(channel.port2, 20, 100);

    try {
      assert.strictEqual(
        await client.createFromSerialized(
          {} as never,
          {} as never,
          undefined,
          'host-display',
        ),
        'instance:ready',
        'the immediate admission ack moves a cold operation onto its longer completion deadline',
      );
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('RP-15.3: a hung RPC (e.g. createFromSerialized for an interactive-edit purpose) fails closed on a bounded timeout instead of hanging BoxelExecutionSession.update() forever', async function (assert) {
    // No server on the other end: this is the shape of a child that never
    // acks an operation — the case behind "switching to edit format leaves
    // the prerendered placeholder up forever with no error." Unlike the
    // render RPC (already timeout-guarded), loadBoxel/createFromSerialized/
    // buildRenderRecord run *before* getRenderSlot and previously had no
    // bound at all, so a hang there wedged the whole session silently.
    let channel = new MessageChannel();
    let client = new SandboxBoxelRuntimeClient(channel.port2, 20);

    try {
      await assert.rejects(
        client.createFromSerialized(
          {} as never,
          {} as never,
          undefined,
          'interactive-edit',
        ),
        /timed out after 20ms/,
        'the RPC fails closed instead of hanging forever',
      );
    } finally {
      client.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('failPending fails in-flight requests immediately, without waiting out the timeout', async function (assert) {
    let channel = new MessageChannel();
    let client = new SandboxBoxelRuntimeClient(channel.port2, 60_000);

    let pending = client.buildRenderRecord('card:one' as never);
    let settledEarly = false;
    pending.catch(() => (settledEarly = true));

    client.failPending(new Error('Sandbox reported a runtime error'));
    await assert.rejects(
      pending,
      /Sandbox reported a runtime error/,
      'the report from an out-of-band child failure reaches the caller directly',
    );
    assert.true(settledEarly, 'the promise settled without the timeout firing');

    client.destroy();
    channel.port1.close();
    channel.port2.close();
  });

  test('destroy rejects every pending request and stops accepting new ones', async function (assert) {
    let channel = new MessageChannel();
    let client = new SandboxBoxelRuntimeClient(channel.port2, 60_000);
    let pending = client.getFields('type:one' as never);

    client.destroy();

    await assert.rejects(pending, /Sandbox runtime client was destroyed/);
    await assert.rejects(
      client.getFields('type:two' as never),
      /Sandbox runtime client is closed/,
    );
    channel.port1.close();
    channel.port2.close();
  });
});
