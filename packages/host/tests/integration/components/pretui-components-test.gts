import { click } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { Button } from '@cardstack/pretui/components/button';
import { Switch } from '@cardstack/pretui/components/switch';
import { module, test } from 'qunit';

import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | pretui components', function (hooks) {
  setupRenderingTest(hooks);

  test('Button renders from the workspace package with its axes resolved', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Button
            @tone='danger'
            @appearance='outlined'
            @size='l'
          >Delete</Button>
        </template>
      },
    );

    assert.dom('[data-test-pretui-button]').hasTagName('button');
    assert.dom('[data-test-pretui-button]').hasText('Delete');
    assert.dom('[data-test-pretui-button]').hasClass('pretui-btn');
    assert
      .dom('[data-test-pretui-button]')
      .hasAttribute('data-tone', 'danger')
      .hasAttribute('data-appearance', 'outlined')
      .hasAttribute('data-size', 'l');
  });

  test('Switch toggles and notifies through the workspace package', async function (assert) {
    let seen: boolean[] = [];
    let onCheckedChange = (checked: boolean) => seen.push(checked);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><Switch @onCheckedChange={{onCheckedChange}} /></template>
      },
    );

    assert
      .dom('[data-test-pretui-switch]')
      .hasAttribute('aria-checked', 'false');
    await click('[data-test-pretui-switch]');
    assert
      .dom('[data-test-pretui-switch]')
      .hasAttribute('aria-checked', 'true');
    assert.deepEqual(seen, [true]);
  });
});
