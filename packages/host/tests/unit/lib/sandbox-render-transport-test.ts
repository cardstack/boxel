import { module, test } from 'qunit';

import { BOXEL_EXECUTION_TRANSPORT_VERSION } from '@cardstack/runtime-common';

import {
  SandboxRenderClient,
  SandboxRenderServer,
  projectedError,
  reconstructedError,
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
      draft: () => {},
      updateInstance: () => {},
    };
    let server = new SandboxRenderServer(channel.port1, target);
    let client = new SandboxRenderClient(channel.port2);

    try {
      await client.render('card:one' as never, 'isolated', 1);
      assert.deepEqual(calls, [{ card: 'card:one', format: 'isolated' }]);
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('a child render failure crosses the wire with its stack and full cause chain — the Host error presentation needs the ROOT cause, not the boundary wrapper', async function (assert) {
    let channel = new MessageChannel();
    let root = new Error('Cannot access Classroom before initialization');
    root.name = 'ReferenceError';
    let wrapper = new Error('Unable to import module for render');
    (wrapper as Error & { cause?: unknown }).cause = root;
    let target: SandboxRenderTarget = {
      render: () => {
        throw wrapper;
      },
      clear: () => {},
      draft: () => {},
      updateInstance: () => {},
    };
    let server = new SandboxRenderServer(channel.port1, target);
    let client = new SandboxRenderClient(channel.port2);

    try {
      let caught: unknown;
      try {
        await client.render('card:one' as never, 'isolated', 1);
      } catch (error) {
        caught = error;
      }
      assert.ok(caught instanceof Error, 'the render rejected with an Error');
      let error = caught as Error & { cause?: Error };
      assert.strictEqual(error.message, 'Unable to import module for render');
      assert.strictEqual(
        error.stack,
        wrapper.stack,
        'the child-side stack survives the wire',
      );
      assert.ok(error.cause instanceof Error, 'the cause chain survives');
      assert.strictEqual(error.cause?.name, 'ReferenceError');
      assert.strictEqual(
        error.cause?.message,
        'Cannot access Classroom before initialization',
      );
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('projectedError bounds a pathological cause chain and reconstructedError round-trips what was kept', function (assert) {
    // Deeper than the projection depth bound; the projection must terminate
    // and stay structured-clone-safe rather than recursing without limit.
    let deepest = new Error('depth-9');
    let error: Error = deepest;
    for (let depth = 8; depth >= 0; depth--) {
      let wrapper = new Error(`depth-${depth}`);
      (wrapper as Error & { cause?: unknown }).cause = error;
      error = wrapper;
    }
    let projected = projectedError(error);
    let depth = 0;
    let cursor: typeof projected | undefined = projected;
    while (cursor.cause) {
      cursor = cursor.cause;
      depth++;
    }
    assert.true(
      depth < 9,
      `the projected cause chain is depth-bounded (saw ${depth})`,
    );

    let rebuilt = reconstructedError(projected) as Error & { cause?: Error };
    assert.strictEqual(rebuilt.message, 'depth-0');
    assert.strictEqual(rebuilt.cause?.message, 'depth-1');

    // A non-Error throw still projects to a usable name/message pair.
    let projectedString = projectedError('boom');
    assert.strictEqual(projectedString.name, 'SandboxRenderError');
    assert.strictEqual(projectedString.message, 'boom');
    assert.strictEqual(projectedString.stack, undefined);
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
        client.render('card:one' as never, 'isolated', 1),
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

    let pending = client.render('card:one' as never, 'isolated', 1);
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
      draft: () => {},
      updateInstance: () => {},
    };
    let server = new SandboxRenderServer(channel.port1, target);
    let client = new SandboxRenderClient(channel.port2, 10);

    try {
      await assert.rejects(
        client.render('card:one' as never, 'isolated', 1),
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
    let pending = client.render('card:one' as never, 'isolated', 1);

    client.destroy();

    await assert.rejects(pending, /Sandbox render client was destroyed/);
    await assert.rejects(
      client.render('card:two' as never, 'isolated', 2),
      /Sandbox render client is closed/,
    );
    channel.port1.close();
    channel.port2.close();
  });

  test('RP-15.3: draft() sends the edited module URL and its echoed generation through the same request/response channel as render/clear', async function (assert) {
    let channel = new MessageChannel();
    let drafted: { url: string; generation: number }[] = [];
    let target: SandboxRenderTarget = {
      render: () => {},
      clear: () => {},
      updateInstance: () => {},
      draft: (url, generation) => {
        drafted.push({ url, generation });
      },
    };
    let server = new SandboxRenderServer(channel.port1, target);
    let client = new SandboxRenderClient(channel.port2);

    try {
      await client.draft('https://realm.example/card.gts', 7);
      assert.deepEqual(drafted, [
        { url: 'https://realm.example/card.gts', generation: 7 },
      ]);
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('RP-15.3: a generation still queued when a strictly newer one arrives is dropped — never dispatched, echoed back with dropped:true — while an older generation already running completes normally', async function (assert) {
    // The dossier's "drop generation <= latest on arrival": three render
    // requests fire back-to-back. Generation 1 is already dispatched
    // (running, mid-await) by the time 2 and 3 arrive, so it completes
    // normally regardless. Generation 2 is still queued (never dispatched)
    // when 3 arrives — it must be skipped entirely, not merely raced.
    // Generation 3, the latest, always runs.
    let channel = new MessageChannel();
    let ran: number[] = [];
    let target: SandboxRenderTarget = {
      render: async (_card, _format, generation) => {
        ran.push(generation);
        if (generation === 1) {
          // Holds the queue open just long enough for generations 2 and 3
          // to both arrive before generation 1 finishes.
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
      },
      clear: () => {},
      draft: () => {},
      updateInstance: () => {},
    };
    let server = new SandboxRenderServer(channel.port1, target);
    let client = new SandboxRenderClient(channel.port2);

    try {
      let first = client.render('card:one' as never, 'isolated', 1);
      let second = client.render('card:one' as never, 'isolated', 2);
      let third = client.render('card:one' as never, 'isolated', 3);

      await first;
      let secondError: Error | undefined;
      try {
        await second;
      } catch (error) {
        secondError = error as Error;
      }
      assert.ok(
        secondError,
        'a superseded generation rejects rather than silently hanging',
      );
      assert.strictEqual(
        secondError?.name,
        'SandboxGenerationSuperseded',
        'the response is distinguishably flagged dropped, not a genuine render failure',
      );
      await third;

      assert.deepEqual(
        ran,
        [1, 3],
        'generation 2 never actually ran — it never reached the target at all',
      );
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('RP-15.3: a render-family request with a missing, negative, or non-integer generation is ignored rather than dispatched', async function (assert) {
    let channel = new MessageChannel();
    let dispatched: unknown[] = [];
    let target: SandboxRenderTarget = {
      render: (card, format, generation) => {
        dispatched.push({ card, format, generation });
      },
      clear: (generation) => {
        dispatched.push({ clear: generation });
      },
      updateInstance: () => {},
      draft: (url, generation) => {
        dispatched.push({ url, generation });
      },
    };
    let server = new SandboxRenderServer(channel.port1, target);
    channel.port2.start();

    try {
      let base = {
        kind: 'boxel-sandbox-render-request',
        transportVersion: BOXEL_EXECUTION_TRANSPORT_VERSION,
        operation: 'clear' as const,
      };
      channel.port2.postMessage({ ...base, requestId: 'missing' });
      channel.port2.postMessage({
        ...base,
        requestId: 'negative',
        generation: -1,
      });
      channel.port2.postMessage({
        ...base,
        requestId: 'fractional',
        generation: 1.5,
      });
      channel.port2.postMessage({
        ...base,
        requestId: 'not-a-number',
        generation: '1',
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepEqual(
        dispatched,
        [],
        'every malformed generation was rejected by the envelope validator before ever reaching the queue',
      );
    } finally {
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('RP-15.3: a draft request with a missing or over-long URL is ignored rather than dispatched', async function (assert) {
    let channel = new MessageChannel();
    let dispatched: unknown[] = [];
    let target: SandboxRenderTarget = {
      render: () => {},
      clear: () => {},
      updateInstance: () => {},
      draft: (url) => {
        dispatched.push(url);
      },
    };
    let server = new SandboxRenderServer(channel.port1, target);
    channel.port2.start();

    try {
      channel.port2.postMessage({
        kind: 'boxel-sandbox-render-request',
        transportVersion: BOXEL_EXECUTION_TRANSPORT_VERSION,
        requestId: 'empty-url',
        generation: 1,
        operation: 'draft',
        url: '',
      });
      channel.port2.postMessage({
        kind: 'boxel-sandbox-render-request',
        transportVersion: BOXEL_EXECUTION_TRANSPORT_VERSION,
        requestId: 'huge-url',
        generation: 2,
        operation: 'draft',
        url: 'https://realm.example/' + 'a'.repeat(5000),
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepEqual(dispatched, []);
    } finally {
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });
});
