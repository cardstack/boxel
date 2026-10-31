import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import siteSettingsTests from '@cardstack/runtime-common/tests/site-settings-test';

module(basename(import.meta.filename), function () {
  test('readSiteSettings: an absent site reads as defaults with no problems', async function (assert) {
    await runSharedTest(siteSettingsTests, assert, {});
  });

  test('readSiteSettings: a page type resolves its module and source realm against the realm', async function (assert) {
    await runSharedTest(siteSettingsTests, assert, {});
  });

  test('readSiteSettings: a card type reads from the search doc string form too', async function (assert) {
    await runSharedTest(siteSettingsTests, assert, {});
  });

  test('readSiteSettings: a page type with no valid path is kept without one and reported', async function (assert) {
    await runSharedTest(siteSettingsTests, assert, {});
  });

  test('readSiteSettings: an invalid page type is dropped and reported, the rest kept', async function (assert) {
    await runSharedTest(siteSettingsTests, assert, {});
  });

  test('readSiteSettings: a bad listing is dropped but the page type kept', async function (assert) {
    await runSharedTest(siteSettingsTests, assert, {});
  });

  test('readSiteSettings: a page type keeps a sort array and drops one that is not', async function (assert) {
    await runSharedTest(siteSettingsTests, assert, {});
  });

  test('readSiteSettings: page types past the cap are dropped and reported', async function (assert) {
    await runSharedTest(siteSettingsTests, assert, {});
  });

  test('readSiteSettings: redirects keep template variables and default to 301', async function (assert) {
    await runSharedTest(siteSettingsTests, assert, {});
  });

  test('readSiteSettings: a redirect whose target uses a name its source lacks is dropped', async function (assert) {
    await runSharedTest(siteSettingsTests, assert, {});
  });

  test('readSiteSettings: reads the not-found card, crawlers and defaults', async function (assert) {
    await runSharedTest(siteSettingsTests, assert, {});
  });

  test('readSiteSettings: reads the frame card, and reports one that is not a card id', async function (assert) {
    await runSharedTest(siteSettingsTests, assert, {});
  });
});
