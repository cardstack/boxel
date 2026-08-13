import { module, test } from 'qunit';

import {
  BOXEL_EXECUTION_TRANSPORT_VERSION,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import {
  constrainSandboxWriteDocument,
  SandboxWriteClient,
  SandboxWriteServer,
} from '@cardstack/host/lib/sandbox-write-transport';

function documentFor(id: string, headline: string): LooseSingleCardDocument {
  return {
    data: {
      id,
      type: 'card',
      attributes: { headline },
      meta: { adoptsFrom: { module: 'test', name: 'Test' } },
    },
  } as unknown as LooseSingleCardDocument;
}

module('Unit | Sandbox write transport', function () {
  test('included resources are read-only and relationship writes stay within the projected neighborhood', function (assert) {
    let authorized = {
      data: {
        type: 'card',
        id: 'https://realm.example/parent',
        relationships: {
          child: {
            data: { type: 'card', id: 'https://realm.example/child' },
          },
        },
      },
      included: [
        {
          type: 'card',
          id: 'https://realm.example/child',
          attributes: { title: 'canonical child' },
        },
      ],
    } as unknown as LooseSingleCardDocument;
    let proposed = {
      ...authorized,
      data: {
        ...authorized.data,
        attributes: { title: 'edited parent' },
      },
      included: [
        {
          type: 'card',
          id: 'https://realm.example/child',
          attributes: { title: 'attacker changed child' },
        },
      ],
    } as unknown as LooseSingleCardDocument;

    let constrained = constrainSandboxWriteDocument(proposed, authorized);
    assert.deepEqual(
      constrained.included,
      authorized.included,
      'attacker-controlled included payload is replaced by the canonical projection',
    );
    assert.deepEqual(constrained.data.attributes, {
      title: 'edited parent',
    });

    let escaped = structuredClone(proposed);
    escaped.data.relationships = {
      child: {
        data: { type: 'card', id: 'https://realm.example/other-card' },
      },
    };
    assert.throws(
      () => constrainSandboxWriteDocument(escaped, authorized),
      /outside its projected capabilities/,
      'the root cannot point at an undeclared Store instance',
    );
  });

  test('RP-20.6: a child write resolves once the parent confirms applying it', async function (assert) {
    let channel = new MessageChannel();
    let applied: LooseSingleCardDocument[] = [];
    let server = new SandboxWriteServer(channel.port1, (document) => {
      applied.push(document);
    });
    let client = new SandboxWriteClient(channel.port2);

    try {
      await client.write(documentFor('http://realm/card/1', 'First Light'));
      assert.strictEqual(applied.length, 1);
      assert.strictEqual(
        applied[0]!.data?.attributes?.headline,
        'First Light',
        'the full document reached the parent apply callback',
      );
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('RP-20.6: a parent apply failure crosses back as the write rejection, cause chain intact', async function (assert) {
    let channel = new MessageChannel();
    let root = new Error('canonical instance is gone');
    let wrapper = new Error('Unable to apply sandbox instance write');
    (wrapper as Error & { cause?: unknown }).cause = root;
    let server = new SandboxWriteServer(channel.port1, () => {
      throw wrapper;
    });
    let client = new SandboxWriteClient(channel.port2);

    try {
      let caught: unknown;
      try {
        await client.write(documentFor('http://realm/card/1', 'x'));
      } catch (error) {
        caught = error;
      }
      assert.ok(caught instanceof Error, 'the write rejected with an Error');
      let error = caught as Error & { cause?: Error };
      assert.strictEqual(
        error.message,
        'Unable to apply sandbox instance write',
      );
      assert.strictEqual(
        error.cause?.message,
        'canonical instance is gone',
        'the cause chain survives the wire',
      );
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('RP-20.6: a concurrent burst applies serially, never regresses order, and always lands on the newest state — superseded intermediates may coalesce away', async function (assert) {
    let channel = new MessageChannel();
    let applied: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    let server = new SandboxWriteServer(channel.port1, async (document) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Yield so an interleaving bug would actually get the chance to show —
      // and so later writes ARRIVE while an earlier one is mid-apply, which
      // is what makes the supersede-drop reachable at all.
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      applied.push(String(document.data?.attributes?.headline));
      inFlight--;
    });
    let client = new SandboxWriteClient(channel.port2);

    try {
      // Every write resolves — including any the server coalesced away as
      // superseded (each write is the instance's COMPLETE current state, so
      // a newer one already carries everything an older one proposed).
      await Promise.all([
        client.write(documentFor('http://realm/card/1', 'one')),
        client.write(documentFor('http://realm/card/1', 'two')),
        client.write(documentFor('http://realm/card/1', 'three')),
      ]);
      assert.strictEqual(
        applied[applied.length - 1],
        'three',
        'the final applied state is the newest write',
      );
      let order = ['one', 'two', 'three'];
      assert.deepEqual(
        applied,
        order.filter((h) => applied.includes(h)),
        `applied writes hold arrival order, never regressing (saw ${JSON.stringify(applied)})`,
      );
      assert.strictEqual(maxInFlight, 1, 'applies never overlapped');
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('RP-20.6: a stale seq is dropped, not applied — and the child treats the drop as success', async function (assert) {
    let channel = new MessageChannel();
    let applied: string[] = [];
    let server = new SandboxWriteServer(channel.port1, (document) => {
      applied.push(String(document.data?.attributes?.headline));
    });

    try {
      // Drive the wire directly so an out-of-order seq can actually be
      // constructed (a real client's serialized sends can't produce one).
      let responses: unknown[] = [];
      channel.port2.addEventListener('message', (event) =>
        responses.push(event.data),
      );
      channel.port2.start();
      let request = (requestId: string, seq: number, headline: string) => ({
        kind: 'boxel-sandbox-write-request',
        transportVersion: BOXEL_EXECUTION_TRANSPORT_VERSION,
        requestId,
        seq,
        document: documentFor('http://realm/card/1', headline),
      });
      channel.port2.postMessage(request('write:1', 5, 'newer'));
      channel.port2.postMessage(request('write:2', 3, 'stale'));
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      assert.deepEqual(applied, ['newer'], 'the stale document never applied');
      let stale = responses.find(
        (r) => (r as { requestId?: string }).requestId === 'write:2',
      ) as { ok: boolean; dropped?: boolean };
      assert.false(stale.ok, 'the stale write acked ok:false');
      assert.true(stale.dropped, 'flagged dropped, not a genuine failure');
    } finally {
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('RP-20.6: a malformed envelope is ignored and a valid write still succeeds after it', async function (assert) {
    let channel = new MessageChannel();
    let applied: string[] = [];
    let server = new SandboxWriteServer(channel.port1, (document) => {
      applied.push(String(document.data?.attributes?.headline));
    });
    let client = new SandboxWriteClient(channel.port2);

    try {
      channel.port2.postMessage({ kind: 'boxel-sandbox-write-request' });
      channel.port2.postMessage({
        kind: 'boxel-sandbox-write-request',
        transportVersion: BOXEL_EXECUTION_TRANSPORT_VERSION,
        requestId: 'evil',
        seq: 1,
        document: null,
      });
      await client.write(documentFor('http://realm/card/1', 'legit'));
      assert.deepEqual(
        applied,
        ['legit'],
        'only the valid write reached the apply callback',
      );
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('RP-20.6: a write that never gets a response fails closed on a bounded timeout instead of hanging forever', async function (assert) {
    let channel = new MessageChannel();
    // No server on the other end at all — the shape of a wedged parent.
    let client = new SandboxWriteClient(channel.port2, 50);

    try {
      let caught: unknown;
      try {
        await client.write(documentFor('http://realm/card/1', 'x'));
      } catch (error) {
        caught = error;
      }
      assert.ok(caught instanceof Error);
      assert.true(
        (caught as Error).message.includes('timed out'),
        'the sender learns about the silence instead of pending forever',
      );
    } finally {
      client.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('RP-20.6: destroying the client fails every in-flight write', async function (assert) {
    let channel = new MessageChannel();
    let client = new SandboxWriteClient(channel.port2);

    try {
      let pending = client.write(documentFor('http://realm/card/1', 'x'));
      client.destroy('teardown');
      let caught: unknown;
      try {
        await pending;
      } catch (error) {
        caught = error;
      }
      assert.strictEqual((caught as Error).message, 'teardown');
    } finally {
      client.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });
});
