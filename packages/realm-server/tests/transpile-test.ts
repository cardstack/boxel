import { module, test } from 'qunit';
import { basename } from 'path';
import { transpileJS } from '@cardstack/runtime-common/transpile';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(basename(__filename), function () {
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
});
