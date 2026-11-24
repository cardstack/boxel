import { render } from '@ember/test-helpers';

import window from 'ember-window-mock';

import { module, test } from 'qunit';

import LoadingTemplate from '@cardstack/host/templates/loading';

import { setupRenderingTest } from '../../helpers/setup';

// #686283, the operator-mode color that blends into the stacks.
const OPERATOR_MODE_COLOR = 'rgb(104, 98, 131)';
// #191624, the signed-out pages' color.
const SIGNED_OUT_COLOR = 'rgb(25, 22, 36)';

// The color a CSS color value paints on this page.
function paintedColor(value: string): string {
  let probe = document.createElement('div');
  probe.style.backgroundColor = value;
  document.body.append(probe);
  let { backgroundColor } = getComputedStyle(probe);
  probe.remove();
  return backgroundColor;
}

module('Integration | loading screen', function (hooks) {
  setupRenderingTest(hooks);

  function storeSession() {
    window.localStorage.setItem(
      'auth',
      JSON.stringify({ user_id: '@testuser:localhost' }),
    );
  }

  test('a signed-in load of the app’s root page paints the dashboard’s background', async function (assert) {
    storeSession();
    window.location.href = '/';
    await render(LoadingTemplate);

    let dashboardBackground = paintedColor('var(--host-dashboard-background)');
    assert.notStrictEqual(
      dashboardBackground,
      paintedColor('transparent'),
      'the dashboard has a background to match',
    );
    assert
      .dom('[data-test-host-loading]')
      .hasStyle({ backgroundColor: dashboardBackground });
  });

  test('a signed-in load of the root page with an empty interact state paints the dashboard’s background', async function (assert) {
    storeSession();
    let emptyInteract = encodeURIComponent(
      JSON.stringify({ stacks: [], submode: 'interact' }),
    );
    window.location.href = `/?operatorModeState=${emptyInteract}`;
    await render(LoadingTemplate);

    assert.dom('[data-test-host-loading]').hasStyle({
      backgroundColor: paintedColor('var(--host-dashboard-background)'),
    });
  });

  test('a signed-in load of a direct link to a card paints the operator-mode color', async function (assert) {
    storeSession();
    window.location.href = '/test/Pet/mango';
    await render(LoadingTemplate);

    assert
      .dom('[data-test-host-loading]')
      .hasStyle({ backgroundColor: OPERATOR_MODE_COLOR });
  });

  test('a signed-in reload with stacks open paints the operator-mode color', async function (assert) {
    storeSession();
    let withStacks = encodeURIComponent(
      JSON.stringify({
        stacks: [
          [{ id: 'http://test-realm/test/Pet/mango', format: 'isolated' }],
        ],
        submode: 'interact',
      }),
    );
    window.location.href = `/?operatorModeState=${withStacks}`;
    await render(LoadingTemplate);

    assert
      .dom('[data-test-host-loading]')
      .hasStyle({ backgroundColor: OPERATOR_MODE_COLOR });
  });

  test('a signed-in load of the root page with a null state paints the dashboard’s background', async function (assert) {
    storeSession();
    window.location.href = '/?operatorModeState=null';
    await render(LoadingTemplate);

    assert.dom('[data-test-host-loading]').hasStyle({
      backgroundColor: paintedColor('var(--host-dashboard-background)'),
    });
  });

  test('a signed-in reload with the dashboard open over stacks paints the dashboard’s background', async function (assert) {
    storeSession();
    let dashboardOverStacks = encodeURIComponent(
      JSON.stringify({
        stacks: [
          [{ id: 'http://test-realm/test/Pet/mango', format: 'isolated' }],
        ],
        submode: 'interact',
        workspaceChooserOpened: true,
      }),
    );
    window.location.href = `/test/Pet/mango?operatorModeState=${dashboardOverStacks}`;
    await render(LoadingTemplate);

    assert.dom('[data-test-host-loading]').hasStyle({
      backgroundColor: paintedColor('var(--host-dashboard-background)'),
    });
  });

  test('a signed-out load of the root page paints the signed-out color', async function (assert) {
    window.location.href = '/';
    await render(LoadingTemplate);

    assert
      .dom('[data-test-host-loading]')
      .hasStyle({ backgroundColor: SIGNED_OUT_COLOR });
  });
});
