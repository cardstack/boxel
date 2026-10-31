import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import sitePathsTests from '@cardstack/runtime-common/tests/site-paths-test';

module(basename(import.meta.filename), function () {
  test('parsePathTemplate: reads literals and whole-segment variables', async function (assert) {
    await runSharedTest(sitePathsTests, assert, {});
  });

  test('parsePathTemplate: refuses what cannot be read back', async function (assert) {
    await runSharedTest(sitePathsTests, assert, {});
  });

  test('expandPathTemplate: RFC 6570 simple expansion, one segment per value', async function (assert) {
    await runSharedTest(sitePathsTests, assert, {});
  });

  test('matchPathTemplate: matches by segment, and round-trips an expansion', async function (assert) {
    await runSharedTest(sitePathsTests, assert, {});
  });

  test('pageTypeMatchFilter: variables become eq values, numbers match either spelling', async function (assert) {
    await runSharedTest(sitePathsTests, assert, {});
  });

  test('matchRedirect: substitutes template values into the target', async function (assert) {
    await runSharedTest(sitePathsTests, assert, {});
  });

  test('resolveSitePath: follows the precedence ladder', async function (assert) {
    await runSharedTest(sitePathsTests, assert, {});
  });

  test('resolveSitePath: a fixed page comes after literal redirects and before listings and templates', async function (assert) {
    await runSharedTest(sitePathsTests, assert, {});
  });

  test('resolveSitePath: a template whose search finds nothing falls through', async function (assert) {
    await runSharedTest(sitePathsTests, assert, {});
  });

  test('resolveSitePath: an earlier page type that routes the card gives its canonical address', async function (assert) {
    await runSharedTest(sitePathsTests, assert, {});
  });

  test('canonicalPathOf: the first page type that routes the card and has its fields', async function (assert) {
    await runSharedTest(sitePathsTests, assert, {});
  });

  test('shareFor: reads share tags from the card, and leaves out what it cannot read', async function (assert) {
    await runSharedTest(sitePathsTests, assert, {});
  });
});
