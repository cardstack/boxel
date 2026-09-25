// Pretui — proof for the menu tier (menu.gts + focus.gts).
//
// Two halves, deliberately:
//
//  1. **Pure geometry and text**, asserted without a DOM. The Amazon safe
//     triangle, the shortcut platform mapping, the fuzzy matcher and the
//     type-ahead index are all plain functions precisely so that the hardest
//     logic in the tier is testable at this level rather than being argued
//     for in prose. The triangle in particular is a behaviour nobody can see
//     in a screenshot and everybody gets wrong.
//
//  2. **Render proof** for the parts only a browser can settle: the
//     aria-disabled defect, mixed state, the roving tab stop, submenu open
//     and close by keyboard, Escape closing exactly one level, and the
//     palette's filter/scope behaviour.
import { module, test } from 'qunit';
import { render, click, settled, triggerKeyEvent, fillIn } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import {
  OwnedTimers,
  TypeaheadBuffer,
  inSafeTriangle,
  pointInTriangle,
  safeEdgeFor,
  typeaheadIndex,
} from './focus';
import {
  CommandPalette,
  Menu,
  ariaKeyShortcuts,
  formatShortcut,
  fuzzyMatch,
  matchSegments,
  parseShortcut,
} from './menu';
import type { MenuEntry } from './menu';

// ── 1. The safe triangle ─────────────────────────────────────────────────
//
// The scene these numbers describe, in viewport coordinates:
//
//     menu panel            submenu
//   ┌──────────────┐      ┌──────────────┐
//   │ item A       │ 200  │              │ 60
//   │ item B  ▸    │──────│  submenu     │
//   │ item C       │      │              │ 160
//   └──────────────┘      └──────────────┘
//                        ^ near edge, x = 200
//
// The pointer sits on "item B" at (150, 110) and moves toward the submenu.
// Any position inside the triangle (150,110)→(200,50)→(200,170) means the
// reader is travelling to the submenu, and the sibling row the pointer
// crosses must NOT take over the hover.

const SUBMENU = { left: 200, right: 360, top: 60, bottom: 160 };

module('Pretui | menu | safe triangle', function () {
  test('the near edge is the side the pointer approaches from', function (assert) {
    let right = safeEdgeFor(SUBMENU, 'right', 10);
    assert.strictEqual(right.x, 200, 'a submenu opened rightward is met at its left edge');
    assert.strictEqual(right.top, 50, 'tolerance grows the edge upward');
    assert.strictEqual(right.bottom, 170, 'and downward');

    let left = safeEdgeFor(SUBMENU, 'left', 10);
    assert.strictEqual(left.x, 360, 'a submenu opened leftward is met at its right edge');
  });

  test('a diagonal aimed at the submenu defers the sibling', function (assert) {
    let edge = safeEdgeFor(SUBMENU, 'right');
    // Down-and-right toward the submenu's lower half: the classic diagonal
    // that crosses the row below the parent item.
    assert.true(
      inSafeTriangle({ x: 150, y: 110 }, { x: 168, y: 126 }, edge),
      'travelling diagonally into the submenu is inside the triangle',
    );
    // Up-and-right toward the submenu's upper half.
    assert.true(
      inSafeTriangle({ x: 150, y: 110 }, { x: 170, y: 95 }, edge),
      'the upward diagonal counts too',
    );
  });

  test('movement away from the submenu does not defer', function (assert) {
    let edge = safeEdgeFor(SUBMENU, 'right');
    assert.false(
      inSafeTriangle({ x: 150, y: 110 }, { x: 150, y: 150 }, edge),
      'straight down the menu is a normal hover, not a diagonal',
    );
    assert.false(
      inSafeTriangle({ x: 150, y: 110 }, { x: 120, y: 130 }, edge),
      'moving left, away from the submenu, is never deferred',
    );
    assert.false(
      inSafeTriangle({ x: 150, y: 110 }, { x: 260, y: 300 }, edge),
      'past the submenu edge and well below it is outside the triangle',
    );
  });

  test('a stationary pointer stops qualifying, so the sibling always wins eventually', function (assert) {
    let edge = safeEdgeFor(SUBMENU, 'right');
    assert.false(
      inSafeTriangle({ x: 168, y: 126 }, { x: 168, y: 126 }, edge),
      'no movement is not travel',
    );
  });

  test('the triangle mirrors for a submenu that flipped to the left', function (assert) {
    let edge = safeEdgeFor(SUBMENU, 'left');
    assert.true(
      inSafeTriangle({ x: 420, y: 110 }, { x: 392, y: 126 }, edge),
      'travelling leftward into a flipped submenu is inside its triangle',
    );
    assert.false(
      inSafeTriangle({ x: 420, y: 110 }, { x: 440, y: 126 }, edge),
      'travelling further right, away from it, is not',
    );
  });

  test('point-in-triangle is inclusive on the edges', function (assert) {
    let a = { x: 0, y: 0 };
    let b = { x: 10, y: 0 };
    let c = { x: 0, y: 10 };
    assert.true(pointInTriangle({ x: 1, y: 1 }, a, b, c), 'interior');
    assert.true(pointInTriangle({ x: 5, y: 0 }, a, b, c), 'on an edge');
    assert.false(pointInTriangle({ x: 6, y: 6 }, a, b, c), 'outside');
  });
});

// ── 2. Shortcuts ─────────────────────────────────────────────────────────

module('Pretui | menu | shortcuts', function () {
  test('one spec renders both platforms', function (assert) {
    assert.strictEqual(formatShortcut('Mod+K', 'apple'), '⌘K');
    assert.strictEqual(formatShortcut('Mod+K', 'other'), 'Ctrl+K');
    assert.strictEqual(formatShortcut('Mod+Shift+P', 'apple'), '⇧⌘P');
    assert.strictEqual(formatShortcut('Mod+Shift+P', 'other'), 'Ctrl+Shift+P');
  });

  test('Apple modifier order is ⌃⌥⇧⌘ regardless of how it was typed', function (assert) {
    assert.strictEqual(formatShortcut('Meta+Shift+Alt+Ctrl+D', 'apple'), '⌃⌥⇧⌘D');
  });

  test('literal faces pass through, so pre-rebuild call sites keep rendering', function (assert) {
    assert.strictEqual(formatShortcut('⌘K', 'apple'), '⌘K');
    assert.strictEqual(formatShortcut('F2', 'other'), 'F2');
    assert.strictEqual(parseShortcut('⌘K', 'apple'), null);
  });

  test('aria-keyshortcuts is the platform-neutral spelling', function (assert) {
    assert.strictEqual(ariaKeyShortcuts('Mod+Shift+P', 'apple'), 'Shift+Meta+P');
    assert.strictEqual(ariaKeyShortcuts('Mod+Shift+P', 'other'), 'Control+Shift+P');
    assert.strictEqual(
      ariaKeyShortcuts('⌘K', 'apple'),
      undefined,
      'a literal face has no spec to announce',
    );
  });

  test('named keys get their glyphs where the platform expects them', function (assert) {
    assert.strictEqual(formatShortcut('ArrowUp', 'other'), '↑', 'arrows are universal');
    assert.strictEqual(formatShortcut('Mod+Backspace', 'apple'), '⌘⌫');
    assert.strictEqual(formatShortcut('Escape', 'other'), 'Esc');
  });
});

// ── 3. Fuzzy matching ────────────────────────────────────────────────────

module('Pretui | menu | fuzzy match', function () {
  test('word-boundary initials beat inner letters', function (assert) {
    let match = fuzzyMatch('cs', 'Copy Selection');
    assert.ok(match, 'matches');
    assert.deepEqual(
      match?.ranges,
      [
        [0, 1],
        [5, 6],
      ],
      'C of Copy and S of Selection, not the s inside "Selection"',
    );
  });

  test('a contiguous prefix outranks a scattered subsequence', function (assert) {
    let prefix = fuzzyMatch('sel', 'Select all');
    let scattered = fuzzyMatch('sel', 'Show every label');
    assert.ok(prefix && scattered, 'both match');
    assert.true(
      (prefix?.score ?? 0) > (scattered?.score ?? 0),
      'the prefix hit scores higher',
    );
  });

  test('a missing character is no match at all', function (assert) {
    assert.strictEqual(fuzzyMatch('zq', 'Copy Selection'), null);
  });

  test('segments reconstruct the original text exactly', function (assert) {
    let match = fuzzyMatch('cs', 'Copy Selection');
    let segments = matchSegments('Copy Selection', match?.ranges ?? []);
    assert.strictEqual(
      segments.map((s) => s.text).join(''),
      'Copy Selection',
      'nothing is lost or duplicated in highlighting',
    );
    assert.deepEqual(
      segments.filter((s) => s.hit).map((s) => s.text),
      ['C', 'S'],
    );
  });
});

// ── 4. Type-ahead ────────────────────────────────────────────────────────

const LABELS = ['Duplicate', 'Delete', 'Details', 'Move', 'Rename'];

module('Pretui | menu | type-ahead', function () {
  test('a single character steps to the NEXT match, so repeats cycle', function (assert) {
    assert.strictEqual(typeaheadIndex(LABELS, 'd', 0), 1, 'Duplicate → Delete');
    assert.strictEqual(typeaheadIndex(LABELS, 'd', 1), 2, 'Delete → Details');
    assert.strictEqual(typeaheadIndex(LABELS, 'd', 2), 0, 'and wraps');
  });

  test('a multi-character buffer narrows without moving off a still-valid match', function (assert) {
    assert.strictEqual(typeaheadIndex(LABELS, 'det', 2), 2, 'Details stays Details');
    assert.strictEqual(typeaheadIndex(LABELS, 'del', 0), 1, 'Delete');
  });

  test('no match returns -1 rather than moving somewhere arbitrary', function (assert) {
    assert.strictEqual(typeaheadIndex(LABELS, 'zz', 0), -1);
  });

  test('the buffer degrades to single characters when no modifier owns its timer', function (assert) {
    let timers = new OwnedTimers();
    let buffer = new TypeaheadBuffer(timers);
    assert.strictEqual(buffer.push('d'), 'd');
    assert.strictEqual(
      buffer.push('e'),
      'e',
      'unowned: no timer is scheduled and the buffer never accumulates',
    );
    buffer.reset();
    timers.adopt();
    assert.strictEqual(buffer.push('d'), 'd');
    assert.strictEqual(buffer.push('e'), 'de', 'owned: it accumulates');
    assert.true(buffer.push('e') === 'dee');
    buffer.reset();
    assert.strictEqual(buffer.value, '');
    timers.release();
  });

  test('a repeated character is reported as cycling, per the APG', function (assert) {
    let timers = new OwnedTimers();
    timers.adopt();
    let buffer = new TypeaheadBuffer(timers);
    buffer.push('d');
    buffer.push('d');
    assert.true(buffer.isCycling, 'dd cycles on d');
    buffer.reset();
    buffer.push('d');
    buffer.push('e');
    assert.false(buffer.isCycling, 'de narrows');
    timers.release();
  });
});

// ── 5. Render proof ──────────────────────────────────────────────────────

class MenuState {
  @tracked bold: boolean | 'mixed' = 'mixed';
  @tracked lastRun = '';
  @tracked paletteOpen = false;

  get items(): MenuEntry[] {
    return [
      { label: 'Duplicate', kbd: 'Mod+D', onSelect: () => (this.lastRun = 'duplicate') },
      { label: 'Rename', needsInput: true, isDefault: true },
      {
        kind: 'toggle',
        label: 'Bold',
        kbd: 'Mod+B',
        checked: this.bold,
        onChange: (next: boolean) => (this.bold = next),
      },
      {
        kind: 'submenu',
        label: 'Share',
        items: [
          { label: 'Copy link', onSelect: () => (this.lastRun = 'copy-link') },
          { label: 'Email', disabled: true },
        ],
      },
      { kind: 'section', label: 'View', items: [{ kind: 'radio', group: 'v', label: 'List', checked: true }] },
      '---',
      { label: 'Delete', destructive: true, disabled: true },
    ];
  }
}

/** textContent with template whitespace collapsed: a highlighted palette row
 * is several text nodes, so its raw textContent is full of newlines. */
function norm(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}
function root(): HTMLElement {
  return document.querySelector('#ember-testing') as HTMLElement;
}
function items(): HTMLElement[] {
  return Array.from(
    root().querySelectorAll('[data-test-pretui-menu-panel] [data-menu-key]'),
  ) as HTMLElement[];
}
function panels(): HTMLElement[] {
  return Array.from(
    root().querySelectorAll('[data-test-pretui-menu-panel]'),
  ) as HTMLElement[];
}
function byLabel(label: string): HTMLElement {
  return items().find((el) => norm(el).startsWith(label)) as HTMLElement;
}

module('Pretui | menu | render', function (hooks) {
  setupCardTest(hooks);
  // A hang here would take the whole suite down with it (QUnit never reaches
  // runEnd), which hides everyone else's failures. A per-test deadline turns
  // any hang into an ordinary failure.
  hooks.beforeEach(function (assert) {
    assert.timeout(8000);
  });

  test('a disabled item is dimmed, focusable and announced — never removed from the tab order', async function (assert) {
    let state = new MenuState();
    await render(
      <template>
        <Menu @items={{state.items}} @platform='apple'>
          <:trigger as |open toggle|>
            <button type='button' {{on 'click' toggle}}>{{if open 'Close' 'Open'}}</button>
          </:trigger>
        </Menu>
      </template>,
    );
    await click('button');
    let del = byLabel('Delete');
    assert.strictEqual(del.getAttribute('aria-disabled'), 'true', 'aria-disabled is set');
    assert.false(del.hasAttribute('disabled'), 'the disabled ATTRIBUTE is never used');
    assert.strictEqual(del.tagName, 'LI', 'items are list items, reachable by roving tabindex');
    assert.ok(del.tabIndex === 0 || del.tabIndex === -1, 'it is in the roving set');
  });

  test('the trigger gets the menu-button contract without the caller wiring it', async function (assert) {
    let state = new MenuState();
    await render(
      <template>
        <Menu @items={{state.items}}>
          <:trigger as |open toggle|>
            <button type='button' {{on 'click' toggle}}>{{if open 'Close' 'Open'}}</button>
          </:trigger>
        </Menu>
      </template>,
    );
    let trigger = root().querySelector(
      '.pretui-menu-trigger button',
    ) as HTMLElement;
    assert.strictEqual(trigger.getAttribute('aria-haspopup'), 'menu');
    assert.strictEqual(trigger.getAttribute('aria-expanded'), 'false');
    await click(trigger);
    assert.strictEqual(trigger.getAttribute('aria-expanded'), 'true');
  });

  test('exactly one item is in the tab sequence (roving tabindex)', async function (assert) {
    let state = new MenuState();
    await render(
      <template>
        <Menu @items={{state.items}}>
          <:trigger as |_open toggle|>
            <button type='button' {{on 'click' toggle}}>Open</button>
          </:trigger>
        </Menu>
      </template>,
    );
    await click('button');
    let zero = items().filter((el) => el.tabIndex === 0);
    assert.strictEqual(zero.length, 1, 'one tab stop for the whole menu');
  });

  test('mixed state renders a dash and announces aria-checked="mixed"', async function (assert) {
    let state = new MenuState();
    await render(
      <template>
        <Menu @items={{state.items}}>
          <:trigger as |_open toggle|>
            <button type='button' {{on 'click' toggle}}>Open</button>
          </:trigger>
        </Menu>
      </template>,
    );
    await click('button');
    let bold = byLabel('Bold');
    assert.strictEqual(bold.getAttribute('role'), 'menuitemcheckbox');
    assert.strictEqual(bold.getAttribute('aria-checked'), 'mixed');
    assert.strictEqual(bold.dataset.check, 'mixed');

    // activating a mixed toggle turns it ON (never off), like every OS menu
    await click(bold);
    assert.strictEqual(state.bold, true, 'mixed flips to checked');
  });

  test('an unchecked toggle still carries aria-checked="false"', async function (assert) {
    let state = new MenuState();
    state.bold = false;
    await render(
      <template>
        <Menu @items={{state.items}}>
          <:trigger as |_open toggle|>
            <button type='button' {{on 'click' toggle}}>Open</button>
          </:trigger>
        </Menu>
      </template>,
    );
    await click('button');
    assert.strictEqual(byLabel('Bold').getAttribute('aria-checked'), 'false');
  });

  test('sections become labelled groups and separators get the separator role', async function (assert) {
    let state = new MenuState();
    await render(
      <template>
        <Menu @items={{state.items}}>
          <:trigger as |_open toggle|>
            <button type='button' {{on 'click' toggle}}>Open</button>
          </:trigger>
        </Menu>
      </template>,
    );
    await click('button');
    let group = root().querySelector('[role="group"]') as HTMLElement;
    assert.ok(group, 'a group exists');
    let labelId = group.getAttribute('aria-labelledby');
    assert.strictEqual(
      document.getElementById(labelId ?? '')?.textContent?.trim(),
      'View',
      'the group is named by its visible header',
    );
    assert.ok(root().querySelector('[role="separator"]'), 'the separator has its role');
  });

  test('the ellipsis convention is applied by the component, not typed by callers', async function (assert) {
    let state = new MenuState();
    await render(
      <template>
        <Menu @items={{state.items}}>
          <:trigger as |_open toggle|>
            <button type='button' {{on 'click' toggle}}>Open</button>
          </:trigger>
        </Menu>
      </template>,
    );
    await click('button');
    assert.ok(
      norm(byLabel('Rename')).includes('…'),
      'needsInput renders U+2026, never three periods',
    );
  });

  test('ArrowRight opens a submenu and ArrowLeft closes exactly one level', async function (assert) {
    let state = new MenuState();
    await render(
      <template>
        <Menu @items={{state.items}}>
          <:trigger as |_open toggle|>
            <button type='button' {{on 'click' toggle}}>Open</button>
          </:trigger>
        </Menu>
      </template>,
    );
    await click('button');
    assert.strictEqual(panels().length, 1, 'one panel to start');

    let share = byLabel('Share');
    assert.strictEqual(share.getAttribute('aria-haspopup'), 'menu');
    assert.strictEqual(share.getAttribute('aria-expanded'), 'false');

    // Walk the roving focus down to Share (Duplicate, Rename, Bold, Share),
    // then open it. Keydown is delegated on the wrapper, so it does not
    // matter which item the event is dispatched on — only where focus is.
    let panel = panels()[0];
    await triggerKeyEvent(panel, 'keydown', 'ArrowDown');
    await triggerKeyEvent(panel, 'keydown', 'ArrowDown');
    await triggerKeyEvent(panel, 'keydown', 'ArrowDown');
    assert.strictEqual(
      norm(document.activeElement).slice(0, 5),
      'Share',
      'ArrowDown walked the roving focus to Share',
    );
    await triggerKeyEvent(panel, 'keydown', 'ArrowRight');
    assert.strictEqual(panels().length, 2, 'the submenu opened');
    assert.strictEqual(
      byLabel('Share').getAttribute('aria-expanded'),
      'true',
      'aria-expanded tracks it',
    );
    assert.ok(
      norm(document.activeElement).startsWith('Copy link'),
      'focus moved to the submenu’s first item',
    );

    await triggerKeyEvent(panel, 'keydown', 'ArrowLeft');
    assert.strictEqual(panels().length, 1, 'ArrowLeft closed one level');
    assert.ok(
      norm(document.activeElement).startsWith('Share'),
      'and returned focus to the parent item',
    );
  });

  test('Escape closes one level, then the whole menu, returning focus to the trigger', async function (assert) {
    let state = new MenuState();
    await render(
      <template>
        <Menu @items={{state.items}}>
          <:trigger as |_open toggle|>
            <button type='button' {{on 'click' toggle}}>Open</button>
          </:trigger>
        </Menu>
      </template>,
    );
    let trigger = root().querySelector('button') as HTMLElement;
    await click(trigger);
    let share = byLabel('Share');
    await click(share);
    await settled();
    assert.strictEqual(panels().length, 2, 'clicking a submenu parent opens it');

    await triggerKeyEvent(document.activeElement as HTMLElement, 'keydown', 'Escape');
    assert.strictEqual(panels().length, 1, 'one level closed, not the whole menu');

    await triggerKeyEvent(document.activeElement as HTMLElement, 'keydown', 'Escape');
    assert.strictEqual(panels().length, 0, 'the menu closed');
    assert.strictEqual(document.activeElement, trigger, 'focus came back to the trigger');
  });

  test('a disabled item does not activate', async function (assert) {
    let state = new MenuState();
    await render(
      <template>
        <Menu @items={{state.items}}>
          <:trigger as |_open toggle|>
            <button type='button' {{on 'click' toggle}}>Open</button>
          </:trigger>
        </Menu>
      </template>,
    );
    await click('button');
    await click(byLabel('Delete'));
    assert.strictEqual(panels().length, 1, 'the menu stays open');
    assert.strictEqual(state.lastRun, '', 'nothing ran');
  });

  test('shortcuts are hidden from the name and mirrored into aria-keyshortcuts', async function (assert) {
    let state = new MenuState();
    await render(
      <template>
        <Menu @items={{state.items}} @platform='apple'>
          <:trigger as |_open toggle|>
            <button type='button' {{on 'click' toggle}}>Open</button>
          </:trigger>
        </Menu>
      </template>,
    );
    await click('button');
    let duplicate = byLabel('Duplicate');
    assert.strictEqual(duplicate.getAttribute('aria-keyshortcuts'), 'Meta+D');
    let kbd = duplicate.querySelector('.pretui-menukbd') as HTMLElement;
    assert.strictEqual(kbd.textContent, '⌘D', 'the eye gets the glyph');
    assert.strictEqual(kbd.getAttribute('aria-hidden'), 'true', 'assistive tech does not');
  });
});

// ── 6. Command palette ───────────────────────────────────────────────────

function paletteRows(): HTMLElement[] {
  return Array.from(
    root().querySelectorAll('[data-test-pretui-command-palette] [role="option"]'),
  ) as HTMLElement[];
}

module('Pretui | command palette | render', function (hooks) {
  setupCardTest(hooks);
  hooks.beforeEach(function (assert) {
    assert.timeout(8000);
  });

  test('the same tree renders flattened, filtered and scoped', async function (assert) {
    let state = new MenuState();
    let noop = () => {
      state.paletteOpen = false;
    };
    await render(
      <template>
        <CommandPalette
          @items={{state.items}}
          @open={{state.paletteOpen}}
          @onClose={{noop}}
          @platform='apple'
        />
      </template>,
    );
    state.paletteOpen = true;
    await settled();
    assert.true(paletteRows().length > 0, 'rows render from the same MenuNode tree');

    let input = root().querySelector(
      '[data-test-pretui-palette-input]',
    ) as HTMLInputElement;
    assert.strictEqual(input.getAttribute('role'), 'combobox');
    assert.strictEqual(
      input.getAttribute('aria-activedescendant'),
      paletteRows()[0].id,
      'the active row is pointed at, not focused',
    );

    await fillIn(input, 'copy');
    let labels = paletteRows().map(norm);
    assert.true(
      labels.some((l) => l.startsWith('Copy link')),
      'searching reaches INTO submenus — nesting survives flattening',
    );
    assert.ok(
      root().querySelector('.pal-hit'),
      'the matched characters are highlighted',
    );

    await fillIn(input, 'zzzz');
    assert.strictEqual(paletteRows().length, 0, 'no rows');
    assert.ok(root().querySelector('.pal-empty'), 'and an empty state instead');
  });

  test('a toggle keeps its mixed state in the palette', async function (assert) {
    let state = new MenuState();
    let noop = () => {};
    await render(
      <template>
        <CommandPalette
          @items={{state.items}}
          @open={{state.paletteOpen}}
          @onClose={{noop}}
        />
      </template>,
    );
    state.paletteOpen = true;
    await settled();
    let bold = paletteRows().find((el) =>
      norm(el).startsWith('Bold'),
    ) as HTMLElement;
    assert.strictEqual(
      bold.getAttribute('aria-checked'),
      'mixed',
      'checkbox state is part of the node, not the presentation',
    );
  });

  test('entering a submenu scope leaves a breadcrumb, and Enter runs a command', async function (assert) {
    let state = new MenuState();
    let closed = 0;
    let onClose = () => {
      closed++;
      state.paletteOpen = false;
    };
    await render(
      <template>
        <CommandPalette
          @items={{state.items}}
          @open={{state.paletteOpen}}
          @onClose={{onClose}}
        />
      </template>,
    );
    state.paletteOpen = true;
    await settled();
    let share = paletteRows().find((el) =>
      norm(el).startsWith('Share'),
    ) as HTMLElement;
    await click(share);
    assert.ok(
      root().querySelector('[data-test-pretui-palette-crumbs]'),
      'descending into a submenu shows the scope as a breadcrumb',
    );
    let scoped = paletteRows().map(norm);
    assert.true(
      scoped.some((l) => l.startsWith('Copy link')),
      'the scope shows the submenu’s own items',
    );

    let input = root().querySelector(
      '[data-test-pretui-palette-input]',
    ) as HTMLInputElement;
    await triggerKeyEvent(input, 'keydown', 'Enter');
    assert.strictEqual(state.lastRun, 'copy-link', 'Enter ran the active command');
    assert.strictEqual(closed, 1, 'and the palette closed once');
  });
});
