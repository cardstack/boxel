import { module, test } from 'qunit';

import {
  SandboxRenderClient,
  SandboxRenderServer,
  type SandboxRenderTarget,
} from '@cardstack/host/lib/sandbox-render-transport';

module('Unit | Sandbox render transport', function () {
  test('render resolves once the child confirms it', async function (assert) {
    let channel = new MessageChannel();
    let calls: { card: string; format: string }[] = [];
    let target: SandboxRenderTarget = {
      render: (card, format) => {
        calls.push({ card, format });
      },
      clear: () => {},
    };
    let server = new SandboxRenderServer(channel.port1, target);
    let client = new SandboxRenderClient(channel.port2);

    try {
      await client.render('card:one' as never, 'isolated');
      assert.deepEqual(calls, [{ card: 'card:one', format: 'isolated' }]);
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('RP-15.3: a render that never gets a response fails closed on a bounded timeout instead of hanging forever', async function (assert) {
    // No server on the other end of this channel at all: this is the shape of
    // a child that bootstrapped, stopped responding (a wedged runloop, a hung
    // module graph), and never acks the render — the exact "iframe mounts but
    // paints no authored DOM" failure reported against the suite realm. The
    // slot must still fail so the Host renderer's existing error chrome can
    // take over, rather than leaving `getRenderSlot` pending indefinitely
    // with an already-blank iframe on screen.
    let channel = new MessageChannel();
    let client = new SandboxRenderClient(channel.port2, 20);

    try {
      await assert.rejects(
        client.render('card:one' as never, 'isolated'),
        /timed out after 20ms/,
        'the render fails closed instead of hanging forever',
      );
    } finally {
      client.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('failPending fails in-flight renders immediately, without waiting out the timeout', async function (assert) {
    let channel = new MessageChannel();
    // A long timeout that would not fire during this test on its own — only
    // the explicit failPending() call below should settle the request.
    let client = new SandboxRenderClient(channel.port2, 60_000);

    let pending = client.render('card:one' as never, 'isolated');
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

  test('a response that arrives after the timeout already rejected is a silent no-op', async function (assert) {
    let channel = new MessageChannel();
    let target: SandboxRenderTarget = {
      // Never resolves within the test's timeout window, but does resolve
      // eventually — simulating a slow-but-not-actually-hung child whose ack
      // loses the race with the bounded timeout.
      render: () => new Promise((resolve) => setTimeout(resolve, 40)),
      clear: () => {},
    };
    let server = new SandboxRenderServer(channel.port1, target);
    let client = new SandboxRenderClient(channel.port2, 10);

    try {
      await assert.rejects(
        client.render('card:one' as never, 'isolated'),
        /timed out after 10ms/,
      );
      // Let the server's late response arrive; it must not throw or resolve
      // a promise that already settled.
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.ok(true, 'the late response was dropped without error');
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('destroy rejects every pending render and stops accepting new ones', async function (assert) {
    let channel = new MessageChannel();
    let client = new SandboxRenderClient(channel.port2, 60_000);
    let pending = client.render('card:one' as never, 'isolated');

    client.destroy();

    await assert.rejects(pending, /Sandbox render client was destroyed/);
    await assert.rejects(
      client.render('card:two' as never, 'isolated'),
      /Sandbox render client is closed/,
    );
    channel.port1.close();
    channel.port2.close();
  });
});
