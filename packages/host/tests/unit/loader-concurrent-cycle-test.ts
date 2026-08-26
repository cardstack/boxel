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
    // Every axis of this graph is load-bearing: the two-node cycle, `./b`
    // preceding `./slow` (so root 1 suspends with `a` still 'registered'),
    // and root 2 entering at `b` specifically. A longer chain closes the
    // window on its own — the suspended root resumes and advances the dep
    // before the second root arrives — and the interleaving pins nothing.
    // Anyone restructuring this test must re-verify it fails with the
    // loader's completing-dep recovery reverted to a throw.
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

  test('a module evaluated out of the completing state reports every module it imported', async function (assert) {
    let releaseSlow = new Deferred<void>();
    let slowRequested = new Deferred<void>();
    // The concurrent-root interleaving this module is built around, kept
    // whole because it is what leaves `/a` evaluating straight out of
    // 'registered-completing-deps' with every one of its edges still marked
    // completing — the state in which a module's imports are recorded from
    // nowhere else. `/slow` carries the assertion that matters most: it
    // participates in no cycle, so a dependency record that keeps only
    // cycle-free edges loses it too.
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

    let root1 = loader.import<{ a: string }>('http://race.example/a');
    await slowRequested.promise;
    let root2 = loader.import<{ b: string }>('http://race.example/b');
    releaseSlow.fulfill();
    await Promise.all([root1, root2]);

    // The index records module dependencies from this, so an edge missing
    // here is an edit to that module never invalidating its importer.
    assert.deepEqual(
      (await loader.getConsumedModules('http://race.example/a')).sort(),
      ['http://race.example/b', 'http://race.example/slow'],
      'the module that evaluated out of the completing state reports both imports',
    );
    assert.deepEqual(
      (await loader.getConsumedModules('http://race.example/b')).sort(),
      ['http://race.example/a', 'http://race.example/slow'],
      'the concurrent root reports its import and what it reaches through the cycle',
    );
    assert.deepEqual(
      await loader.getConsumedModules('http://race.example/slow'),
      [],
      'a leaf module consumes nothing',
    );
  });
});
