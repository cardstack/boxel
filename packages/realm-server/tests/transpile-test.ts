import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { transpileJS } from '@cardstack/runtime-common/transpile';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(basename(import.meta.filename), function () {
  module('Transpile', function () {
    test('can rewrite fetch()', async function (assert) {
      let transpiled = await transpileJS(
        `
        async function test() {
          return await fetch('http://test.com');
        }`,
        'test-module.ts',
      );
      assert.codeEqual(
        transpiled,
        `
        async function test() {
          return await import.meta.loader.fetch('http://test.com');
        }`,
      );
    });
  });

  test('can rewrite import() that has url like argument', async function (assert) {
    let transpiled = await transpileJS(
      `
      async function test() {
        return await import('./x'); 
      }`,
      'test-module.ts',
    );
    assert.codeEqual(
      transpiled,
      `
      async function test() {
        return await import.meta.loader.import(new URL('./x', import.meta.url).href); 
      }`,
    );
  });

  test('can rewrite import() that has module specifier argument', async function (assert) {
    let transpiled = await transpileJS(
      `
      async function test() {
        return await import('lodash'); 
      }`,
      'test-module.ts',
    );
    assert.codeEqual(
      transpiled,
      `
      async function test() {
        return await import.meta.loader.import('lodash'); 
      }`,
    );
  });

  module('module provenance', function () {
    test('marks each class and function the module declares and exports', async function (assert) {
      let transpiled = await transpileJS(
        `
        export class A {}
        export function f() {}
        export const g = () => 1;
        class B {}
        export { B, B as Bee };
        export default class C {}
        `,
        'test-module.ts',
      );
      assert.codeEqual(
        transpiled,
        `
        export class A {}
        export function f() {}
        export const g = () => 1;
        class B {}
        export { B, B as Bee };
        export default class C {}
        function _markModuleProvenance(value, name) {
          let key = Symbol.for("module-provenance");
          if (typeof value === 'function' && Object.isExtensible(value) && !Object.prototype.hasOwnProperty.call(value, key)) {
            Object.defineProperty(value, key, {
              value: Object.freeze({ module: import.meta.url, name })
            });
          }
        }
        _markModuleProvenance(A, "A");
        _markModuleProvenance(f, "f");
        _markModuleProvenance(g, "g");
        _markModuleProvenance(B, "B");
        _markModuleProvenance(C, "default");
        `,
      );
    });

    test('marks nothing the module does not declare', async function (assert) {
      let transpiled = await transpileJS(
        `
        import { Imported } from './y';
        export { Elsewhere } from './z';
        interface Shape { a: number }
        export type { Shape };
        export declare const Declared: unknown;
        export { Imported };
        export default Imported;
        `,
        'test-module.ts',
      );
      assert.codeEqual(
        transpiled,
        `
        import { Imported } from './y';
        export { Elsewhere } from './z';
        export { Imported };
        export default Imported;
        `,
      );
    });
  });
});
