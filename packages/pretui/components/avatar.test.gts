// Avatar unit tests for its size and hue next to a caller's `style`. No
// assertion reads a computed style: the host test harness stamps the
// scoped-css attribute and delivers no stylesheet. What Avatar promises is the
// `--pretui-avatar-size` and `--pretui-chip-hue` properties the stylesheet
// sizes and paints from, so those are read off the DOM directly.
import { module, test } from 'qunit';
import { render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { setCssVar } from '@cardstack/boxel-ui/modifiers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Avatar } from './avatar';
import { statusHue } from '../internal/ink';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function size(el: HTMLElement): string {
  return el.style.getPropertyValue('--pretui-avatar-size').trim();
}
function hue(el: HTMLElement): string {
  return el.style.getPropertyValue('--pretui-chip-hue').trim();
}
// Caller styles as a card would pass them: a bound SafeString.
const RING_STYLE = htmlSafe('--status-ring: var(--chart-2); margin: 2px');
const CALLER_HUE_STYLE = htmlSafe('--pretui-chip-hue: var(--muted-foreground)');
const CALLER_SIZE_STYLE = htmlSafe('--pretui-avatar-size: 3rem');

module('Pretui | components/avatar', function (hooks) {
  setupCardTest(hooks);

  test('@size is written as rem, and no size is written without it', async function (assert) {
    await render(
      <template>
        <Avatar @name='Ada Lovelace' data-test-default />
        <Avatar @name='Ada Lovelace' @size={{40}} data-test-40 />
        <Avatar @name='Ada Lovelace' @size={{28}} data-test-28 />
        <Avatar @name='Ada Lovelace' @size={{0}} data-test-zero />
      </template>,
    );
    let plain = q('[data-test-default]');
    assert.strictEqual(
      size(plain),
      '',
      'without @size the stylesheet default (1.5rem) applies, so a class or container query can set the size',
    );
    assert.notOk(
      plain.getAttribute('style')?.includes('px'),
      'no px size is written inline',
    );
    assert.strictEqual(size(q('[data-test-40]')), '2.5rem', '40px at a 16px root');
    assert.strictEqual(size(q('[data-test-28]')), '1.75rem');
    assert.strictEqual(size(q('[data-test-zero]')), '', 'a zero size falls back to the default');
  });

  test("the size and the name's hue survive a caller's style, which keeps its own declarations", async function (assert) {
    await render(
      <template>
        <Avatar @name='Grace Hopper' @size={{52}} style={{RING_STYLE}} />
      </template>,
    );
    let el = q('[data-test-pretui-avatar]');
    assert.strictEqual(size(el), '3.25rem', 'the size is still on the element');
    assert.strictEqual(hue(el), statusHue('Grace Hopper'), 'the hue is still the name hash');
    assert.strictEqual(
      el.style.getPropertyValue('--status-ring').trim(),
      'var(--chart-2)',
      "the caller's declarations are kept",
    );
    assert.strictEqual(el.style.margin, '2px');
  });

  test("@hue survives a caller's style", async function (assert) {
    await render(
      <template>
        <Avatar @name='Ada' @hue='var(--primary-ink)' style={{RING_STYLE}} />
      </template>,
    );
    assert.strictEqual(hue(q('[data-test-pretui-avatar]')), 'var(--primary-ink)');
  });

  test("a hue in the caller's style wins over the name's hue when @hue is not given", async function (assert) {
    await render(<template><Avatar @name='Ada' style={{CALLER_HUE_STYLE}} /></template>);
    assert.strictEqual(hue(q('[data-test-pretui-avatar]')), 'var(--muted-foreground)');
  });

  test("@hue wins over a hue in the caller's style, which comes back when @hue is cleared", async function (assert) {
    class State {
      @tracked hue: string | undefined = 'var(--chart-2)';
    }
    let state = new State();
    await render(<template><Avatar @name='Ada' @hue={{state.hue}} style={{CALLER_HUE_STYLE}} /></template>);
    let el = q('[data-test-pretui-avatar]');
    assert.strictEqual(hue(el), 'var(--chart-2)', '@hue wins');

    state.hue = 'var(--chart-4)';
    await settled();
    assert.strictEqual(hue(el), 'var(--chart-4)', 'a new @hue still wins');

    state.hue = undefined;
    await settled();
    assert.strictEqual(hue(el), 'var(--muted-foreground)', "the caller's hue is back");
  });

  test("@size wins over a size in the caller's style, which comes back when @size is cleared", async function (assert) {
    class State {
      @tracked size: number | undefined = 40;
      @tracked style = CALLER_SIZE_STYLE;
    }
    let state = new State();
    await render(<template><Avatar @name='Ada' @size={{state.size}} style={{state.style}} /></template>);
    let el = q('[data-test-pretui-avatar]');
    assert.strictEqual(size(el), '2.5rem', '@size wins');

    state.size = undefined;
    await settled();
    assert.strictEqual(size(el), '3rem', "the caller's size is back");

    state.size = 40;
    await settled();
    assert.strictEqual(size(el), '2.5rem', '@size wins again');

    state.style = htmlSafe('--pretui-avatar-size: 2.5rem');
    state.size = undefined;
    await settled();
    assert.strictEqual(
      size(el),
      '2.5rem',
      "a caller style rewritten in the same render that clears @size is kept, not replaced by the caller's earlier size",
    );
  });

  test("clearing @size after another modifier writes to the style leaves no size behind", async function (assert) {
    class State {
      @tracked size: number | undefined = 40;
      @tracked ring = 'var(--chart-3)';
    }
    let state = new State();
    await render(
      <template>
        <Avatar
          @name='Ada'
          @size={{state.size}}
          style={{RING_STYLE}}
          {{setCssVar status-ring=state.ring}}
        />
      </template>,
    );
    let el = q('[data-test-pretui-avatar]');

    state.ring = 'var(--chart-4)';
    await settled();
    assert.strictEqual(
      el.style.getPropertyValue('--status-ring').trim(),
      'var(--chart-4)',
      'the other modifier wrote its property',
    );
    assert.strictEqual(size(el), '2.5rem');

    state.size = undefined;
    await settled();
    assert.strictEqual(size(el), '', "Avatar's own size is not mistaken for the caller's");
  });

  test("a @name change after another modifier writes to the style moves the hue to the new name", async function (assert) {
    class State {
      @tracked name = 'Ada Lovelace';
      @tracked ring = 'var(--chart-3)';
    }
    let state = new State();
    await render(
      <template>
        <Avatar
          @name={{state.name}}
          style={{RING_STYLE}}
          {{setCssVar status-ring=state.ring}}
        />
      </template>,
    );
    let el = q('[data-test-pretui-avatar]');
    state.ring = 'var(--chart-4)';
    await settled();
    assert.notStrictEqual(statusHue('Ada Lovelace'), statusHue('Alan Turing'), 'the two names hash to different hues');
    assert.strictEqual(hue(el), statusHue('Ada Lovelace'));

    state.name = 'Alan Turing';
    await settled();
    assert.strictEqual(hue(el), statusHue('Alan Turing'), "the previous name's hue is not mistaken for the caller's");
  });

  test("clearing @size in the same render as another modifier's write leaves no size behind", async function (assert) {
    class State {
      @tracked size: number | undefined = 40;
      @tracked ring = 'var(--chart-3)';
    }
    let state = new State();
    await render(
      <template>
        <Avatar
          @name='Ada'
          @size={{state.size}}
          style={{RING_STYLE}}
          {{setCssVar status-ring=state.ring}}
        />
      </template>,
    );
    let el = q('[data-test-pretui-avatar]');
    assert.strictEqual(size(el), '2.5rem');

    state.ring = 'var(--chart-4)';
    state.size = undefined;
    await settled();
    assert.strictEqual(
      el.style.getPropertyValue('--status-ring').trim(),
      'var(--chart-4)',
      'the other modifier wrote its property in the same render',
    );
    assert.strictEqual(size(el), '', "Avatar's own size is not mistaken for the caller's");
  });

  test("a @size change in the same render as another modifier's write does not keep the old size as the caller's", async function (assert) {
    class State {
      @tracked size: number | undefined = 40;
      @tracked ring = 'var(--chart-3)';
    }
    let state = new State();
    await render(
      <template>
        <Avatar
          @name='Ada'
          @size={{state.size}}
          style={{RING_STYLE}}
          {{setCssVar status-ring=state.ring}}
        />
      </template>,
    );
    let el = q('[data-test-pretui-avatar]');

    state.ring = 'var(--chart-4)';
    state.size = 48;
    await settled();
    assert.strictEqual(size(el), '3rem', 'the new @size wins');

    state.size = undefined;
    await settled();
    assert.strictEqual(size(el), '', 'neither @size is left behind');
  });

  test("a @name change in the same render as another modifier's write moves the hue to the new name", async function (assert) {
    class State {
      @tracked name = 'Ada Lovelace';
      @tracked ring = 'var(--chart-3)';
    }
    let state = new State();
    await render(
      <template>
        <Avatar
          @name={{state.name}}
          style={{RING_STYLE}}
          {{setCssVar status-ring=state.ring}}
        />
      </template>,
    );
    let el = q('[data-test-pretui-avatar]');
    assert.strictEqual(hue(el), statusHue('Ada Lovelace'));

    state.ring = 'var(--chart-4)';
    state.name = 'Alan Turing';
    await settled();
    assert.strictEqual(hue(el), statusHue('Alan Turing'), "the previous name's hue is not mistaken for the caller's");
  });

  test("a caller's rewrite to the size @size set is the size that comes back when @size is cleared", async function (assert) {
    class State {
      @tracked size: number | undefined = 40;
      @tracked style = CALLER_SIZE_STYLE;
    }
    let state = new State();
    await render(<template><Avatar @name='Ada' @size={{state.size}} style={{state.style}} /></template>);
    let el = q('[data-test-pretui-avatar]');

    state.style = htmlSafe('--pretui-avatar-size: 2.5rem');
    await settled();
    assert.strictEqual(size(el), '2.5rem');

    state.size = undefined;
    await settled();
    assert.strictEqual(size(el), '2.5rem', "the caller's current size, not the 3rem it replaced");
  });

  test("a caller's rewrite that repeats Avatar's size and hue exactly, and nothing else, is the caller's", async function (assert) {
    class State {
      @tracked size: number | undefined = 40;
      @tracked style = CALLER_SIZE_STYLE;
    }
    let state = new State();
    await render(<template><Avatar @name='Ada' @size={{state.size}} style={{state.style}} /></template>);
    let el = q('[data-test-pretui-avatar]');

    state.style = htmlSafe(`--pretui-avatar-size: 2.5rem; --pretui-chip-hue: ${statusHue('Ada')}`);
    await settled();
    state.size = undefined;
    await settled();
    assert.strictEqual(size(el), '2.5rem', 'a rewrite that changes no declaration is still a rewrite');
  });

  test("a caller's rewrite that repeats Avatar's size and hue exactly and changes another declaration is not told apart from another modifier's write", async function (assert) {
    class State {
      @tracked size: number | undefined = 40;
      @tracked style = CALLER_SIZE_STYLE;
    }
    let state = new State();
    await render(<template><Avatar @name='Ada' @size={{state.size}} style={{state.style}} /></template>);
    let el = q('[data-test-pretui-avatar]');

    state.style = htmlSafe(`--pretui-avatar-size: 2.5rem; --pretui-chip-hue: ${statusHue('Ada')}; margin: 2px`);
    await settled();
    assert.strictEqual(el.style.margin, '2px');
    state.size = undefined;
    await settled();
    assert.strictEqual(
      size(el),
      '3rem',
      "the known cost: the rewrite looks like a single-property write, so the caller's earlier size comes back",
    );
  });

  test("the size and hue are put back after a later change to the caller's style", async function (assert) {
    class State {
      @tracked style = RING_STYLE;
    }
    let state = new State();
    await render(<template><Avatar @name='Alan Turing' @size={{36}} style={{state.style}} /></template>);
    let el = q('[data-test-pretui-avatar]');

    state.style = htmlSafe('--status-ring: var(--chart-5); letter-spacing: 1px');
    await settled();
    assert.strictEqual(el.style.letterSpacing, '1px', 'the new caller style is applied');
    assert.strictEqual(size(el), '2.25rem', 'the size is put back');
    assert.strictEqual(hue(el), statusHue('Alan Turing'), 'the hue is put back');

    state.style = CALLER_HUE_STYLE;
    await settled();
    assert.strictEqual(hue(el), 'var(--muted-foreground)', 'a hue the caller adds later wins over the name hash');
    assert.strictEqual(size(el), '2.25rem');
  });

  test("with no caller style, @size and @hue change and clear through Avatar's own style", async function (assert) {
    class State {
      @tracked size: number | undefined = 40;
      @tracked hue: string | undefined = 'var(--chart-1)';
    }
    let state = new State();
    await render(<template><Avatar @name='Ada' @size={{state.size}} @hue={{state.hue}} /></template>);
    let el = q('[data-test-pretui-avatar]');
    assert.strictEqual(size(el), '2.5rem');
    assert.strictEqual(hue(el), 'var(--chart-1)');

    state.size = 48;
    state.hue = 'var(--chart-3)';
    await settled();
    assert.strictEqual(size(el), '3rem');
    assert.strictEqual(hue(el), 'var(--chart-3)');

    state.size = undefined;
    state.hue = undefined;
    await settled();
    assert.strictEqual(size(el), '', 'no size is left behind');
    assert.strictEqual(hue(el), statusHue('Ada'), 'the hue goes back to the name hash');
  });

  test('refuses a hue outside the CSS value allowlist', async function (assert) {
    await render(<template><Avatar @name='Ada' @hue='url(https://example.com/x)' style={{RING_STYLE}} /></template>);
    let el = q('[data-test-pretui-avatar]');
    assert.strictEqual(hue(el), '', 'the hue is dropped whole');
    assert.notOk(el.getAttribute('style')?.includes('url('), 'nothing from the rejected value reaches the element');
  });
});
