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

    test('tags a marked definition for an exported binding', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('tags a marked definition exported through an export list', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('tags a marked definition that is the default export', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('recognizes markDefinition imported under another name or through a namespace', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('refuses markDefinition imported by another spelling of the base package', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('refuses a marked definition that is not what an exported binding is declared with', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('leaves a call to an unmarked function alone', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });

    test('leaves values made by other functions alone', async function (assert) {
      await runSharedTest(exportIdentityPluginTests, assert, {});
    });
  });
});
