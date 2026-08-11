import 'ses';

import { module, test } from 'qunit';

import { transpileJS } from '@cardstack/runtime-common/transpile';

import CapsuleModuleEvaluator from '@cardstack/host/lib/capsule-module-evaluator';

// Adversarial probes of the Capsule tier (SES compartment, host main thread).
// Card-authored source is driven through the same evaluator a real Capsule
// render uses. Two groups: containment invariants that must not regress, and
// known-gap probes that pin today's behavior so closing a gap fails loudly.

const MODULE_ID = 'https://example.test/cards/probe.js';
const BLOCK = JSON.stringify([[['Append', 'probe']], []]);

function evaluatorFor(sources: Record<string, string>, fetched: string[] = []) {
  return new CapsuleModuleEvaluator('https://example.test/cards/', {
    fetch: async (input: RequestInfo | URL) => {
      let url = input instanceof Request ? input.url : String(input);
      fetched.push(url);
      let source = sources[url];
      return source === undefined
        ? new Response('not granted', { status: 403 })
        : new Response(source, { status: 200 });
    },
    resolveImport: (m) =>
      m.startsWith('@') ? `https://packages.example/${m}` : m,
    documentFacade: Object.freeze({
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

function cardSource(getterBody: string, top = '') {
  return `
    import { CardDef, Component } from 'https://cardstack.com/base/card-api';
    import { setComponentTemplate } from '@ember/component';
    import { createTemplateFactory } from '@ember/template-factory';
    ${top}
    export class Probe extends CardDef {}
    Probe.isolated = class Isolated extends Component {
      get probe() {
        try { return JSON.stringify(${getterBody}); }
        catch (e) { return JSON.stringify({ threw: e && e.message }); }
      }
    };
    setComponentTemplate(createTemplateFactory({
      id: 'probe-isolated',
      block: ${JSON.stringify(BLOCK)},
      moduleName: ${JSON.stringify(MODULE_ID)},
      isStrictMode: true,
    }), Probe.isolated);
  `;
}

async function probe(getterBody: string, top = '') {
  let evaluator = evaluatorFor({ [MODULE_ID]: cardSource(getterBody, top) });
  try {
    let bundle = await evaluator.evaluateTemplate(
      MODULE_ID,
      'Probe',
      'isolated',
    );
    let handle = bundle.templates[bundle.root]!.instance.handle;
    return JSON.parse(String(evaluator.readComponentProperty(handle, 'probe')));
  } finally {
    evaluator.destroy?.();
  }
}

module('Unit | Capsule boundary probe', function () {
  test('ambient browser authority is absent from the compartment', async function (assert) {
    let r = await probe(`({
      window: typeof window,
      localStorage: typeof localStorage,
      sessionStorage: typeof sessionStorage,
      fetch: typeof fetch,
      XMLHttpRequest: typeof XMLHttpRequest,
      WebSocket: typeof WebSocket,
      Worker: typeof Worker,
      indexedDB: typeof indexedDB,
      navigator: typeof navigator,
      importScripts: typeof importScripts,
      documentKeys: Object.keys(document)
    })`);
    for (let name of [
      'window',
      'localStorage',
      'sessionStorage',
      'fetch',
      'XMLHttpRequest',
      'WebSocket',
      'Worker',
      'indexedDB',
      'navigator',
      'importScripts',
    ]) {
      assert.strictEqual(r[name], 'undefined', `${name} not reachable`);
    }
    assert.deepEqual(
      r.documentKeys,
      ['addEventListener', 'removeEventListener'],
      'document is an inert facade',
    );
  });

  test('Function-constructor escapes to the host realm are blocked', async function (assert) {
    let r = await probe(`(function () {
      function a(fn){ try { fn(); return 'ESCAPED'; } catch (e) { return 'blocked'; } }
      return {
        fn: a(function(){ return (function(){}).constructor('return globalThis')(); }),
        arr: a(function(){ return [].constructor.constructor('return globalThis')(); }),
        asyncFn: a(function(){ return Object.getPrototypeOf(async function(){}).constructor('return globalThis')(); }),
        gen: a(function(){ return Object.getPrototypeOf(function*(){}).constructor('return globalThis')(); }),
        endowed: a(function(){ return document.addEventListener.constructor('return globalThis')(); })
      };
    })()`);
    assert.deepEqual(r, {
      fn: 'blocked',
      arr: 'blocked',
      asyncFn: 'blocked',
      gen: 'blocked',
      endowed: 'blocked',
    });
  });

  test('indirect eval stays inside the compartment global', async function (assert) {
    let r = await probe(`(function () {
      var g = (0, eval)('globalThis');
      return { same: g === globalThis, window: typeof g.window, document: typeof g.document };
    })()`);
    assert.true(r.same, 'indirect eval resolves to the compartment global');
    assert.strictEqual(r.window, 'undefined');
  });

  test('shared intrinsics are frozen; host prototype stays clean', async function (assert) {
    let r = await probe(`(function () {
      function a(fn){ try { fn(); return 'MUTATED'; } catch (e) { return 'blocked'; } }
      return {
        proto: a(function(){ Object.prototype.__capsuleProbe = 'x'; }),
        push: a(function(){ Array.prototype.push = function(){ return 'hijacked'; }; }),
        frozen: Object.isFrozen(Object.prototype)
      };
    })()`);
    assert.strictEqual(r.proto, 'blocked');
    assert.strictEqual(r.push, 'blocked');
    assert.true(r.frozen);
    assert.strictEqual(
      (Object.prototype as Record<string, unknown>).__capsuleProbe,
      undefined,
      'host Object.prototype unpolluted',
    );
  });

  test('GAP: a dynamic import in a real card fails closed but opaquely', async function (assert) {
    // Real card source is transpiled before it reaches the compartment. The
    // transpiler rewrites `import(x)` to `import.meta.loader.import(...)`, so
    // SES censorship never sees an import expression; the compartment then
    // strips `loader` from import.meta, so the card loads and throws a bare
    // TypeError at runtime rather than naming a sandbox policy to the author.
    let gts = `
      import { CardDef, Component } from 'https://cardstack.com/base/card-api';
      export class Probe extends CardDef {
        static isolated = class Isolated extends Component {
          get probe() {
            let out = { loader: typeof import.meta.loader };
            try { import('https://esm.sh/canvas-confetti'); out.dyn = 'issued'; }
            catch (e) { out.dyn = e.message; }
            return JSON.stringify(out);
          }
          <template>{{this.probe}}</template>
        };
      }
    `;
    let transpiled = await transpileJS(gts, '/probe.gts');
    assert.true(
      transpiled.includes('import.meta.loader.import'),
      'transpiler rewrites dynamic import to import.meta.loader.import',
    );
    let evaluator = evaluatorFor({ [MODULE_ID]: transpiled });
    let r: Record<string, unknown> = {};
    let loadError: string | undefined;
    try {
      let bundle = await evaluator.evaluateTemplate(
        MODULE_ID,
        'Probe',
        'isolated',
      );
      let handle = bundle.templates[bundle.root]!.instance.handle;
      r = JSON.parse(String(evaluator.readComponentProperty(handle, 'probe')));
    } catch (e) {
      loadError = (e as Error).message;
    } finally {
      evaluator.destroy?.();
    }
    if (loadError) {
      // Also acceptable as fail-closed: refused at evaluation.
      assert.ok(loadError, `dynamic-import card refused at load: ${loadError}`);
    } else {
      assert.strictEqual(r.loader, 'undefined', 'import.meta.loader stripped');
      let opaque =
        /import/i.test(String(r.dyn)) && /undefined/i.test(String(r.dyn));
      assert.true(
        opaque,
        `GAP: dynamic import fails with an opaque TypeError, not a policy message: ${r.dyn}`,
      );
    }
  });

  test('GAP: the main-thread compartment blocks the event loop', async function (assert) {
    let ticks = 0;
    let timer = setInterval(() => ticks++, 5);
    let start = performance.now();
    await probe(`(function () {
      var n = 0; for (var i = 0; i < 60000000; i++) { n += i % 7; } return { done: n > 0 };
    })()`);
    let elapsed = performance.now() - start;
    clearInterval(timer);
    assert.true(
      elapsed > 20,
      `compartment held the main thread ~${Math.round(elapsed)}ms`,
    );
    assert.strictEqual(
      ticks,
      0,
      'GAP: no host timer ran while card code spun — Capsule has no termination boundary',
    );
  });
});
