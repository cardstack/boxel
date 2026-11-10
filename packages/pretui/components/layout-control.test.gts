// Pretui — LayoutControl: the pure chooser, then folding into ⋯ in a render.
import { module, test } from 'qunit';
import { render, click, fillIn, triggerKeyEvent, waitUntil } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { SearchInput } from './search-input';
import { eq } from '../helpers';
import { applyHysteresis, chooseForms, HYSTERESIS_PX, LayoutControl } from './layout-control';
import type { LayoutControlChoice, LayoutControlSlotSpec } from './layout-control';

const REM = 16;
const slot = (id: string, priority: number, ...forms: [string, number][]): LayoutControlSlotSpec => ({
  id,
  priority,
  forms: forms.map(([name, minWidth]) => ({ name, minWidth })),
});
const names = (slots: LayoutControlSlotSpec[], w: number) => {
  let levels = chooseForms(slots, w, 0, 2 * REM, REM);
  return slots.map((s) => s.forms[levels.get(s.id)!]!.name);
};

module('Pretui | components/layout-control | chooseForms', function () {
  let A = slot('a', 1, ['big', 10], ['small', 5], ['menu', 0]);
  let B = slot('b', 2, ['big', 10], ['small', 5], ['menu', 0]);
  let P = slot('p', 0, ['label', 8], ['icon', 2]); // pinned: no menu form

  test('every slot starts at its richest form when it fits', function (assert) {
    assert.deepEqual(names([A, B, P], 28 * REM), ['big', 'big', 'label']);
  });

  test('steps down evenly: nobody steps twice before everyone steps once', function (assert) {
    assert.deepEqual(names([A, B, P], 15 * REM), ['small', 'small', 'icon']);
  });

  test('a priority tie goes to the less important slot, then the later one', function (assert) {
    assert.deepEqual(names([A, B, P], 26 * REM), ['big', 'small', 'label'], 'b has the higher @priority');
    let A2 = slot('a2', 1, ['big', 10], ['small', 5], ['menu', 0]);
    assert.deepEqual(names([A, A2], 18 * REM), ['big', 'small'], 'equal priority: the later slot');
  });

  test('a slot with no menu form never folds', function (assert) {
    assert.deepEqual(names([A, B, P], 1 * REM), ['menu', 'menu', 'icon']);
  });

  test('stepping back up is guarded by HYSTERESIS_PX', function (assert) {
    assert.strictEqual(HYSTERESIS_PX, 16);
    let lv = (a: number, b: number) => new Map([['a', a], ['b', b]]);
    assert.deepEqual(
      [...applyHysteresis(lv(0, 0), lv(1, 1), lv(1, 1))],
      [['a', 1], ['b', 1]],
      'richer at the exact width but not HYSTERESIS_PX narrower: held',
    );
    assert.deepEqual(
      [...applyHysteresis(lv(0, 0), lv(1, 1), lv(0, 0))],
      [['a', 0], ['b', 0]],
      'richer HYSTERESIS_PX narrower too: accepted',
    );
    assert.deepEqual(
      [...applyHysteresis(lv(0, 2), lv(1, 1), lv(1, 2))],
      [['a', 1], ['b', 2]],
      'mixed: the slot stepping down moves at once, the one stepping up is held (per slot, not by total steps)',
    );
    assert.deepEqual([...applyHysteresis(lv(0, 0), new Map(), lv(0, 0))], [['a', 0], ['b', 0]], 'no previous choice: taken as is');
  });
});

module('Pretui | components/layout-control | folding', function (hooks) {
  setupCardTest(hooks);

  const BIG = [
    { name: 'big', minWidth: 40 },
    { name: 'menu', minWidth: 0 },
  ];
  const NARROW = 'inline-size: 20rem';
  const PIN = [{ name: 'label', minWidth: 4 }];
  const CHOICES: LayoutControlChoice[] = [
    { label: 'Board', value: 'board', group: 'view', checked: true },
    { label: 'List', value: 'list', group: 'view' },
  ];

  test('folded slots become ⋯ menu items, the pinned slot stays, the fallback opens the slot', async function (assert) {
    await render(
      <template>
        <div style={{NARROW}}>
          <LayoutControl @label='Candidates' as |lc|>
            <lc.Slot @id='view' @forms={{BIG}} @label='View' @menuItems={{CHOICES}}>
              <span data-test-view>view</span>
            </lc.Slot>
            <lc.Slot @id='search' @forms={{BIG}} @label='Search'>
              <input aria-label='Search' data-test-search />
            </lc.Slot>
            <lc.Slot @id='add' @forms={{PIN}} @pinned={{true}}>
              <button type='button' data-test-add>Add</button>
            </lc.Slot>
          </LayoutControl>
        </div>
      </template>,
    );
    await waitUntil(() => document.querySelector('[data-test-pretui-layout-control-more]'));
    let bar = document.querySelector('[data-test-pretui-layout-control]')!;
    assert.strictEqual(bar.getAttribute('role'), 'group');
    assert.strictEqual(bar.getAttribute('aria-label'), 'Candidates');
    assert.dom('[data-test-add]').exists('pinned slot stays in the row');
    assert.dom('[data-test-view]').doesNotExist('folded slot is not rendered in the row');
    assert.dom('[data-test-search]').doesNotExist();

    await click('[data-test-pretui-layout-control-more] button');
    let radios = [...document.querySelectorAll('[role="menuitemradio"]')];
    assert.deepEqual(radios.map((r) => r.textContent?.trim()), ['Board', 'List'], '@menuItems become radio items');
    assert.strictEqual(radios[0]!.getAttribute('aria-checked'), 'true');
    let fallback = [...document.querySelectorAll('[role^="menuitem"]')].find((el) =>
      el.textContent?.includes('Search…'),
    ) as HTMLElement;
    assert.ok(fallback, 'a slot without @menuItems folds to one "@label…" item');

    await click(fallback);
    let moved = await waitUntil(
      () =>
        document.querySelector('[data-test-pretui-layout-control-fallback] [data-test-search]') ||
        document.querySelector('[data-test-pretui-layout-control-sheet] [data-test-search]'),
    );
    assert.ok(moved, 'the slot’s own block opens in the popover (or sheet)');
  });

  test('a search slot at its icon form opens a focused field on click and Escape closes it', async function (assert) {
    const SEARCH = [
      { name: 'field', minWidth: 40 },
      { name: 'icon', minWidth: 2 },
    ];
    await render(
      <template>
        <div style={{NARROW}}>
          <LayoutControl @label='Candidates' as |lc|>
            <lc.Slot @id='search' @forms={{SEARCH}} @label='Search' as |form|>
              {{#if (eq form 'icon')}}
                <SearchInput @display='collapsed' @placeholder='Search candidates' />
              {{else}}
                <SearchInput @placeholder='Search candidates' />
              {{/if}}
            </lc.Slot>
          </LayoutControl>
        </div>
      </template>,
    );
    let toggle = () => document.querySelector<HTMLElement>('[data-test-pretui-search-toggle]');
    let input = () => document.querySelector<HTMLInputElement>('[data-test-pretui-search-input] input');
    await waitUntil(toggle);
    assert.notOk(input(), 'only the square shows at this width');

    await click(toggle()!);
    assert.strictEqual(document.activeElement, input(), 'the field opens with focus in it');
    await fillIn(input()!, 'ada');
    await triggerKeyEvent(input()!, 'keydown', 'Escape');
    await waitUntil(() => document.activeElement === toggle());
    assert.notOk(input(), 'Escape collapses back to the square');
    assert.strictEqual(document.activeElement, toggle(), 'focus returns to the square');
  });

  test('a slot folded by a measurement taken mid-resize unfolds when the bar is back at its width', async function (assert) {
    const WIDE = [
      { name: 'wide', minWidth: 30 },
      { name: 'menu', minWidth: 0 },
    ];
    const HOST = 'inline-size: 40rem';
    const CONTENT = 'display: inline-block; flex: none; inline-size: 30rem';
    await render(
      <template>
        <div style={{HOST}} data-test-host>
          <LayoutControl as |lc|>
            <lc.Slot @id='wide' @forms={{WIDE}}>
              <span style={{CONTENT}} data-test-wide>wide</span>
            </lc.Slot>
          </LayoutControl>
        </div>
      </template>,
    );
    let host = document.querySelector<HTMLElement>('[data-test-host]')!;
    let frames = async (n: number) => {
      for (let i = 0; i < n; i++) {
        await new Promise((r) => requestAnimationFrame(r));
      }
    };
    await waitUntil(() => document.querySelector('[data-test-wide]'));
    await frames(3);
    // The bar reports 39rem, then narrows within the same observer delivery.
    // An observer only hears of a deeper element's resize in that frame, so
    // the bar's next measuring frame sees the narrow layout before its own
    // observer reports it, as in a host resize or stack animation.
    let shrink = new ResizeObserver(() => {
      shrink.disconnect();
      host.style.inlineSize = '20rem';
    });
    host.style.inlineSize = '39rem';
    shrink.observe(document.querySelector('[data-test-wide]')!);
    await waitUntil(() => document.querySelector('[data-test-pretui-layout-control-more]'));
    await frames(3);
    // back to the width it was measured at, less than HYSTERESIS_PX above it
    host.style.inlineSize = '39rem';
    await frames(10);
    assert.dom('[data-test-wide]').exists('back at its width, the slot is in the row again');
    assert.dom('[data-test-pretui-layout-control-more]').doesNotExist();
  });
});
