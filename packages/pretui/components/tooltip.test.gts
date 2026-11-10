// Pretui — Tooltip unit tests.
//
// No assertion depends on the component's own `<style scoped>`, which is inert
// in this harness (the scoped-css attribute is stamped, the rules are not
// applied). Layout assertions lean on the popover UA styles; a test that needs
// the component's placement rules sets them inline.
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

/** Waits n animation frames, by which resize and intersection observers have reported. */
function frames(n = 2): Promise<void> {
  return new Promise((done) => {
    let step = (left: number) =>
      left ? requestAnimationFrame(() => step(left - 1)) : done();
    step(n);
  });
}

/**
 * Gives the stage room on both sides, so the viewport clamp never moves the
 * bubble, and applies the placement rules the inert scoped style would set
 * over the popover UA styles.
 */
function stage(): HTMLElement {
  let el = q('[data-test-stage]');
  Object.assign(el.style, { padding: '2rem 24rem' });
  Object.assign(q('[data-test-pretui-tooltip-bubble]').style, {
    inset: 'auto',
    margin: '0',
  });
  return el;
}

/** How far the bubble's center is from its trigger's, horizontally. */
function offCenter(): number {
  let trigger = q('[data-test-pretui-tooltip]').getBoundingClientRect();
  let bubble = q('[data-test-pretui-tooltip-bubble]').getBoundingClientRect();
  return Math.abs(
    bubble.left + bubble.width / 2 - (trigger.left + trigger.width / 2),
  );
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
    let tip = q('[data-test-pretui-tooltip-bubble]');
    let trigger = q('[data-test-trigger]');
    assert.strictEqual(tip.getAttribute('role'), 'tooltip');
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
    assert.strictEqual(trigger.getAttribute('aria-labelledby'), q('[data-test-pretui-tooltip-bubble]').id);
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
      `existing-hint ${q('[data-test-pretui-tooltip-bubble]').id}`,
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
      `second-hint ${q('[data-test-pretui-tooltip-bubble]').id}`,
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
    let tip = q('[data-test-pretui-tooltip-bubble]');
    assert.strictEqual(tip.dataset['side'], 'right');

    await triggerEvent(wrap, 'mouseenter');
    assert.strictEqual(tip.dataset['open'], 'true', 'hover opens it');
    assert.strictEqual(tip.dataset['side'], 'right', 'on the side it asked for');
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
    let tip = q('[data-test-pretui-tooltip-bubble]');
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
    let tip = q('[data-test-pretui-tooltip-bubble]');

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
    let tip = q('[data-test-pretui-tooltip-bubble]');
    await triggerEvent(q('[data-test-pretui-tooltip]'), 'mouseenter');
    assert.strictEqual(tip.dataset['open'], 'true');

    await triggerKeyEvent(document, 'keydown', 'Escape');
    assert.strictEqual(tip.dataset['open'], undefined, 'Escape hides it without moving the pointer');

    await triggerEvent(q('[data-test-pretui-tooltip]'), 'mouseleave');
    await triggerEvent(q('[data-test-pretui-tooltip]'), 'mouseenter');
    assert.strictEqual(tip.dataset['open'], 'true', 'leaving and returning arms it again');
  });

  test('Tooltip stays dismissed when its trigger is clicked after Escape', async function (assert) {
    await render(
      <template>
        <Tooltip @content='Hint'>
          <button type='button' data-test-trigger>Go</button>
        </Tooltip>
      </template>,
    );
    let tip = q('[data-test-pretui-tooltip-bubble]');
    await triggerEvent(q('[data-test-pretui-tooltip]'), 'mouseenter');
    await triggerKeyEvent(document, 'keydown', 'Escape');
    assert.strictEqual(tip.dataset['open'], undefined, 'Escape hides it');

    await click('[data-test-trigger]');
    assert.strictEqual(tip.dataset['open'], undefined, 'a click on the trigger keeps it hidden');
  });

  test('Tooltip takes no space in its scroll container while hidden', async function (assert) {
    await render(
      <template>
        <div data-test-scroller>
          <Tooltip @content='Publishes everything in this workspace'>
            <button type='button'>Go</button>
          </Tooltip>
        </div>
      </template>,
    );
    let scroller = smallScroller('auto');
    assert.strictEqual(scroller.scrollWidth, scroller.clientWidth, 'no sideways scroll');
    assert.strictEqual(scroller.scrollHeight, scroller.clientHeight, 'no vertical scroll');
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
    let tip = q('[data-test-pretui-tooltip-bubble]');
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
    stage();
    await triggerEvent(q('[data-test-pretui-tooltip]'), 'mouseenter');
    // Let the observers' first reports pass, so only the bubble's resize
    // can place it again.
    await frames();

    state.content = 'Copied the link to this workspace';
    await settled();
    await frames();
    assert.ok(offCenter() < 1, 'the longer tip is centered under the trigger');
  });

  test('Tooltip flips to the opposite side when its own has no room, and data-side says so', async function (assert) {
    await render(
      <template>
        <Tooltip @content='Copy the link' @side='top'>
          <button type='button'>Go</button>
        </Tooltip>
      </template>,
    );
    let tip = q('[data-test-pretui-tooltip-bubble]');
    let trigger = q('[data-test-pretui-tooltip]');
    // Too tall to fit above the trigger; the placement rules the inert
    // scoped style would set over the popover UA styles.
    Object.assign(tip.style, {
      inset: 'auto',
      margin: '0',
      boxSizing: 'border-box',
      height: `${Math.ceil(trigger.getBoundingClientRect().top)}px`,
    });
    assert.strictEqual(tip.dataset['side'], 'top', 'closed, it gives the side it prefers');
    let box = trigger.getBoundingClientRect();
    // Room below for that height plus the 6px gap.
    assert.ok(window.innerHeight - box.bottom > box.top + 8, 'there is room for it below');

    await triggerEvent(trigger, 'mouseenter');
    assert.ok(
      tip.getBoundingClientRect().top >= trigger.getBoundingClientRect().bottom,
      'it opened below the trigger',
    );
    assert.strictEqual(tip.dataset['side'], 'bottom', 'open, it gives the side it opened on');
  });

  test('Tooltip stays beside its trigger while the trigger scrolls in view', async function (assert) {
    await render(
      <template>
        <div data-test-scroller>
          <div data-test-spacer='above'></div>
          <Tooltip @content='Copy the link' @side='bottom'>
            <button type='button'>Go</button>
          </Tooltip>
          <div data-test-spacer='below'></div>
        </div>
      </template>,
    );
    let scroller = q('[data-test-scroller]');
    Object.assign(scroller.style, { height: '12rem', overflow: 'auto' });
    q('[data-test-spacer="above"]').style.height = '6rem';
    q('[data-test-spacer="below"]').style.height = '40rem';
    scroller.scrollIntoView();
    let tip = q('[data-test-pretui-tooltip-bubble]');
    Object.assign(tip.style, { inset: 'auto', margin: '0' });
    let trigger = q('[data-test-pretui-tooltip]');
    let gap = () =>
      tip.getBoundingClientRect().top - trigger.getBoundingClientRect().bottom;
    await triggerEvent(trigger, 'mouseenter');
    await frames();
    let before = gap();

    // Measured in the scroller's own scroll event, which reaches this
    // listener after the tooltip's capture-phase one: other scrolls in the
    // runner's page could otherwise re-place the tip first.
    let during: number | undefined;
    scroller.addEventListener('scroll', () => (during = gap()), { once: true });
    // Half the space above the trigger, so it moves but stays in view.
    scroller.scrollTop = 48;
    await frames();
    assert.notStrictEqual(during, undefined, 'the scroller scrolled');
    assert.ok(Math.abs((during ?? NaN) - before) < 1, 'the tip moved with its trigger');
  });

  test('Tooltip stays centered on its trigger when the trigger changes size while shown', async function (assert) {
    class State {
      @tracked label = 'Go';
    }
    let state = new State();
    await render(
      <template>
        <div data-test-stage>
          <Tooltip @content='Copy' @side='bottom'>
            <button type='button'>{{state.label}}</button>
          </Tooltip>
        </div>
      </template>,
    );
    stage();
    // The wrapper's display the inert scoped style would set; an inline box
    // reports no size changes.
    q('[data-test-pretui-tooltip]').style.display = 'inline-flex';
    await triggerEvent(q('[data-test-pretui-tooltip]'), 'mouseenter');
    await frames();

    state.label = 'A much longer trigger label than before';
    await settled();
    await frames();
    assert.ok(offCenter() < 1, 'centered under the wider trigger');
  });

  test('Tooltip hides while its trigger is scrolled out of view', async function (assert) {
    await render(
      <template>
        <div data-test-scroller>
          <Tooltip @content='Copy the link' @side='bottom'>
            <button type='button' data-test-trigger>Go</button>
          </Tooltip>
          <div data-test-spacer></div>
        </div>
      </template>,
    );
    let scroller = smallScroller('auto');
    q('[data-test-spacer]').style.height = '40rem';
    // The observer measures against the viewport, wherever the runner puts
    // its container.
    scroller.scrollIntoView();
    let tip = q('[data-test-pretui-tooltip-bubble]');
    let visible = () => tip.checkVisibility({ visibilityProperty: true });
    await triggerEvent(q('[data-test-pretui-tooltip]'), 'mouseenter');
    await frames();
    assert.true(visible(), 'visible beside its trigger');

    scroller.scrollTop = scroller.scrollHeight;
    await frames(3);
    assert.true(tip.matches(':popover-open'), 'still open');
    assert.false(visible(), 'but hidden while the trigger is out of view');

    let escapes = 0;
    let count = (e: KeyboardEvent) => {
      if (e.key === 'Escape') escapes++;
    };
    document.addEventListener('keydown', count);
    await triggerKeyEvent('[data-test-trigger]', 'keydown', 'Escape');
    document.removeEventListener('keydown', count);
    assert.strictEqual(escapes, 1, 'Escape passes to the page while the tip is out of sight');

    scroller.scrollTop = 0;
    await frames(3);
    assert.true(visible(), 'and back once the trigger is');

    scroller.scrollTop = scroller.scrollHeight;
    await frames(3);
    await triggerEvent(q('[data-test-pretui-tooltip]'), 'mouseleave');
    scroller.scrollTop = 0;
    await frames(3);
    await triggerEvent(q('[data-test-pretui-tooltip]'), 'mouseenter');
    assert.true(visible(), 'a tip that closed while hidden opens visible');
  });

  test('Tooltip closes as dismissed when its trigger moves in the DOM', async function (assert) {
    class State {
      @tracked items = ['first', 'second'];
    }
    let state = new State();
    await render(
      <template>
        {{#each state.items key='@identity' as |item|}}
          <Tooltip @content={{item}} data-test-item={{item}}>
            <button type='button'>{{item}}</button>
          </Tooltip>
        {{/each}}
      </template>,
    );
    // Removing a showing popover from the document closes it, and a keyed
    // swap detaches one of the two items to reorder them.
    let wrap = q('[data-test-item="first"]');
    let tip = wrap.querySelector('[data-test-pretui-tooltip-bubble]') as HTMLElement;
    await triggerEvent(wrap, 'mouseenter');
    assert.true(tip.matches(':popover-open'), 'open on hover');

    let detached = false;
    let moves = new MutationObserver((records) => {
      detached ||= records.some((r) => [...r.removedNodes].includes(wrap));
    });
    moves.observe(wrap.parentNode!, { childList: true });
    state.items = ['second', 'first'];
    await settled();
    moves.takeRecords().forEach((r) => {
      detached ||= [...r.removedNodes].includes(wrap);
    });
    moves.disconnect();
    assert.true(detached, 'the hovered trigger was moved, not its neighbor');
    await frames();
    await settled();
    assert.strictEqual(tip.dataset['open'], undefined, 'its tip closes as dismissed');
    assert.false(tip.matches(':popover-open'), 'out of the top layer');

    await triggerEvent(wrap, 'mouseleave');
    await triggerEvent(wrap, 'mouseenter');
    assert.true(tip.matches(':popover-open'), 'and the next hover opens it');
  });

  test('Tooltip opens on keyboard focus after its trigger moved and closed it', async function (assert) {
    class State {
      @tracked items = ['first', 'second'];
    }
    let state = new State();
    await render(
      <template>
        {{#each state.items key='@identity' as |item|}}
          <Tooltip @content={{item}} data-test-item={{item}}>
            <button type='button' data-test-button={{item}}>{{item}}</button>
          </Tooltip>
        {{/each}}
      </template>,
    );
    let wrap = q('[data-test-item="first"]');
    let tip = wrap.querySelector('[data-test-pretui-tooltip-bubble]') as HTMLElement;
    await triggerEvent(wrap, 'mouseenter');
    state.items = ['second', 'first'];
    await settled();
    await frames();
    await settled();
    assert.strictEqual(tip.dataset['open'], undefined, 'closed by the move');

    // No mouseleave or focusout clears the dismissal; keyboard focus arriving
    // from outside does.
    await focus('[data-test-button="first"]');
    assert.true(tip.matches(':popover-open'), 'keyboard focus from outside opens it again');
  });
});
