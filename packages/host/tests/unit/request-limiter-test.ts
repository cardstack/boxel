import { module, test } from 'qunit';

import {
  RequestLimiter,
  priorityOf,
  queueTimeOf,
} from '@cardstack/host/lib/request-limiter';

const ORIGIN = 'https://realms.example.test';

// A fetch whose responses the test hands out one at a time, so it decides
// when each request gets its headers.
class FakeNetwork {
  sent: Request[] = [];
  #pending: {
    request: Request;
    resolve: (response: Response) => void;
    reject: (error: unknown) => void;
  }[] = [];

  fetch = (request: Request): Promise<Response> => {
    this.sent.push(request);
    return new Promise((resolve, reject) => {
      this.#pending.push({ request, resolve, reject });
    });
  };

  sentPaths(): string[] {
    return this.sent.map((r) => `${r.method} ${new URL(r.url).pathname}`);
  }

  respond(path: string, response: Response) {
    let index = this.#pending.findIndex(
      (p) => new URL(p.request.url).pathname === path,
    );
    if (index === -1) {
      throw new Error(`no pending request for ${path}`);
    }
    let [entry] = this.#pending.splice(index, 1);
    entry.resolve(response);
  }

  fail(path: string, error: unknown) {
    let index = this.#pending.findIndex(
      (p) => new URL(p.request.url).pathname === path,
    );
    let [entry] = this.#pending.splice(index, 1);
    entry.reject(error);
  }
}

// Timers the test fires by hand.
class ManualTimers {
  #next = 0;
  #timers = new Map<number, () => void>();
  set = (callback: () => void) => {
    let id = ++this.#next;
    this.#timers.set(id, callback);
    return id;
  };
  clear = (handle: unknown) => {
    this.#timers.delete(handle as number);
  };
  fireAll() {
    let callbacks = [...this.#timers.values()];
    this.#timers.clear();
    callbacks.forEach((c) => c());
  }
  get count() {
    return this.#timers.size;
  }
}

function get(path: string, init?: RequestInit) {
  return new Request(`${ORIGIN}${path}`, init);
}

function post(path: string) {
  return new Request(`${ORIGIN}${path}`, { method: 'POST', body: '{}' });
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function setup(opts: { maxInFlight: number; urgentReserve: number }) {
  let network = new FakeNetwork();
  let timers = new ManualTimers();
  let clock = 0;
  let limiter = new RequestLimiter(network.fetch, {
    ...opts,
    bodyGraceMs: 30_000,
    now: () => clock,
    setTimer: timers.set,
    clearTimer: timers.clear,
  });
  return {
    network,
    timers,
    limiter,
    advance(ms: number) {
      clock += ms;
    },
  };
}

module('Unit | request-limiter', function () {
  test('classes writes and auth as urgent, and reads and searches as normal', function (assert) {
    assert.strictEqual(priorityOf(get('/a')), 'normal');
    assert.strictEqual(priorityOf(get('/a', { method: 'HEAD' })), 'normal');
    assert.strictEqual(
      priorityOf(get('/_federated-search', { method: 'QUERY' })),
      'normal',
    );
    assert.strictEqual(priorityOf(post('/_session')), 'urgent');
    assert.strictEqual(
      priorityOf(get('/card', { method: 'PATCH', body: '{}' })),
      'urgent',
    );
    assert.strictEqual(
      priorityOf(get('/card', { method: 'DELETE' })),
      'urgent',
    );
  });

  test('reads beyond the normal share wait, and go out in order as slots free', async function (assert) {
    let { network, limiter } = setup({ maxInFlight: 3, urgentReserve: 1 });
    let a = limiter.fetch(get('/a'));
    limiter.fetch(get('/b'));
    limiter.fetch(get('/c'));
    await settle();
    assert.deepEqual(network.sentPaths(), ['GET /a', 'GET /b']);
    assert.deepEqual(limiter.stats(ORIGIN), {
      inFlight: 2,
      urgent: 0,
      normal: 1,
    });

    network.respond('/a', new Response(null, { status: 204 }));
    await a;
    await settle();
    assert.deepEqual(network.sentPaths(), ['GET /a', 'GET /b', 'GET /c']);
  });

  test('an urgent request takes a reserved slot while reads fill the rest', async function (assert) {
    let { network, limiter } = setup({ maxInFlight: 3, urgentReserve: 1 });
    limiter.fetch(get('/a'));
    limiter.fetch(get('/b'));
    limiter.fetch(get('/c'));
    limiter.fetch(post('/_session'));
    await settle();
    assert.deepEqual(network.sentPaths(), [
      'GET /a',
      'GET /b',
      'POST /_session',
    ]);
  });

  test('a freed slot goes to a waiting urgent request before waiting reads', async function (assert) {
    let { network, limiter } = setup({ maxInFlight: 2, urgentReserve: 0 });
    let a = limiter.fetch(get('/a'));
    limiter.fetch(get('/b'));
    limiter.fetch(get('/c'));
    limiter.fetch(post('/_session'));
    await settle();
    assert.deepEqual(network.sentPaths(), ['GET /a', 'GET /b']);

    network.respond('/a', new Response(null, { status: 204 }));
    await a;
    await settle();
    assert.deepEqual(network.sentPaths(), [
      'GET /a',
      'GET /b',
      'POST /_session',
    ]);
  });

  test('origins are limited separately, and non-network URLs are not limited', async function (assert) {
    let { network, limiter } = setup({ maxInFlight: 1, urgentReserve: 0 });
    limiter.fetch(get('/a'));
    limiter.fetch(new Request('https://other.example.test/b'));
    limiter.fetch(new Request('data:text/plain,hi'));
    await settle();
    assert.strictEqual(network.sent.length, 3);
  });

  test('a slot is held until the body has been read', async function (assert) {
    let { network, limiter } = setup({ maxInFlight: 1, urgentReserve: 0 });
    let a = limiter.fetch(get('/a'));
    limiter.fetch(get('/b'));
    await settle();
    network.respond('/a', new Response('hello'));
    let response = await a;
    await settle();
    assert.deepEqual(
      network.sentPaths(),
      ['GET /a'],
      'headers alone do not free the slot',
    );

    assert.strictEqual(await response.text(), 'hello');
    await settle();
    assert.deepEqual(network.sentPaths(), ['GET /a', 'GET /b']);
  });

  test('a cancelled body frees its slot', async function (assert) {
    let { network, limiter } = setup({ maxInFlight: 1, urgentReserve: 0 });
    let a = limiter.fetch(get('/a'));
    limiter.fetch(get('/b'));
    await settle();
    network.respond('/a', new Response('hello'));
    let response = await a;
    await response.body!.cancel();
    await settle();
    assert.deepEqual(network.sentPaths(), ['GET /a', 'GET /b']);
  });

  test('a body that fails while it is read frees its slot', async function (assert) {
    let { network, limiter } = setup({ maxInFlight: 1, urgentReserve: 0 });
    let a = limiter.fetch(get('/a'));
    limiter.fetch(get('/b'));
    await settle();
    let failing = new ReadableStream({
      pull(controller) {
        controller.error(new TypeError('network error'));
      },
    });
    network.respond('/a', new Response(failing));
    let response = await a;
    await assert.rejects(response.text());
    await settle();
    assert.deepEqual(network.sentPaths(), ['GET /a', 'GET /b']);
  });

  test('a body nobody reads frees its slot after the grace period', async function (assert) {
    let { network, timers, limiter } = setup({
      maxInFlight: 1,
      urgentReserve: 0,
    });
    let a = limiter.fetch(get('/a'));
    limiter.fetch(get('/b'));
    await settle();
    network.respond('/a', new Response('never read'));
    await a;
    await settle();
    assert.deepEqual(network.sentPaths(), ['GET /a']);

    timers.fireAll();
    await settle();
    assert.deepEqual(network.sentPaths(), ['GET /a', 'GET /b']);
  });

  test('a body that downloads slowly keeps its slot past the grace period', async function (assert) {
    let { network, timers, limiter } = setup({
      maxInFlight: 1,
      urgentReserve: 0,
    });
    let a = limiter.fetch(get('/a'));
    limiter.fetch(get('/b'));
    await settle();
    let source!: ReadableStreamDefaultController<Uint8Array>;
    network.respond(
      '/a',
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            source = controller;
          },
        }),
      ),
    );
    let reader = (await a).body!.getReader();
    let encoder = new TextEncoder();

    let first = reader.read();
    await settle();
    assert.strictEqual(
      timers.count,
      0,
      'no grace timer runs while a read waits on the network',
    );
    timers.fireAll();
    source.enqueue(encoder.encode('one'));
    assert.false((await first).done);
    await settle();
    assert.deepEqual(
      network.sentPaths(),
      ['GET /a'],
      'a body still being read holds its slot',
    );

    assert.strictEqual(
      timers.count,
      0,
      'reading ahead for the next chunk keeps the grace timer stopped',
    );

    source.close();
    await settle();
    assert.deepEqual(
      network.sentPaths(),
      ['GET /a', 'GET /b'],
      'the slot frees once the body has downloaded',
    );
    assert.true((await reader.read()).done);
  });

  test('a streamed response frees its slot at the headers', async function (assert) {
    let { network, limiter } = setup({ maxInFlight: 1, urgentReserve: 0 });
    let a = limiter.fetch(post('/_request-forward'));
    limiter.fetch(post('/_session'));
    await settle();
    network.respond(
      '/_request-forward',
      new Response('data: {}\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
    await a;
    await settle();
    assert.deepEqual(network.sentPaths(), [
      'POST /_request-forward',
      'POST /_session',
    ]);
  });

  test('a failed request frees its slot', async function (assert) {
    let { network, limiter } = setup({ maxInFlight: 1, urgentReserve: 0 });
    let a = limiter.fetch(get('/a'));
    limiter.fetch(get('/b'));
    await settle();
    network.fail('/a', new TypeError('Failed to fetch'));
    await assert.rejects(a, TypeError);
    await settle();
    assert.deepEqual(network.sentPaths(), ['GET /a', 'GET /b']);
  });

  test('a request aborted while it waits is never sent', async function (assert) {
    let { network, limiter } = setup({ maxInFlight: 1, urgentReserve: 0 });
    let a = limiter.fetch(get('/a'));
    let controller = new AbortController();
    let b = limiter.fetch(get('/b', { signal: controller.signal }));
    limiter.fetch(get('/c'));
    await settle();
    controller.abort();
    await assert.rejects(b);
    assert.deepEqual(limiter.stats(ORIGIN), {
      inFlight: 1,
      urgent: 0,
      normal: 1,
    });

    network.respond('/a', new Response(null, { status: 204 }));
    await a;
    await settle();
    assert.deepEqual(network.sentPaths(), ['GET /a', 'GET /c']);
  });

  test('records how long a response waited, and keeps the network response properties', async function (assert) {
    let { network, limiter, advance } = setup({
      maxInFlight: 1,
      urgentReserve: 0,
    });
    let a = limiter.fetch(get('/a'));
    let b = limiter.fetch(get('/b'));
    await settle();
    advance(250);
    let sent = new Response('first', {
      status: 200,
      headers: { 'x-boxel-realm-url': `${ORIGIN}/realm/` },
    });
    Object.defineProperty(sent, 'url', { value: `${ORIGIN}/a` });
    network.respond('/a', sent);
    let first = await a;
    assert.strictEqual(queueTimeOf(first), 0);
    assert.strictEqual(first.url, `${ORIGIN}/a`);
    assert.strictEqual(
      first.headers.get('x-boxel-realm-url'),
      `${ORIGIN}/realm/`,
    );
    await first.text();
    await settle();

    network.respond('/b', new Response(null, { status: 204 }));
    assert.strictEqual(queueTimeOf(await b), 250);
  });
});
