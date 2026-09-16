import { module, test } from 'qunit';

import { Deferred, SupportedMimeType } from '@cardstack/runtime-common';
import type { LatticeDisplayBatchRequest } from '@cardstack/runtime-common/lattice-display';

import LatticeDisplayReader from '@cardstack/host/lib/lattice-display-reader';

const realm = 'http://display.test/realm/';
function read(i: number, signal?: AbortSignal) {
  return {
    realm,
    url: `${realm}Card/${i}`,
    signal,
    have: () => undefined,
    current: () => true,
  };
}
function body(request: LatticeDisplayBatchRequest) {
  return {
    ...request,
    results: request.required.map((url) => ({
      url,
      publication: {
        data: {
          type: 'card',
          id: url,
          attributes: { value: 1 },
          meta: { adoptsFrom: { module: './card', name: 'Card' } },
        },
      },
    })),
  };
}
function response(value: unknown, authority = realm) {
  return new Response(JSON.stringify(value), {
    headers: {
      'Content-Type': SupportedMimeType.CardJson,
      'x-boxel-realm-url': authority,
    },
  });
}

module('Unit | Lattice Store batches transport', function () {
  test('bounds requests and keeps exact realm buckets separate', async function (assert) {
    let requests: LatticeDisplayBatchRequest[] = [];
    let reader = new LatticeDisplayReader(
      async (url, init) => {
        let request = JSON.parse(String(init.body));
        requests.push(request);
        return response(body(request), url.replace('_lattice-read', ''));
      },
      (id) => id,
    );
    let results = await Promise.all([
      ...Array.from({ length: 18 }, (_, i) => reader.read(read(i))),
      reader.read({
        ...read(1),
        realm: realm + 'nested/',
        url: realm + 'nested/Card/1',
      }),
    ]);
    assert.deepEqual(
      requests.map((item) => item.required.length),
      [16, 2, 1],
    );
    assert.strictEqual(results.length, 19);
    assert.strictEqual(
      new Set(requests.flatMap((item) => item.required)).size,
      19,
    );
    assert.strictEqual(new Set(requests.map((item) => item.session)).size, 1);
    assert.true(requests.every((item) => item.epoch === 0));
  });

  test('cancelling a consumer preserves its peer; reset fences the session and aborts old transport', async function (assert) {
    let requests: Array<{
      request: LatticeDisplayBatchRequest;
      signal: AbortSignal;
      result: Deferred<Response>;
    }> = [];
    let reader = new LatticeDisplayReader(
      async (_url, init) => {
        let result = new Deferred<Response>();
        requests.push({
          request: JSON.parse(String(init.body)),
          signal: init.signal!,
          result,
        });
        return result.promise;
      },
      (id) => id,
    );
    let one = new AbortController();
    let first = reader.read(read(1, one.signal));
    let second = reader.read(read(2));
    await Promise.resolve();
    let rejected = assert.rejects(first, /cancelled/);
    one.abort();
    await rejected;
    assert.false(
      requests[0].signal.aborted,
      'a live peer keeps the shared request',
    );
    requests[0].result.fulfill(response(body(requests[0].request)));
    assert.ok(await second, 'the peer receives its publication');
    let old = reader.read(read(3));
    await Promise.resolve();
    rejected = assert.rejects(old, /cancelled/);
    reader.reset();
    await rejected;
    assert.true(requests[1].signal.aborted, 'reset aborts old exchange');
    let fresh = reader.read(read(3));
    await Promise.resolve();
    assert.strictEqual(requests[2].request.epoch, 1);
    requests[1].result.fulfill(response(body(requests[1].request)));
    requests[2].result.fulfill(response(body(requests[2].request)));
    assert.ok(
      await fresh,
      'new session can proceed while old response arrives',
    );
  });

  test('queued cancellation and obsolete work do not issue a request', async function (assert) {
    let calls = 0;
    let reader = new LatticeDisplayReader(
      async () => {
        calls++;
        throw new Error('must not fetch');
      },
      (id) => id,
    );
    let controller = new AbortController();
    let cancelled = reader.read(read(1, controller.signal));
    let rejected = assert.rejects(cancelled, /cancelled/);
    controller.abort();
    let obsolete = reader.read({ ...read(2), current: () => false });
    await rejected;
    assert.strictEqual(await obsolete, undefined);
    assert.strictEqual(calls, 0);
  });

  test('invalid envelopes reject all consumers before any partial response resolves', async function (assert) {
    for (let defect of [
      'omission',
      'duplicate',
      'session',
      'epoch',
      'authority',
      'type',
      'endpoint',
      'endpoint-busy',
    ] as const) {
      let reader = new LatticeDisplayReader(
        async (_url, init) => {
          let request = JSON.parse(String(init.body));
          let value = body(request);
          if (defect === 'omission') value.results.pop();
          if (defect === 'duplicate') value.results[1] = value.results[0];
          if (defect === 'session') value.session += '-other';
          if (defect === 'epoch') value.epoch++;
          if (defect === 'endpoint' || defect === 'endpoint-busy')
            return new Response('no publication response', {
              status: defect === 'endpoint' ? 404 : 409,
            });
          let result = response(
            value,
            defect === 'authority' ? realm + 'nested/' : realm,
          );
          if (defect === 'type')
            result.headers.set('Content-Type', 'text/html');
          return result;
        },
        (id) => id,
      );
      let results = await Promise.allSettled([
        reader.read(read(1)),
        reader.read(read(2)),
      ]);
      assert.true(
        results.every((item) => item.status === 'rejected'),
        defect,
      );
      for (let result of results)
        if (result.status === 'rejected')
          assert.strictEqual(
            result.reason.status,
            502,
            'transport failure is not deletion',
          );
    }
  });

  test('per-card failures do not erase a successful peer', async function (assert) {
    let reader = new LatticeDisplayReader(
      async (_url, init) => {
        let request = JSON.parse(
          String(init.body),
        ) as LatticeDisplayBatchRequest;
        return response({
          ...request,
          results: [
            body(request).results[0],
            {
              url: request.required[1],
              error: { status: 409, message: 'unavailable' },
            },
          ],
        });
      },
      (id) => id,
    );
    let [good, unavailable] = await Promise.allSettled([
      reader.read(read(1)),
      reader.read(read(2)),
    ]);
    assert.strictEqual(good.status, 'fulfilled');
    assert.strictEqual(unavailable.status, 'rejected');
    if (unavailable.status === 'rejected')
      assert.strictEqual(unavailable.reason.status, 409);
  });
});
