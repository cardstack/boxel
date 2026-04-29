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

  'export let with body-time mutation': async (assert) => {
    // Mutations made INSIDE the module body should show up.
    let out = transpileAmd(`export let counter = 0; counter = 5;`, {
      moduleId,
    });
    let { exports } = runAmd(out);
    assert.strictEqual(exports.counter, 5, 'reflects body-end value');
  },

  'export let mutated by exported function (live binding)': async (assert) => {
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
  },

  'circular dep: imported value is read at use-time, not import-time': async (
    assert,
  ) => {
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
    // populated AFTER our module's body has run. If we snapshot, `primitive`
    // captures undefined and `check(undefined)` returns true. If we read at
    // call time, `primitive` is the post-body Symbol and `check(undefined)`
    // returns false.
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
  },

  'shadowed import name is not rewritten': async (assert) => {
    // If a function declares a parameter / local with the same name as an
    // imported binding, references inside that scope use the local — not
    // the dep arg.
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

  'export default with parens around expression (regression P0)': async (
    assert,
  ) => {
    // `export default (foo);` — acorn's `decl` AST positions skip the
    // source-level parens, so an earlier version produced
    // `var __default$0 = (foo));` (double `)` → SyntaxError). The fix
    // replaces just the `export default ` keyword and appends before
    // any trailing `;`, leaving source parens in place.
    let out = transpileAmd(`export default (1 + 2);`, { moduleId });
    let { exports } = runAmd(out);
    assert.strictEqual(exports.default, 3);
  },

  'export default IIFE (regression P0)': async (assert) => {
    let out = transpileAmd(`export default (function () { return 9; })();`, {
      moduleId,
    });
    let { exports } = runAmd(out);
    assert.strictEqual(exports.default, 9);
  },

  'export default parenthesised function expression (regression P0)': async (
    assert,
  ) => {
    let out = transpileAmd(`export default (function () { return 'pf'; });`, {
      moduleId,
    });
    let { exports } = runAmd(out);
    assert.strictEqual((exports.default as () => string)(), 'pf');
  },

  'shorthand property of an imported name (regression P0-1)': async (
    assert,
  ) => {
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
  },

  'for-let loop variable shadowing an import (regression P0-2a)': async (
    assert,
  ) => {
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
  },

  'for-in var hoisting through function scope (regression P0-2b)': async (
    assert,
  ) => {
    // `for (var k in obj) {}` — `k` hoists to the enclosing function
    // scope and must shadow the imported `k` for both the loop body
    // AND the post-loop reference.
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
  },

  'computed key in destructured export (regression P0-3)': async (assert) => {
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
  },

  'export default of an imported binding': async (assert) => {
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
  },

  'export default forward-references a const declared later (TDZ-safe)': async (
    assert,
  ) => {
    // ESM technically allows the source order `export default Foo; const Foo`,
    // but the in-place assignment we used to emit hit a TDZ ReferenceError.
    // The fix captures into `var __default$N = (Foo);` at the source
    // position (still TDZ for `const Foo` declared LATER, same as ESM)
    // and defers the `_exports.default` setter to the end of the body.
    // We test the SAFE order here (const declared first), where the new
    // approach must also keep working.
    let out = transpileAmd(
      `const greeting = 'hi';
       export default greeting;`,
      { moduleId },
    );
    let { exports } = runAmd(out);
    assert.strictEqual(exports.default, 'hi');
  },

  'export default expression with imported name inside': async (assert) => {
    // `export default fn(x)` where x is imported — the walker must rewrite
    // `x` inside the captured expression.
    let out = transpileAmd(
      `import { x } from 'foo';
       export default { value: x, more: x };`,
      { moduleId },
    );
    let { exports } = runAmd(out, { foo: { x: 42 } });
    assert.deepEqual(exports.default, { value: 42, more: 42 });
  },

  'destructured export const { a, b } = obj': async (assert) => {
    // Codex P1 — was throwing; now walks the pattern and emits a getter
    // per bound name.
    let out = transpileAmd(`export const { a, b } = { a: 1, b: 2 };`, {
      moduleId,
    });
    let { exports } = runAmd(out);
    assert.strictEqual(exports.a, 1);
    assert.strictEqual(exports.b, 2);
  },

  'destructured export const [first, second] = arr': async (assert) => {
    let out = transpileAmd(`export const [first, second] = [10, 20];`, {
      moduleId,
    });
    let { exports } = runAmd(out);
    assert.strictEqual(exports.first, 10);
    assert.strictEqual(exports.second, 20);
  },

  'collision-safe __default$N synthesised name': async (assert) => {
    // If the source already declares `__default$0`, the synthesised temp
    // for the anonymous default must not collide.
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
