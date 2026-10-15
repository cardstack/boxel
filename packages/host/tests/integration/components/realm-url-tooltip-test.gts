import { render, triggerEvent, waitFor } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import RealmURLTooltip from '@cardstack/host/components/realm-url-tooltip';

import { setupRenderingTest } from '../../helpers/setup';

module('Integration | Component | realm-url-tooltip', function (hooks) {
  setupRenderingTest(hooks);

  const realmURL = 'http://test-realm/testuser/workspace-a/';
  const longRealmURL = `http://test-realm/${'a-very-long-path-segment/'.repeat(20)}`;

  test('hovering the name shows the realm URL without scheme or trailing slash', async function (assert) {
    await render(
      <template>
        <RealmURLTooltip @realmURL={{realmURL}} @announce={{true}}>Workspace A</RealmURLTooltip>
      </template>,
    );

    assert
      .dom(`[data-test-realm-url-tooltip-trigger="${realmURL}"]`)
      .includesText(
        'test-realm/testuser/workspace-a',
        'the URL is part of the accessible text',
      );

    await triggerEvent(
      `[data-test-realm-url-tooltip-trigger="${realmURL}"]`,
      'mouseenter',
    );
    assert
      .dom('[data-test-realm-url-tooltip]')
      .hasText('test-realm/testuser/workspace-a');
  });

  test('without @announce the URL is hover-only', async function (assert) {
    await render(
      <template>
        <RealmURLTooltip @realmURL={{realmURL}}>Workspace A</RealmURLTooltip>
      </template>,
    );

    assert
      .dom(`[data-test-realm-url-tooltip-trigger="${realmURL}"]`)
      .hasText('Workspace A');

    await triggerEvent(
      `[data-test-realm-url-tooltip-trigger="${realmURL}"]`,
      'mouseenter',
    );
    assert
      .dom('[data-test-realm-url-tooltip]')
      .hasText('test-realm/testuser/workspace-a');
  });

  test('the URL appears once an unknown realm is looked up', async function (assert) {
    const discoveredRealmURL = 'http://test-realm/discovered-later/';
    const cardURL = `${discoveredRealmURL}Card/1`;
    // Answers the realm lookup the way the realm server does.
    let handler = async (request: Request) =>
      request.method === 'HEAD' && request.url.startsWith(discoveredRealmURL)
        ? new Response(null, {
            headers: { 'x-boxel-realm-url': discoveredRealmURL },
          })
        : null;
    let { virtualNetwork } = getService('network');
    virtualNetwork.mount(handler, { prepend: true });
    try {
      await render(
        <template>
          <RealmURLTooltip @urlInRealm={{cardURL}}>Card</RealmURLTooltip>
        </template>,
      );
      // What the realm icon beside the tooltip does: `info()` starts the
      // lookup for a realm it doesn't know.
      getService('realm').info(cardURL);
      await waitFor(
        `[data-test-realm-url-tooltip-trigger="${discoveredRealmURL}"]`,
      );

      await triggerEvent(
        `[data-test-realm-url-tooltip-trigger="${discoveredRealmURL}"]`,
        'mouseenter',
      );
      assert
        .dom('[data-test-realm-url-tooltip]')
        .hasText('test-realm/discovered-later');
    } finally {
      virtualNetwork.unmount(handler);
    }
  });

  test('a very long realm URL wraps within the viewport', async function (assert) {
    await render(
      <template>
        <RealmURLTooltip @realmURL={{longRealmURL}}>Workspace</RealmURLTooltip>
      </template>,
    );

    await triggerEvent(
      `[data-test-realm-url-tooltip-trigger="${longRealmURL}"]`,
      'mouseenter',
    );
    let tooltip = document.querySelector(
      '[data-test-realm-url-tooltip]',
    ) as HTMLElement;
    assert.ok(
      tooltip.getBoundingClientRect().width < window.innerWidth,
      'the tooltip is narrower than the viewport',
    );
    assert.ok(
      tooltip.scrollWidth <= tooltip.clientWidth,
      'the URL wraps rather than overflowing',
    );
  });
});
