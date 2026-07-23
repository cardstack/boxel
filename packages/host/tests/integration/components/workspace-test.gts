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
});
