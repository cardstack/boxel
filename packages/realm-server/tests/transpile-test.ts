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

  test('tags exported classes with the given module identifier', async function (assert) {
    let transpiled = await transpileJS(
      `
      class Helper {}
      export class Person {}
      export default class {}
      `,
      'test-module.ts',
      { moduleIdentifier: '@cardstack/catalog/person' },
    );
    assert.codeEqual(
      transpiled,
      `
      class Helper {}
      export class Person {
        static [Symbol.for('ident')] = ['@cardstack/catalog/person', 'Person'];
      }
      export default class {
        static [Symbol.for('ident')] = ['@cardstack/catalog/person', 'default'];
      }
      `,
    );
  });

  test('leaves classes untagged without a module identifier', async function (assert) {
    let transpiled = await transpileJS(
      `export class Person {}`,
      'test-module.ts',
    );
    assert.codeEqual(transpiled, `export class Person {}`);
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
});
