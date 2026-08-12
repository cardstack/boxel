import { module, test } from 'qunit';

import { Deferred, Loader } from '@cardstack/runtime-common';

// The loader records a `completing-dep` for a module that is mid-completion on
// the recording task's own recursion stack — cycle handling. That leaves a
// window where the dep is still 'registered': the recording task must resume
// before the dep advances. A *concurrent* import root that reaches the
// recorded module during that window completes the dep itself rather than
// treating the not-yet-advanced dep as a broken invariant, since state
// transitions are monotonic and re-entrant. Regression guard against
// `expected <url> to be 'registered-completing-deps' but was 'registered'`.
module('Unit | loader concurrent cycle completion', function () {
  test('a second import root completes a cycle participant that a suspended root left mid-completion', async function (assert) {
    let releaseSlow = new Deferred<void>();
    let slowRequested = new Deferred<void>();
    let sources: Record<string, string> = {
      '/a': `import './b'; import './slow'; export const a = 'a';`,
      '/b': `import './a'; export const b = 'b';`,
      '/slow': `export const slow = 'slow';`,
    };
    let fetchImpl: typeof globalThis.fetch = async (input) => {
      let url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      let path = new URL(url).pathname;
      if (path === '/slow') {
        slowRequested.fulfill();
        await releaseSlow.promise;
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
    let loader = new Loader(fetchImpl);

    // Root 1 walks a → b (which cycles back to a, so b records a
    // completing-dep on a) → slow, and suspends awaiting slow's bytes with
    // `a` still in state 'registered'.
    let root1 = loader.import<{ a: string }>('http://race.example/a');
    await slowRequested.promise;

    // Root 2 enters at `b` while root 1 is suspended: b's completing-dep `a`
    // has not been advanced yet, which is exactly the interleaving under test.
    let root2 = loader.import<{ b: string }>('http://race.example/b');
    releaseSlow.fulfill();

    // Each module's own export is the strongest stable assertion here: what a
    // module sees *through* the cycle depends on which end the cycle is
    // entered from, which is exactly what the second root varies.
    let [modA, modB] = await Promise.all([root1, root2]);
    assert.strictEqual(modA.a, 'a', 'the suspended root still evaluates');
    assert.strictEqual(modB.b, 'b', 'the concurrent root evaluates the cycle');
  });
});
