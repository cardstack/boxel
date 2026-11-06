// IconButton unit tests. No assertion touches a computed style: the host test
// harness stamps the scoped-css attribute and delivers no stylesheet.
import { module, test } from 'qunit';
import { tracked } from '@glimmer/tracking';
import { render, settled } from '@ember/test-helpers';
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
      btn.querySelector('[data-test-pretui-icon-button-glyph]')?.getAttribute('aria-hidden'),
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

  test('@icon renders hidden, sized in em of the button font unless @iconWidth / @iconHeight say otherwise', async function (assert) {
    await render(
      <template>
        <IconButton @label='Add' @icon={{TestIcon}} data-test-default />
        <IconButton
          @label='Add'
          @icon={{TestIcon}}
          @iconWidth='22'
          @iconHeight='22'
          data-test-explicit
        />
      </template>,
    );
    let icon = el('[data-test-default] [data-test-icon]');
    assert.strictEqual(
      icon.getAttribute('width'),
      '1.25em',
      'scales with @size and the theme text scale through the font size',
    );
    assert.strictEqual(icon.getAttribute('height'), '1.25em');
    assert.ok(
      icon.closest('[aria-hidden="true"]'),
      "the icon's own <title> stays out of the name",
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

  test('@pressedTint={{false}} drops the tint and keeps the toggle state', async function (assert) {
    await render(
      <template>
        <IconButton @label='Pin' @pressed={{true}} data-test-tinted />
        <IconButton
          @label='Pin'
          @pressed={{true}}
          @pressedTint={{false}}
          data-test-untinted
        />
      </template>,
    );
    assert.false(
      el('[data-test-tinted]').hasAttribute('data-pressed-tint'),
      'tinted by default',
    );
    assert.strictEqual(
      el('[data-test-untinted]').getAttribute('data-pressed-tint'),
      'none',
    );
    assert.strictEqual(
      el('[data-test-untinted]').getAttribute('aria-pressed'),
      'true',
      'still announced as pressed',
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
    assert.strictEqual(busy.querySelector('[data-test-pretui-button-busy-label]')?.textContent, 'Saving', 'forwarded to Button, which shows it given the room');
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

  test('@tooltip shows in a Tooltip in place of the native title', async function (assert) {
    await render(
      <template>
        <IconButton @label='Favorite' @tooltip='Add to Favorites'>★</IconButton>
      </template>,
    );
    let btn = el();
    let tip = el('[data-test-pretui-tooltip] [role="tooltip"]');
    assert.false(btn.hasAttribute('title'), 'no native tooltip over the tip');
    assert.strictEqual(
      btn.getAttribute('aria-label'),
      'Favorite',
      'the name stays @label',
    );
    assert.strictEqual(
      btn.getAttribute('aria-describedby'),
      tip.id,
      'the tip describes the button',
    );
    assert.strictEqual(tip.textContent?.trim(), 'Add to Favorites');
  });

  test('a @tooltip that matches @label names the button once instead of describing it', async function (assert) {
    await render(
      <template>
        <IconButton @label='Choose Catalogs' @tooltip='Choose Catalogs' data-test-idle>⚙</IconButton>
        <IconButton
          @label='Choose Catalogs'
          @tooltip='Choose Catalogs'
          @busy={{true}}
          @busyLabel='Saving'
          data-test-busy
        >⚙</IconButton>
      </template>,
    );
    let idle = el('[data-test-idle]');
    let tip = idle.parentElement?.querySelector('[role="tooltip"]') as HTMLElement;
    assert.strictEqual(idle.getAttribute('aria-labelledby'), tip.id, 'the tip names the button');
    assert.false(idle.hasAttribute('aria-label'), 'no aria-label for the tip to override');
    assert.false(idle.hasAttribute('aria-describedby'), 'no description repeating the name');
    assert.false(idle.hasAttribute('title'), 'only the Pret UI tooltip shows');

    let busy = el('[data-test-busy]');
    assert.strictEqual(busy.getAttribute('aria-label'), 'Choose Catalogs Saving', '@busyLabel stays in the name');
    assert.false(busy.hasAttribute('aria-labelledby'), 'which an aria-labelledby would override');
    assert.strictEqual(
      busy.getAttribute('aria-describedby'),
      busy.parentElement?.querySelector('[role="tooltip"]')?.id,
      'the tip describes the button while busy',
    );
  });

  test('a @tooltip that stops matching @label goes back to describing the button', async function (assert) {
    class State {
      @tracked tip = 'Copy';
    }
    let state = new State();
    await render(
      <template>
        <IconButton @label='Copy' @tooltip={{state.tip}}>⧉</IconButton>
      </template>,
    );
    let btn = el();
    let tipId = btn.parentElement?.querySelector('[role="tooltip"]')?.id;
    assert.strictEqual(btn.getAttribute('aria-labelledby'), tipId, 'the matching tip names it');

    state.tip = 'Copied';
    await settled();
    assert.false(btn.hasAttribute('aria-labelledby'), 'the new tip does not name it');
    assert.strictEqual(btn.getAttribute('aria-label'), 'Copy', 'the name stays the label');
    assert.strictEqual(btn.getAttribute('aria-describedby'), tipId, 'the new tip describes it');

    state.tip = 'Copy';
    await settled();
    assert.strictEqual(btn.getAttribute('aria-labelledby'), tipId, 'a matching tip names it again');
    assert.false(btn.hasAttribute('aria-label'), 'with no aria-label beside it');
    assert.false(btn.hasAttribute('aria-describedby'), 'and no description');
  });

  test('@tooltipSide picks the side the tip opens on', async function (assert) {
    await render(
      <template>
        <IconButton
          @label='Favorite'
          @tooltip='Add to Favorites'
          @tooltipSide='right'
        >★</IconButton>
      </template>,
    );
    assert.strictEqual(
      el('[data-test-pretui-tooltip] [role="tooltip"]').dataset['side'],
      'right',
    );
  });

  test('without @tooltip there is no Tooltip wrapper', async function (assert) {
    await render(
      <template>
        <IconButton @label='Favorite'>★</IconButton>
      </template>,
    );
    assert.strictEqual(
      document.querySelector('[data-test-pretui-tooltip]'),
      null,
    );
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
