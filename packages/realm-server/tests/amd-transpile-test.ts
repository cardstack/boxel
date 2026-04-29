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

    test('export let snapshots at body-end', async function (assert) {
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

    test('identical-name import binding via { x: x }', async function (assert) {
      await runSharedTest(amdTranspileTests, assert, {});
    });
  });
});
