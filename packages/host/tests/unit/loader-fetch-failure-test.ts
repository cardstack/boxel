import { module, test } from 'qunit';

import { Loader } from '@cardstack/runtime-common';

// The loader's module map keys entries by the extension-trimmed identifier:
// `foo.gts`, `foo.ts`, and extensionless `foo` share one cache slot. A fetch
// failure (404, transport error) is a property of the requested *spelling*,
// not of that shared identity — the definition-cache population path probes
// extension candidates with real fetches, so a 404 on `foo.gts` for a module
// whose file is `foo.ts` is routine. These tests pin the invariant that such
// a failure is never cached: the sibling spelling must still load, and a
// retried import must refetch rather than replay the failure.
module('Unit | loader fetch-failure caching', function () {
  function makeLoader(fetches: string[]) {
    let fetchImpl: typeof globalThis.fetch = async (input) => {
      let url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      fetches.push(url);
      if (url.endsWith('/greeting.gts') || url.endsWith('/greeting.gjs')) {
        return new Response('not found', { status: 404 });
      }
      if (url.endsWith('/greeting') || url.endsWith('/greeting.ts')) {
        return new Response(`export const value = 'hello';`, {
          status: 200,
          headers: { 'content-type': 'text/javascript' },
        });
      }
      return new Response('not found', { status: 404 });
    };
    return new Loader(fetchImpl);
  }

  test('a 404 on one extension spelling does not poison the trimmed identity', async function (assert) {
    let fetches: string[] = [];
    let loader = makeLoader(fetches);

    // Probe the `.gts` spelling of a module whose file is `.ts` — the shape
    // the definition-cache extension-candidate probing produces.
    await assert.rejects(
      loader.import('http://test.example/realm/greeting.gts'),
      /404|not found/i,
      'the missing spelling itself errors',
    );

    // The extensionless sibling shares the trimmed cache key; it must load
    // from its own fetch rather than replaying the cached 404.
    let mod = await loader.import<{ value: string }>(
      'http://test.example/realm/greeting',
    );
    assert.strictEqual(
      mod.value,
      'hello',
      'the sibling spelling loads after the failed probe',
    );
    assert.true(
      fetches.some((url) => url.endsWith('/greeting')),
      `the sibling import fetched its own spelling (fetches: ${JSON.stringify(fetches)})`,
    );
  });

  test('a failed fetch is retried by a subsequent import of the same spelling', async function (assert) {
    let responses = [
      new Response('not found', { status: 404 }),
      new Response(`export const value = 'recovered';`, {
        status: 200,
        headers: { 'content-type': 'text/javascript' },
      }),
    ];
    let fetchCount = 0;
    let fetchImpl: typeof globalThis.fetch = async () => {
      fetchCount++;
      return responses.shift() ?? new Response('exhausted', { status: 500 });
    };
    let loader = new Loader(fetchImpl);

    await assert.rejects(
      loader.import('http://test.example/realm/flaky'),
      /404|not found/i,
      'the first import surfaces the fetch failure',
    );
    let mod = await loader.import<{ value: string }>(
      'http://test.example/realm/flaky',
    );
    assert.strictEqual(
      mod.value,
      'recovered',
      'the second import refetched instead of replaying a cached failure',
    );
    assert.strictEqual(fetchCount, 2, 'each import performed its own fetch');
  });
});
