import { module, test } from 'qunit';

import { Deferred, Loader, VirtualNetwork } from '@cardstack/runtime-common';

// A realm-mapping change discards the loader's module caches: the keys they are
// filed under are derived from the mappings, so an entry cannot outlive the
// spelling it was keyed under. Mapping changes fire routinely — registering or
// removing a realm is enough — and nothing coordinates them with an import that
// happens to be in flight, so a walk suspended at a fetch resumes to find that
// modules it has already visited, including its own ancestors, have no entry.
//
// Every module the walk has passed through has to come back out of it with the
// full set of edges its implementation declares. `evaluate` binds factory
// arguments positionally, so an edge lost here is not an error at the point it
// was lost: the arguments after the gap shift down and the factory reads its
// imports off the wrong module, or off nothing.
module('Unit | loader mapping change during traversal', function () {
  // Fetches `sources` by pathname, parking the first request for `parkPath`
  // until the returned `release` is fulfilled so a caller can act while a walk
  // is suspended mid-fetch.
  function parkedFetch(sources: Record<string, string>, parkPath: string) {
    let requested = new Deferred<void>();
    let release = new Deferred<void>();
    let parked = false;
    let fetchImpl: typeof globalThis.fetch = async (input) => {
      let url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      let path = new URL(url).pathname;
      if (path === parkPath && !parked) {
        parked = true;
        requested.fulfill();
        await release.promise;
      }
      let source = sources[path];
      if (!source) {
        return new Response('not found', { status: 404 });
      }
      return new Response(source, {
        status: 200,
        headers: { 'content-type': 'text/javascript' },
      });
    };
    return { fetchImpl, requested, release };
  }

  // `/b` reads `a` at evaluation time, which is what makes a dropped edge
  // observable: with the edge recorded, `b`'s factory is handed `/a`'s
  // namespace and reads an uninitialized binding off it — `undefined`, the
  // value a cycle owes it. With the edge dropped, `b`'s factory is handed one
  // argument fewer and reads that binding off nothing at all.
  //
  // Every axis of the interleaving below is load-bearing: the two-node cycle,
  // the parked fetch of `/b` (so the walk is suspended with `/a` registered and
  // on the stack), and the mapping change landing inside that suspension. The
  // drop it reproduces also only commits because `/a` is the last dep `/b`
  // declares — a dep after it that still needs work would leave through
  // `break outer_switch` and discard the truncated list.
  //
  // Anyone restructuring this module must re-verify it still has teeth. A
  // `registered` case that records a completing-dep only when the dep is
  // already registered, and otherwise falls through without either recording
  // the edge or advancing the dep, drops `/b`'s edge to `/a`. Every test here
  // then rejects on the length invariant, which catches the drop before the
  // factory is ever called — `bug: dependency list for http://mapping.example/b
  // recorded 1 of the 2 dependencies it declares` for the two-module cycle, and
  // the same for `/c.js` at 2 of 3 in the mixed-spelling one. Remove that invariant too and
  // the rejection becomes the mis-binding it exists to prevent:
  // `Cannot read properties of undefined (reading 'a')`.
  let cycleSources: Record<string, string> = {
    '/a': `import { b } from './b'; export const a = 'a' + b;`,
    '/b': `import { a } from './a'; export const b = 'b' + String(a);`,
  };

  test('a cycle participant whose cache entry is discarded mid-walk still evaluates', async function (assert) {
    let { fetchImpl, requested, release } = parkedFetch(cycleSources, '/b');
    let virtualNetwork = new VirtualNetwork(fetchImpl);
    let loader = new Loader(
      virtualNetwork.fetch,
      virtualNetwork.resolveImport,
      {
        virtualNetwork,
      },
    );

    // The walk reaches `/b` with `/a` registered and on its own recursion
    // stack, then suspends on `/b`'s bytes. Clearing the caches here is what
    // leaves `/b` resuming into a walk whose ancestor `/a` has no entry — the
    // one shape in which "already being completed further up" and "nothing
    // recorded yet" hold at once.
    let root = loader.import<{ a: string }>('http://mapping.example/a');
    await requested.promise;
    virtualNetwork.addURLMapping(
      new URL('http://alias.example/'),
      new URL('http://real.example/'),
    );
    release.fulfill();

    let modA = await root;
    assert.strictEqual(
      modA.a,
      'abundefined',
      'the factory binds its imports positionally and reads the cycle through them',
    );

    // The failure this guards against is cached, not transient: a factory that
    // throws leaves the module `broken` for the life of the loader, so every
    // later import of it throws the same error and nothing short of a new
    // loader recovers. Re-importing is the assertion that matters most here.
    let again = await loader.import<{ a: string }>('http://mapping.example/a');
    assert.strictEqual(
      again.a,
      'abundefined',
      'a later import of the same module is unaffected',
    );
  });

  test('a cycle participant whose cache entry is discarded mid-walk reports every module it imported', async function (assert) {
    let { fetchImpl, requested, release } = parkedFetch(cycleSources, '/b');
    let virtualNetwork = new VirtualNetwork(fetchImpl);
    let loader = new Loader(
      virtualNetwork.fetch,
      virtualNetwork.resolveImport,
      {
        virtualNetwork,
      },
    );

    let root = loader.import<{ a: string }>('http://mapping.example/a');
    await requested.promise;
    virtualNetwork.addURLMapping(
      new URL('http://alias.example/'),
      new URL('http://real.example/'),
    );
    release.fulfill();
    await root;

    // The index records module dependencies from this, so an edge missing here
    // is an edit to that module never invalidating its importer.
    assert.deepEqual(
      (await loader.getConsumedModules('http://mapping.example/b')).sort(),
      ['http://mapping.example/a'],
      'the module that resumed into the cleared caches reports its import',
    );
    assert.deepEqual(
      (await loader.getConsumedModules('http://mapping.example/a')).sort(),
      ['http://mapping.example/b'],
      'its importer reports the edge it was walked through',
    );
  });

  // The cache key folds every spelling of a module onto one entry, so a cycle
  // whose two edges name the shared module differently is still one cycle, and
  // still resolves to one module instance across both spellings — which is what
  // this pins, alongside the same mid-walk cache clear as the tests above.
  //
  // Note what it cannot pin. Comparing the completing stack by cache key
  // rather than by raw href only changes how many levels the walk descends: by
  // raw href the edge spelled `./b` does not match the ancestor pushed as
  // `./b.js`, so the cycle reads as unvisited and the walk takes a level it
  // does not need, reaching the same result by more work. The outcome is
  // identical either way, so no assertion here distinguishes the two — what
  // differs is the number of descents, not the depth they reach.
  test('a cycle whose edges spell the shared module differently is walked as one cycle', async function (assert) {
    // `/b` is reached as `./b.js` from the root and as `./b` from `/c`; `/slow`
    // is what suspends the walk so the mapping change lands inside it.
    let mixedSources: Record<string, string> = {
      '/a.js': `import { b } from './b.js'; export const a = 'a' + b;`,
      '/b.js': `import { c } from './c.js'; export const b = 'b' + c;`,
      '/c.js': `import { b } from './b'; import { slow } from './slow.js';
                export const c = 'c' + String(b) + slow;`,
      '/slow.js': `export const slow = 'S';`,
    };
    // The loader trims executable extensions to build a cache key, but a fetch
    // still goes out under the spelling the importer used, so both answer.
    let sources = new Proxy(mixedSources, {
      get(target, path: string) {
        return target[path] ?? target[`${path}.js`];
      },
    });
    let { fetchImpl, requested, release } = parkedFetch(sources, '/slow.js');
    let virtualNetwork = new VirtualNetwork(fetchImpl);
    let loader = new Loader(
      virtualNetwork.fetch,
      virtualNetwork.resolveImport,
      {
        virtualNetwork,
      },
    );

    let root = loader.import<{ a: string }>('http://mapping.example/a.js');
    await requested.promise;
    virtualNetwork.addURLMapping(
      new URL('http://alias.example/'),
      new URL('http://real.example/'),
    );
    release.fulfill();
    await root;

    // One cache entry, so one module instance — the property the fold exists
    // for. Two instances here would diverge under `instanceof` and
    // polymorphic-field identity checks across the two spellings.
    let viaExtension = await loader.import('http://mapping.example/b.js');
    let viaBare = await loader.import('http://mapping.example/b');
    assert.strictEqual(
      viaExtension,
      viaBare,
      'both spellings resolve to one module instance',
    );

    // Consumed edges carry the spelling the importer wrote, which is a
    // different question from cache identity: the fold gives the two spellings
    // one module instance, and each importer still reports the one it named.
    // `/c` closing the cycle keeps both of its edges either way.
    assert.deepEqual(
      (await loader.getConsumedModules('http://mapping.example/c.js')).sort(),
      ['http://mapping.example/b', 'http://mapping.example/slow.js'],
      'the module closing the cycle reports both of its imports',
    );
  });
});
