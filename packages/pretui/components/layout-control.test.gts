// Pretui — LayoutControl: the pure chooser, then folding into ⋯ in a render.
import { module, test } from 'qunit';
import { render, click, waitUntil } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { chooseForms, HYSTERESIS_PX, LayoutControl } from './layout-control';
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
    // the bar runs the chooser HYSTERESIS_PX narrower before accepting a richer
    // choice; at an exact boundary that narrower run is still the poorer one
    let edge = 28 * REM;
    assert.deepEqual(names([A, B, P], edge), ['big', 'big', 'label']);
    assert.deepEqual(names([A, B, P], edge - HYSTERESIS_PX), ['big', 'small', 'label']);
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
    assert.strictEqual(bar.getAttribute('role'), 'toolbar');
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
    await waitUntil(() => document.querySelector('[data-test-pretui-layout-control-fallback] [data-test-search]') ||
      document.querySelector('[data-test-pretui-layout-control-sheet] [data-test-search]'));
    assert.ok(true, 'the slot’s own block opens in the popover (or sheet)');
  });
});
