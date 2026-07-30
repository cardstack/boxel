import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import {
  Workspace,
  setupBaseRealm,
  setupWorkspaceCard,
} from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

// Smoke coverage that the ported Workspace card renders its shell without
// runtime errors. The full behavior suite (segment switching, feed
// pagination, search, subscription-driven refresh, publish) lands separately.
module('Integration | Card | workspace', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupWorkspaceCard(hooks);

  let loader: Loader;

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  test('isolated format renders the Home/Library/Activity tab shell', async function (assert) {
    let card = new Workspace({});
    await renderCard(loader, card, 'isolated');

    assert.dom('nav.tabs').exists('renders the sections nav');
    assert
      .dom('nav.tabs .tab')
      .exists({ count: 3 }, 'Home, Library, and Activity tabs');
    assert
      .dom('nav.tabs .tab.active')
      .hasText('Home', 'Home is the default active segment');
  });

  test('edit format renders workspace settings', async function (assert) {
    let card = new Workspace({});
    await renderCard(loader, card, 'edit');

    assert.dom('.settings-title').hasText('Workspace settings');
  });

  // Graceful degradation: a Workspace whose `workspace` link (the realm's
  // RealmConfig card) is absent must still render Home and settings with sane
  // defaults rather than erroring on the missing instance.
  module('missing RealmConfig', function () {
    test('Home renders without a linked RealmConfig', async function (assert) {
      let card = new Workspace({}); // no `workspace` link set
      await renderCard(loader, card, 'isolated');

      assert
        .dom('[data-test-workspace-index]')
        .exists('the isolated shell renders');
      assert
        .dom('nav.tabs .tab.active')
        .hasText('Home', 'Home is active and its stage rendered without error');
    });

    test('settings render, omitting the config-owned identity inputs', async function (assert) {
      let card = new Workspace({}); // no `workspace` link set
      await renderCard(loader, card, 'edit');

      assert
        .dom('.settings-title')
        .hasText('Workspace settings', 'the settings form still renders');
      // Name/Icon live on the RealmConfig card, so they fall away when it is
      // missing — the rest of the form (including the config-card picker) stays.
      assert
        .dom('input[placeholder="Workspace name"]')
        .doesNotExist('the config-owned name input is omitted, not errored');
      assert
        .dom('input[placeholder="https://…"]')
        .doesNotExist('the config-owned icon input is omitted, not errored');
    });
  });
});
