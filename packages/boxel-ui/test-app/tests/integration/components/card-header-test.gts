import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { find, render } from '@ember/test-helpers';
import { CardHeader } from '@cardstack/boxel-ui/components';
import { MenuItem } from '@cardstack/boxel-ui/helpers';

function centerX(selector: string): number {
  let el = find(selector);
  if (!el) {
    throw new Error(`expected to find element: ${selector}`);
  }
  let rect = el.getBoundingClientRect();
  return rect.left + rect.width / 2;
}

module('Integration | Component | card-header', function (hooks) {
  setupRenderingTest(hooks);

  // The header is rendered wide enough (>= 28rem) for the symmetric
  // icon/actions min-widths to apply, mirroring how the host sizes a top
  // card's header. The action buttons make the actions column wider than its
  // min-width so that any extra width contributed by the utility menu would
  // shift the centered title — which is exactly the regression we guard.
  const realmInfo = {
    name: 'Test Workspace',
    iconURL: 'https://example.com/icon.png',
    publishable: null,
  };
  const noop = () => {};
  const utilityMenu = {
    triggerText: '2',
    menuItems: [new MenuItem({ label: 'Deselect All', action: noop })],
  };

  test('the card title stays centered whether or not the selection utility menu is present', async function (assert) {
    await render(
      <template>
        <div style='width: 600px'>
          <CardHeader
            @cardTitle='A Centered Card Title'
            @realmInfo={{realmInfo}}
            @isTopCard={{true}}
            @onEdit={{noop}}
            @onExpand={{noop}}
            @onClose={{noop}}
            style='--boxel-card-header-icon-container-min-width: 95px; --boxel-card-header-actions-min-width: 95px;'
          />
        </div>
      </template>,
    );

    let headerCenterWithoutMenu = centerX('[data-test-card-header]');
    let titleCenterWithoutMenu = centerX('[data-test-boxel-card-header-title]');
    let offsetWithoutMenu = titleCenterWithoutMenu - headerCenterWithoutMenu;

    await render(
      <template>
        <div style='width: 600px'>
          <CardHeader
            @cardTitle='A Centered Card Title'
            @realmInfo={{realmInfo}}
            @isTopCard={{true}}
            @utilityMenu={{utilityMenu}}
            @onEdit={{noop}}
            @onExpand={{noop}}
            @onClose={{noop}}
            style='--boxel-card-header-icon-container-min-width: 95px; --boxel-card-header-actions-min-width: 95px;'
          />
        </div>
      </template>,
    );

    let headerCenterWithMenu = centerX('[data-test-card-header]');
    let titleCenterWithMenu = centerX('[data-test-boxel-card-header-title]');
    let offsetWithMenu = titleCenterWithMenu - headerCenterWithMenu;

    assert
      .dom('[data-test-card-header] .utility-menu-trigger')
      .exists('the selection utility menu pill is rendered');

    assert.ok(
      Math.abs(offsetWithMenu - offsetWithoutMenu) <= 1.5,
      `title center should not shift when the utility menu appears (without: ${offsetWithoutMenu.toFixed(
        1,
      )}px, with: ${offsetWithMenu.toFixed(1)}px)`,
    );
  });
});
