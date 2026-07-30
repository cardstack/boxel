import { render } from '@ember/test-helpers';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';

import { CardContainer } from '@cardstack/boxel-ui/components';

const OUTER_THEME = `:root {
  --primary: #112233;
  --theme-body-font-size: 18px;
}
.dark {
  --primary: #445566;
}`;

// Defines --accent only; --primary and --theme-body-font-size must come from
// the boundary reset, not from an enclosing theme.
const INNER_THEME = `:root { --accent: #aabbcc; } .dark { --accent: #ddeeff; }`;

function propertyOf(selector: string, property: string): string {
  let el = document.querySelector(selector);
  if (!el) {
    throw new Error(`expected to find element: ${selector}`);
  }
  return window.getComputedStyle(el).getPropertyValue(property).trim();
}

module('Integration | Component | card-container', function (hooks) {
  setupRenderingTest(hooks);

  test('stamps the theme scope only when theme css is present', async function (assert) {
    await render(
      <template>
        <CardContainer data-test-unthemed>unthemed</CardContainer>
        <CardContainer
          @themeCss={{OUTER_THEME}}
          @themeScope='scope-a'
          data-test-themed
        >themed</CardContainer>
      </template>,
    );

    assert
      .dom('[data-test-unthemed]')
      .doesNotHaveAttribute('data-boxel-theme-scope');
    assert
      .dom('[data-test-themed]')
      .hasAttribute('data-boxel-theme-scope', 'scope-a');
  });

  test('applies root variables under the ambient light scheme', async function (assert) {
    await render(
      <template>
        <CardContainer
          @themeCss={{OUTER_THEME}}
          @themeScope='scope-a'
          data-test-themed
        >themed</CardContainer>
      </template>,
    );

    assert.strictEqual(
      propertyOf('[data-test-themed]', '--primary'),
      '#112233',
    );
  });

  test('applies dark variables inside a dark subtree and switches back inside a light island', async function (assert) {
    await render(
      <template>
        <div data-theme='dark'>
          <CardContainer
            @themeCss={{OUTER_THEME}}
            @themeScope='scope-a'
            data-test-dark
          >dark</CardContainer>
          <div data-theme='light'>
            <CardContainer
              @themeCss={{OUTER_THEME}}
              @themeScope='scope-b'
              data-test-light-island
            >light island</CardContainer>
          </div>
        </div>
      </template>,
    );

    assert.strictEqual(
      propertyOf('[data-test-dark]', '--primary'),
      '#445566',
      'dark variables apply inside a dark subtree',
    );
    assert.strictEqual(
      propertyOf('[data-test-light-island]', '--primary'),
      '#112233',
      'root variables apply again inside a nested light island',
    );
  });

  test('an outer theme does not leak into a nested themed card', async function (assert) {
    await render(
      <template>
        <CardContainer data-test-reference>reference</CardContainer>
        <CardContainer
          @themeCss={{OUTER_THEME}}
          @themeScope='scope-outer'
          data-test-outer
        >
          <CardContainer
            @themeCss={{INNER_THEME}}
            @themeScope='scope-inner'
            data-test-inner
          >inner</CardContainer>
        </CardContainer>
      </template>,
    );

    assert.strictEqual(
      propertyOf('[data-test-inner]', '--accent'),
      '#aabbcc',
      'inner theme applies its own variables',
    );
    assert.strictEqual(
      propertyOf('[data-test-inner]', '--primary'),
      propertyOf('[data-test-reference]', '--primary'),
      'inner card resets --primary to the default instead of inheriting the outer theme',
    );
    assert.strictEqual(
      propertyOf('[data-test-inner]', '--theme-body-font-size'),
      '',
      'inner card resets --theme-* knobs to initial instead of inheriting the outer theme',
    );
  });

  test('the ambient color scheme inherits through a themed-card boundary', async function (assert) {
    await render(
      <template>
        <div data-theme='dark'>
          <CardContainer
            @themeCss={{OUTER_THEME}}
            @themeScope='scope-outer'
            data-test-outer
          >
            <CardContainer
              @themeCss={{INNER_THEME}}
              @themeScope='scope-inner'
              data-test-inner
            >inner</CardContainer>
          </CardContainer>
        </div>
      </template>,
    );

    assert.strictEqual(
      propertyOf('[data-test-outer]', '--primary'),
      '#445566',
      'outer themed card follows the ambient dark scheme',
    );
    assert.strictEqual(
      propertyOf('[data-test-inner]', '--accent'),
      '#ddeeff',
      'nested themed card still sees the ambient dark scheme',
    );
  });
});
