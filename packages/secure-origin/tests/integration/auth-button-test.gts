import { render } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

import AuthButton from '../../src/components/auth-button.gts';

// The component tests load no theme, so the theme's button variables are set
// on the document before each render: set after it, they would start Pret UI
// Button's color transition, and a read would land partway through it.
const THEME = {
  '--primary': 'rgb(0, 255, 186)',
  '--primary-foreground': 'rgb(0, 0, 0)',
  '--boxel-button-disabled-background': 'rgb(68, 64, 81)',
  '--boxel-button-disabled-foreground': 'rgb(129, 124, 147)',
  '--boxel-button-disabled-border': '1px solid rgb(68, 64, 81)',
  '--boxel-button-disabled-opacity': '1',
};

function paintTheme() {
  for (let [name, value] of Object.entries(THEME)) {
    document.documentElement.style.setProperty(name, value);
  }
}

function clearTheme() {
  for (let name of Object.keys(THEME)) {
    document.documentElement.style.removeProperty(name);
  }
}

function style(selector: string) {
  return getComputedStyle(document.querySelector(selector)!);
}

module('Integration | AuthButton', function (hooks) {
  setupRenderingTest(hooks);
  hooks.beforeEach(paintTheme);
  hooks.afterEach(clearTheme);

  test('a disabled button paints the theme’s disabled colors', async function (assert) {
    await render(
      <template>
        <AuthButton @variant='primary' @disabled={{true}} data-test-btn>Sign In</AuthButton>
      </template>,
    );
    let button = style('[data-test-btn]');
    assert.strictEqual(button.backgroundColor, 'rgb(68, 64, 81)');
    assert.strictEqual(button.color, 'rgb(129, 124, 147)');
    assert.strictEqual(button.borderTopColor, 'rgb(68, 64, 81)');
    assert.strictEqual(button.opacity, '1', 'at the theme’s opacity');
  });

  test('a busy button keeps its colors and its label at full strength', async function (assert) {
    await render(
      <template>
        <AuthButton
          @variant='primary'
          @disabled={{true}}
          @loading={{true}}
          data-test-btn
        >Sign In</AuthButton>
      </template>,
    );
    assert.dom('[data-test-btn]').hasAttribute('data-state', 'busy');
    assert
      .dom('[data-test-btn] [data-test-pretui-button-spinner]')
      .exists('shows the spinner');
    let button = style('[data-test-btn]');
    assert.strictEqual(button.backgroundColor, 'rgb(0, 255, 186)');
    assert.strictEqual(button.color, 'rgb(0, 0, 0)');
    assert.strictEqual(button.opacity, '1');
    assert.strictEqual(
      style('[data-test-btn] [data-test-pretui-button-label]').opacity,
      '1',
      'the label isn’t dimmed beside the spinner',
    );
  });

  test('given an address, it is a link', async function (assert) {
    await render(
      <template>
        <AuthButton @variant='secondary' @href='/secure/keys' data-test-btn>Go
          to your keys</AuthButton>
      </template>,
    );
    assert
      .dom('[data-test-btn]')
      .hasTagName('a')
      .hasAttribute('href', '/secure/keys');
  });
});
