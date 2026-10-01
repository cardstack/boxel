// Pretui — proof for the right-click menu (menu-context.gts).
//
// Same split as menubar.test.gts: the decisions that can be expressed as pure
// functions are driven directly, and only the rest is rendered.
//
//  1. `isContextMenuKey` and `keyboardPoint` — the keyboard invocation
//     contract, which is the part every implementation skips and therefore the
//     part most worth pinning down.
//  2. Render proof for the roles, the single tab stop, the keyboard path, the
//     aria-disabled contract, and focus returning to the region on dismissal.
//
// Local-only test file; run with `boxel test` from this directory — do NOT
// push to the realm.
import { module, test } from 'qunit';
import { render, click, triggerEvent, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { tracked } from '@glimmer/tracking';
import { ContextMenu, isContextMenuKey, keyboardPoint } from './components/context-menu';
import type { MenuEntry } from './internal/menu';
import { DEMOS_CONTEXT_MENU } from './components/context-menu.usage';

// ── 1. The invocation contract, as data ──────────────────────────────────

module('Pretui | ContextMenu | invocation', function () {
  test('Shift+F10 and the Menu key are the platform request; nothing else is', function (assert) {
    assert.true(isContextMenuKey('F10', true), 'Shift+F10 opens it');
    assert.false(isContextMenuKey('F10', false), 'bare F10 does not');
    assert.true(isContextMenuKey('ContextMenu', false), 'the Menu key opens it');
    assert.true(
      isContextMenuKey('ContextMenu', true),
      'and Shift makes no difference to the Menu key',
    );
    assert.false(isContextMenuKey('Enter', true), 'Enter is not the request');
    assert.false(
      isContextMenuKey('F10', true, true),
      'Ctrl+Shift+F10 belongs to the host, not to us',
    );
    assert.false(
      isContextMenuKey('ContextMenu', false, false, true),
      'and so does a Meta-modified Menu key',
    );
  });

  test('a keyboard invocation anchors on the region, never at the origin', function (assert) {
    let point = keyboardPoint({ left: 120, top: 300, height: 90 });
    assert.strictEqual(point.x, 120, 'x is the start edge of the thing');
    assert.strictEqual(
      point.y,
      324,
      'y is a short way down it, so the menu reads as attached without covering the first line',
    );

    let short = keyboardPoint({ left: 0, top: 40, height: 10 });
    assert.strictEqual(
      short.y,
      50,
      'a short region is not overshot — the offset is clamped to its own height',
    );
  });
});

// ── 2. Render proof ──────────────────────────────────────────────────────

class Board {
  @tracked log = '—';
  @tracked pinned = false;

  setPinned = (next: boolean) => (this.pinned = next);

  get items(): MenuEntry[] {
    return [
      { label: 'Open lot', onSelect: () => (this.log = 'Open lot') },
      { label: 'Rename', needsInput: true, onSelect: () => (this.log = 'Rename') },
      { label: 'Archive', disabled: true },
      '---',
      {
        kind: 'submenu',
        label: 'Share',
        items: [{ label: 'Copy link', onSelect: () => (this.log = 'Copy link') }],
      },
      {
        label: 'Withdraw',
        destructive: true,
        onSelect: () => (this.log = 'Withdraw'),
      },
    ];
  }
}

async function rightClick(el: Element, x = 200, y = 200) {
  await triggerEvent(el, 'contextmenu', { button: 2, clientX: x, clientY: y });
}

module('Pretui | ContextMenu | render', function (hooks) {
  setupCardTest(hooks);

  test('the region is reachable, and a right-click opens a real menu', async function (assert) {
    let board = new Board();

    await render(<template>
      <ContextMenu @items={{board.items}} @label='Lot actions'>
        <:default>
          <div data-test-board>Arrivals board</div>
        </:default>
      </ContextMenu>
    </template>);

    let region = document.querySelector(
      '[data-test-pretui-contextmenu-region]',
    ) as HTMLElement;
    assert.strictEqual(
      region.tabIndex,
      0,
      'the region takes a tab stop, which is what makes the platform keys fire on it at all',
    );
    assert.notOk(
      document.querySelector('[role="menu"]'),
      'nothing is open to begin with',
    );

    await rightClick(region);

    let menu = document.querySelector('[role="menu"]');
    assert.ok(menu, 'a right-click opens the menu');
    assert.strictEqual(
      menu?.getAttribute('aria-label'),
      'Lot actions',
      'named by the caller',
    );
    assert.strictEqual(
      document
        .querySelector('[data-test-pretui-contextmenu]')
        ?.getAttribute('data-state'),
      'open',
      'and the surface reflects its state for styling and for tests',
    );
  });

  test('the rows come from the shared MenuNode transform, ellipsis and all', async function (assert) {
    let board = new Board();

    await render(<template>
      <ContextMenu @items={{board.items}}>
        <:default><div data-test-board>board</div></:default>
      </ContextMenu>
    </template>);

    await rightClick(
      document.querySelector('[data-test-pretui-contextmenu-region]')!,
    );

    let rows = document.querySelectorAll('[role="menuitem"]');
    assert.strictEqual(rows.length, 5, 'five focusable rows, separator excluded');

    let labels = Array.from(rows).map((r) => r.textContent?.trim());
    assert.ok(
      labels[1]?.startsWith('Rename…') || labels[1]?.includes('…'),
      'needsInput appended the HIG ellipsis, applied by the shared transform rather than typed',
    );

    let archive = rows[2] as HTMLElement;
    assert.strictEqual(
      archive.getAttribute('aria-disabled'),
      'true',
      'a dimmed command uses aria-disabled',
    );
    assert.strictEqual(
      archive.getAttribute('disabled'),
      null,
      'never the disabled attribute, so it stays focusable and announced',
    );

    assert.ok(
      document.querySelector('[role="separator"]'),
      'the separator rendered',
    );
  });

  test('a right-click opens without stealing focus; Shift+F10 opens ON the first item', async function (assert) {
    let board = new Board();

    await render(<template>
      <ContextMenu @items={{board.items}}>
        <:default><div data-test-board>board</div></:default>
      </ContextMenu>
    </template>);

    let region = document.querySelector(
      '[data-test-pretui-contextmenu-region]',
    ) as HTMLElement;

    await rightClick(region);
    let firstRow = document.querySelector('[role="menuitem"]') as HTMLElement;
    assert.notStrictEqual(
      document.activeElement,
      firstRow,
      'a pointer invocation leaves focus alone, exactly as a platform menu does',
    );

    await triggerKeyEvent(document, 'keydown', 'Escape');

    region.focus();
    await triggerKeyEvent(region, 'keydown', 'F10', { shiftKey: true });
    let row = document.querySelector('[role="menuitem"]') as HTMLElement;
    assert.strictEqual(
      document.activeElement,
      row,
      'a keyboard invocation lands on the first item, per the APG',
    );
  });

  test('arrows walk, the submenu opens and closes, and Enter activates', async function (assert) {
    let board = new Board();

    await render(<template>
      <ContextMenu @items={{board.items}}>
        <:default><div data-test-board>board</div></:default>
      </ContextMenu>
    </template>);

    let region = document.querySelector(
      '[data-test-pretui-contextmenu-region]',
    ) as HTMLElement;
    region.focus();
    await triggerKeyEvent(region, 'keydown', 'F10', { shiftKey: true });

    let rows = () =>
      document.querySelectorAll('[role="menuitem"]') as NodeListOf<HTMLElement>;

    await triggerKeyEvent(document.activeElement!, 'keydown', 'ArrowDown');
    assert.strictEqual(
      document.activeElement,
      rows()[1],
      'Down moves to the next row',
    );

    await triggerKeyEvent(document.activeElement!, 'keydown', 'End');
    let last = rows()[rows().length - 1];
    assert.strictEqual(document.activeElement, last, 'End reaches the last row');

    await triggerKeyEvent(document.activeElement!, 'keydown', 'ArrowUp');
    let share = document.activeElement as HTMLElement;
    assert.strictEqual(
      share.getAttribute('aria-haspopup'),
      'menu',
      'and Up lands on the submenu parent',
    );

    await triggerKeyEvent(share, 'keydown', 'ArrowRight');
    assert.strictEqual(
      document.querySelectorAll('[role="menu"]').length,
      2,
      'Right opens the submenu',
    );
    assert.strictEqual(
      (document.activeElement as HTMLElement).textContent?.trim(),
      'Copy link',
      'with focus on its first item',
    );

    await triggerKeyEvent(document.activeElement!, 'keydown', 'ArrowLeft');
    assert.strictEqual(
      document.querySelectorAll('[role="menu"]').length,
      1,
      'Left closes it again',
    );

    await triggerKeyEvent(document.activeElement!, 'keydown', 'Enter');
    assert.strictEqual(board.log, '—', 'a submenu parent does not activate a command');
  });

  test('Escape closes one level at a time and the last one returns focus to the region', async function (assert) {
    let board = new Board();

    await render(<template>
      <ContextMenu @items={{board.items}}>
        <:default><div data-test-board>board</div></:default>
      </ContextMenu>
    </template>);

    let region = document.querySelector(
      '[data-test-pretui-contextmenu-region]',
    ) as HTMLElement;
    region.focus();
    await triggerKeyEvent(region, 'keydown', 'F10', { shiftKey: true });
    await triggerKeyEvent(document.activeElement!, 'keydown', 'End');
    await triggerKeyEvent(document.activeElement!, 'keydown', 'ArrowUp');
    await triggerKeyEvent(document.activeElement!, 'keydown', 'ArrowRight');
    assert.strictEqual(
      document.querySelectorAll('[role="menu"]').length,
      2,
      'two levels open',
    );

    await triggerKeyEvent(document, 'keydown', 'Escape');
    assert.strictEqual(
      document.querySelectorAll('[role="menu"]').length,
      1,
      'Escape closed exactly one level',
    );

    await triggerKeyEvent(document, 'keydown', 'Escape');
    assert.strictEqual(
      document.querySelectorAll('[role="menu"]').length,
      0,
      'and then the menu',
    );
    assert.strictEqual(
      document.activeElement,
      region,
      'focus went back to the thing the menu was about, not onto the body',
    );
  });

  test('clicking an item runs it, closes the menu and reports through onSelect', async function (assert) {
    let board = new Board();
    let picked: string[] = [];
    let onSelect = (node: { label: string }) => picked.push(node.label);

    await render(<template>
      <ContextMenu @items={{board.items}} @onSelect={{onSelect}}>
        <:default><div data-test-board>board</div></:default>
      </ContextMenu>
    </template>);

    await rightClick(
      document.querySelector('[data-test-pretui-contextmenu-region]')!,
    );
    await click(document.querySelector('[role="menuitem"]')!);

    assert.strictEqual(board.log, 'Open lot', "the node's own onSelect ran");
    assert.deepEqual(picked, ['Open lot'], 'and the component reported it too');
    assert.strictEqual(
      document.querySelectorAll('[role="menu"]').length,
      0,
      'activation closes the menu',
    );
  });

  test('a disabled row is inert but still there', async function (assert) {
    let board = new Board();

    await render(<template>
      <ContextMenu @items={{board.items}}>
        <:default><div data-test-board>board</div></:default>
      </ContextMenu>
    </template>);

    await rightClick(
      document.querySelector('[data-test-pretui-contextmenu-region]')!,
    );
    let archive = document.querySelectorAll('[role="menuitem"]')[2];
    await click(archive);

    assert.strictEqual(board.log, '—', 'nothing ran');
    assert.strictEqual(
      document.querySelectorAll('[role="menu"]').length,
      1,
      'and the menu stayed open, because a dimmed command is not a dismissal',
    );
  });

  test('@focusable=false leaves the region out of the tab order', async function (assert) {
    let board = new Board();

    await render(<template>
      <ContextMenu @items={{board.items}} @focusable={{false}}>
        <:default><div data-test-board>board</div></:default>
      </ContextMenu>
    </template>);

    let region = document.querySelector(
      '[data-test-pretui-contextmenu-region]',
    ) as HTMLElement;
    assert.strictEqual(
      region.tabIndex,
      -1,
      'opted out, and documented as making the menu pointer-only',
    );
  });
});

// ── Usage pages ──────────────────────────────────────────────────────────
//
// The demo registry is what the gallery mounts. Rendering each page here is
// the cheap standing regression for it: a usage page that throws takes the
// whole gallery down, and it does so at a point far from the edit that caused
// it.

/* eslint-disable @typescript-eslint/no-explicit-any -- the DEMOS_* registries
   are Record<string, unknown> by contract; the gallery casts them the same
   way. */
const PAGES: Record<string, any> = { ...DEMOS_CONTEXT_MENU } as Record<string, any>;

module('Pretui | ContextMenu | usage page', function (hooks) {
  setupCardTest(hooks);

  test('the ContextMenu usage page renders', async function (assert) {
    let Page = PAGES['ContextMenu'];
    assert.ok(Page, 'the page is in the registry');
    await render(<template><Page /></template>);
    assert.dom('.FreestyleUsage').exists('the page mounted');
  });
});
