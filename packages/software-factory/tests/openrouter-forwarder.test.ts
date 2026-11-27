import QUnit from 'qunit';
const { module, test } = QUnit;

import {
  startOpenRouterForwarder,
  type OpenRouterForwarder,
} from '../src/factory-agent/openrouter-forwarder.ts';

// The loopback forwarder opencode calls on a profile signed in with OAuth. The
// realm server is stood in for by `forward`, which boxel-cli's authed fetch
// is in the factory.
module('openrouter forwarder', function (hooks) {
  let forwarder: OpenRouterForwarder | undefined;

  hooks.afterEach(async function () {
    await forwarder?.close();
    forwarder = undefined;
  });

  function chat(
    started: OpenRouterForwarder,
    {
      path = '/chat/completions',
      authorization = started.authorization,
      body = '{"model":"m","messages":[]}',
    }: { path?: string; authorization?: string | null; body?: string } = {},
  ) {
    let headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (authorization !== null) {
      headers.authorization = authorization;
    }
    return fetch(`${started.baseURL}${path}`, {
      method: 'POST',
      headers,
      body,
    });
  }

  test('sends a chat call on and answers with the realm server’s response', async function (assert) {
    let sent: string[] = [];
    forwarder = await startOpenRouterForwarder(async (body) => {
      sent.push(body);
      return new Response('{"id":"gen-1"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    assert.true(
      forwarder.baseURL.startsWith('http://127.0.0.1:'),
      'it listens on loopback',
    );
    let response = await chat(forwarder);
    assert.strictEqual(response.status, 200);
    assert.deepEqual(await response.json(), { id: 'gen-1' });
    assert.deepEqual(sent, ['{"model":"m","messages":[]}']);
  });

  test('streams the response through as it arrives', async function (assert) {
    forwarder = await startOpenRouterForwarder(async () => {
      let encoder = new TextEncoder();
      let stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"a":1}\n\n'));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });
    let response = await chat(forwarder);
    assert.strictEqual(
      response.headers.get('content-type'),
      'text/event-stream',
    );
    assert.strictEqual(
      await response.text(),
      'data: {"a":1}\n\ndata: [DONE]\n\n',
    );
  });

  test('refuses a call without its bearer, and anything but a chat call', async function (assert) {
    let calls = 0;
    forwarder = await startOpenRouterForwarder(async () => {
      calls++;
      return new Response('{}');
    });
    assert.strictEqual(
      (await chat(forwarder, { authorization: null })).status,
      401,
    );
    assert.strictEqual(
      (await chat(forwarder, { authorization: 'Bearer wrong' })).status,
      401,
    );
    assert.strictEqual(
      (await chat(forwarder, { path: '/models' })).status,
      404,
    );
    assert.strictEqual(calls, 0, 'nothing reaches the realm server');
  });

  test('tells opencode why a forward failed, with the status chosen for the error', async function (assert) {
    class SignInAgain extends Error {}
    let fail: Error = new SignInAgain(
      "This profile can't spend AI credits. Sign in again with `boxel profile add --oauth --allow-ai-credits`.",
    );
    forwarder = await startOpenRouterForwarder(
      async () => {
        throw fail;
      },
      { statusFor: (error) => (error instanceof SignInAgain ? 403 : 502) },
    );
    let response = await chat(forwarder);
    assert.strictEqual(
      response.status,
      403,
      'an error no retry can fix is answered with a 4xx, which opencode does not retry',
    );
    let body = (await response.json()) as { error: { message: string } };
    assert.true(body.error.message.includes('--allow-ai-credits'));

    fail = new Error('the realm server is unreachable');
    assert.strictEqual(
      (await chat(forwarder)).status,
      502,
      'any other failure is a 502',
    );
  });

  test('a bearer is made for each forwarder', async function (assert) {
    forwarder = await startOpenRouterForwarder(async () => new Response('{}'));
    let other = await startOpenRouterForwarder(async () => new Response('{}'));
    try {
      assert.notStrictEqual(forwarder.authorization, other.authorization);
      assert.strictEqual(
        (await chat(forwarder, { authorization: other.authorization })).status,
        401,
      );
    } finally {
      await other.close();
    }
  });
});
