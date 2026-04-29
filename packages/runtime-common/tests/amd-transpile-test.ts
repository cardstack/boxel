import type { SharedTests } from '../helpers';
import { transpileAmd } from '../amd-transpile';

// Run an AMD-wrapped source string with a fake `define` that captures
// (moduleId, deps, factory). Stub each non-`exports`/`__import_meta__` dep
// with the value provided by `depValues[dep]`, defaulting to `{}` if not
// supplied. Returns the populated `_exports` object after the factory runs.
function runAmd(
  amdSrc: string,
  depValues: Record<string, unknown> = {},
): {
  moduleId: string;
  deps: string[];
  exports: Record<string, unknown>;
} {
  let captured: {
    moduleId?: string;
    deps?: string[];
    factory?: (...args: unknown[]) => void;
  } = {};
  let define = (
    moduleId: string,
    deps: string[],
    factory: (...args: unknown[]) => void,
  ) => {
    captured.moduleId = moduleId;
    captured.deps = deps;
    captured.factory = factory;
  };

  new Function('define', amdSrc)(define);

  let exports: Record<string, unknown> = {};
  let args = captured.deps!.map((dep) => {
    if (dep === 'exports') return exports;
    if (dep === '__import_meta__') {
      return depValues[dep] ?? { url: 'http://test/x.js' };
    }
    return depValues[dep] ?? {};
  });
  captured.factory!(...args);
  return {
    moduleId: captured.moduleId!,
    deps: captured.deps!,
    exports,
  };
}

const moduleId = 'http://test/m.js';

const tests: SharedTests<Record<string, never>> = Object.freeze({
  'wraps an empty module in define()': async (assert) => {
    let out = transpileAmd('', { moduleId });
    let { moduleId: capturedId, deps, exports } = runAmd(out);
    assert.strictEqual(capturedId, moduleId);
    assert.deepEqual(deps, ['exports']);
    assert.true(
      Object.getOwnPropertyDescriptor(exports, '__esModule')!.value === true,
      '__esModule marker is set',
    );
  },

  'export const X = expr': async (assert) => {
    let out = transpileAmd(`export const X = 42;`, { moduleId });
    let { exports } = runAmd(out);
    assert.strictEqual(exports.X, 42);
  },

  'export let snapshots at body-end': async (assert) => {
    // Both this transpiler and babel's plugin diverge from full ES module
    // live-binding semantics for mutable `export let` — neither propagates
    // mutations made AFTER the module body finishes. We snapshot at body
    // end (so mutations inside the body show up); babel snapshots at the
    // declaration site. The end-of-body behavior is closer to spec for
    // typical card code, where the body fully initialises the export.
    let out = transpileAmd(`export let counter = 0; counter = 5;`, {
      moduleId,
    });
    let { exports } = runAmd(out);
    assert.strictEqual(exports.counter, 5, 'reflects body-end value');
  },

  'export function f': async (assert) => {
    let out = transpileAmd(`export function f() { return 7; }`, { moduleId });
    let { exports } = runAmd(out);
    assert.strictEqual(typeof exports.f, 'function');
    assert.strictEqual((exports.f as () => number)(), 7);
  },

  'export class C': async (assert) => {
    let out = transpileAmd(`export class C { ping() { return 'pong'; } }`, {
      moduleId,
    });
    let { exports } = runAmd(out);
    let inst = new (exports.C as new () => { ping: () => string })();
    assert.strictEqual(inst.ping(), 'pong');
  },

  'export default expression': async (assert) => {
    let out = transpileAmd(`export default 1 + 2;`, { moduleId });
    let { exports } = runAmd(out);
    assert.strictEqual(exports.default, 3);
  },

  'export default named function': async (assert) => {
    let out = transpileAmd(`export default function f() { return 9; }`, {
      moduleId,
    });
    let { exports } = runAmd(out);
    assert.strictEqual((exports.default as () => number)(), 9);
  },

  'export default anonymous class': async (assert) => {
    let out = transpileAmd(
      `export default class { hello() { return 'hi'; } };`,
      {
        moduleId,
      },
    );
    let { exports } = runAmd(out);
    let inst = new (exports.default as new () => { hello: () => string })();
    assert.strictEqual(inst.hello(), 'hi');
  },

  'named import binds via destructuring': async (assert) => {
    let out = transpileAmd(
      `import { a, b as c } from 'foo'; export const r = a + c;`,
      { moduleId },
    );
    let { exports, deps } = runAmd(out, { foo: { a: 10, b: 20 } });
    assert.true(deps.includes('foo'), 'foo declared as dep');
    assert.strictEqual(exports.r, 30);
  },

  'default import uses .default': async (assert) => {
    let out = transpileAmd(`import D from 'foo'; export const r = D.x;`, {
      moduleId,
    });
    let { exports } = runAmd(out, { foo: { default: { x: 'ok' } } });
    assert.strictEqual(exports.r, 'ok');
  },

  'namespace import binds the dep arg': async (assert) => {
    let out = transpileAmd(
      `import * as ns from 'foo'; export const r = ns.a + ns.b;`,
      { moduleId },
    );
    let { exports } = runAmd(out, { foo: { a: 1, b: 2 } });
    assert.strictEqual(exports.r, 3);
  },

  'side-effect-only import declares the dep': async (assert) => {
    let out = transpileAmd(`import 'foo';`, { moduleId });
    let { deps } = runAmd(out, { foo: {} });
    assert.true(deps.includes('foo'), 'foo declared as dep');
  },

  're-export from foo uses live-binding getter': async (assert) => {
    let out = transpileAmd(`export { x as y } from 'foo';`, { moduleId });
    // Mutate `foo.x` *after* the factory has run; reading `_exports.y`
    // must see the new value (proves it's a getter, not a snapshot).
    let foo: { x: number } = { x: 1 };
    let { exports } = runAmd(out, { foo });
    assert.strictEqual(exports.y, 1, 'initial value');
    foo.x = 99;
    assert.strictEqual(exports.y, 99, 'live-binding updates flow through');
  },

  're-export of imported binding uses live-binding getter': async (assert) => {
    let out = transpileAmd(`import { x } from 'foo'; export { x };`, {
      moduleId,
    });
    let foo: { x: number } = { x: 5 };
    let { exports } = runAmd(out, { foo });
    assert.strictEqual(exports.x, 5);
    foo.x = 50;
    assert.strictEqual(exports.x, 50, 'live binding through dep arg');
  },

  'export * from foo installs getters for each key': async (assert) => {
    let out = transpileAmd(`export * from 'foo';`, { moduleId });
    let foo: Record<string, unknown> = { a: 1, b: 2, default: 999 };
    let { exports } = runAmd(out, { foo });
    assert.strictEqual(exports.a, 1);
    assert.strictEqual(exports.b, 2);
    assert.strictEqual(
      exports.default,
      undefined,
      'export * skips the default key',
    );
    foo.a = 7;
    assert.strictEqual(exports.a, 7, 'live-binding via getter');
  },

  'export * skips names that this module declares explicitly': async (
    assert,
  ) => {
    let out = transpileAmd(`export const a = 'local'; export * from 'foo';`, {
      moduleId,
    });
    let { exports } = runAmd(out, { foo: { a: 'remote', b: 2 } });
    assert.strictEqual(exports.a, 'local', 'local wins over re-export *');
    assert.strictEqual(exports.b, 2);
  },

  'export * as ns from foo installs a namespace getter': async (assert) => {
    let out = transpileAmd(`export * as ns from 'foo';`, { moduleId });
    let foo = { a: 1 };
    let { exports } = runAmd(out, { foo });
    assert.deepEqual(exports.ns, foo);
  },

  'import.meta is replaced and added to deps': async (assert) => {
    let out = transpileAmd(`export const u = import.meta.url;`, { moduleId });
    let { exports, deps } = runAmd(out, {
      __import_meta__: { url: 'meta-url-here' },
    });
    assert.true(deps.includes('__import_meta__'), 'import meta declared');
    assert.strictEqual(exports.u, 'meta-url-here');
  },

  'string literal containing "import.meta" is preserved': async (assert) => {
    // Regression: regex-based replacement would corrupt this; the AST walk
    // we use only matches MetaProperty nodes.
    let out = transpileAmd(`export const s = "import.meta.url is a thing";`, {
      moduleId,
    });
    let { exports, deps } = runAmd(out);
    assert.strictEqual(exports.s, 'import.meta.url is a thing');
    assert.false(
      deps.includes('__import_meta__'),
      'no actual import.meta usage, no dep added',
    );
  },

  'export { a, b as c } of locals': async (assert) => {
    let out = transpileAmd(`const a = 1; const b = 2; export { a, b as c };`, {
      moduleId,
    });
    let { exports } = runAmd(out);
    assert.strictEqual(exports.a, 1);
    assert.strictEqual(exports.c, 2);
  },

  'mixed default + named import on same statement': async (assert) => {
    let out = transpileAmd(
      `import D, { a } from 'foo'; export const r = D.id + a;`,
      { moduleId },
    );
    let { exports } = runAmd(out, { foo: { default: { id: 'X' }, a: 'Y' } });
    assert.strictEqual(exports.r, 'XY');
  },

  'multiple exports of the same import are all live': async (assert) => {
    let out = transpileAmd(
      `import { v } from 'foo'; export { v, v as alias };`,
      { moduleId },
    );
    let foo: { v: number } = { v: 1 };
    let { exports } = runAmd(out, { foo });
    foo.v = 100;
    assert.strictEqual(exports.v, 100);
    assert.strictEqual(exports.alias, 100);
  },

  'identical-name import binding via { x: x }': async (assert) => {
    // Defensive: the `local === imported` shortcut must produce valid JS.
    let out = transpileAmd(`import { foo } from 'src'; export const r = foo;`, {
      moduleId,
    });
    let { exports } = runAmd(out, { src: { foo: 'BAR' } });
    assert.strictEqual(exports.r, 'BAR');
  },
});

export default tests;
