// IconButton unit tests. No assertion touches a computed style: the host test
// harness stamps the scoped-css attribute and delivers no stylesheet.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { IconButton } from './icon-button';

const TestIcon: TemplateOnlyComponent<{ Element: SVGSVGElement }> = <template>
  <svg viewBox='0 0 14 14' data-test-icon ...attributes><title>Plus</title><path
      d='M7 2v10M2 7h10'
    /></svg>
</template>;

function el(sel = '[data-test-pretui-icon-button]'): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}

module('Pretui | components/icon-button', function (hooks) {
  setupCardTest(hooks);

  test('the label names the button, and the face is hidden from the name', async function (assert) {
    await render(
      <template>
        <IconButton @label='Remove supplier'>✕</IconButton>
      </template>,
    );
    let btn = el();
    assert.strictEqual(btn.tagName, 'BUTTON');
    assert.strictEqual(btn.getAttribute('aria-label'), 'Remove supplier');
    assert.strictEqual(btn.getAttribute('title'), 'Remove supplier');
    assert.strictEqual(
      btn.querySelector('.pretui-iconbtn-glyph')?.getAttribute('aria-hidden'),
      'true',
      'a text glyph is not read after the label',
    );
    assert.strictEqual(
      btn.dataset['appearance'],
      'outlined',
      'secondary by default',
    );
    assert.false(
      btn.hasAttribute('aria-pressed'),
      'not a toggle unless @pressed is set',
    );
  });

  test('@icon renders hidden, sized by @size unless @width / @height say otherwise', async function (assert) {
    await render(
      <template>
        <IconButton @label='Add' @icon={{TestIcon}} data-test-default />
        <IconButton @label='Add' @icon={{TestIcon}} @size='xl' data-test-xl />
        <IconButton
          @label='Add'
          @icon={{TestIcon}}
          @width='22'
          @height='22'
          data-test-explicit
        />
      </template>,
    );
    let icon = el('[data-test-default] [data-test-icon]');
    assert.strictEqual(icon.getAttribute('width'), '16');
    assert.strictEqual(icon.getAttribute('height'), '16');
    assert.ok(
      icon.closest('[aria-hidden="true"]'),
      "the icon's own <title> stays out of the name",
    );
    assert.strictEqual(
      el('[data-test-xl] [data-test-icon]').getAttribute('width'),
      '20',
    );
    assert.strictEqual(
      el('[data-test-explicit] [data-test-icon]').getAttribute('width'),
      '22',
    );
  });

  test('@pressed reports toggle state without changing the label', async function (assert) {
    await render(
      <template>
        <IconButton @label='Pin' @pressed={{true}} data-test-on />
        <IconButton @label='Pin' @pressed={{false}} data-test-off />
        <IconButton
          @label='Pin'
          @pressed={{true}}
          @href='/pins'
          data-test-link
        />
      </template>,
    );
    assert.strictEqual(
      el('[data-test-on]').getAttribute('aria-pressed'),
      'true',
    );
    assert.strictEqual(el('[data-test-on]').getAttribute('aria-label'), 'Pin');
    assert.strictEqual(
      el('[data-test-off]').getAttribute('aria-pressed'),
      'false',
    );
    assert.strictEqual(el('[data-test-link]').tagName, 'A');
    assert.false(
      el('[data-test-link]').hasAttribute('aria-pressed'),
      'a link is not a toggle',
    );
  });

  test('busy keeps focus and adds @busyLabel to the accessible name', async function (assert) {
    await render(
      <template>
        <IconButton
          @label='Save'
          @busy={{true}}
          @busyLabel='Saving'
          data-test-busy
        />
        <IconButton @label='Save' @loading={{true}} data-test-loading />
      </template>,
    );
    let busy = el('[data-test-busy]') as HTMLButtonElement;
    assert.strictEqual(busy.getAttribute('aria-busy'), 'true');
    assert.strictEqual(busy.getAttribute('aria-disabled'), 'true');
    assert.false(busy.disabled, 'stays in the tab order');
    assert.strictEqual(busy.getAttribute('aria-label'), 'Save Saving');
    assert.strictEqual(
      busy.getAttribute('title'),
      'Save',
      'the tooltip keeps the label',
    );

    let loading = el('[data-test-loading]');
    assert.strictEqual(
      loading.getAttribute('aria-busy'),
      'true',
      '@loading is an alias',
    );
    assert.strictEqual(loading.getAttribute('aria-label'), 'Save');
  });

  test('@tone and @appearance reach Button, over @variant', async function (assert) {
    await render(
      <template>
        <IconButton
          @label='Warn'
          @variant='ghost'
          @tone='warning'
          @appearance='filled'
        />
      </template>,
    );
    assert.strictEqual(el().dataset['tone'], 'warning');
    assert.strictEqual(el().dataset['appearance'], 'filled');
  });
});
