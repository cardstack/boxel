import { render } from '@ember/test-helpers';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { Button } from '@cardstack/boxel-ui/components';

module('Integration | Component | button', function (hooks) {
  setupRenderingTest(hooks);

  test('renders a <button> by default and when @as="button"', async function (assert) {
    await render(
      <template>
        <Button>Go</Button>
      </template>,
    );
    assert.dom('[data-test-boxel-button]').hasTagName('button');
    assert
      .dom('[data-test-boxel-button]')
      .doesNotHaveAttribute('aria-disabled');

    await render(
      <template>
        <Button @as='button'>Go</Button>
      </template>,
    );
    assert.dom('[data-test-boxel-button]').hasTagName('button');
  });

  test('@as="anchor" renders a link with the sanitized href', async function (assert) {
    await render(
      <template>
        <Button @as='anchor' @href='https://example.com/x'>Go</Button>
      </template>,
    );
    assert.dom('[data-test-boxel-button]').hasTagName('a');
    assert
      .dom('[data-test-boxel-button]')
      .hasAttribute('href', 'https://example.com/x');
  });

  // An <a> with no href maps to the generic role, where aria-disabled is not
  // supported — so role='link' is what makes the state reach assistive tech.
  test('a disabled anchor is announced as an unavailable link', async function (assert) {
    await render(
      <template>
        <Button @as='anchor' @href='https://example.com/x' @disabled={{true}}>
          Go
        </Button>
      </template>,
    );
    assert.dom('[data-test-boxel-button]').doesNotHaveAttribute('href');
    assert.dom('[data-test-boxel-button]').hasAttribute('role', 'link');
    assert.dom('[data-test-boxel-button]').hasAria('disabled', 'true');
  });

  test('an enabled anchor carries neither role nor aria-disabled', async function (assert) {
    await render(
      <template>
        <Button @as='anchor' @href='https://example.com/x' @disabled={{false}}>
          Go
        </Button>
      </template>,
    );
    assert.dom('[data-test-boxel-button]').doesNotHaveAttribute('role');
    assert
      .dom('[data-test-boxel-button]')
      .doesNotHaveAttribute('aria-disabled');
  });

  // Regression guard: the disabled state is keyed on @disabled, never on a
  // falsy @href. Callers legitimately pass href as a plain attribute through
  // ...attributes (base/skill-plus.gts, base/default-templates/theme-dashboard.gts),
  // and those are real links that must not be labelled unavailable.
  test('an href passed via ...attributes is not treated as disabled', async function (assert) {
    await render(
      <template>
        <Button @as='anchor' href='#top'>Back to top</Button>
      </template>,
    );
    assert.dom('[data-test-boxel-button]').hasAttribute('href', '#top');
    assert.dom('[data-test-boxel-button]').doesNotHaveAttribute('role');
    assert
      .dom('[data-test-boxel-button]')
      .doesNotHaveAttribute('aria-disabled');
  });

  test('a disabled <button> keeps the native disabled attribute', async function (assert) {
    await render(
      <template>
        <Button @disabled={{true}}>Go</Button>
      </template>,
    );
    assert.dom('[data-test-boxel-button]').isDisabled();
    assert.dom('[data-test-boxel-button]').hasAria('disabled', 'true');
  });
});
