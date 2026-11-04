// Logo unit tests. No assertion touches a computed style: the host test
// harness stamps the scoped-css attribute and delivers no stylesheet.
import { module, test } from 'qunit';
import { tracked } from '@glimmer/tracking';
import { render, waitUntil } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Logo } from './logo';
import { Sidebar } from './sidebar';

const svg = (w: number, h: number) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#4338ca"/></svg>`,
  )}`;
const WIDE = svg(400, 100);
const SQUARE = svg(100, 100);
const BROKEN = 'data:image/png;base64,AAAA';

function logo(sel = '[data-test-pretui-logo]'): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}

module('Pretui | components/logo', function (hooks) {
  setupCardTest(hooks);

  test('an image is drawn whole, named by @name, at size m', async function (assert) {
    await render(
      <template>
        <Logo @src={{WIDE}} @name='Acme' />
      </template>,
    );
    let img = logo().querySelector('img') as HTMLImageElement;
    assert.strictEqual(img.getAttribute('alt'), 'Acme');
    assert.strictEqual(logo().dataset['size'], 'm');
    assert.strictEqual(logo().dataset['hasImage'], 'true');
  });

  test('auto picks wordmark for a wide image and mark for a square one', async function (assert) {
    await render(
      <template>
        <Logo @src={{WIDE}} @name='Wide' data-test-wide />
        <Logo @src={{SQUARE}} @name='Square' data-test-square />
      </template>,
    );
    await waitUntil(
      () => logo('[data-test-wide]').dataset['variant'] === 'wordmark',
    );
    await waitUntil(
      () => logo('[data-test-square]').dataset['variant'] === 'mark',
    );
    assert.ok(true, 'both resolved from the loaded image ratio');
  });

  test('@variant wins over the image ratio', async function (assert) {
    await render(
      <template>
        <Logo @src={{WIDE}} @name='Acme' @variant='mark' />
      </template>,
    );
    assert.strictEqual(logo().dataset['variant'], 'mark');
  });

  test('with no image the name is a wordmark, and the initials in a mark', async function (assert) {
    await render(
      <template>
        <Logo @name='Acme Studio' data-test-word />
        <Logo @name='Acme Studio' @variant='mark' data-test-mark />
      </template>,
    );
    assert.strictEqual(logo('[data-test-word]').dataset['variant'], 'wordmark');
    assert.dom('[data-test-word]').hasText('Acme Studio');
    assert.dom('[data-test-mark]').hasText('AS');
    assert
      .dom('[data-test-mark] [role="img"]')
      .hasAttribute('aria-label', 'Acme Studio', 'initials still say the name');
  });

  test('a failing image falls back to the name', async function (assert) {
    await render(
      <template>
        <Logo @src={{BROKEN}} @name='Acme' />
      </template>,
    );
    await waitUntil(() => logo().dataset['state'] === 'fallback');
    assert.dom('img').doesNotExist();
    assert.dom('[data-test-pretui-logo]').hasText('Acme');
    assert.strictEqual(logo().dataset['hasImage'], undefined);
  });

  test('the fallback state follows the current @src', async function (assert) {
    class State {
      @tracked src = BROKEN;
    }
    let state = new State();
    await render(
      <template>
        <Logo @src={{state.src}} @name='Acme' />
      </template>,
    );
    await waitUntil(() => logo().dataset['state'] === 'fallback');
    state.src = SQUARE;
    await waitUntil(() => logo().dataset['state'] === undefined);
    assert.dom('img').exists('the new source is drawn');
  });

  test('@decorative hides it from assistive tech', async function (assert) {
    await render(
      <template>
        <Logo @src={{SQUARE}} @name='Acme' @decorative={{true}} data-test-img />
        <Logo
          @name='Acme Studio'
          @variant='mark'
          @decorative={{true}}
          data-test-initials
        />
      </template>,
    );
    assert.dom('[data-test-img]').hasAttribute('aria-hidden', 'true');
    assert.dom('[data-test-img] img').hasAttribute('alt', '');
    assert.dom('[data-test-initials] [role]').doesNotExist();
  });

  test('@size takes the house scale and falls back to m', async function (assert) {
    await render(
      <template>
        <Logo @name='A' @size='xl' data-test-xl />
        <Logo @name='A' @size='lg' data-test-lg />
        {{! @glint-expect-error - deliberately invalid }}
        <Logo @name='A' @size='huge' data-test-huge />
      </template>,
    );
    assert.strictEqual(logo('[data-test-xl]').dataset['size'], 'xl');
    assert.strictEqual(logo('[data-test-lg]').dataset['size'], 'l');
    assert.strictEqual(logo('[data-test-huge]').dataset['size'], 'm');
  });

  test('sits in a Sidebar header, expanded and collapsed to the rail', async function (assert) {
    await render(
      <template>
        <Sidebar @label='Workspace' @open={{true}} @collapsible='rail'>
          <:header as |bar|>
            <Logo
              @name='Acme Studio'
              @variant={{if bar.collapsed 'mark' 'wordmark'}}
            />
          </:header>
          <:nav></:nav>
        </Sidebar>
        <Sidebar @label='Rail' @open={{false}} @collapsible='rail'>
          <:header as |bar|>
            <Logo
              @name='Acme Studio'
              @variant={{if bar.collapsed 'mark' 'wordmark'}}
            />
          </:header>
          <:nav></:nav>
        </Sidebar>
      </template>,
    );
    let logos = document.querySelectorAll<HTMLElement>(
      '[data-test-pretui-sidebar-rail] [data-test-pretui-logo]',
    );
    assert.strictEqual(logos[0]?.dataset['variant'], 'wordmark');
    assert.strictEqual(logos[1]?.dataset['variant'], 'mark');
    assert.strictEqual(logos[1]?.textContent?.trim(), 'AS');
  });
});
