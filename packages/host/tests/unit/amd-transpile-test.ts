import { module, test } from 'qunit';

import { transpileAmd } from '@cardstack/runtime-common/amd-transpile';

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

module('Unit | amd-transpile (CS-10977)', function () {
  test('wraps an empty module in define()', function (assert) {
    let out = transpileAmd('', { moduleId });
    let { moduleId: capturedId, deps, exports } = runAmd(out);
    assert.strictEqual(capturedId, moduleId);
    assert.deepEqual(deps, ['exports']);
    assert.true(
      Object.getOwnPropertyDescriptor(exports, '__esModule')!.value === true,
      '__esModule marker is set',
    );
  });

  test('export const X = expr', function (assert) {
    let out = transpileAmd(`export const X = 42;`, { moduleId });
    let { exports } = runAmd(out);
    assert.strictEqual(exports.X, 42);
  });

  test('export let with body-time mutation', function (assert) {
    // Mutations made INSIDE the module body should show up.
    let out = transpileAmd(`export let counter = 0; counter = 5;`, {
      moduleId,
    });
    let { exports } = runAmd(out);
    assert.strictEqual(exports.counter, 5, 'reflects body-end value');
  });

  test('export let mutated by exported function (live binding)', function (assert) {
    // CS-10977 regression: `export let counter; export function inc() { counter++; }`
    // — after `inc()` the importer must see counter+1. The fix is a getter
    // on `_exports.counter` so the read goes through the local variable.
    let out = transpileAmd(
      `
      export let counter = 0;
      export function increment() { counter++; }
      `,
      { moduleId },
    );
    let { exports } = runAmd(out);
    assert.strictEqual(exports.counter, 0, 'starts at 0');
    (exports.increment as () => void)();
    assert.strictEqual(
      exports.counter,
      1,
      'mutation inside exported function propagates to importers',
    );
    (exports.increment as () => void)();
    assert.strictEqual(exports.counter, 2);
  });

  test('circular dep: imported value is read at use-time, not import-time', function (assert) {
    // CS-10977 regression: when card-api and contains-many-component import
    // each other, the loader evaluates the deps before the body. If the
    // transpiler snapshots `_dep.x` at body entry, that snapshot is `undefined`
    // for circular deps where the dep hasn't populated _exports yet. The
    // fix is to inline-rewrite every use of an imported name to `_dep.x`
    // so the lookup happens at call time.
    let out = transpileAmd(
      `import { primitive } from 'card-api';
       export function check(v) { return v === primitive; }`,
      { moduleId },
    );
    // Stub `card-api` with a partially-evaluated _exports object that gets
    // populated AFTER our module's body has run.
    const cardApi: { primitive?: symbol } = {};
    let { exports } = runAmd(out, { 'card-api': cardApi });
    cardApi.primitive = Symbol('primitive');
    assert.strictEqual(
      (exports.check as (v: unknown) => boolean)(cardApi.primitive),
      true,
      'reads through dep arg at call time',
    );
    assert.strictEqual(
      (exports.check as (v: unknown) => boolean)(undefined),
      false,
      'does not snapshot undefined',
    );
  });

  test('shadowed import name is not rewritten', function (assert) {
    let out = transpileAmd(
      `import { x } from 'foo';
       export function outer(x) { return x; }
       export function reads() { return x; }`,
      { moduleId },
    );
    let { exports } = runAmd(out, { foo: { x: 'imported' } });
    assert.strictEqual(
      (exports.outer as (v: string) => string)('shadow'),
      'shadow',
      'parameter shadows the import',
    );
    assert.strictEqual(
      (exports.reads as () => string)(),
      'imported',
      'unshadowed reference goes through the dep',
    );
  });

  test('export function f', function (assert) {
    let out = transpileAmd(`export function f() { return 7; }`, { moduleId });
    let { exports } = runAmd(out);
    assert.strictEqual(typeof exports.f, 'function');
    assert.strictEqual((exports.f as () => number)(), 7);
  });

  test('export class C', function (assert) {
    let out = transpileAmd(`export class C { ping() { return 'pong'; } }`, {
      moduleId,
    });
    let { exports } = runAmd(out);
    let inst = new (exports.C as new () => { ping: () => string })();
    assert.strictEqual(inst.ping(), 'pong');
  });

  test('export default expression', function (assert) {
    let out = transpileAmd(`export default 1 + 2;`, { moduleId });
    let { exports } = runAmd(out);
    assert.strictEqual(exports.default, 3);
  });

  test('export default named function', function (assert) {
    let out = transpileAmd(`export default function f() { return 9; }`, {
      moduleId,
    });
    let { exports } = runAmd(out);
    assert.strictEqual((exports.default as () => number)(), 9);
  });

  test('export default anonymous class', function (assert) {
    let out = transpileAmd(
      `export default class { hello() { return 'hi'; } };`,
      { moduleId },
    );
    let { exports } = runAmd(out);
    let inst = new (exports.default as new () => { hello: () => string })();
    assert.strictEqual(inst.hello(), 'hi');
  });

  test('export default with parens around expression (regression P0)', function (assert) {
    // `export default (foo);` — acorn's `decl` AST positions skip the
    // source-level parens, so an earlier version produced
    // `var __default$0 = (foo));` (double `)` → SyntaxError). The fix
    // replaces just the `export default ` keyword and appends before
    // any trailing `;`, leaving source parens in place.
    let out = transpileAmd(`export default (1 + 2);`, { moduleId });
    let { exports } = runAmd(out);
    assert.strictEqual(exports.default, 3);
  });

  test('export default IIFE (regression P0)', function (assert) {
    let out = transpileAmd(
      `export default (function () { return 9; })();`,
      { moduleId },
    );
    let { exports } = runAmd(out);
    assert.strictEqual(exports.default, 9);
  });

  test('export default parenthesised function expression (regression P0)', function (assert) {
    let out = transpileAmd(
      `export default (function () { return 'pf'; });`,
      { moduleId },
    );
    let { exports } = runAmd(out);
    assert.strictEqual((exports.default as () => string)(), 'pf');
  });

  test('shorthand property of an imported name (regression P0-1)', function (assert) {
    // `import { x } from 'foo'; const r = { x };` — naive overwrite of
    // the shorthand identifier produces `{ _foo$1.x }` (SyntaxError).
    // We must emit the explicit `x: _foo$1.x` form instead.
    let out = transpileAmd(
      `import { user } from 'auth';
       export function pack() { return { user }; }`,
      { moduleId },
    );
    let { exports } = runAmd(out, { auth: { user: 'live' } });
    assert.deepEqual((exports.pack as () => unknown)(), { user: 'live' });
  });

  test('for-let loop variable shadowing an import (regression P0-2a)', function (assert) {
    // `for (let i = 0; i < N; i++)` where `i` is also imported — the
    // loop variable must shadow the import inside the test/update/body.
    let out = transpileAmd(
      `import { i } from 'shadow';
       export function loop() {
         let last = -1;
         for (let i = 0; i < 3; i++) { last = i; }
         return last;
       }`,
      { moduleId },
    );
    let { exports } = runAmd(out, { shadow: { i: 'IMPORTED' } });
    assert.strictEqual((exports.loop as () => number)(), 2);
  });

  test('for-in var hoisting through function scope (regression P0-2b)', function (assert) {
    let out = transpileAmd(
      `import { k } from 'shadow';
       export function readK() {
         let last;
         for (var k in { a: 1, b: 2 }) { last = k; }
         return [k, last];
       }`,
      { moduleId },
    );
    let { exports } = runAmd(out, { shadow: { k: 'IMPORTED' } });
    let result = (exports.readK as () => [string, string])();
    assert.strictEqual(result[0], 'b', 'post-loop k holds the last loop value');
    assert.strictEqual(result[1], 'b', 'in-loop k is the var, not the import');
  });

  test('computed key in destructured export (regression P0-3)', function (assert) {
    // `export const { [k]: v } = obj` where `k` is imported — the
    // computed-key reference must be rewritten so the destructure picks
    // the right property at runtime.
    let out = transpileAmd(
      `import { keyName } from 'cfg';
       export const { [keyName]: chosen } = { actualKey: 'value!' };`,
      { moduleId },
    );
    let { exports } = runAmd(out, { cfg: { keyName: 'actualKey' } });
    assert.strictEqual(exports.chosen, 'value!');
  });

  test('named import binds via destructuring', function (assert) {
    let out = transpileAmd(
      `import { a, b as c } from 'foo'; export const r = a + c;`,
      { moduleId },
    );
    let { exports, deps } = runAmd(out, { foo: { a: 10, b: 20 } });
    assert.true(deps.includes('foo'), 'foo declared as dep');
    assert.strictEqual(exports.r, 30);
  });

  test('default import uses .default', function (assert) {
    let out = transpileAmd(`import D from 'foo'; export const r = D.x;`, {
      moduleId,
    });
    let { exports } = runAmd(out, { foo: { default: { x: 'ok' } } });
    assert.strictEqual(exports.r, 'ok');
  });

  test('namespace import binds the dep arg', function (assert) {
    let out = transpileAmd(
      `import * as ns from 'foo'; export const r = ns.a + ns.b;`,
      { moduleId },
    );
    let { exports } = runAmd(out, { foo: { a: 1, b: 2 } });
    assert.strictEqual(exports.r, 3);
  });

  test('side-effect-only import declares the dep', function (assert) {
    let out = transpileAmd(`import 'foo';`, { moduleId });
    let { deps } = runAmd(out, { foo: {} });
    assert.true(deps.includes('foo'), 'foo declared as dep');
  });

  test('re-export from foo uses live-binding getter', function (assert) {
    let out = transpileAmd(`export { x as y } from 'foo';`, { moduleId });
    let foo: { x: number } = { x: 1 };
    let { exports } = runAmd(out, { foo });
    assert.strictEqual(exports.y, 1, 'initial value');
    foo.x = 99;
    assert.strictEqual(exports.y, 99, 'live-binding updates flow through');
  });

  test('re-export of imported binding uses live-binding getter', function (assert) {
    let out = transpileAmd(`import { x } from 'foo'; export { x };`, {
      moduleId,
    });
    let foo: { x: number } = { x: 5 };
    let { exports } = runAmd(out, { foo });
    assert.strictEqual(exports.x, 5);
    foo.x = 50;
    assert.strictEqual(exports.x, 50, 'live binding through dep arg');
  });

  test('export * from foo installs getters for each key', function (assert) {
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
  });

  test('export * skips names that this module declares explicitly', function (assert) {
    let out = transpileAmd(
      `export const a = 'local'; export * from 'foo';`,
      { moduleId },
    );
    let { exports } = runAmd(out, { foo: { a: 'remote', b: 2 } });
    assert.strictEqual(exports.a, 'local', 'local wins over re-export *');
    assert.strictEqual(exports.b, 2);
  });

  test('export * as ns from foo installs a namespace getter', function (assert) {
    let out = transpileAmd(`export * as ns from 'foo';`, { moduleId });
    let foo = { a: 1 };
    let { exports } = runAmd(out, { foo });
    assert.deepEqual(exports.ns, foo);
  });

  test('import.meta is replaced and added to deps', function (assert) {
    let out = transpileAmd(`export const u = import.meta.url;`, { moduleId });
    let { exports, deps } = runAmd(out, {
      __import_meta__: { url: 'meta-url-here' },
    });
    assert.true(deps.includes('__import_meta__'), 'import meta declared');
    assert.strictEqual(exports.u, 'meta-url-here');
  });

  test('string literal containing "import.meta" is preserved', function (assert) {
    // Regression: regex-based replacement would corrupt this; the AST walk
    // we use only matches MetaProperty nodes.
    let out = transpileAmd(
      `export const s = "import.meta.url is a thing";`,
      { moduleId },
    );
    let { exports, deps } = runAmd(out);
    assert.strictEqual(exports.s, 'import.meta.url is a thing');
    assert.false(
      deps.includes('__import_meta__'),
      'no actual import.meta usage, no dep added',
    );
  });

  test('export { a, b as c } of locals', function (assert) {
    let out = transpileAmd(
      `const a = 1; const b = 2; export { a, b as c };`,
      { moduleId },
    );
    let { exports } = runAmd(out);
    assert.strictEqual(exports.a, 1);
    assert.strictEqual(exports.c, 2);
  });

  test('mixed default + named import on same statement', function (assert) {
    let out = transpileAmd(
      `import D, { a } from 'foo'; export const r = D.id + a;`,
      { moduleId },
    );
    let { exports } = runAmd(out, { foo: { default: { id: 'X' }, a: 'Y' } });
    assert.strictEqual(exports.r, 'XY');
  });

  test('multiple exports of the same import are all live', function (assert) {
    let out = transpileAmd(
      `import { v } from 'foo'; export { v, v as alias };`,
      { moduleId },
    );
    let foo: { v: number } = { v: 1 };
    let { exports } = runAmd(out, { foo });
    foo.v = 100;
    assert.strictEqual(exports.v, 100);
    assert.strictEqual(exports.alias, 100);
  });

  test('export default of an imported binding', function (assert) {
    // Regression for the exact bug that broke base-realm indexing — a
    // module like `import x from 'foo'; export default x;`. The
    // identifier-rewrite walk and the export-default rewrite must agree
    // on AST positions (no magic-string overlap), and the imported name
    // must read through the dep arg at the time the importer reads
    // `_exports.default`.
    let out = transpileAmd(
      `import { sanitizeHtmlSafe } from 'sanitize';
       export default sanitizeHtmlSafe;`,
      { moduleId },
    );
    let { exports } = runAmd(out, {
      sanitize: { sanitizeHtmlSafe: 'live-fn' },
    });
    assert.strictEqual(exports.default, 'live-fn');
  });

  test('export default forward-references a const declared later (TDZ-safe)', function (assert) {
    let out = transpileAmd(
      `const greeting = 'hi';
       export default greeting;`,
      { moduleId },
    );
    let { exports } = runAmd(out);
    assert.strictEqual(exports.default, 'hi');
  });

  test('export default expression with imported name inside', function (assert) {
    let out = transpileAmd(
      `import { x } from 'foo';
       export default { value: x, more: x };`,
      { moduleId },
    );
    let { exports } = runAmd(out, { foo: { x: 42 } });
    assert.deepEqual(exports.default, { value: 42, more: 42 });
  });

  test('destructured export const { a, b } = obj', function (assert) {
    let out = transpileAmd(
      `export const { a, b } = { a: 1, b: 2 };`,
      { moduleId },
    );
    let { exports } = runAmd(out);
    assert.strictEqual(exports.a, 1);
    assert.strictEqual(exports.b, 2);
  });

  test('destructured export const [first, second] = arr', function (assert) {
    let out = transpileAmd(
      `export const [first, second] = [10, 20];`,
      { moduleId },
    );
    let { exports } = runAmd(out);
    assert.strictEqual(exports.first, 10);
    assert.strictEqual(exports.second, 20);
  });

  test('collision-safe __default$N synthesised name', function (assert) {
    let out = transpileAmd(
      `const __default$0 = 'hand-coded';
       export default function() { return __default$0; };`,
      { moduleId },
    );
    let { exports } = runAmd(out);
    assert.strictEqual(
      (exports.default as () => string)(),
      'hand-coded',
      'hand-coded __default$0 still accessible',
    );
  });

  test('identical-name import binding via { x: x }', function (assert) {
    let out = transpileAmd(
      `import { foo } from 'src'; export const r = foo;`,
      { moduleId },
    );
    let { exports } = runAmd(out, { src: { foo: 'BAR' } });
    assert.strictEqual(exports.r, 'BAR');
  });
});
