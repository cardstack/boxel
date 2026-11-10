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
import { on } from '@ember/modifier';
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
// the open field; anchorTo positions Popup's layer, its parent
function field(): HTMLElement | null {
  return root().querySelector('[data-test-pretui-search-field]');
}
function layer(): HTMLElement {
  return field()?.parentElement as HTMLElement;
}
// the anchor anchorTo measures
function anchorRect(): DOMRect {
  return (
    root().querySelector('[data-test-pretui-search-anchor]') as HTMLElement
  ).getBoundingClientRect();
}
function focusables(): HTMLElement[] {
  return [...root().querySelectorAll<HTMLElement>('button, input')];
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
  [data-pretui-search-collapse] { inline-size: 32px; block-size: 32px; }
  [data-test-pretui-search-anchor] { display: grid; inline-size: 32px; block-size: 32px; }
  [data-test-pretui-search-anchor] > span { position: fixed; display: block; }
  [data-test-pretui-search-toggle] { inline-size: 100%; block-size: 100%; }
  [data-test-pad] { padding: 2rem; }
  [data-test-scroller] { block-size: 6rem; overflow: auto; }
  [data-test-spacer] { block-size: 3rem; }
  [data-test-tail] { block-size: 20rem; }
  [data-test-pretui-search-field] { display: block; inline-size: 240px; }`;
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
    assert.notOk(
      root().querySelector('[role="dialog"]'),
      'the open field is not announced as a dialog',
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
    let room = Math.max(window.innerWidth - square.left, square.right) - 8;
    assert.strictEqual(field()?.style.maxInlineSize, `${room}px`);
  });

  test('the width cap follows a viewport resize while open', async function (assert) {
    await render(
      <template>
        <div data-test-pad><SearchInput @display='collapsed' /></div>
      </template>,
    );
    // the harness can't resize the window and may sit anywhere in it, so an
    // own innerWidth stands in for the window: wide enough that the inline end
    // is the roomier side, then narrowed. Restore exactly what was there so
    // later tests read the real width.
    let original = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    let setWidth = (value: number) =>
      Object.defineProperty(window, 'innerWidth', { configurable: true, value });
    try {
      let rect = root().getBoundingClientRect();
      let wide = Math.ceil(rect.right + rect.left + 2000);
      setWidth(wide);
      let square = await openOver();
      let before = Math.max(wide - square.left, square.right) - 8;
      assert.strictEqual(field()?.style.maxInlineSize, `${before}px`, 'capped to the wide window');
      let narrow = Math.ceil(square.right + square.left + 500);
      setWidth(narrow);
      window.dispatchEvent(new Event('resize'));
      await settled();
      let room = Math.max(narrow - square.left, square.right) - 8;
      assert.strictEqual(field()?.style.maxInlineSize, `${room}px`, 'recapped after the resize');
      assert.true(room < before, 'shrank');
    } finally {
      if (original) {
        Object.defineProperty(window, 'innerWidth', original);
      } else {
        delete (window as { innerWidth?: number }).innerWidth;
      }
      window.dispatchEvent(new Event('resize'));
      await settled();
    }
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

  test('an outside click closes it and the clicked control still gets the click', async function (assert) {
    let clicks = 0;
    let onNext = () => clicks++;
    await render(
      <template>
        <SearchInput @display='collapsed' @value='bug' /><button
          type='button'
          data-test-next
          {{on 'click' onNext}}
        >Next</button>
      </template>,
    );
    await click(toggle() as HTMLElement);
    assert.ok(field(), 'open');
    await click('[data-test-next]');
    await waitUntil(() => !field());
    assert.strictEqual(clicks, 1, 'the click reached the control');
    assert.strictEqual(
      document.activeElement,
      document.querySelector('[data-test-next]'),
      'focus went where the click went',
    );
    assert.ok(toggle(), 'the square is back');
  });

  test('Escape returns focus to the square', async function (assert) {
    await render(<template><SearchInput @display='collapsed' /></template>);
    await click(toggle() as HTMLElement);
    await triggerKeyEvent(input() as HTMLInputElement, 'keydown', 'Escape');
    await waitUntil(() => document.activeElement === toggle());
    assert.notOk(field(), 'closed');
    assert.strictEqual(document.activeElement, toggle());
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
    assert.ok(field(), 'open');
    await triggerKeyEvent(input() as HTMLInputElement, 'keydown', 'Escape');
    await waitUntil(() => document.activeElement === toggle());
    assert.strictEqual(field(), null, 'the layer is gone');
    await click('[data-test-next]');
    assert.strictEqual(
      document.activeElement,
      document.querySelector('[data-test-next]'),
      'the next control takes the click',
    );
  });
});
