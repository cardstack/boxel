// Pretui — proof for the application menu bar (menubar.gts).
//
// Two halves, and the FIRST one carries most of the weight:
//
//  1. **The keyboard state machine as pure functions.** `menubarKey` takes
//     (state, key, context) and returns (state, effect), with no DOM and no
//     component, so the entire transition table can be driven directly. That
//     is where menubar implementations go wrong — the Left/Right carry rule,
//     Up landing on the LAST item, Escape at depth 1 versus depth 2 — and it
//     is exactly the part that is invisible in a screenshot and unpleasant to
//     drive through a rendered bar. It also cannot hang.
//
//  2. **Render proof** for the parts only a browser settles: the menubar
//     roles, the single tab stop across bar + panels, real focus movement,
//     the aria-disabled contract, and the hover asymmetry.
//
// Local-only test file; run with `boxel test` from this directory — do NOT
// push to the realm (a pushed *.test.gts opts the realm into a QUnit gate).
import { module, test } from 'qunit';
import { render, click, triggerEvent, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { tracked } from '@glimmer/tracking';
import { Menubar, barCarry, menubarKey } from './components/menubar';
import type { BarContext, BarState } from './components/menubar';
import type { MenuEntry } from './internal/menu';

// ── 1. The state machine ─────────────────────────────────────────────────
//
// The fixture bar: four titles, three of which open menus.
//
//   0 File ▾   1 Edit ▾   2 View ▾   3 Help      (Help is a bare command)
//
// `dead` is the same bar with View disabled, which must behave as though it
// has no menu at all while staying focusable.

const CTX: BarContext = {
  count: 4,
  hasMenu: (i) => i < 3,
  rowHasMenu: false,
};
const CTX_SUB: BarContext = { ...CTX, rowHasMenu: true };

function onBar(index: number, open = -1): BarState {
  return { index, open, where: 'bar', depth: 0 };
}
function inMenu(index: number, depth = 1): BarState {
  return { index, open: index, where: 'menu', depth };
}

module('Pretui | menubar | state machine', function () {
  test('Left/Right move along the bar and wrap', function (assert) {
    let right = menubarKey(onBar(0), 'ArrowRight', CTX);
    assert.strictEqual(right.state.index, 1, 'Right steps forward');
    assert.true(right.handled, 'and is preventDefault-ed');

    assert.strictEqual(
      menubarKey(onBar(3), 'ArrowRight', CTX).state.index,
      0,
      'Right wraps past the last title',
    );
    assert.strictEqual(
      menubarKey(onBar(0), 'ArrowLeft', CTX).state.index,
      3,
      'Left wraps past the first',
    );
  });

  test('with nothing open, moving along the bar opens nothing', function (assert) {
    let next = menubarKey(onBar(0), 'ArrowRight', CTX).state;
    assert.strictEqual(next.open, -1, 'the bar stays closed');
    assert.strictEqual(next.where, 'bar', 'and focus stays on the bar');
  });

  test('with a menu open, moving along the bar OPENS the item it lands on', function (assert) {
    // The behaviour that makes an application menu bar feel like one.
    let next = menubarKey(onBar(0, 0), 'ArrowRight', CTX).state;
    assert.strictEqual(next.index, 1, 'focus steps to Edit');
    assert.strictEqual(next.open, 1, "and Edit's menu opens");
    assert.strictEqual(next.where, 'bar', 'focus stays on the TITLE, not in the menu');
    assert.strictEqual(next.depth, 0, 'so the depth returns to the bar');
  });

  test('landing on a title with no menu closes what was open', function (assert) {
    // 2 View is open; Right lands on 3 Help, which is a bare command.
    let next = menubarKey(onBar(2, 2), 'ArrowRight', CTX).state;
    assert.strictEqual(next.index, 3, 'focus lands on Help');
    assert.strictEqual(next.open, -1, 'and the open menu closes rather than stranding');
  });

  test('Home/End jump along the bar, carrying openness the same way', function (assert) {
    assert.strictEqual(menubarKey(onBar(2), 'Home', CTX).state.index, 0);
    assert.strictEqual(menubarKey(onBar(0), 'End', CTX).state.index, 3);
    assert.strictEqual(
      menubarKey(onBar(1, 1), 'Home', CTX).state.open,
      0,
      'an active bar opens the item Home lands on',
    );
    assert.strictEqual(
      menubarKey(onBar(1), 'Home', CTX).state.open,
      -1,
      'an inactive bar does not',
    );
  });

  test('Down opens onto the FIRST item, Up onto the LAST', function (assert) {
    let down = menubarKey(onBar(0), 'ArrowDown', CTX);
    assert.strictEqual(down.effect, 'enterFirst');
    assert.strictEqual(down.state.where, 'menu');
    assert.strictEqual(down.state.depth, 1);
    assert.strictEqual(down.state.open, 0);

    let up = menubarKey(onBar(0), 'ArrowUp', CTX);
    assert.strictEqual(up.effect, 'enterLast', 'Up is not a mirror of Down here');
  });

  test('Enter and Space open a menu, or activate a bare command', function (assert) {
    for (let key of ['Enter', ' ']) {
      let opened = menubarKey(onBar(0), key, CTX);
      assert.strictEqual(opened.effect, 'enterFirst', key + ' opens File onto its first item');

      let fired = menubarKey(onBar(3), key, CTX);
      assert.strictEqual(fired.effect, 'activate', key + ' activates the bare Help command');
      assert.strictEqual(fired.state.open, -1, 'nothing opens');
    }
  });

  test('a title with no menu ignores Down rather than half-opening', function (assert) {
    let result = menubarKey(onBar(3), 'ArrowDown', CTX);
    assert.false(result.handled, 'the key is not taken');
    assert.strictEqual(result.effect, 'none');
  });

  test('a DISABLED title is treated as having no menu, but is still reachable', function (assert) {
    // ctx.hasMenu folds `disabled` in, so the machine never opens a dimmed
    // menu — while Left/Right still land on it (aria-disabled, not disabled).
    let dead: BarContext = { ...CTX, hasMenu: (i) => i < 3 && i !== 2 };
    assert.strictEqual(
      menubarKey(onBar(1), 'ArrowRight', dead).state.index,
      2,
      'focus still reaches the dimmed title',
    );
    assert.strictEqual(
      menubarKey(onBar(1, 1), 'ArrowRight', dead).state.open,
      -1,
      'but the carry rule refuses to open it',
    );
    assert.strictEqual(menubarKey(onBar(2), 'ArrowDown', dead).effect, 'none');
  });

  // ── inside a menu ──────────────────────────────────────────────────────

  test('Down/Up/Home/End inside a menu belong to the level, not the bar', function (assert) {
    for (let key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
      let result = menubarKey(inMenu(1), key, CTX);
      assert.true(result.inner, key + ' is routed to the level machine');
      assert.false(result.handled, 'the bar does not consume it');
    }
  });

  test('Right on a leaf inside a menu jumps to the NEXT title and opens it', function (assert) {
    let next = menubarKey(inMenu(1), 'ArrowRight', CTX).state;
    assert.strictEqual(next.index, 2, 'the bar steps forward');
    assert.strictEqual(next.open, 2, 'the new title opens');
    assert.strictEqual(next.where, 'bar', 'and focus comes back up to the bar');
  });

  test('Right on a submenu row descends instead', function (assert) {
    let result = menubarKey(inMenu(1), 'ArrowRight', CTX_SUB);
    assert.strictEqual(result.effect, 'openRow');
    assert.strictEqual(result.state.depth, 2, 'one level deeper');
    assert.strictEqual(result.state.index, 1, 'the bar has not moved');
  });

  test('Left at depth 1 jumps to the PREVIOUS title and opens it', function (assert) {
    let next = menubarKey(inMenu(1), 'ArrowLeft', CTX).state;
    assert.strictEqual(next.index, 0);
    assert.strictEqual(next.open, 0);
    assert.strictEqual(next.where, 'bar');
  });

  test('Left inside a NESTED submenu closes just that level', function (assert) {
    let result = menubarKey(inMenu(1, 2), 'ArrowLeft', CTX_SUB);
    assert.strictEqual(result.effect, 'closeLevel');
    assert.strictEqual(result.state.depth, 1, 'back to the level above');
    assert.strictEqual(result.state.index, 1, 'the bar has not moved');
    assert.strictEqual(result.state.open, 1, 'and the menu is still open');
  });

  test('Enter on a leaf inside a menu activates and closes the bar', function (assert) {
    let result = menubarKey(inMenu(1), 'Enter', CTX);
    assert.strictEqual(result.effect, 'activate');
    assert.strictEqual(result.state.open, -1, 'the menu closes');
    assert.strictEqual(result.state.where, 'bar', 'focus returns to the title');
    assert.strictEqual(result.state.index, 1, 'the one the command came from');
  });

  // ── Escape and Tab ─────────────────────────────────────────────────────

  test('Escape at depth 1 closes the menu and returns focus to its title', function (assert) {
    let result = menubarKey(inMenu(2), 'Escape', CTX);
    assert.true(result.handled);
    assert.strictEqual(result.state.open, -1);
    assert.strictEqual(result.state.where, 'bar');
    assert.strictEqual(result.state.index, 2, 'staying in the bar, on the same title');
  });

  test('Escape inside a NESTED submenu closes one level only', function (assert) {
    // Deviation from accessible-menu, which throws away every level at once.
    let result = menubarKey(inMenu(2, 3), 'Escape', CTX_SUB);
    assert.strictEqual(result.effect, 'closeLevel');
    assert.strictEqual(result.state.depth, 2);
    assert.strictEqual(result.state.open, 2, 'the top-level menu is untouched');
  });

  test('Escape on a closed bar is not the bar’s to take', function (assert) {
    let result = menubarKey(onBar(1), 'Escape', CTX);
    assert.false(result.handled, 'a host surface still hears the key');
    assert.strictEqual(result.effect, 'none');
  });

  test('Escape on an open bar closes without leaving the bar', function (assert) {
    let result = menubarKey(onBar(1, 1), 'Escape', CTX);
    assert.true(result.handled);
    assert.strictEqual(result.state.open, -1);
    assert.strictEqual(result.state.index, 1);
  });

  test('Tab leaves the bar entirely, and is never preventDefault-ed', function (assert) {
    let result = menubarKey(inMenu(1, 2), 'Tab', CTX);
    assert.strictEqual(result.effect, 'leave');
    assert.false(result.handled, 'the browser continues its own tab order');
    assert.strictEqual(result.state.open, -1);
  });

  test('letters fall through to the caller’s type-ahead', function (assert) {
    let result = menubarKey(onBar(0), 'e', CTX);
    assert.false(result.handled);
    assert.false(result.inner);
    assert.strictEqual(result.effect, 'none');
  });

  test('an empty bar consumes nothing', function (assert) {
    let empty: BarContext = { count: 0, hasMenu: () => false, rowHasMenu: false };
    for (let key of ['ArrowRight', 'ArrowDown', 'Enter', 'Escape', 'Tab']) {
      assert.false(menubarKey(onBar(0), key, empty).handled, key + ' is ignored');
    }
  });

  test('barCarry is the whole carry rule, on its own', function (assert) {
    assert.strictEqual(barCarry(onBar(0), 1, CTX).open, -1, 'inactive: nothing opens');
    assert.strictEqual(barCarry(onBar(0, 0), 1, CTX).open, 1, 'active: the landing title opens');
    assert.strictEqual(barCarry(inMenu(0), 1, CTX).open, 1, 'focus inside a menu counts as active');
    assert.strictEqual(barCarry(onBar(0, 0), 3, CTX).open, -1, 'a menu-less landing closes');
    assert.strictEqual(barCarry(inMenu(0, 2), 1, CTX).depth, 0, 'and depth always returns to the bar');
  });
});

// ── 2. Render proof ──────────────────────────────────────────────────────

class BarFixture {
  @tracked log = '—';
  @tracked wrap = false;

  private ran = (what: string) => () => (this.log = what);

  get items(): MenuEntry[] {
    return [
      {
        kind: 'submenu',
        label: 'File',
        items: [
          { label: 'New lot', kbd: 'Mod+N', onSelect: this.ran('new') },
          { label: 'Open…', needsInput: true },
          '---',
          {
            kind: 'submenu',
            label: 'Export',
            items: [{ label: 'As CSV' }, { label: 'As PDF' }],
          },
        ],
      },
      {
        kind: 'submenu',
        label: 'Edit',
        items: [
          { label: 'Undo', kbd: 'Mod+Z' },
          { kind: 'toggle', label: 'Track changes', checked: 'mixed' },
        ],
      },
      {
        kind: 'submenu',
        label: 'View',
        disabled: true,
        items: [{ label: 'Never reachable' }],
      },
      { label: 'Help', onSelect: this.ran('help') },
    ];
  }
}

function root(): HTMLElement {
  return document.querySelector('#ember-testing') as HTMLElement;
}
function titles(): HTMLElement[] {
  return Array.from(root().querySelectorAll('[data-bar-index]')) as HTMLElement[];
}
function panels(): HTMLElement[] {
  return Array.from(
    root().querySelectorAll('[data-test-pretui-menubar-panel]'),
  ) as HTMLElement[];
}
function rows(): HTMLElement[] {
  return Array.from(
    root().querySelectorAll('[data-test-pretui-menubar-panel] [data-menu-key]'),
  ) as HTMLElement[];
}
function norm(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}
/** A row's LABEL only: its textContent also carries the shortcut face. */
function label(el: Element | null | undefined): string {
  return norm(el?.querySelector('.pretui-menulabel') ?? el);
}
/** Walk the bar's roving focus to title `i` the way a reader would. */
async function focusTitle(i: number) {
  for (let step = 0; step < i; step++) {
    await triggerKeyEvent(titles()[step], 'keydown', 'ArrowRight');
  }
}
/** Every tab stop the whole composite presents — the APG rule is exactly one. */
function tabStops(): HTMLElement[] {
  return [...titles(), ...rows()].filter((el) => el.tabIndex === 0);
}

module('Pretui | menubar | render', function (hooks) {
  setupCardTest(hooks);
  // A hang here would take the whole suite down with it (QUnit never reaches
  // runEnd), which hides everyone else's failures. A per-test deadline turns
  // any hang into an ordinary failure.
  hooks.beforeEach(function (assert) {
    assert.timeout(8000);
  });

  test('the bar carries the menubar roles and per-item popup state', async function (assert) {
    let state = new BarFixture();
    await render(<template><Menubar @items={{state.items}} @platform='apple' /></template>);

    let bar = root().querySelector('[data-test-pretui-menubar-list]') as HTMLElement;
    assert.strictEqual(bar.getAttribute('role'), 'menubar');
    assert.strictEqual(bar.getAttribute('aria-label'), 'Main menu');

    let all = titles();
    assert.strictEqual(all.length, 4, 'four titles');
    assert.strictEqual(all[0].getAttribute('role'), 'menuitem');
    assert.strictEqual(all[0].getAttribute('aria-haspopup'), 'menu');
    assert.strictEqual(all[0].getAttribute('aria-expanded'), 'false');
    assert.strictEqual(
      all[3].getAttribute('aria-haspopup'),
      null,
      'a bare command advertises no popup',
    );
  });

  test('a disabled title is dimmed, focusable and announced — never removed', async function (assert) {
    let state = new BarFixture();
    await render(<template><Menubar @items={{state.items}} /></template>);
    let view = titles()[2];
    assert.strictEqual(view.getAttribute('aria-disabled'), 'true');
    assert.false(view.hasAttribute('disabled'), 'the disabled ATTRIBUTE is never used');
    assert.ok(view.tabIndex === 0 || view.tabIndex === -1, 'it stays in the roving set');
  });

  test('the whole bar is ONE tab stop, open or closed', async function (assert) {
    let state = new BarFixture();
    await render(<template><Menubar @items={{state.items}} /></template>);
    assert.strictEqual(tabStops().length, 1, 'closed: one tab stop');

    await click(titles()[0]);
    assert.strictEqual(panels().length, 1, 'the File menu is down');
    assert.strictEqual(
      tabStops().length,
      1,
      'open: still one tab stop across the bar AND its panel',
    );
  });

  test('Left/Right move the tab stop and open nothing while the bar is idle', async function (assert) {
    let state = new BarFixture();
    await render(<template><Menubar @items={{state.items}} /></template>);
    let bar = titles()[0];
    await triggerKeyEvent(bar, 'keydown', 'ArrowRight');
    assert.strictEqual(panels().length, 0, 'nothing opened');
    assert.strictEqual(titles()[1].tabIndex, 0, 'the tab stop moved to Edit');
    assert.strictEqual(document.activeElement, titles()[1], 'and so did real focus');
  });

  test('Down opens onto the first item; Up opens onto the last', async function (assert) {
    let state = new BarFixture();
    await render(<template><Menubar @items={{state.items}} /></template>);
    await triggerKeyEvent(titles()[0], 'keydown', 'ArrowDown');
    assert.strictEqual(titles()[0].getAttribute('aria-expanded'), 'true');
    assert.strictEqual(label(document.activeElement), 'New lot', 'focus lands on the first item');

    await triggerKeyEvent(document.activeElement as HTMLElement, 'keydown', 'Escape');
    await triggerKeyEvent(titles()[0], 'keydown', 'ArrowUp');
    assert.strictEqual(label(document.activeElement), 'Export', 'Up lands on the last item');
  });

  test('with a menu open, Right closes it, moves along the bar and opens the next', async function (assert) {
    let state = new BarFixture();
    await render(<template><Menubar @items={{state.items}} /></template>);
    await triggerKeyEvent(titles()[0], 'keydown', 'ArrowDown');
    assert.strictEqual(label(document.activeElement), 'New lot', 'the File menu is focused');

    // Right from a LEAF inside the menu: out of the menu, along the bar, and
    // the next title opens with focus back on the bar.
    await triggerKeyEvent(document.activeElement as HTMLElement, 'keydown', 'ArrowRight');
    assert.strictEqual(titles()[0].getAttribute('aria-expanded'), 'false', 'File closed');
    assert.strictEqual(titles()[1].getAttribute('aria-expanded'), 'true', 'Edit opened');
    assert.strictEqual(document.activeElement, titles()[1], 'focus is on the TITLE, not in the menu');
    assert.strictEqual(label(rows()[0]), 'Undo', "and Edit's menu is the one showing");
  });

  test('Escape closes the menu and returns focus to its title, staying in the bar', async function (assert) {
    let state = new BarFixture();
    await render(<template><Menubar @items={{state.items}} /></template>);
    await focusTitle(1);
    await triggerKeyEvent(titles()[1], 'keydown', 'ArrowDown');
    assert.strictEqual(panels().length, 1, "Edit's menu is down");
    await triggerKeyEvent(document.activeElement as HTMLElement, 'keydown', 'Escape');
    assert.strictEqual(panels().length, 0, 'the menu closed');
    assert.strictEqual(document.activeElement, titles()[1], 'focus is back on Edit');
  });

  test('a nested submenu opens with Right and closes one level with Left', async function (assert) {
    let state = new BarFixture();
    await render(<template><Menubar @items={{state.items}} /></template>);
    await triggerKeyEvent(titles()[0], 'keydown', 'ArrowDown');
    // New lot → Open… → Export
    await triggerKeyEvent(document.activeElement as HTMLElement, 'keydown', 'ArrowDown');
    await triggerKeyEvent(document.activeElement as HTMLElement, 'keydown', 'ArrowDown');
    assert.strictEqual(label(document.activeElement), 'Export', 'focus reached the submenu row');

    await triggerKeyEvent(document.activeElement as HTMLElement, 'keydown', 'ArrowRight');
    assert.strictEqual(panels().length, 2, 'the nested submenu is open');
    assert.strictEqual(label(document.activeElement), 'As CSV', 'on its first item');

    await triggerKeyEvent(document.activeElement as HTMLElement, 'keydown', 'ArrowLeft');
    assert.strictEqual(panels().length, 1, 'Left closed just that level');
    assert.strictEqual(label(document.activeElement), 'Export', 'focus is on its parent row');
    assert.strictEqual(titles()[0].getAttribute('aria-expanded'), 'true', 'the bar has not moved');
  });

  test('a disabled title refuses to open by keyboard or click', async function (assert) {
    let state = new BarFixture();
    await render(<template><Menubar @items={{state.items}} /></template>);
    await focusTitle(2);
    assert.strictEqual(document.activeElement, titles()[2], 'focus still reaches the dimmed title');
    await triggerKeyEvent(titles()[2], 'keydown', 'ArrowDown');
    assert.strictEqual(panels().length, 0, 'Down does nothing on a dimmed title');
    await click(titles()[2]);
    assert.strictEqual(panels().length, 0, 'and neither does a click');
  });

  test('hover is asymmetric: inert until the bar is active, immediate after', async function (assert) {
    let state = new BarFixture();
    await render(<template><Menubar @items={{state.items}} /></template>);

    await triggerEvent(titles()[1], 'pointerover');
    assert.strictEqual(panels().length, 0, 'an idle bar ignores hover entirely');

    await click(titles()[0]);
    assert.strictEqual(
      titles()[0].getAttribute('aria-expanded'),
      'true',
      'a click opens it, which is what makes the bar active',
    );

    await triggerEvent(titles()[1], 'pointerover');
    assert.strictEqual(
      titles()[1].getAttribute('aria-expanded'),
      'true',
      'an active bar switches on hover, with no dwell delay',
    );
    assert.strictEqual(titles()[0].getAttribute('aria-expanded'), 'false', 'and closes the old one');
    assert.strictEqual(label(rows()[0]), 'Undo', "and Edit's menu is the one showing");
  });

  test('clicking the open title closes it again', async function (assert) {
    let state = new BarFixture();
    await render(<template><Menubar @items={{state.items}} /></template>);
    await click(titles()[0]);
    assert.strictEqual(panels().length, 1);
    await click(titles()[0]);
    assert.strictEqual(panels().length, 0, 'a second click on the same title closes');
  });

  test('activating a command fires it and closes the bar', async function (assert) {
    let state = new BarFixture();
    await render(<template><Menubar @items={{state.items}} /></template>);
    await click(titles()[0]);
    await click(rows()[0]);
    assert.strictEqual(state.log, 'new', 'the command ran');
    assert.strictEqual(panels().length, 0, 'and the menu closed behind it');

    await click(titles()[3]);
    assert.strictEqual(state.log, 'help', 'a bare title acts on click');
  });

  test('shortcuts reach assistive tech as aria-keyshortcuts, not as glyph soup', async function (assert) {
    let state = new BarFixture();
    await render(<template><Menubar @items={{state.items}} @platform='apple' /></template>);
    await click(titles()[0]);
    let first = rows()[0];
    assert.strictEqual(first.getAttribute('aria-keyshortcuts'), 'Meta+N');
    assert.true(norm(first).includes('⌘N'), 'while the eye gets the Apple glyph run');
  });

  test('type-ahead moves along the bar, then within the open menu', async function (assert) {
    let state = new BarFixture();
    await render(<template><Menubar @items={{state.items}} /></template>);
    await triggerKeyEvent(titles()[0], 'keydown', 'H');
    assert.strictEqual(document.activeElement, titles()[3], '"h" jumps to Help');

    await triggerKeyEvent(titles()[3], 'keydown', 'E');
    assert.strictEqual(document.activeElement, titles()[1], '"e" wraps around to Edit');

    await triggerKeyEvent(titles()[1], 'keydown', 'ArrowDown');
    await triggerKeyEvent(document.activeElement as HTMLElement, 'keydown', 'T');
    assert.strictEqual(
      label(document.activeElement),
      'Track changes',
      'and then within the open menu',
    );
  });
});
