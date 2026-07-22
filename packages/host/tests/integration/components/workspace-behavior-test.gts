import { click } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import { Workspace, setupBaseRealm } from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

const HOME = 'nav.tabs .tab:nth-child(1)';
const LIBRARY = 'nav.tabs .tab:nth-child(2)';
const ACTIVITY = 'nav.tabs .tab:nth-child(3)';

module('Integration | Card | workspace | segments', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  test('clicking a tab moves the active segment', async function (assert) {
    await renderCard(loader, new Workspace({}), 'isolated');
    assert.dom('nav.tabs .tab.active').hasText('Home', 'Home is active first');

    await click(LIBRARY);
    assert.dom('nav.tabs .tab.active').hasText('Library');

    await click(ACTIVITY);
    assert.dom('nav.tabs .tab.active').hasText('Activity');

    await click(HOME);
    assert.dom('nav.tabs .tab.active').hasText('Home');
  });

  test('the Frame search input is present and editable', async function (assert) {
    await renderCard(loader, new Workspace({}), 'isolated');
    assert.dom('.search-box .search-input').exists('Cmd+K frame search input');
  });
});
