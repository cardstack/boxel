import { module, test } from 'qunit';

import { Deferred, Loader } from '@cardstack/runtime-common';

// The loader records a `completing-dep` for any dep that had not finished
// completing when a module's dependency list was frozen. One way that happens
// is a dep mid-completion on the recording task's own recursion stack — cycle
// handling; another is a dep left in 'registered-completing-deps' by a
// suspended import root, which is how an edge to a module in no cycle at all
// comes to be marked completing. Either way it leaves a window where the dep
// has not advanced yet: the recording task must resume before it does. A *concurrent* import root that reaches the
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
    // participates in no cycle, so a record that treats a completing edge as
    // a cycle edge and discards it loses `/slow` too.
    //
    // The assertions below are just the true import closure, which the loader
    // also produces when this interleaving does not happen — so the test only
    // means something while the interleaving holds. Anyone restructuring it
    // must re-verify it fails with `evaluate` narrowed back to
    // `dep.type === 'dep'`, which should leave `/a` reporting nothing.
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

  test('concurrent roots over a cycle whose middle module imports itself all evaluate', async function (assert) {
    // `evaluate` descends a module's whole dependency closure synchronously, so
    // every module in it has to be past 'registered' before the first factory
    // runs. Reaching 'registered-with-deps' does not establish that on its own:
    // a cycle completes one participant at a time, and each is committed while
    // its cycle edges are still completing. A single root closes that gap
    // before returning, so only a concurrent root can observe a participant in
    // the window where it looks ready and is not.
    //
    // The graph is the smallest one that reaches it: `/m1`'s dep list is
    // forward dep, then back-edge, then self-import, and the self-import is
    // what puts `/m1` on its own completing stack while that list is being
    // resolved. Drop any of the three edges, or the third root, and the window
    // never opens.
    //
    // The interleaving is driven rather than raced. Each module's bytes are
    // held behind its own gate and released in the order `/m0`, `/m2`, `/m1`,
    // draining between releases so every walk runs as far as it can before the
    // next module arrives — that release order is what suspends `/m1`'s walk
    // inside `/m2`'s completion with `/m0` still 'registered'. Reorder the
    // releases and the test still passes while covering nothing: against the
    // loader with the closure check removed this order rejects on every run,
    // and other orders on none. That check is the only thing this exercises, so
    // anyone restructuring the test must re-verify it fails without it, with
    // `Cannot evaluate the module http://selfcycle.example/m0, it is not
    // evaluatable--it is in state 'registered'`.
    let sources: Record<string, string> = {
      '/m0': `import './m1'; export const id = 'm0';`,
      '/m1': `import './m2'; import './m0'; import './m1'; export const id = 'm1';`,
      '/m2': `import './m1'; export const id = 'm2';`,
    };
    let gates: Record<string, Deferred<void>> = {};
    let gateFor = (path: string) => (gates[path] ??= new Deferred<void>());
    for (let path of Object.keys(sources)) {
      gateFor(path);
    }
    let fetchImpl: typeof globalThis.fetch = async (input) => {
      let url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      let path = new URL(url).pathname;
      await gateFor(path).promise;
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

    let origin = 'http://selfcycle.example';
    let roots = [
      loader.import<{ id: string }>(`${origin}/m0`),
      loader.import<{ id: string }>(`${origin}/m2`),
      loader.import<{ id: string }>(`${origin}/m1`),
    ];
    // Every walk suspended on a gate resumes on a macrotask, and resuming can
    // suspend it again a level deeper, so one turn is not enough to let it
    // settle against what has been released so far.
    let drain = async () => {
      for (let i = 0; i < 12; i++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    };
    await drain();
    for (let path of ['/m0', '/m2', '/m1']) {
      gateFor(path).fulfill();
      await drain();
    }

    let [m0, m2, m1] = await Promise.all(roots);
    assert.strictEqual(m0.id, 'm0', 'the first root evaluates');
    assert.strictEqual(m2.id, 'm2', 'the second root evaluates');
    assert.strictEqual(m1.id, 'm1', 'the cycle participant evaluates');

    // A root that rejects here leaves its modules cached in a state that does
    // not self-heal, so a later import of the same module is the half that
    // shows the failure was cached rather than transient.
    let again = await loader.import<{ id: string }>(`${origin}/m0`);
    assert.strictEqual(
      again.id,
      'm0',
      'a later import of the same module is unaffected',
    );

    assert.deepEqual(
      (await loader.getConsumedModules(`${origin}/m1`)).sort(),
      [`${origin}/m0`, `${origin}/m2`],
      'the self-importing module reports the modules it imports, itself excluded',
    );
  });
});
