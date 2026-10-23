import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import exportIdentityPluginTests from '@cardstack/runtime-common/tests/export-identity-plugin-test';

module(basename(import.meta.filename), function () {
  module('exportIdentityPlugin', function () {
    test('tags an exported class declaration with its name', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('tags a named default export class as "default"', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('tags an anonymous default export class as "default"', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('tags a class exported through an export list', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('uses the exported name, not the local name, of a renamed export', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('tags a class exported under a string-literal name', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('tags a class exported by "export default <identifier>"', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('tags an exported class expression with the variable name', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('tags a class expression whose binding is exported later', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('a class exported under several names takes the first in source order', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('leaves classes that are not exported alone', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('leaves classes re-exported from another module alone', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('leaves ambient and type-only exports alone', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('tags every exported class in a module', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('passes the on-disk filename to the moduleIdentifier callback', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('accepts a fixed string as the module identifier', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('leaves a file untagged when moduleIdentifier returns null', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('tags the class a class factory returns for an exported binding', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('tags a class factory result exported through an export list', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('tags a class factory result that is the default export', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('recognizes a class factory imported by a realm alias or through a namespace', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('recognizes a class factory a module imports by a relative specifier', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('recognizes a class factory the module declares and exports itself', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('names an imported module through the importedModule option', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('leaves values made by other functions alone', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });
  });
});
