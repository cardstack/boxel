// Pretui — SearchInput unit tests: the collapsed display.
//
// The component's own `<style scoped>` is inert in this harness, so the
// geometry tests inject a stylesheet that stands in for its rules.
import { module, test } from 'qunit';
import {
  render,
  click,
  fillIn,
  triggerKeyEvent,
  focus,
  waitUntil,
  settled,
} from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { SearchInput } from './search-input';
import { positionPopup } from '../internal/overlay';

function root(): HTMLElement {
  return document.querySelector(
    '[data-test-pretui-search-input]',
  ) as HTMLElement;
}
function toggle(): HTMLButtonElement | null {
  return root().querySelector('[data-test-pretui-search-toggle]');
}
function input(): HTMLInputElement | null {
  return root().querySelector('input');
}
// Popover's panel; anchorTo positions the layer around it
function panel(): HTMLElement | null {
  return root().querySelector('[role="dialog"]');
}
function layer(): HTMLElement {
  return panel()?.parentElement as HTMLElement;
}
// the anchor anchorTo measures: the layer's parent
function anchorRect(): DOMRect {
  return (layer().parentElement as HTMLElement).getBoundingClientRect();
}
// Popover's backdrop is out of the tab order
function focusables(): HTMLElement[] {
  return [
    ...root().querySelectorAll<HTMLElement>(
      'button:not([tabindex="-1"]), input',
    ),
  ];
}
// the left/top anchorTo wrote, against the square it measured on open
function placed() {
  let p = layer();
  return {
    left: parseFloat(p.style.left),
    top: parseFloat(p.style.top),
    width: p.getBoundingClientRect().width,
  };
}
// the harness applies no scoped styles, so geometry tests stand in the box
// the component's own rules give: a fixed panel over a fixed-size square,
// in an unscaled test container (a transform would re-anchor the fixed panel)
const GEOMETRY = `#ember-testing { transform: none !important; zoom: 1 !important; }
  [data-test-pretui-popover] { display: grid; inline-size: 32px; block-size: 32px; }
  [data-test-pretui-popover] > span > span { position: fixed; display: block; }
  [data-test-pretui-popover] [aria-label='Close'] { position: fixed; inset: 0; }
  [data-test-pretui-search-toggle] { inline-size: 100%; block-size: 100%; }
  [data-test-pad] { padding: 2rem; }
  [data-test-scroller] { block-size: 6rem; overflow: auto; }
  [data-test-spacer] { block-size: 3rem; }
  [data-test-tail] { block-size: 20rem; }
  [data-test-pretui-search-input] [role='dialog'] { display: block; inline-size: 240px; }`;
async function openOver(): Promise<DOMRect> {
  await click(toggle() as HTMLElement);
  return anchorRect();
}

module('Pretui | components/search-input', function (hooks) {
  setupCardTest(hooks);
  let sheet: HTMLStyleElement;
  hooks.beforeEach(function () {
    sheet = document.head.appendChild(document.createElement('style'));
    sheet.textContent = GEOMETRY;
  });
  hooks.afterEach(function () {
    sheet.remove();
  });

  test('the default field has no toggle', async function (assert) {
    await render(
      <template><SearchInput @placeholder='Search tasks' /></template>,
    );
    assert.ok(input());
    assert.notOk(toggle());
  });

  test("@display 'collapsed' opens on click, keeps the value, and Escape returns focus", async function (assert) {
    let seen: string[] = [];
    let onInput = (v: string) => seen.push(v);
    await render(
      <template>
        <SearchInput
          @display='collapsed'
          @placeholder='Search tasks'
          @onInput={{onInput}}
        />
      </template>,
    );
    assert.notOk(input(), 'only the square shows');
    assert.strictEqual(toggle()?.getAttribute('aria-label'), 'Search tasks');

    await click(toggle() as HTMLElement);
    assert.strictEqual(
      document.activeElement,
      input(),
      'the field opens focused',
    );
    assert.strictEqual(
      panel()?.getAttribute('aria-label'),
      'Search tasks',
      'the panel is named too',
    );
    await fillIn(input() as HTMLInputElement, 'bug');
    assert.deepEqual(seen, ['bug']);

    await triggerKeyEvent(input() as HTMLInputElement, 'keydown', 'Escape');
    await waitUntil(() => document.activeElement === toggle());
    assert.notOk(input(), 'Escape collapses it');
    assert.strictEqual(
      document.activeElement,
      toggle(),
      'focus is back on the square',
    );
    assert.strictEqual(
      toggle()?.getAttribute('aria-label'),
      'Search tasks: bug',
      'the name carries the value',
    );

    await click(toggle() as HTMLElement);
    assert.strictEqual(
      input()?.value,
      'bug',
      'the value survives the round trip',
    );
  });

  test("@display 'collapsed' stays closed when focused and opens on click only", async function (assert) {
    await render(<template><SearchInput @display='collapsed' /></template>);
    await focus(toggle() as HTMLElement);
    assert.strictEqual(input(), null, 'focus alone does not open it');
    await click(toggle() as HTMLElement);
    assert.ok(input(), 'a click does');
  });

  test('Escape does not bubble past the open field', async function (assert) {
    let seen = false;
    let spy = () => (seen = true);
    document.addEventListener('keydown', spy);
    try {
      await render(<template><SearchInput @display='collapsed' /></template>);
      await click(toggle() as HTMLElement);
      await triggerKeyEvent(input() as HTMLInputElement, 'keydown', 'Escape');
      assert.false(seen, 'the Escape stops at the field');
    } finally {
      document.removeEventListener('keydown', spy);
    }
  });

  test('clear keeps focus in the field', async function (assert) {
    await render(<template><SearchInput @value='bug' /></template>);
    await click('[data-test-pretui-search-clear]');
    assert.strictEqual(document.activeElement, input(), 'default field');
  });

  test('the input is named from its placeholder', async function (assert) {
    await render(
      <template><SearchInput @placeholder='Search tasks' /></template>,
    );
    assert.strictEqual(input()?.getAttribute('aria-label'), 'Search tasks');
  });

  test("@display 'collapsed' keeps @controlId on the toggle, so a label still names it", async function (assert) {
    await render(
      <template>
        <label for='task-search'>Tasks</label>
        <SearchInput @display='collapsed' @controlId='task-search' />
      </template>,
    );
    assert.strictEqual(toggle()?.id, 'task-search');
    assert.notOk(
      toggle()?.hasAttribute('aria-label'),
      'the label, not an aria-label, names it',
    );
  });
  test('the open field lies over the square toward the inline end', async function (assert) {
    await render(
      <template>
        <div data-test-pad><SearchInput
            @display='collapsed'
            @value='bug'
          /></div>
      </template>,
    );
    let square = await openOver();
    let p = placed();
    assert.true(Math.abs(p.left - square.left) < 1, 'starts at the square');
    assert.true(
      Math.abs(p.top - square.top) < 1,
      'on the square, not below it',
    );
  });

  test('RTL: the open field ends at the square, opening leftward', async function (assert) {
    await render(
      <template>
        <div dir='rtl' data-test-pad><SearchInput
            @display='collapsed'
            @value='bug'
          /></div>
      </template>,
    );
    let square = await openOver();
    let p = placed();
    assert.true(
      Math.abs(p.left + p.width - square.right) < 1,
      'its inline start is the square',
    );
  });

  test('the open field follows the square on scroll and resize', async function (assert) {
    await render(
      <template>
        <div data-test-scroller>
          <div data-test-spacer></div><SearchInput @display='collapsed' /><div
            data-test-tail
          ></div>
        </div>
      </template>,
    );
    let before = await openOver();
    let scroller = document.querySelector(
      '[data-test-scroller]',
    ) as HTMLElement;
    scroller.scrollTop = 24;
    scroller.dispatchEvent(new Event('scroll'));
    await settled();
    let anchor = anchorRect();
    assert.true(anchor.top < before.top, 'the square moved');
    assert.true(
      Math.abs(placed().top - anchor.top) < 1,
      'moved with the scroll',
    );
    window.dispatchEvent(new Event('resize'));
    await settled();
    assert.true(
      Math.abs(placed().top - anchor.top) < 1,
      'still on the square after a resize',
    );
  });

  test('the open field is never wider than the roomier side of the square', async function (assert) {
    await render(
      <template>
        <div data-test-pad><SearchInput @display='collapsed' /></div>
      </template>,
    );
    let square = await openOver();
    let popover = root().querySelector(
      '[data-test-pretui-popover]',
    ) as HTMLElement;
    let room = Math.max(window.innerWidth - square.left, square.right) - 8;
    assert.strictEqual(
      popover.style.getPropertyValue('--pretui-popover-max-width'),
      `${room}px`,
    );
  });

  test('positionPopup flips the field toward the room near the viewport edge', function (assert) {
    let vw = window.innerWidth;
    let square = new DOMRect(vw - 40, 100, 32, 32);
    let flipped = positionPopup(square, 240, 32, 'right-start', -32);
    assert.strictEqual(flipped.side, 'left', 'flips toward the room');
    assert.strictEqual(flipped.left, vw - 8 - 240, 'ends at the square');
  });

  test('focusout closes it; Tab order is square, then field, then clear', async function (assert) {
    await render(
      <template>
        <SearchInput @display='collapsed' @value='bug' /><button
          type='button'
          data-test-next
        >Next</button>
      </template>,
    );
    assert.deepEqual(
      focusables(),
      [toggle() as HTMLElement],
      'closed: only the square',
    );
    await click(toggle() as HTMLElement);
    let clearBtn = root().querySelector(
      '[data-test-pretui-search-clear]',
    ) as HTMLElement;
    assert.deepEqual(
      focusables(),
      [input() as HTMLElement, clearBtn],
      'open: field, then clear',
    );
    await focus('[data-test-next]');
    await waitUntil(() => !input());
    assert.ok(toggle(), 'leaving closes it');
  });

  test('the clear button is clickable when open, and clears in place', async function (assert) {
    let seen: string[] = [];
    let onInput = (v: string) => seen.push(v);
    await render(
      <template>
        <SearchInput @display='collapsed' @value='bug' @onInput={{onInput}} />
      </template>,
    );
    await click(toggle() as HTMLElement);
    await click('[data-test-pretui-search-clear]');
    assert.deepEqual(seen, [''], 'cleared');
    assert.strictEqual(
      document.activeElement,
      input(),
      'still open, focus in the field',
    );
  });

  test('a click outside closes it and returns focus to the square', async function (assert) {
    await render(
      <template><SearchInput @display='collapsed' @value='bug' /></template>,
    );
    await click(toggle() as HTMLElement);
    await click(root().querySelector('[aria-label="Close"]') as HTMLElement);
    await waitUntil(() => document.activeElement === toggle());
    assert.strictEqual(panel(), null, 'closed');
  });

  test('closing removes the panel, so nothing covers later controls', async function (assert) {
    await render(
      <template>
        <SearchInput @display='collapsed' /><button
          type='button'
          data-test-next
        >Next</button>
      </template>,
    );
    await click(toggle() as HTMLElement);
    assert.ok(panel(), 'open');
    await triggerKeyEvent(input() as HTMLInputElement, 'keydown', 'Escape');
    await waitUntil(() => document.activeElement === toggle());
    assert.strictEqual(panel(), null, 'the panel is gone');
    await click('[data-test-next]');
    assert.strictEqual(
      document.activeElement,
      document.querySelector('[data-test-next]'),
      'the next control takes the click',
    );
  });
});
