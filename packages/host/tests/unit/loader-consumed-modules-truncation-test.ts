import { module, test } from 'qunit';

import { Loader } from '@cardstack/runtime-common';

// `getConsumedModules` and `getKnownConsumedModules` answer the same question
// about the same loader — which modules a module imports, transitively — and
// have to answer it the same way. Every state past `fetching` names the modules
// a module imports, so every one of them has edges to descend; a walk that
// descends only the two terminal states truncates at exactly the modules an
// import failure leaves behind, which are the ones the answer matters most for.
//
// The index records a module's dependencies from `getConsumedModules`,
// including on the path where the import threw. A module indexed without the
// edge to the dependency that broke it is never invalidated when that
// dependency is fixed, so it stays broken in the index until something else
// forces a reindex. Both graphs below reach that with a single import root and
// no interleaving.
module('Unit | loader consumed modules truncation', function () {
  test('a module whose import failed on a missing dependency reports every edge it declared', async function (assert) {
    // `/nope` is served by nothing, so importing `/a` throws before `/a` can
    // leave 'registered' — the state carrying its dependency list. Both the
    // module that could not be fetched and the sibling that was fetched fine
    // are edges `/a` declared, and an index that does not hold the first one
    // never learns that creating `/nope` should invalidate `/a`.
    let sources: Record<string, string> = {
      '/a': `import './b'; import './nope'; export const a = 'a';`,
      '/b': `export const b = 'b';`,
    };
    let loader = new Loader(sourceFetch(sources));
    let origin = 'http://trunc.example';

    await assert.rejects(
      loader.import(`${origin}/a`),
      /unable to fetch .*\/nope/,
      'the import fails on the dependency nothing serves',
    );

    assert.deepEqual(
      (await loader.getConsumedModules(`${origin}/a`)).sort(),
      [`${origin}/b`, `${origin}/nope`],
      'the failed module reports the missing dependency and its sibling',
    );
    assert.deepEqual(
      (await loader.getConsumedModules(`${origin}/a`)).sort(),
      loader.getKnownConsumedModules(`${origin}/a`).sort(),
      'both walks describe one loader the same way',
    );
  });

  test('a sibling that throws does not truncate the branch that loaded', async function (assert) {
    // `/thrower` throws while evaluating, which aborts the root import before
    // `/good` is advanced past the registered states. `/good` still imports
    // `/deep`, and a walk that stops at `/good` loses that subtree entirely —
    // the deeper the good branch, the more edges go missing.
    let sources: Record<string, string> = {
      '/root': `import './thrower'; import './good'; export const root = 1;`,
      '/thrower': `throw new Error('boom'); export const t = 1;`,
      '/good': `import './deep'; export const good = 1;`,
      '/deep': `export const deep = 1;`,
    };
    let loader = new Loader(sourceFetch(sources));
    let origin = 'http://trunc2.example';

    await assert.rejects(
      loader.import(`${origin}/root`),
      /boom/,
      'the import fails on the module that throws',
    );

    assert.deepEqual(
      (await loader.getConsumedModules(`${origin}/root`)).sort(),
      [`${origin}/deep`, `${origin}/good`, `${origin}/thrower`],
      'the walk descends through the good branch the failure stranded',
    );
    assert.deepEqual(
      (await loader.getConsumedModules(`${origin}/root`)).sort(),
      loader.getKnownConsumedModules(`${origin}/root`).sort(),
      'both walks describe one loader the same way',
    );
  });
});

// Serves `sources` by pathname, 404ing anything absent, so a graph is written
// as the modules it contains and the names it reaches past them.
function sourceFetch(sources: Record<string, string>): typeof globalThis.fetch {
  return async (input) => {
    let url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    let source = sources[new URL(url).pathname.replace(/\.js$/, '')];
    if (source === undefined) {
      return new Response('not found', { status: 404 });
    }
    return new Response(source, {
      status: 200,
      headers: { 'content-type': 'text/javascript' },
    });
  };
}
