// Token unit tests. No assertion reads a computed style: the host test harness
// stamps the scoped-css attribute and delivers no stylesheet. What Token
// promises is its element, the `data-size` / `data-wrap` hooks the stylesheet
// sizes and wraps from, and the `--pretui-token-hue` property it paints from,
// so those are read off the DOM directly.
import { module, test } from 'qunit';
import { render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Token } from './token';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
// Caller styles as a card would pass them: a bound SafeString.
const WRAP_AND_BODY_STYLE = htmlSafe('white-space: normal; --text-body: 14px');
const MUTED_HUE_STYLE = htmlSafe('--pretui-token-hue: var(--muted-foreground)');

function hue(el: HTMLElement): string {
  return el.style.getPropertyValue('--pretui-token-hue').trim();
}

module('Pretui | components/token', function (hooks) {
  setupCardTest(hooks);

  test('renders as <code>, prefers @value, and carries an allowed hue', async function (assert) {
    await render(<template><Token @value='SKU-8812' @hue='var(--chart-2)'>ignored</Token></template>);
    let el = q('[data-test-pretui-token]');
    assert.strictEqual(el.tagName, 'CODE', 'a machine value is marked up as code');
    assert.strictEqual(el.textContent?.trim(), 'SKU-8812');
    assert.strictEqual(hue(el), 'var(--chart-2)');
  });

  test('falls back to its block', async function (assert) {
    await render(<template><Token>0x41</Token></template>);
    assert.strictEqual(q('[data-test-pretui-token]').textContent?.trim(), '0x41');
  });

  test('refuses a hue that carries its own declaration', async function (assert) {
    await render(<template><Token @value='x' @hue='red; background: url(https://example.com/x)' /></template>);
    let el = q('[data-test-pretui-token]');
    assert.strictEqual(hue(el), '', 'the hue is dropped whole');
    assert.notOk(el.getAttribute('style')?.includes('url('), 'nothing from the rejected value reaches the element');
  });

  test('@size sets the house size step, and its aliases land on the same step', async function (assert) {
    await render(
      <template>
        <Token @value='a' data-test-default />
        <Token @value='b' @size='xs' data-test-xs />
        <Token @value='c' @size='sm' data-test-sm />
        <Token @value='d' @size='large' data-test-large />
      </template>,
    );
    assert.false(
      q('[data-test-default]').hasAttribute('data-size'),
      'with no @size the size still follows --text-body',
    );
    assert.strictEqual(q('[data-test-xs]').dataset.size, 'xs');
    assert.strictEqual(q('[data-test-sm]').dataset.size, 's');
    assert.strictEqual(q('[data-test-large]').dataset.size, 'l');
  });

  test('@wrap lets a long value wrap', async function (assert) {
    await render(
      <template>
        <Token @value='a' data-test-nowrap />
        <Token @value='when status contains a long phrase' @wrap={{true}} data-test-wrap />
      </template>,
    );
    assert.false(q('[data-test-nowrap]').hasAttribute('data-wrap'), 'stays on one line by default');
    assert.strictEqual(q('[data-test-wrap]').dataset.wrap, 'true');
  });

  test("@hue survives a caller's style, which keeps its own declarations", async function (assert) {
    await render(
      <template>
        <Token @value='POL-7' @hue='var(--chart-3)' @size='xs' style={{WRAP_AND_BODY_STYLE}} />
      </template>,
    );
    let el = q('[data-test-pretui-token]');
    assert.strictEqual(hue(el), 'var(--chart-3)', 'the hue is still on the element');
    assert.strictEqual(el.style.whiteSpace, 'normal', "the caller's declarations are kept");
    assert.strictEqual(el.style.getPropertyValue('--text-body').trim(), '14px');
    assert.strictEqual(el.dataset.size, 'xs', 'the size does not depend on the style attribute at all');
  });

  test('a hue in the caller style still paints when @hue is not given', async function (assert) {
    await render(<template><Token @value='LOT-1' style={{MUTED_HUE_STYLE}} /></template>);
    assert.strictEqual(hue(q('[data-test-pretui-token]')), 'var(--muted-foreground)');
  });

  test("@hue survives a later change to the caller's style, and follows its own changes", async function (assert) {
    class State {
      @tracked style = htmlSafe('white-space: normal');
      @tracked hue: string | undefined = 'var(--chart-1)';
    }
    let state = new State();
    await render(<template><Token @value='REF-2' @hue={{state.hue}} style={{state.style}} /></template>);
    let el = q('[data-test-pretui-token]');
    assert.strictEqual(hue(el), 'var(--chart-1)');

    state.style = htmlSafe('white-space: nowrap; letter-spacing: 1px');
    await settled();
    assert.strictEqual(el.style.letterSpacing, '1px', 'the new caller style is applied');
    assert.strictEqual(hue(el), 'var(--chart-1)', 'the hue is put back after the caller style is rewritten');

    state.hue = 'var(--chart-4)';
    await settled();
    assert.strictEqual(hue(el), 'var(--chart-4)', 'a new @hue replaces the old one');

    state.hue = undefined;
    await settled();
    assert.strictEqual(hue(el), '', 'removing @hue removes the property');
    assert.strictEqual(el.style.letterSpacing, '1px', "the caller's style is left alone");
  });
});
