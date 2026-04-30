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
      Object.getOwnPropertyDescriptor(exports, '__esModule')!.value,
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
    assert.true(
      (exports.check as (v: unknown) => boolean)(cardApi.primitive),
      'reads through dep arg at call time',
    );
    assert.false(
      (exports.check as (v: unknown) => boolean)(undefined),
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

  test('assignment to imported binding throws (regression P1)', function (assert) {
    // `imp = 1` where `imp` is imported must NOT be rewritten to
    // `_foo$1.imp = 1` — that would silently mutate the dep's _exports
    // namespace. ESM treats imports as read-only; we leave the LHS
    // untouched and let strict-mode runtime throw ReferenceError.
    let out = transpileAmd(
      `import { imp } from 'foo';
       export function bad() { imp = 99; }`,
      { moduleId },
    );
    let foo = { imp: 1 };
    let { exports } = runAmd(out, { foo });
    assert.throws(
      () => (exports.bad as () => void)(),
      /ReferenceError/,
      'assigning to an imported binding throws at runtime',
    );
    assert.strictEqual(foo.imp, 1, "dep's exports namespace untouched");
  });

  test('post-increment of imported binding throws (regression P1)', function (assert) {
    let out = transpileAmd(
      `import { x } from 'foo';
       export function bad() { x++; }`,
      { moduleId },
    );
    let foo = { x: 1 };
    let { exports } = runAmd(out, { foo });
    assert.throws(
      () => (exports.bad as () => void)(),
      /ReferenceError/,
      'incrementing an imported binding throws at runtime',
    );
    assert.strictEqual(foo.x, 1, "dep's exports namespace untouched");
  });

  test('destructuring-assignment to imported binding throws (regression P1)', function (assert) {
    // `({ x } = obj)` where `x` is imported — same read-only rule via
    // a different syntactic path (Property shorthand inside an
    // AssignmentExpression LHS pattern).
    let out = transpileAmd(
      `import { x } from 'foo';
       export function bad(obj) { ({ x } = obj); }`,
      { moduleId },
    );
    let foo = { x: 1 };
    let { exports } = runAmd(out, { foo });
    assert.throws(
      () => (exports.bad as (o: unknown) => void)({ x: 99 }),
      /ReferenceError/,
      'destructure-assigning to an imported binding throws at runtime',
    );
    assert.strictEqual(foo.x, 1, "dep's exports namespace untouched");
  });

  test('class static block shadows imports within the block (regression P2)', function (assert) {
    // ES2022 class static initializer blocks have their own var + lexical
    // env. `let x` inside `static { ... }` must shadow an imported `x`
    // ONLY within the block, not in surrounding instance methods.
    let out = transpileAmd(
      `import { x } from 'shadow';
       export class C {
         static {
           let x = 'inner';
           C.staticReadsX = x;
         }
         instanceReadsX() { return x; }
       }`,
      { moduleId },
    );
    let { exports } = runAmd(out, { shadow: { x: 'IMPORTED' } });
    let C = exports.C as { staticReadsX: string } & {
      new (): { instanceReadsX(): string };
    };
    assert.strictEqual(C.staticReadsX, 'inner', 'static block shadow wins');
    assert.strictEqual(
      new C().instanceReadsX(),
      'IMPORTED',
      'instance method sees the import',
    );
  });

  test('switch body block scope shadows imports across cases (regression P2)', function (assert) {
    // JS treats the entire switch body as a single block scope. A
    // `let x` declared in one case is in scope (in TDZ) during another.
    // The walker must collect block-scope decls from EVERY case
    // consequent before walking, so a reference to `x` in a later case
    // doesn't get rewritten to `_foo$1.x` when there's a same-named
    // `let x` somewhere in the switch.
    let out = transpileAmd(
      `import { x } from 'shadow';
       export function pick(n) {
         switch (n) {
           case 1: { let x = 'one'; return x; }
           case 2: { let x = 'two'; return x; }
           default: return 'other';
         }
       }`,
      { moduleId },
    );
    let { exports } = runAmd(out, { shadow: { x: 'IMPORTED' } });
    assert.strictEqual((exports.pick as (n: number) => string)(1), 'one');
    assert.strictEqual((exports.pick as (n: number) => string)(2), 'two');
    assert.strictEqual((exports.pick as (n: number) => string)(3), 'other');
  });

  test('`using r = ...` shadows an imported `r` (regression P1)', function (assert) {
    // ES2024 `using` declarations are block-scoped, just like let/const.
    // The walker must add them to the current block scope so a same-named
    // imported binding is shadowed; otherwise the reference inside the
    // function body would be rewritten to `_foo$1.r` (silent wrong value).
    let out = transpileAmd(
      `import { r } from 'foo';
       export function f() {
         using r = { value: 'local', [Symbol.dispose]() {} };
         return r.value;
       }`,
      { moduleId },
    );
    let { exports } = runAmd(out, {
      foo: { r: { value: 'IMPORTED' } },
    });
    assert.strictEqual(
      (exports.f as () => string)(),
      'local',
      '`using r` shadows the imported `r`',
    );
  });

  test('`for (using r of src)` head binds r (regression P1)', function (assert) {
    let out = transpileAmd(
      `import { r } from 'foo';
       export function f(src) {
         let last;
         for (using r of src) { last = r; }
         return last;
       }`,
      { moduleId },
    );
    // Stub `Symbol.dispose` so the disposable iteration doesn't crash on
    // browsers that don't yet have full sync-disposable support.
    let { exports } = runAmd(out, {
      foo: { r: { value: 'IMPORTED' } },
    });
    let dispose = (Symbol as any).dispose ?? Symbol.for('dispose');
    let items = [
      { id: 'a', [dispose]() {} },
      { id: 'b', [dispose]() {} },
    ];
    assert.strictEqual(
      (exports.f as (s: unknown[]) => unknown)(items),
      items[1],
    );
  });

  test('top-level await is rejected at transpile time (regression P2)', function (assert) {
    // The AMD wrapper emits a non-async factory, so a top-level
    // `await` would become a SyntaxError at eval time. Reject up
    // front with a clear error message instead.
    assert.throws(
      () =>
        transpileAmd(`import { p } from 'foo'; export const r = await p;`, {
          moduleId,
        }),
      /top-level await is not supported/,
    );
  });

  test('top-level `for await` is rejected at transpile time', function (assert) {
    // `for await (... of ...)` is a `ForOfStatement` with `await: true`
    // — there's NO `AwaitExpression` child, so the naive AwaitExpression
    // walk would let it through. Same async-context requirement as TLA.
    assert.throws(
      () =>
        transpileAmd(`for await (const x of foo) {}`, {
          moduleId,
        }),
      /top-level await is not supported/,
    );
  });

  test('top-level `await using` is rejected at transpile time', function (assert) {
    // ES2024 `await using r = res;` — VariableDeclaration with kind
    // `'await using'`. Like TLA, requires an async enclosing scope.
    assert.throws(
      () =>
        transpileAmd(`import { res } from 'foo'; await using r = res;`, {
          moduleId,
        }),
      /top-level await is not supported/,
    );
  });

  test('`for await` inside an async function is fine', function (assert) {
    // Sanity: `for await ... of ...` inside an async function does NOT
    // trigger the top-level-await rejection.
    transpileAmd(
      `export async function consume(stream) {
         for await (const chunk of stream) { console.log(chunk); }
       }`,
      { moduleId },
    );
    assert.ok(true, 'no throw');
  });

  test('top-level await inside an async function is fine', function (assert) {
    // Sanity check: `await` inside an async function (regular or
    // arrow) must NOT trigger the top-level-await rejection.
    let out = transpileAmd(
      `import { p } from 'foo';
       export async function r() { return await p; }`,
      { moduleId },
    );
    let foo = { p: Promise.resolve(42) };
    let { exports } = runAmd(out, { foo });
    return (exports.r as () => Promise<number>)().then((v) => {
      assert.strictEqual(v, 42);
    });
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
    let out = transpileAmd(`export default (function () { return 9; })();`, {
      moduleId,
    });
    let { exports } = runAmd(out);
    assert.strictEqual(exports.default, 9);
  });

  test('export default parenthesised function expression (regression P0)', function (assert) {
    let out = transpileAmd(`export default (function () { return 'pf'; });`, {
      moduleId,
    });
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

  test('object destructure-assignment to a member of an imported namespace (regression P1)', function (assert) {
    // `({ x: obj.field } = src)` where `obj` is imported. `obj` is a
    // reference position (we read it to assign to its `.field`), so it
    // must be rewritten to the dep-arg accessor — otherwise the emitted
    // AMD body references an undeclared `obj` and throws ReferenceError.
    let out = transpileAmd(
      `import * as ns from 'foo';
       export function bad(src) { ({ x: ns.field } = src); return ns.field; }`,
      { moduleId },
    );
    let nsObj: Record<string, unknown> = {};
    let { exports } = runAmd(out, { foo: nsObj });
    let result = (exports.bad as (src: Record<string, unknown>) => unknown)({
      x: 42,
    });
    assert.strictEqual(result, 42, 'destructure-assigned ns.field is 42');
    assert.strictEqual(nsObj.field, 42, 'mutation reached the dep arg');
  });

  test('array destructure-assignment to a member of an imported namespace (regression P1)', function (assert) {
    // `[ns.field] = src` — array variant of the same bug.
    let out = transpileAmd(
      `import * as ns from 'foo';
       export function bad(src) { [ns.field] = src; return ns.field; }`,
      { moduleId },
    );
    let nsObj: Record<string, unknown> = {};
    let { exports } = runAmd(out, { foo: nsObj });
    let result = (exports.bad as (src: unknown[]) => unknown)(['hi']);
    assert.strictEqual(result, 'hi');
    assert.strictEqual(nsObj.field, 'hi');
  });

  test('for-of head with destructure-assignment to imported namespace member (regression P1)', function (assert) {
    // `for ({ x: ns.field } of items) {}` — for-of head variant.
    let out = transpileAmd(
      `import * as ns from 'foo';
       export function collect(items) {
         for ({ x: ns.field } of items) {}
         return ns.field;
       }`,
      { moduleId },
    );
    let nsObj: Record<string, unknown> = {};
    let { exports } = runAmd(out, { foo: nsObj });
    let result = (exports.collect as (items: { x: number }[]) => unknown)([
      { x: 1 },
      { x: 2 },
      { x: 3 },
    ]);
    assert.strictEqual(result, 3, 'last iteration mutated ns.field');
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
    let out = transpileAmd(`export const a = 'local'; export * from 'foo';`, {
      moduleId,
    });
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
    let out = transpileAmd(`export const s = "import.meta.url is a thing";`, {
      moduleId,
    });
    let { exports, deps } = runAmd(out);
    assert.strictEqual(exports.s, 'import.meta.url is a thing');
    assert.false(
      deps.includes('__import_meta__'),
      'no actual import.meta usage, no dep added',
    );
  });

  test('export { a, b as c } of locals', function (assert) {
    let out = transpileAmd(`const a = 1; const b = 2; export { a, b as c };`, {
      moduleId,
    });
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
    let out = transpileAmd(`export const { a, b } = { a: 1, b: 2 };`, {
      moduleId,
    });
    let { exports } = runAmd(out);
    assert.strictEqual(exports.a, 1);
    assert.strictEqual(exports.b, 2);
  });

  test('destructured export const [first, second] = arr', function (assert) {
    let out = transpileAmd(`export const [first, second] = [10, 20];`, {
      moduleId,
    });
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
    let out = transpileAmd(`import { foo } from 'src'; export const r = foo;`, {
      moduleId,
    });
    let { exports } = runAmd(out, { src: { foo: 'BAR' } });
    assert.strictEqual(exports.r, 'BAR');
  });

  test('user `var _<sanitized>$N` does NOT shadow the dep arg (regression P2)', function (assert) {
    // The AMD wrapper's parameter name for `import { x } from 'a'` would
    // normally be `_a$1`. If the user source ALSO declares `var _a$1` at
    // top level the parameter would be shadowed and every rewritten
    // import access would read the user's binding instead of the dep.
    // Pass 1 must detect the collision and pick a fresh argName.
    let out = transpileAmd(
      `import { x } from 'a';
       var _a$1 = { x: 'shadow-target' };
       export function before() { return x; }
       export function after() { var _a$1 = 'inner'; return x; }`,
      { moduleId },
    );
    let { exports } = runAmd(out, { a: { x: 'real-import' } });
    assert.strictEqual(
      (exports.before as () => string)(),
      'real-import',
      'top-level `var _a$1` does not break the import binding',
    );
    assert.strictEqual(
      (exports.after as () => string)(),
      'real-import',
      'inner `var _a$1` does not break the import binding either',
    );
  });

  test('user-declared `_exports` is rejected at transpile time (regression P2)', function (assert) {
    assert.throws(
      () =>
        transpileAmd(`let _exports = {}; export const x = 1;`, { moduleId }),
      /reserved name `_exports`/,
      'rejects modules that redeclare the AMD exports parameter',
    );
  });

  test('user-declared `__import_meta__` is rejected when import.meta is used (regression P2)', function (assert) {
    assert.throws(
      () =>
        transpileAmd(`const __import_meta__ = 1; console.log(import.meta);`, {
          moduleId,
        }),
      /reserved name `__import_meta__`/,
      'rejects modules that redeclare the AMD import.meta parameter when import.meta is referenced',
    );
  });

  test('user-declared `__import_meta__` is accepted when import.meta is NOT used (regression P2)', function (assert) {
    // The wrapper only synthesizes `__import_meta__` as a parameter when
    // the source actually references `import.meta`. Without that
    // reference, the user's local `__import_meta__` is harmless.
    let out = transpileAmd(
      `const __import_meta__ = 'local';
       export const r = __import_meta__;`,
      { moduleId },
    );
    let { exports } = runAmd(out);
    assert.strictEqual(
      exports.r,
      'local',
      'no import.meta → user declaration accepted as a regular local',
    );
  });

  test('user-declared `_exportNames` is rejected when `export *` is used (regression P2)', function (assert) {
    assert.throws(
      () =>
        transpileAmd(
          `const _exportNames = {}; export * from 'foo'; export const x = 1;`,
          { moduleId },
        ),
      /reserved name `_exportNames`/,
      'rejects modules that redeclare the AMD export* lookup table when export * is present',
    );
  });

  test('user-declared `_exportNames` is accepted without `export *` (regression P2)', function (assert) {
    // The wrapper only declares `var _exportNames` when at least one
    // bare `export * from ...` is present. Without that, the user's
    // local `_exportNames` is harmless.
    let out = transpileAmd(
      `const _exportNames = { custom: true };
       export const r = _exportNames;`,
      { moduleId },
    );
    let { exports } = runAmd(out);
    assert.deepEqual(
      exports.r,
      { custom: true },
      'no export * → user declaration accepted as a regular local',
    );
  });
});
