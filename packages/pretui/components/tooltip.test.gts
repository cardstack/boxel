// Pretui — Tooltip unit tests.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied). Layout assertions lean only on the popover UA styles.
import { module, test } from 'qunit';
import { tracked } from '@glimmer/tracking';
import {
  render,
  settled,
  click,
  focus,
  blur,
  triggerEvent,
  triggerKeyEvent,
} from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Tooltip } from './tooltip';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}

/** A box too small for the tip, so any space the tip takes shows as scroll. */
function smallScroller(overflow: 'auto' | 'hidden'): HTMLElement {
  let el = q('[data-test-scroller]');
  Object.assign(el.style, { width: '4rem', height: '4rem', overflow });
  return el;
}

module('Pretui | components/tooltip', function (hooks) {
  setupCardTest(hooks);

  test('Tooltip wires its bubble onto the trigger via aria-describedby', async function (assert) {
    await render(
      <template>
        <Tooltip @content='Publishes to the realm'>
          <button type='button' data-test-trigger>Publish</button>
        </Tooltip>
      </template>,
    );
    let tip = q('[role="tooltip"]');
    let trigger = q('[data-test-trigger]');
    assert.ok(tip.id, 'the bubble has an id to point at');
    assert.strictEqual(
      trigger.getAttribute('aria-describedby'),
      tip.id,
      'the trigger references it — a bubble nobody points at is announced to nobody',
    );
    assert.strictEqual(tip.textContent?.trim(), 'Publishes to the realm');
    assert.strictEqual(tip.dataset['open'], undefined, 'closed at rest');
    assert.strictEqual(tip.dataset['side'], 'top', 'top by default');
  });

  test('Tooltip names rather than describes when @labels is set', async function (assert) {
    await render(
      <template>
        <Tooltip @content='Delete' @labels={{true}}>
          <button type='button' data-test-trigger>✕</button>
        </Tooltip>
      </template>,
    );
    let trigger = q('[data-test-trigger]');
    assert.strictEqual(trigger.getAttribute('aria-labelledby'), q('[role="tooltip"]').id);
    assert.strictEqual(trigger.getAttribute('aria-describedby'), null, 'one relationship, not both');
  });

  test('Tooltip preserves a describedby the trigger already had', async function (assert) {
    await render(
      <template>
        <Tooltip @content='Extra'>
          <button type='button' data-test-trigger aria-describedby='existing-hint'>Go</button>
        </Tooltip>
        <span id='existing-hint'>hint</span>
      </template>,
    );
    assert.strictEqual(
      q('[data-test-trigger]').getAttribute('aria-describedby'),
      `existing-hint ${q('[role="tooltip"]').id}`,
      'appended, not overwritten',
    );
  });

  test('Tooltip keeps its id when the caller changes its own describedby', async function (assert) {
    class State {
      @tracked hint = 'first-hint';
    }
    let state = new State();
    await render(
      <template>
        <Tooltip @content='Extra'>
          <button type='button' data-test-trigger aria-describedby={{state.hint}}>Go</button>
        </Tooltip>
      </template>,
    );
    state.hint = 'second-hint';
    await settled();
    assert.strictEqual(
      q('[data-test-trigger]').getAttribute('aria-describedby'),
      `second-hint ${q('[role="tooltip"]').id}`,
      'the new value, with the tip id put back',
    );
  });

  test('Tooltip opens on hover and on focus, and closes again', async function (assert) {
    await render(
      <template>
        <Tooltip @content='Hint' @side='right'>
          <button type='button' data-test-trigger>Go</button>
        </Tooltip>
      </template>,
    );
    let wrap = q('[data-test-pretui-tooltip]');
    let tip = q('[role="tooltip"]');
    assert.strictEqual(tip.dataset['side'], 'right');

    await triggerEvent(wrap, 'mouseenter');
    assert.strictEqual(tip.dataset['open'], 'true', 'hover opens it');
    await triggerEvent(wrap, 'mouseleave');
    assert.strictEqual(tip.dataset['open'], undefined);

    await focus('[data-test-trigger]');
    assert.strictEqual(tip.dataset['open'], 'true', 'keyboard focus opens it too');
    await blur('[data-test-trigger]');
    assert.strictEqual(tip.dataset['open'], undefined);
  });

  test('Tooltip stays closed while @disabled, and opens once it clears', async function (assert) {
    class State {
      @tracked disabled = true;
    }
    let state = new State();
    await render(
      <template>
        <Tooltip @content='Hint' @disabled={{state.disabled}}>
          <button type='button' data-test-trigger>Go</button>
        </Tooltip>
      </template>,
    );
    let tip = q('[role="tooltip"]');
    await triggerEvent(q('[data-test-pretui-tooltip]'), 'mouseenter');
    assert.strictEqual(tip.dataset['open'], undefined, 'hover leaves it closed');
    assert.strictEqual(
      q('[data-test-trigger]').getAttribute('aria-describedby'),
      tip.id,
      'still describes its trigger',
    );

    state.disabled = false;
    await settled();
    assert.strictEqual(tip.dataset['open'], 'true', 'the hover still under way opens it');
  });

  test('Tooltip stays closed after a click once the pointer leaves', async function (assert) {
    await render(
      <template>
        <Tooltip @content='Hint'>
          <button type='button' data-test-trigger>Go</button>
        </Tooltip>
      </template>,
    );
    let wrap = q('[data-test-pretui-tooltip]');
    let tip = q('[role="tooltip"]');

    await triggerEvent(wrap, 'mouseenter');
    await click('[data-test-trigger]');
    assert.strictEqual(tip.dataset['open'], 'true', 'open while hovered');
    await triggerEvent(wrap, 'mouseleave');
    assert.strictEqual(document.activeElement, q('[data-test-trigger]'), 'the trigger keeps focus');
    assert.strictEqual(tip.dataset['open'], undefined, 'and the tip closes');

    await blur('[data-test-trigger]');
    await focus('[data-test-trigger]');
    assert.strictEqual(tip.dataset['open'], 'true', 'keyboard focus still opens it');
  });

  test('Tooltip is dismissible with Escape while the pointer stays put (WCAG 1.4.13)', async function (assert) {
    await render(
      <template>
        <Tooltip @content='Hint'>
          <button type='button' data-test-trigger>Go</button>
        </Tooltip>
      </template>,
    );
    let tip = q('[role="tooltip"]');
    await triggerEvent(q('[data-test-pretui-tooltip]'), 'mouseenter');
    assert.strictEqual(tip.dataset['open'], 'true');

    await triggerKeyEvent(document, 'keydown', 'Escape');
    assert.strictEqual(tip.dataset['open'], undefined, 'Escape hides it without moving the pointer');

    await triggerEvent(q('[data-test-pretui-tooltip]'), 'mouseleave');
    await triggerEvent(q('[data-test-pretui-tooltip]'), 'mouseenter');
    assert.strictEqual(tip.dataset['open'], 'true', 'leaving and returning arms it again');
  });

  test('Tooltip takes no space in its scroll container while hidden, on any side', async function (assert) {
    class State {
      @tracked side: 'top' | 'bottom' | 'left' | 'right' = 'top';
    }
    let state = new State();
    await render(
      <template>
        <div data-test-scroller>
          <Tooltip @content='Publishes everything in this workspace' @side={{state.side}}>
            <button type='button'>Go</button>
          </Tooltip>
        </div>
      </template>,
    );
    let scroller = smallScroller('auto');
    for (let side of ['top', 'bottom', 'left', 'right'] as const) {
      state.side = side;
      await settled();
      assert.strictEqual(scroller.scrollWidth, scroller.clientWidth, `${side}: no sideways scroll`);
      assert.strictEqual(scroller.scrollHeight, scroller.clientHeight, `${side}: no vertical scroll`);
    }
  });

  test('Tooltip shows in the top layer, outside its clipping container', async function (assert) {
    await render(
      <template>
        <div data-test-scroller>
          <Tooltip @content='Publishes everything in this workspace' @side='right'>
            <button type='button'>Go</button>
          </Tooltip>
        </div>
      </template>,
    );
    let scroller = smallScroller('hidden');
    let tip = q('[role="tooltip"]');
    assert.false(tip.matches(':popover-open'), 'not in the top layer while hidden');

    await triggerEvent(q('[data-test-pretui-tooltip]'), 'mouseenter');
    assert.true(tip.matches(':popover-open'), 'in the top layer while shown');
    assert.strictEqual(scroller.scrollWidth, scroller.clientWidth, 'and still adds nothing to the container');

    await triggerEvent(q('[data-test-pretui-tooltip]'), 'mouseleave');
    assert.false(tip.matches(':popover-open'), 'out of the top layer again');
  });

  test('Tooltip stays centered on its trigger when its content changes while shown', async function (assert) {
    class State {
      @tracked content = 'Copy';
    }
    let state = new State();
    await render(
      <template>
        <div data-test-stage>
          <Tooltip @content={{state.content}} @side='bottom'>
            <button type='button'>Go</button>
          </Tooltip>
        </div>
      </template>,
    );
    // Room on both sides, so the viewport clamp never moves the bubble.
    Object.assign(q('[data-test-stage]').style, { padding: '2rem 24rem' });
    let tip = q('[role="tooltip"]');
    // The placement rules the inert scoped style would apply over the popover UA styles.
    Object.assign(tip.style, { inset: 'auto', margin: '0' });
    let wrap = q('[data-test-pretui-tooltip]');
    await triggerEvent(wrap, 'mouseenter');

    state.content = 'Copied the link to this workspace';
    await settled();
    // A ResizeObserver reports after the next frame's animation callbacks.
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    let trigger = wrap.getBoundingClientRect();
    let bubble = tip.getBoundingClientRect();
    assert.ok(
      Math.abs(bubble.left + bubble.width / 2 - (trigger.left + trigger.width / 2)) < 1,
      'the longer tip is centered under the trigger',
    );
  });
});
