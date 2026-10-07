// Token unit tests. No assertion reads a computed style: the host test harness
// stamps the scoped-css attribute and delivers no stylesheet. What Token
// promises is its element, the `data-size` / `data-wrap` hooks the stylesheet
// sizes and wraps from, and the `--pretui-token-hue` property it paints from,
// so those are read off the DOM directly.
import { module, test } from 'qunit';
import { render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { setCssVar } from '@cardstack/boxel-ui/modifiers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Token } from './token';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
// Caller styles as a card would pass them: a bound SafeString.
const WRAP_AND_SIZE_STYLE = htmlSafe('white-space: normal; --pretui-token-font-size: 14px');
const MUTED_HUE_STYLE = htmlSafe('--pretui-token-hue: var(--muted-foreground)');
const WRAP_STYLE = htmlSafe('white-space: normal');

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
        <Token @value='e' @size='default' data-test-default-alias />
      </template>,
    );
    assert.false(
      q('[data-test-default]').hasAttribute('data-size'),
      'with no @size the size is the default one',
    );
    assert.strictEqual(q('[data-test-xs]').dataset.size, 'xs');
    assert.strictEqual(q('[data-test-sm]').dataset.size, 's');
    assert.strictEqual(q('[data-test-large]').dataset.size, 'l');
    assert.false(
      q('[data-test-default-alias]').hasAttribute('data-size'),
      "@size='default' means the same as leaving @size off",
    );
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
        <Token @value='POL-7' @hue='var(--chart-3)' @size='xs' style={{WRAP_AND_SIZE_STYLE}} />
      </template>,
    );
    let el = q('[data-test-pretui-token]');
    assert.strictEqual(hue(el), 'var(--chart-3)', 'the hue is still on the element');
    assert.strictEqual(el.style.whiteSpace, 'normal', "the caller's declarations are kept");
    assert.strictEqual(el.style.getPropertyValue('--pretui-token-font-size').trim(), '14px');
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

  test("@hue wins over a hue in the caller's style, which comes back when @hue is cleared", async function (assert) {
    class State {
      @tracked hue: string | undefined = 'var(--chart-2)';
    }
    let state = new State();
    await render(<template><Token @value='LOT-9' @hue={{state.hue}} style={{MUTED_HUE_STYLE}} /></template>);
    let el = q('[data-test-pretui-token]');
    assert.strictEqual(hue(el), 'var(--chart-2)', '@hue wins');

    state.hue = 'var(--chart-5)';
    await settled();
    assert.strictEqual(hue(el), 'var(--chart-5)', 'a new @hue still wins');

    state.hue = undefined;
    await settled();
    assert.strictEqual(hue(el), 'var(--muted-foreground)', "the caller's hue is back");
  });

  test("a caller's !important hue comes back !important when @hue is cleared", async function (assert) {
    class State {
      @tracked hue: string | undefined = 'var(--chart-2)';
    }
    let state = new State();
    let importantHueStyle = htmlSafe('--pretui-token-hue: var(--muted-foreground) !important');
    await render(<template><Token @value='LOT-9' @hue={{state.hue}} style={{importantHueStyle}} /></template>);
    let el = q('[data-test-pretui-token]');
    assert.strictEqual(hue(el), 'var(--chart-2)', '@hue wins');

    state.hue = undefined;
    await settled();
    assert.strictEqual(hue(el), 'var(--muted-foreground)', "the caller's hue is back");
    assert.strictEqual(el.style.getPropertyPriority('--pretui-token-hue'), 'important', 'with its !important');
  });

  test("a caller's hue that matches @hue stays when @hue is cleared", async function (assert) {
    class State {
      @tracked hue: string | undefined = 'var(--chart-2)';
    }
    let state = new State();
    let sameHueStyle = htmlSafe('--pretui-token-hue: var(--chart-2)');
    await render(<template><Token @value='LOT-3' @hue={{state.hue}} style={{sameHueStyle}} /></template>);
    let el = q('[data-test-pretui-token]');
    assert.strictEqual(hue(el), 'var(--chart-2)');

    state.hue = 'var(--chart-4)';
    await settled();
    assert.strictEqual(hue(el), 'var(--chart-4)', 'a new @hue wins');

    state.hue = undefined;
    await settled();
    assert.strictEqual(hue(el), 'var(--chart-2)', "the caller's own hue is still there");
  });

  test("a caller's rewrite to a new hue is the hue that comes back when @hue is cleared", async function (assert) {
    class State {
      @tracked style = MUTED_HUE_STYLE;
      @tracked hue: string | undefined = 'var(--chart-2)';
    }
    let state = new State();
    await render(<template><Token @value='LOT-4' @hue={{state.hue}} style={{state.style}} /></template>);
    let el = q('[data-test-pretui-token]');

    state.style = htmlSafe('--pretui-token-hue: var(--chart-6)');
    await settled();
    assert.strictEqual(hue(el), 'var(--chart-2)', '@hue still wins over the rewrite');

    state.hue = undefined;
    await settled();
    assert.strictEqual(hue(el), 'var(--chart-6)', "the caller's new hue, not its first one");
  });

  test("a caller's rewrite to the hue @hue already set is kept when @hue is cleared", async function (assert) {
    class State {
      @tracked style = MUTED_HUE_STYLE;
      @tracked hue: string | undefined = 'var(--chart-2)';
    }
    let state = new State();
    await render(<template><Token @value='LOT-5' @hue={{state.hue}} style={{state.style}} /></template>);
    let el = q('[data-test-pretui-token]');

    state.style = htmlSafe('--pretui-token-hue: var(--chart-2)');
    await settled();
    assert.strictEqual(hue(el), 'var(--chart-2)');

    state.hue = undefined;
    await settled();
    assert.strictEqual(hue(el), 'var(--chart-2)', "the caller's current hue, not the muted one it replaced");
  });

  test("a caller's rewrite spelled exactly as the element's current style still counts", async function (assert) {
    class State {
      @tracked style = MUTED_HUE_STYLE;
      @tracked hue: string | undefined = 'var(--chart-2)';
    }
    let state = new State();
    await render(<template><Token @value='LOT-6' @hue={{state.hue}} style={{state.style}} /></template>);
    let el = q('[data-test-pretui-token]');
    let written = el.getAttribute('style') ?? '';
    assert.true(written.includes('var(--chart-2)'), 'the element carries the @hue write');

    state.style = htmlSafe(written);
    await settled();
    state.hue = undefined;
    await settled();
    assert.strictEqual(hue(el), 'var(--chart-2)', "the rewrite is the caller's hue even though the attribute text did not change");
  });

  test("a caller's rewrite that adds @hue's value to its style is kept when @hue is cleared", async function (assert) {
    class State {
      @tracked style = WRAP_STYLE;
      @tracked hue: string | undefined = 'var(--chart-2)';
    }
    let state = new State();
    await render(<template><Token @value='LOT-13' @hue={{state.hue}} style={{state.style}} /></template>);
    let el = q('[data-test-pretui-token]');

    state.style = htmlSafe('white-space: normal; --pretui-token-hue: var(--chart-2)');
    await settled();
    state.hue = undefined;
    await settled();
    assert.strictEqual(hue(el), 'var(--chart-2)', "the hue the caller's style now sets");
  });

  test("a caller's rewrite that repeats @hue and changes another declaration is not told apart from another modifier's write", async function (assert) {
    class State {
      @tracked style = htmlSafe('white-space: normal; --pretui-token-hue: var(--muted-foreground)');
      @tracked hue: string | undefined = 'var(--chart-2)';
    }
    let state = new State();
    await render(<template><Token @value='LOT-14' @hue={{state.hue}} style={{state.style}} /></template>);
    let el = q('[data-test-pretui-token]');

    state.style = htmlSafe('white-space: nowrap; --pretui-token-hue: var(--chart-2)');
    await settled();
    assert.strictEqual(el.style.whiteSpace, 'nowrap');
    state.hue = undefined;
    await settled();
    assert.strictEqual(
      hue(el),
      'var(--muted-foreground)',
      "the known cost: the rewrite looks like a single-property write, so the caller's earlier hue comes back",
    );
  });

  test("a caller's rewrite in the same render that clears @hue is kept", async function (assert) {
    class State {
      @tracked style = MUTED_HUE_STYLE;
      @tracked hue: string | undefined = 'var(--chart-2)';
    }
    let state = new State();
    await render(<template><Token @value='LOT-7' @hue={{state.hue}} style={{state.style}} /></template>);
    let el = q('[data-test-pretui-token]');

    state.style = htmlSafe('--pretui-token-hue: var(--chart-2)');
    state.hue = undefined;
    await settled();
    assert.strictEqual(hue(el), 'var(--chart-2)', "the caller's new hue, not the muted one");
  });

  test('with no caller style, @hue changes and clears through Token\'s own style', async function (assert) {
    class State {
      @tracked hue: string | undefined = 'var(--chart-1)';
    }
    let state = new State();
    await render(<template><Token @value='LOT-8' @hue={{state.hue}} /></template>);
    let el = q('[data-test-pretui-token]');
    assert.strictEqual(hue(el), 'var(--chart-1)');

    state.hue = 'var(--chart-3)';
    await settled();
    assert.strictEqual(hue(el), 'var(--chart-3)');

    state.hue = undefined;
    await settled();
    assert.strictEqual(hue(el), '', 'no hue is left behind');
  });

  test('clearing @hue after another modifier writes to the style leaves no hue behind', async function (assert) {
    class State {
      @tracked hue: string | undefined = 'var(--chart-2)';
      @tracked ring = 'var(--chart-3)';
    }
    let state = new State();
    await render(
      <template>
        <Token @value='LOT-10' @hue={{state.hue}} style={{WRAP_STYLE}} {{setCssVar status-ring=state.ring}} />
      </template>,
    );
    let el = q('[data-test-pretui-token]');

    state.ring = 'var(--chart-4)';
    await settled();
    assert.strictEqual(
      el.style.getPropertyValue('--status-ring').trim(),
      'var(--chart-4)',
      'the other modifier wrote its property',
    );
    assert.strictEqual(hue(el), 'var(--chart-2)');

    state.hue = undefined;
    await settled();
    assert.strictEqual(hue(el), '', "Token's own hue is not mistaken for the caller's");
    assert.strictEqual(el.style.whiteSpace, 'normal', "the caller's style is left alone");
  });

  test("clearing @hue after another modifier writes to the style brings back the caller's hue", async function (assert) {
    class State {
      @tracked hue: string | undefined = 'var(--chart-2)';
      @tracked ring = 'var(--chart-3)';
    }
    let state = new State();
    await render(
      <template>
        <Token @value='LOT-11' @hue={{state.hue}} style={{MUTED_HUE_STYLE}} {{setCssVar status-ring=state.ring}} />
      </template>,
    );
    let el = q('[data-test-pretui-token]');

    state.ring = 'var(--chart-4)';
    await settled();
    assert.strictEqual(hue(el), 'var(--chart-2)', '@hue still wins');

    state.hue = undefined;
    await settled();
    assert.strictEqual(hue(el), 'var(--muted-foreground)', "the caller's hue, not Token's");
  });

  test("a new @hue after another modifier writes to the style does not keep the old @hue as the caller's", async function (assert) {
    class State {
      @tracked hue: string | undefined = 'var(--chart-2)';
      @tracked ring = 'var(--chart-3)';
    }
    let state = new State();
    await render(
      <template>
        <Token @value='LOT-12' @hue={{state.hue}} style={{MUTED_HUE_STYLE}} {{setCssVar status-ring=state.ring}} />
      </template>,
    );
    let el = q('[data-test-pretui-token]');

    state.ring = 'var(--chart-4)';
    await settled();
    state.hue = 'var(--chart-5)';
    await settled();
    assert.strictEqual(hue(el), 'var(--chart-5)', 'the new @hue wins');

    state.ring = 'var(--chart-6)';
    await settled();
    state.hue = undefined;
    await settled();
    assert.strictEqual(hue(el), 'var(--muted-foreground)', "neither @hue is mistaken for the caller's");
  });

  test('clearing @hue in the same render as another modifier\'s write leaves no hue behind', async function (assert) {
    class State {
      @tracked hue: string | undefined = 'var(--chart-2)';
      @tracked ring = 'var(--chart-3)';
    }
    let state = new State();
    await render(
      <template>
        <Token @value='LOT-15' @hue={{state.hue}} style={{WRAP_STYLE}} {{setCssVar status-ring=state.ring}} />
      </template>,
    );
    let el = q('[data-test-pretui-token]');
    assert.strictEqual(hue(el), 'var(--chart-2)');

    state.ring = 'var(--chart-4)';
    state.hue = undefined;
    await settled();
    assert.strictEqual(
      el.style.getPropertyValue('--status-ring').trim(),
      'var(--chart-4)',
      'the other modifier wrote its property in the same render',
    );
    assert.strictEqual(hue(el), '', "Token's own hue is not mistaken for the caller's");
  });

  test("clearing @hue in the same render as another modifier's write brings back the caller's hue", async function (assert) {
    class State {
      @tracked hue: string | undefined = 'var(--chart-2)';
      @tracked ring = 'var(--chart-3)';
    }
    let state = new State();
    await render(
      <template>
        <Token @value='LOT-16' @hue={{state.hue}} style={{MUTED_HUE_STYLE}} {{setCssVar status-ring=state.ring}} />
      </template>,
    );
    let el = q('[data-test-pretui-token]');

    state.ring = 'var(--chart-4)';
    state.hue = undefined;
    await settled();
    assert.strictEqual(hue(el), 'var(--muted-foreground)', "the caller's hue, not Token's");
  });

  test("a new @hue in the same render as another modifier's write does not keep the old @hue as the caller's", async function (assert) {
    class State {
      @tracked hue: string | undefined = 'var(--chart-2)';
      @tracked ring = 'var(--chart-3)';
    }
    let state = new State();
    await render(
      <template>
        <Token @value='LOT-17' @hue={{state.hue}} style={{MUTED_HUE_STYLE}} {{setCssVar status-ring=state.ring}} />
      </template>,
    );
    let el = q('[data-test-pretui-token]');

    state.ring = 'var(--chart-4)';
    state.hue = 'var(--chart-5)';
    await settled();
    assert.strictEqual(hue(el), 'var(--chart-5)', 'the new @hue wins');

    state.hue = undefined;
    await settled();
    assert.strictEqual(hue(el), 'var(--muted-foreground)', "neither @hue is mistaken for the caller's");
  });
});
