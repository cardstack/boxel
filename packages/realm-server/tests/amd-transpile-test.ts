import { module, test } from 'qunit';
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import amdTranspileTests from '@cardstack/runtime-common/tests/amd-transpile-test';

module(basename(__filename), function () {
  module('amd-transpile (CS-10977)', function () {
    test('wraps an empty module in define()', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('export const X = expr', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('export let with body-time mutation', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('export let mutated by exported function (live binding)', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('circular dep: imported value is read at use-time, not import-time', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('shadowed import name is not rewritten', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('export function f', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('export class C', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('export default expression', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('export default named function', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('export default anonymous class', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('named import binds via destructuring', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('default import uses .default', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('namespace import binds the dep arg', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('side-effect-only import declares the dep', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('re-export from foo uses live-binding getter', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('re-export of imported binding uses live-binding getter', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('export * from foo installs getters for each key', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('export * skips names that this module declares explicitly', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('export * as ns from foo installs a namespace getter', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('import.meta is replaced and added to deps', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('string literal containing "import.meta" is preserved', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('export { a, b as c } of locals', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('mixed default + named import on same statement', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('multiple exports of the same import are all live', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('shorthand property of an imported name (regression P0-1)', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('for-let loop variable shadowing an import (regression P0-2a)', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('for-in var hoisting through function scope (regression P0-2b)', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('computed key in destructured export (regression P0-3)', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('export default of an imported binding', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('export default forward-references a const declared later (TDZ-safe)', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('export default expression with imported name inside', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('destructured export const { a, b } = obj', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('destructured export const [first, second] = arr', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('collision-safe __default$N synthesised name', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });

    test('identical-name import binding via { x: x }', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });
  });
});
