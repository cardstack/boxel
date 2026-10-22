// Pretui — proof for Reorder and ActionBar.
//
// The point of this file is the KEYBOARD path. An audit of five comparable
// drag implementations found four were pointer-only, and a pointer-only
// reorder is not a component with a missing feature — it is a component a
// whole class of readers cannot use at all. So the move arithmetic is
// asserted as pure functions, and then the full pick-up / move / drop /
// cancel cycle is driven from the keyboard in a real browser, because that
// is the only evidence that counts.
//
// Run with `boxel test` from this directory; deployment leaves `*.test.gts`
// off the realm.
import { module, test } from 'qunit';
import { render, focus, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { tracked } from '@glimmer/tracking';
import { keyboardNudge } from './internal/design-tools';
import { ActionBar, selectionSummary } from './components/action-bar';
import type { ActionBarAction } from './components/action-bar';
import { Reorder, indexFromCentres, moveItem, reorderAnnouncement, reorderTarget } from './components/reorder';

const LIST = ['a', 'b', 'c', 'd'];

function root(): HTMLElement {
  return document.querySelector('#ember-testing') as HTMLElement;
}
function handles(): HTMLElement[] {
  return Array.from(
    root().querySelectorAll<HTMLElement>('[data-test-pretui-reorder-handle]'),
  );
}
function status(): string {
  return (
    root().querySelector('[data-test-pretui-reorder-status]') as HTMLElement
  ).textContent?.trim() ?? '';
}
function names(): string[] {
  return Array.from(
    root().querySelectorAll<HTMLElement>('.pretui-reorder-content'),
  ).map((el) => el.textContent?.trim() ?? '');
}

module('Pretui | reorder | move arithmetic', function () {
  test('moveItem returns a NEW array and never mutates the input', function (assert) {
    let out = moveItem(LIST, 0, 2);
    assert.deepEqual(out, ['b', 'c', 'a', 'd'], 'the member travels to its target index');
    assert.deepEqual(LIST, ['a', 'b', 'c', 'd'], 'the caller array is untouched');
    assert.notStrictEqual(out, LIST, 'and it is a different array object');
  });

  test('moving backwards', function (assert) {
    assert.deepEqual(moveItem(LIST, 3, 0), ['d', 'a', 'b', 'c']);
    assert.deepEqual(moveItem(LIST, 2, 1), ['a', 'c', 'b', 'd']);
  });

  test('out-of-range indices clamp rather than throw', function (assert) {
    assert.deepEqual(moveItem(LIST, 0, 99), ['b', 'c', 'd', 'a'], 'past the end means last');
    assert.deepEqual(moveItem(LIST, -5, 1), ['b', 'a', 'c', 'd'], 'before the start means first');
    assert.deepEqual(moveItem([], 0, 1), [], 'an empty list is a no-op, not a crash');
  });

  test('a move to the same place is identity', function (assert) {
    assert.deepEqual(moveItem(LIST, 2, 2), LIST);
  });
});

module('Pretui | reorder | keyboard target', function () {
  test('arrows move one position, in SCREEN space', function (assert) {
    assert.strictEqual(
      reorderTarget(1, keyboardNudge('ArrowDown'), 4),
      2,
      'ArrowDown goes DOWN the list — the intent dy is screen space and list positions increase downward',
    );
    assert.strictEqual(reorderTarget(1, keyboardNudge('ArrowUp'), 4), 0);
    assert.strictEqual(reorderTarget(1, keyboardNudge('ArrowRight'), 4), 2, 'dx is used when dy is zero');
  });

  test('Home and End jump to the ends', function (assert) {
    assert.strictEqual(reorderTarget(2, keyboardNudge('Home'), 4), 0);
    assert.strictEqual(reorderTarget(1, keyboardNudge('End'), 4), 3);
  });

  test('Shift coarsens, and the ends clamp instead of wrapping', function (assert) {
    assert.strictEqual(
      reorderTarget(0, keyboardNudge('ArrowDown', { shift: true }), 4),
      3,
      'Shift is x10 from the shared key map, clamped to the last row',
    );
    assert.strictEqual(reorderTarget(3, keyboardNudge('ArrowDown'), 4), 3, 'no wrap at the bottom');
    assert.strictEqual(reorderTarget(0, keyboardNudge('ArrowUp'), 4), 0, 'no wrap at the top');
  });

  test('the FINE modifier still moves one row rather than silently nothing', function (assert) {
    // keyboardNudge scales Alt+Arrow to 0.1, which is meaningless between two
    // rows. Truncating alone would give zero, and a key that appears to do
    // nothing reads as broken.
    assert.strictEqual(
      reorderTarget(0, keyboardNudge('ArrowDown', { alt: true }), 4),
      1,
      'a sub-unit intent is promoted to one whole position',
    );
  });

  test('an unhandled key changes nothing', function (assert) {
    assert.strictEqual(reorderTarget(2, keyboardNudge('KeyQ'), 4), 2);
  });

  test('an empty list has nowhere to go', function (assert) {
    assert.strictEqual(reorderTarget(0, keyboardNudge('ArrowDown'), 0), 0);
  });
});

module('Pretui | reorder | pointer target', function () {
  test('a row is reached once the pointer passes its CENTRE', function (assert) {
    let centres = [10, 30, 50, 70];
    assert.strictEqual(indexFromCentres(centres, 0), 0, 'above everything');
    assert.strictEqual(indexFromCentres(centres, 9), 0, 'just above the first centre');
    assert.strictEqual(indexFromCentres(centres, 11), 1, 'just past it, the second row is the target');
    assert.strictEqual(indexFromCentres(centres, 69), 3);
    assert.strictEqual(indexFromCentres(centres, 999), 3, 'past the end clamps to the last row');
  });

  test('rows of different heights are handled — the usual y/rowHeight maths is not', function (assert) {
    // 20px, 60px and 20px rows: centres at 10, 50 and 90.
    let centres = [10, 50, 90];
    assert.strictEqual(indexFromCentres(centres, 45), 1, 'still inside the tall row');
    assert.strictEqual(indexFromCentres(centres, 55), 2, 'past its centre');
  });

  test('no rows at all', function (assert) {
    assert.strictEqual(indexFromCentres([], 40), 0);
  });
});

module('Pretui | reorder | announcements', function () {
  test('every phase says where the row is, counting from one', function (assert) {
    assert.true(
      reorderAnnouncement('grab', 'Gyokuro', 2, 6).indexOf('position 2 of 6') !== -1,
      'grab',
    );
    assert.true(
      reorderAnnouncement('grab', 'Gyokuro', 2, 6).indexOf('Escape to cancel') !== -1,
      'and the grab announcement teaches the keys, because nothing else will',
    );
    assert.strictEqual(
      reorderAnnouncement('move', 'Gyokuro', 3, 6),
      'Gyokuro, position 3 of 6.',
      'a move is terse — it is spoken on every arrow press',
    );
    assert.true(
      reorderAnnouncement('drop', 'Gyokuro', 3, 6).indexOf('dropped') !== -1,
      'drop',
    );
    assert.true(
      reorderAnnouncement('cancel', 'Gyokuro', 1, 6).indexOf('Move cancelled') !== -1,
      'cancel says so before it says where',
    );
  });
});

module('Pretui | action bar | summary', function () {
  test('pluralisation, and the optional total', function (assert) {
    assert.strictEqual(selectionSummary(1, 'lot'), '1 lot selected');
    assert.strictEqual(selectionSummary(3, 'lot'), '3 lots selected');
    assert.strictEqual(selectionSummary(3, 'lot', 40), '3 lots selected of 40');
    assert.strictEqual(selectionSummary(0, 'lot'), '0 lots selected');
  });

  test('nonsense counts do not produce nonsense copy', function (assert) {
    assert.strictEqual(selectionSummary(Number.NaN, 'lot'), '0 lots selected');
    assert.strictEqual(selectionSummary(-2, 'lot'), '0 lots selected');
    assert.strictEqual(selectionSummary(2.7, 'lot'), '2 lots selected');
  });
});

class ReorderState {
  @tracked items = ['Da Hong Pao', 'Silver Needle', 'Gyokuro', 'Tieguanyin'];
  moves: { from: number; to: number }[] = [];
  keyFor = (item: string) => item;
  labelFor = (item: string) => item;
  onReorder = (next: string[], from: number, to: number) => {
    this.items = next;
    this.moves.push({ from, to });
  };
}

module('Pretui | reorder | render', function (hooks) {
  setupCardTest(hooks);
  // A hang here would take the whole suite down with it (QUnit never reaches
  // runEnd), which hides everyone else's failures.
  hooks.beforeEach(function (assert) {
    assert.timeout(8000);
  });

  test('a press on a control inside a row is left alone; only the handle starts a drag', async function (assert) {
    let state = new ReorderState();
    await render(
      <template>
        <Reorder
          @items={{state.items}}
          @keyFor={{state.keyFor}}
          @labelFor={{state.labelFor}}
          @onReorder={{state.onReorder}}
          as |tea|
        ><button type='button' class='t-row-control'>{{tea}}</button></Reorder>
      </template>,
    );
    let control = document.querySelector('.t-row-control') as HTMLElement;
    let press = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1 });
    control.dispatchEvent(press);
    assert.false(press.defaultPrevented, 'the control keeps its focus-on-press');
    let handle = document.querySelector('[data-reorder-handle]') as HTMLElement;
    let grab = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 2 });
    handle.dispatchEvent(grab);
    assert.true(grab.defaultPrevented, 'the handle still starts the gesture');
  });

  test('one tab stop for the list, and every handle carries its position', async function (assert) {
    let state = new ReorderState();
    await render(
      <template>
        <Reorder
          @items={{state.items}}
          @keyFor={{state.keyFor}}
          @labelFor={{state.labelFor}}
          @onReorder={{state.onReorder}}
          as |tea|
        >{{tea}}</Reorder>
      </template>,
    );
    let all = handles();
    assert.strictEqual(all.length, 4, 'a handle per row');
    assert.strictEqual(
      all.filter((h) => h.tabIndex === 0).length,
      1,
      'exactly one tab stop for the whole composite (roving tabindex)',
    );
    assert.strictEqual(
      all[1]?.getAttribute('aria-label'),
      'Reorder Silver Needle, position 2 of 4',
      'the handle name says which row and where it is — an icon-only control with no name is unusable',
    );
    assert.strictEqual(all[0]?.getAttribute('aria-pressed'), 'false', 'nothing is grabbed yet');
  });

  test('the full keyboard cycle: pick up, move, drop', async function (assert) {
    let state = new ReorderState();
    await render(
      <template>
        <Reorder
          @items={{state.items}}
          @keyFor={{state.keyFor}}
          @labelFor={{state.labelFor}}
          @onReorder={{state.onReorder}}
          as |tea|
        >{{tea}}</Reorder>
      </template>,
    );
    await focus(handles()[0] as HTMLElement);
    await triggerKeyEvent(handles()[0] as HTMLElement, 'keydown', 'Enter');
    assert.strictEqual(
      handles()[0]?.getAttribute('aria-pressed'),
      'true',
      'Enter picks the row up, and the handle says so',
    );
    assert.true(status().indexOf('grabbed') !== -1, 'and the live region announces it: ' + status());

    await triggerKeyEvent(handles()[0] as HTMLElement, 'keydown', 'ArrowDown');
    assert.deepEqual(
      names(),
      ['Silver Needle', 'Da Hong Pao', 'Gyokuro', 'Tieguanyin'],
      'the list visibly rearranges while the row is carried',
    );
    assert.strictEqual(state.moves.length, 0, 'but nothing is committed mid-move');
    assert.true(status().indexOf('position 2 of 4') !== -1, 'the new position is announced');

    await triggerKeyEvent(handles()[1] as HTMLElement, 'keydown', 'Enter');
    assert.deepEqual(state.moves, [{ from: 0, to: 1 }], 'Enter commits exactly once, with both indices');
    assert.strictEqual(handles()[1]?.getAttribute('aria-pressed'), 'false', 'and the row is put down');
    assert.true(status().indexOf('dropped') !== -1, 'announced as a drop: ' + status());
  });

  test('Escape returns the row to where it started and commits nothing', async function (assert) {
    let state = new ReorderState();
    await render(
      <template>
        <Reorder
          @items={{state.items}}
          @keyFor={{state.keyFor}}
          @labelFor={{state.labelFor}}
          @onReorder={{state.onReorder}}
          as |tea|
        >{{tea}}</Reorder>
      </template>,
    );
    await focus(handles()[0] as HTMLElement);
    await triggerKeyEvent(handles()[0] as HTMLElement, 'keydown', 'Enter');
    await triggerKeyEvent(handles()[0] as HTMLElement, 'keydown', 'ArrowDown');
    await triggerKeyEvent(handles()[1] as HTMLElement, 'keydown', 'ArrowDown');
    assert.deepEqual(
      names(),
      ['Silver Needle', 'Gyokuro', 'Da Hong Pao', 'Tieguanyin'],
      'two rows down, live',
    );
    await triggerKeyEvent(handles()[2] as HTMLElement, 'keydown', 'Escape');
    assert.deepEqual(
      names(),
      ['Da Hong Pao', 'Silver Needle', 'Gyokuro', 'Tieguanyin'],
      'Escape puts the whole list back — the caller was never told anything happened',
    );
    assert.strictEqual(state.moves.length, 0, 'and onReorder never fired');
    assert.true(status().indexOf('cancelled') !== -1, 'announced as a cancellation: ' + status());
  });

  test('arrows without a grab move FOCUS, not the row', async function (assert) {
    let state = new ReorderState();
    await render(
      <template>
        <Reorder
          @items={{state.items}}
          @keyFor={{state.keyFor}}
          @labelFor={{state.labelFor}}
          @onReorder={{state.onReorder}}
          as |tea|
        >{{tea}}</Reorder>
      </template>,
    );
    await focus(handles()[0] as HTMLElement);
    await triggerKeyEvent(handles()[0] as HTMLElement, 'keydown', 'ArrowDown');
    assert.deepEqual(
      names(),
      ['Da Hong Pao', 'Silver Needle', 'Gyokuro', 'Tieguanyin'],
      'the list is unchanged',
    );
    assert.strictEqual(handles()[1]?.tabIndex, 0, 'and the tab stop travelled instead');
  });

  test('a disabled list refuses the keyboard path too', async function (assert) {
    let state = new ReorderState();
    await render(
      <template>
        <Reorder
          @items={{state.items}}
          @disabled={{true}}
          @keyFor={{state.keyFor}}
          @labelFor={{state.labelFor}}
          @onReorder={{state.onReorder}}
          as |tea|
        >{{tea}}</Reorder>
      </template>,
    );
    let handle = handles()[0] as HTMLElement;
    assert.strictEqual(
      handle.getAttribute('aria-disabled'),
      'true',
      'aria-disabled, never the disabled attribute — the handle stays focusable and announced',
    );
    assert.false(handle.hasAttribute('disabled'), 'the attribute is not used');
    await focus(handle);
    await triggerKeyEvent(handle, 'keydown', 'Enter');
    assert.strictEqual(handle.getAttribute('aria-pressed'), 'false', 'nothing is picked up');
  });
});

class BarState {
  @tracked count = 3;
  fired: string[] = [];
  cleared = 0;
  clear = () => {
    this.cleared = this.cleared + 1;
    this.count = 0;
  };
  fire = (id: string) => this.fired.push(id);
  get actions(): ActionBarAction[] {
    return [
      { id: 'cup', label: 'Schedule cupping', onAction: this.fire },
      { id: 'price', label: 'Re-price', onAction: this.fire },
      { id: 'export', label: 'Export', onAction: this.fire },
      { id: 'archive', label: 'Archive', onAction: this.fire },
      { id: 'withdraw', label: 'Withdraw', destructive: true, onAction: this.fire },
    ];
  }
}

module('Pretui | action bar | render', function (hooks) {
  setupCardTest(hooks);
  hooks.beforeEach(function (assert) {
    assert.timeout(8000);
  });

  test('nothing selected renders nothing at all', async function (assert) {
    await render(<template><ActionBar @count={{0}} /></template>);
    assert.notOk(
      root().querySelector('[data-test-pretui-action-bar]'),
      'the bar is absent rather than an empty strip',
    );
  });

  test('the bar is a toolbar with one tab stop and a spoken count', async function (assert) {
    let state = new BarState();
    await render(
      <template>
        <ActionBar
          @count={{state.count}}
          @total={{40}}
          @noun='lot'
          @actions={{state.actions}}
          @maxVisible={{2}}
          @onClear={{state.clear}}
        />
      </template>,
    );
    let bar = root().querySelector('[data-test-pretui-action-bar]') as HTMLElement;
    assert.strictEqual(bar.getAttribute('role'), 'toolbar', 'the APG pattern, in full or not at all');
    assert.ok(bar.getAttribute('aria-label'), 'and it has a name');
    assert.strictEqual(
      (
        root().querySelector('[data-test-pretui-action-bar-count]') as HTMLElement
      ).textContent?.trim(),
      '3 lots selected of 40',
      'the count is a sentence, not a bare number',
    );
    let members = Array.from(
      bar.querySelectorAll<HTMLElement>('[data-actionbar-item]'),
    );
    assert.strictEqual(
      members.filter((m) => m.tabIndex === 0).length,
      1,
      'one tab stop for the whole toolbar',
    );
  });

  test('actions past the threshold collapse into an overflow menu', async function (assert) {
    let state = new BarState();
    await render(
      <template>
        <ActionBar @count={{state.count}} @actions={{state.actions}} @maxVisible={{2}} />
      </template>,
    );
    assert.strictEqual(
      root().querySelectorAll('[data-test-pretui-action-bar-action]').length,
      2,
      'two buttons, as asked',
    );
    assert.ok(
      root().querySelector('.pretui-menu-trigger'),
      'and the remaining three are behind a Menu — composed, not reimplemented',
    );
  });

  test('exactly one action over the limit is promoted rather than hidden in a menu of one', async function (assert) {
    let state = new BarState();
    await render(
      <template>
        <ActionBar @count={{state.count}} @actions={{state.actions}} @maxVisible={{4}} />
      </template>,
    );
    assert.strictEqual(
      root().querySelectorAll('[data-test-pretui-action-bar-action]').length,
      5,
      'all five are buttons — a menu holding a single item is a worse outcome than one more button',
    );
    assert.notOk(root().querySelector('.pretui-menu-trigger'), 'no overflow trigger');
  });

  test('Escape inside the bar clears the selection', async function (assert) {
    let state = new BarState();
    await render(
      <template>
        <ActionBar
          @count={{state.count}}
          @actions={{state.actions}}
          @onClear={{state.clear}}
        />
      </template>,
    );
    let bar = root().querySelector('[data-test-pretui-action-bar]') as HTMLElement;
    await triggerKeyEvent(bar, 'keydown', 'Escape');
    assert.strictEqual(state.cleared, 1, 'onClear fired exactly once');
  });

  test('without onClear there is no clear button to mislead anyone', async function (assert) {
    let state = new BarState();
    await render(
      <template><ActionBar @count={{state.count}} @actions={{state.actions}} /></template>,
    );
    assert.notOk(root().querySelector('[data-test-pretui-action-bar-clear]'));
  });
});
