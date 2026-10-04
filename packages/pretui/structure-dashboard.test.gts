// Pretui — runtime proof for the user-customizable dashboard (DashboardGrid,
// DashboardItem).
//
// This is the component in the kit where a clean index proves the least: the
// engine lives inside an ember-modifier, and `boxel realm indexing-errors`
// cannot see anything a modifier throws. So the two things that actually
// matter are asserted here against the real renderer — that gridstack
// positions Glimmer's elements at all, and that the keyboard path works —
// plus the pure layout maths, which is where the arithmetic bugs live.
//
// Run with `boxel test` from this directory; deployment leaves `*.test.gts`
// off the realm.
import { module, test } from 'qunit';
import { render, settled, focus, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { tracked } from '@glimmer/tracking';
import { DashboardGrid } from './components/dashboard-grid';
import { DashboardItem } from './components/dashboard-item';
import { clampPlacement, describeMove, describePlaced, describeResize, nudge, resolveLayout, sameLayout } from './internal/structure-dashboard';
import type { DashboardPlacement } from './internal/structure-dashboard';

interface Tile {
  id: string;
  title: string;
}

const TILES: Tile[] = [
  { id: 'a', title: 'Alpha' },
  { id: 'b', title: 'Beta' },
  { id: 'c', title: 'Gamma' },
];

const LAYOUT: DashboardPlacement[] = [
  { id: 'a', x: 0, y: 0, w: 4, h: 2 },
  { id: 'b', x: 4, y: 0, w: 4, h: 2 },
  { id: 'c', x: 8, y: 0, w: 4, h: 2 },
];

class Store {
  @tracked layout: DashboardPlacement[] = LAYOUT;
  emitted: DashboardPlacement[][] = [];
  save = (next: DashboardPlacement[]) => {
    this.emitted.push(next);
    this.layout = next;
  };
}

function placementOf(
  layout: readonly DashboardPlacement[],
  id: string,
): DashboardPlacement | undefined {
  return layout.find((p) => p.id === id);
}

// ── the pure layer ───────────────────────────────────────────────────────

module('Pretui | DashboardGrid · layout maths', function () {
  test('clampPlacement forces anything into the grid', function (assert) {
    assert.deepEqual(
      clampPlacement({ id: 'x', x: 99, y: -4, w: 99, h: 0 }, 12),
      { id: 'x', x: 0, y: 0, w: 12, h: 1 },
      'oversize width caps at the column count and pins x to 0',
    );
    assert.deepEqual(
      clampPlacement({ id: 'x', x: 10, y: 2, w: 4, h: 3 }, 12),
      { id: 'x', x: 8, y: 2, w: 4, h: 3 },
      'x slides back so the tile still fits',
    );
    assert.deepEqual(
      clampPlacement(
        { id: 'x', x: NaN, y: 1.6, w: undefined, h: 2.2 } as unknown as DashboardPlacement,
        12,
      ),
      { id: 'x', x: 0, y: 2, w: 1, h: 2 },
      'NaN, undefined and fractions all land on sane integers',
    );
  });

  test('resolveLayout resolves collisions with the real engine', function (assert) {
    // Three tiles all claiming 0,0 — the classic corrupt stored layout.
    const stacked: DashboardPlacement[] = [
      { id: 'a', x: 0, y: 0, w: 4, h: 2 },
      { id: 'b', x: 0, y: 0, w: 4, h: 2 },
      { id: 'c', x: 0, y: 0, w: 4, h: 2 },
    ];
    const out = resolveLayout(stacked, 12, false);
    assert.strictEqual(out.length, 3, 'every tile survives');
    const ys = out.map((p) => p.y).sort((m, n) => m - n);
    assert.deepEqual(ys, [0, 2, 4], 'they are stacked, not overlapping');
    // No two tiles may share a cell.
    for (let i = 0; i < out.length; i += 1) {
      for (let j = i + 1; j < out.length; j += 1) {
        const p = out[i]!;
        const q = out[j]!;
        const overlaps =
          p.x < q.x + q.w &&
          q.x < p.x + p.w &&
          p.y < q.y + q.h &&
          q.y < p.y + p.h;
        assert.false(overlaps, `${p.id} and ${q.id} do not overlap`);
      }
    }
  });

  test('resolveLayout preserves input order and is idempotent', function (assert) {
    const once = resolveLayout(LAYOUT, 12, false);
    assert.deepEqual(
      once.map((p) => p.id),
      ['a', 'b', 'c'],
      'output order matches input order, not the engine order',
    );
    const twice = resolveLayout(once, 12, false);
    assert.true(sameLayout(once, twice), 'resolving a resolved layout is a no-op');
  });

  test('serialize → restore round-trips through JSON unchanged', function (assert) {
    const resolved = resolveLayout(LAYOUT, 12, false);
    const restored = JSON.parse(JSON.stringify(resolved)) as DashboardPlacement[];
    assert.true(sameLayout(resolved, restored), 'JSON round-trip is lossless');
    assert.true(
      sameLayout(restored, resolveLayout(restored, 12, false)),
      'and the restored layout resolves to itself',
    );
  });

  test('sameLayout ignores order but not geometry', function (assert) {
    assert.true(sameLayout(LAYOUT, [...LAYOUT].reverse()), 'order does not count');
    assert.false(
      sameLayout(LAYOUT, [
        { id: 'a', x: 1, y: 0, w: 4, h: 2 },
        { id: 'b', x: 4, y: 0, w: 4, h: 2 },
        { id: 'c', x: 8, y: 0, w: 4, h: 2 },
      ]),
      'one moved tile counts',
    );
    assert.false(sameLayout(LAYOUT, LAYOUT.slice(0, 2)), 'a missing tile counts');
  });

  test('nudge moves and resizes by one cell, clamped', function (assert) {
    const p: DashboardPlacement = { id: 'a', x: 2, y: 2, w: 3, h: 2 };
    assert.deepEqual(nudge(p, 'ArrowRight', 'move', 12), {
      id: 'a',
      x: 3,
      y: 2,
      w: 3,
      h: 2,
    });
    assert.deepEqual(nudge(p, 'ArrowUp', 'move', 12), {
      id: 'a',
      x: 2,
      y: 1,
      w: 3,
      h: 2,
    });
    assert.deepEqual(nudge(p, 'ArrowRight', 'resize', 12), {
      id: 'a',
      x: 2,
      y: 2,
      w: 4,
      h: 2,
    });
    assert.deepEqual(nudge(p, 'ArrowUp', 'resize', 12), {
      id: 'a',
      x: 2,
      y: 2,
      w: 3,
      h: 1,
    });
  });

  test('nudge cannot walk a tile off the grid', function (assert) {
    const atOrigin: DashboardPlacement = { id: 'a', x: 0, y: 0, w: 2, h: 1 };
    assert.deepEqual(
      nudge(atOrigin, 'ArrowLeft', 'move', 12),
      atOrigin,
      'left at column 0 is a no-op',
    );
    assert.deepEqual(
      nudge(atOrigin, 'ArrowUp', 'move', 12),
      atOrigin,
      'up at row 0 is a no-op',
    );
    assert.deepEqual(
      nudge(atOrigin, 'ArrowUp', 'resize', 12),
      atOrigin,
      'shrinking below one row is a no-op',
    );
    const full: DashboardPlacement = { id: 'a', x: 0, y: 0, w: 12, h: 1 };
    assert.deepEqual(
      nudge(full, 'ArrowRight', 'resize', 12),
      full,
      'growing past the last column is a no-op',
    );
    const atEnd: DashboardPlacement = { id: 'a', x: 10, y: 0, w: 2, h: 1 };
    assert.deepEqual(
      nudge(atEnd, 'ArrowRight', 'move', 12),
      atEnd,
      'right at the last column is a no-op',
    );
  });

  test('announcements read as sentences, 1-based', function (assert) {
    const p: DashboardPlacement = { id: 'a', x: 2, y: 1, w: 4, h: 2 };
    assert.strictEqual(
      describeMove('Revenue', p),
      'Revenue moved to column 3, row 2.',
    );
    assert.strictEqual(describeResize('Revenue', p), 'Revenue resized to 4 by 2.');
    assert.strictEqual(
      describePlaced('Revenue', p),
      'Revenue placed at column 3, row 2, 4 by 2.',
    );
  });
});

// ── the rendered component ───────────────────────────────────────────────

module('Pretui | DashboardGrid · render', function (hooks) {
  setupCardTest(hooks);

  test('the engine positions Glimmer-rendered tiles', async function (assert) {
    const store = new Store();
    await render(<template>
      <DashboardGrid
        @items={{TILES}}
        @layout={{store.layout}}
        @columns={{12}}
        @cellHeight={{60}}
        @label='Test board'
        @onLayoutChange={{store.save}}
      >
        <:title as |tile|>{{tile.title}}</:title>
        <:item as |tile|><span class='body'>{{tile.id}}</span></:item>
      </DashboardGrid>
    </template>);
    await settled();

    const items = document.querySelectorAll('[data-test-pretui-dashboard-item]');
    assert.strictEqual(items.length, 3, 'three cells rendered');

    // gridstack writes gs-x/gs-y back onto the elements it adopted — the
    // single cheapest proof that registration actually happened and that the
    // engine is talking to Glimmer's nodes rather than to nodes of its own.
    const a = document.querySelector('[data-test-pretui-dashboard-item="a"]');
    const b = document.querySelector('[data-test-pretui-dashboard-item="b"]');
    const c = document.querySelector('[data-test-pretui-dashboard-item="c"]');
    assert.strictEqual(a?.getAttribute('gs-x'), '0', 'a is at column 0');
    assert.strictEqual(b?.getAttribute('gs-x'), '4', 'b is at column 4');
    assert.strictEqual(c?.getAttribute('gs-x'), '8', 'c is at column 8');
    assert.strictEqual(a?.getAttribute('gs-w'), '4', 'a is four wide');

    // The engine stylesheet is injected exactly once, refcounted.
    assert.ok(
      document.getElementById('pretui-dashboard-engine-css'),
      'engine stylesheet is in document.head',
    );

    assert.strictEqual(
      document.querySelectorAll('[data-test-pretui-dashboard-handle]').length,
      3,
      'every editable cell has a focusable drag handle',
    );
    assert.strictEqual(store.emitted.length, 0, 'mounting emits no layout change');
  });

  test('keyboard adjust mode moves a tile and announces the result', async function (assert) {
    const store = new Store();
    await render(<template>
      <DashboardGrid
        @items={{TILES}}
        @layout={{store.layout}}
        @columns={{12}}
        @cellHeight={{60}}
        @float={{true}}
        @label='Test board'
        @onLayoutChange={{store.save}}
      >
        <:title as |tile|>{{tile.title}}</:title>
        <:item as |tile|><span class='body'>{{tile.id}}</span></:item>
      </DashboardGrid>
    </template>);
    await settled();

    const handle = '[data-test-pretui-dashboard-handle="a"]';
    const live = () =>
      document.querySelector('[data-test-pretui-dashboard-live]')?.textContent ??
      '';

    await focus(handle);
    assert.strictEqual(
      document.querySelector(handle)?.getAttribute('aria-pressed'),
      'false',
      'the handle is a toggle, and starts unpressed',
    );

    await triggerKeyEvent(handle, 'keydown', 'Enter');
    assert.strictEqual(
      document.querySelector(handle)?.getAttribute('aria-pressed'),
      'true',
      'Enter opens adjust mode',
    );
    assert.ok(
      live().includes('Adjust mode on Alpha'),
      'the mode is announced with its instructions',
    );

    // Move a down a row. `float` is on so nothing packs it back up.
    await triggerKeyEvent(handle, 'keydown', 'ArrowDown');
    assert.strictEqual(
      document.activeElement,
      document.querySelector(handle),
      'the handle KEEPS focus across an engine move — gridstack re-sorts the '
        + "plane's DOM children on every change, and moving a node blurs "
        + 'whatever is focused inside it',
    );
    assert.ok(
      live().includes('Alpha moved to column 1, row 2'),
      'the outcome is announced 1-based',
    );

    // Resize a by one column.
    await triggerKeyEvent(handle, 'keydown', 'ArrowRight', { shiftKey: true });
    assert.ok(
      live().includes('Alpha resized to 5 by 2'),
      'shift+arrow resizes',
    );
    await triggerKeyEvent(handle, 'keydown', 'Enter');
    assert.strictEqual(
      document.querySelector(handle)?.getAttribute('aria-pressed'),
      'false',
      'Enter commits and closes adjust mode',
    );
    assert.ok(store.emitted.length >= 1, '@onLayoutChange fired on commit');

    const last = store.emitted[store.emitted.length - 1]!;
    const moved = placementOf(last, 'a');
    assert.strictEqual(moved?.y, 1, 'the committed layout has the new row');
    assert.strictEqual(moved?.w, 5, 'and the new width');
  });

  test('Escape restores the layout the adjust mode opened with', async function (assert) {
    const store = new Store();
    await render(<template>
      <DashboardGrid
        @items={{TILES}}
        @layout={{store.layout}}
        @columns={{12}}
        @cellHeight={{60}}
        @float={{true}}
        @label='Test board'
        @onLayoutChange={{store.save}}
      >
        <:title as |tile|>{{tile.title}}</:title>
        <:item as |tile|><span class='body'>{{tile.id}}</span></:item>
      </DashboardGrid>
    </template>);
    await settled();

    const handle = '[data-test-pretui-dashboard-handle="a"]';
    await focus(handle);
    await triggerKeyEvent(handle, 'keydown', 'Enter');
    await triggerKeyEvent(handle, 'keydown', 'ArrowDown');
    await triggerKeyEvent(handle, 'keydown', 'ArrowDown');
    assert.strictEqual(
      document
        .querySelector('[data-test-pretui-dashboard-item="a"]')
        ?.getAttribute('gs-y'),
      '2',
      'the tile really moved',
    );

    await triggerKeyEvent(handle, 'keydown', 'Escape');
    assert.strictEqual(
      document
        .querySelector('[data-test-pretui-dashboard-item="a"]')
        ?.getAttribute('gs-y'),
      '0',
      'Escape put it back',
    );
    assert.strictEqual(
      store.emitted.length,
      0,
      'a cancelled adjustment never reaches @onLayoutChange',
    );
  });

  test('read-only mode renders the same layout with no engine', async function (assert) {
    await render(<template>
      <DashboardGrid
        @items={{TILES}}
        @layout={{LAYOUT}}
        @columns={{12}}
        @editable={{false}}
        @label='Read only board'
      >
        <:title as |tile|>{{tile.title}}</:title>
        <:item as |tile|><span class='body'>{{tile.id}}</span></:item>
      </DashboardGrid>
    </template>);
    await settled();

    assert.strictEqual(
      document.querySelectorAll('[data-test-pretui-dashboard-item]').length,
      3,
      'the same three cells',
    );
    assert.strictEqual(
      document.querySelectorAll('[data-test-pretui-dashboard-handle]').length,
      0,
      'no drag affordance anywhere',
    );
    const b = document.querySelector(
      '[data-test-pretui-dashboard-item="b"]',
    ) as HTMLElement | null;
    assert.strictEqual(
      b?.getAttribute('style'),
      'grid-column:5/span 4;grid-row:1/span 2',
      'position is CSS grid, computed from the same placement',
    );
    assert.strictEqual(
      b?.getAttribute('gs-x'),
      null,
      'no engine ever touched it',
    );
  });

  test('read-only mode untangles an overlapping stored layout', async function (assert) {
    const stacked: DashboardPlacement[] = TILES.map((tile) => ({
      id: tile.id,
      x: 0,
      y: 0,
      w: 4,
      h: 2,
    }));
    await render(<template>
      <DashboardGrid
        @items={{TILES}}
        @layout={{stacked}}
        @columns={{12}}
        @editable={{false}}
        @label='Read only board'
      >
        <:title as |tile|>{{tile.title}}</:title>
        <:item as |tile|><span class='body'>{{tile.id}}</span></:item>
      </DashboardGrid>
    </template>);
    await settled();

    const rows = ['a', 'b', 'c'].map((id) =>
      document
        .querySelector(`[data-test-pretui-dashboard-item="${id}"]`)
        ?.getAttribute('style'),
    );
    assert.deepEqual(
      rows,
      [
        'grid-column:1/span 4;grid-row:5/span 2',
        'grid-column:1/span 4;grid-row:3/span 2',
        'grid-column:1/span 4;grid-row:1/span 2',
      ],
      'the DOM-free engine untangled them — and note WHICH way: the later '
        + 'placement keeps the cell and the earlier one is pushed down, '
        + 'which is exactly what the live engine does with the same input',
    );
  });

  test('a cell with no host is inert', async function (assert) {
    await render(<template>
      <DashboardItem @id='solo' @label='Solo'>
        <:title>Solo</:title>
        <:default><span class='body'>content</span></:default>
      </DashboardItem>
    </template>);
    await settled();
    assert.ok(
      document.querySelector('[data-test-pretui-dashboard-item="solo"]'),
      'it renders',
    );
    assert.strictEqual(
      document.querySelectorAll('[data-test-pretui-dashboard-handle]').length,
      0,
      'with no handle and no engine attachment',
    );
  });

  test('removing an item unregisters it from the engine', async function (assert) {
    class Rows {
      @tracked items: Tile[] = TILES;
    }
    const rows = new Rows();
    const grids: HTMLElement[] = [];
    await render(<template>
      <DashboardGrid
        @items={{rows.items}}
        @layout={{LAYOUT}}
        @columns={{12}}
        @label='Test board'
      >
        <:title as |tile|>{{tile.title}}</:title>
        <:item as |tile|><span class='body'>{{tile.id}}</span></:item>
      </DashboardGrid>
    </template>);
    await settled();
    const plane = document.querySelector(
      '[data-test-pretui-dashboard-plane]',
    ) as HTMLElement & { gridstack?: { engine?: { nodes: unknown[] } } };
    grids.push(plane);
    assert.strictEqual(
      plane.gridstack?.engine?.nodes.length,
      3,
      'three widgets registered',
    );

    rows.items = TILES.slice(0, 2);
    await settled();

    assert.strictEqual(
      document.querySelectorAll('[data-test-pretui-dashboard-item]').length,
      2,
      'Glimmer removed the cell',
    );
    assert.strictEqual(
      plane.gridstack?.engine?.nodes.length,
      2,
      'and the modifier destructor unregistered it — a cell that stayed in the '
        + 'engine would pin its element for the life of the grid',
    );
  });

  test('teardown removes the engine, the observer and the stylesheet', async function (assert) {
    class Toggle {
      @tracked shown = true;
    }
    const toggle = new Toggle();
    await render(<template>
      {{#if toggle.shown}}
        <DashboardGrid
          @items={{TILES}}
          @layout={{LAYOUT}}
          @columns={{12}}
          @label='Test board'
        >
          <:title as |tile|>{{tile.title}}</:title>
          <:item as |tile|><span class='body'>{{tile.id}}</span></:item>
        </DashboardGrid>
      {{/if}}
    </template>);
    await settled();
    const plane = document.querySelector(
      '[data-test-pretui-dashboard-plane]',
    ) as HTMLElement & { gridstack?: unknown };
    assert.ok(plane?.gridstack, 'the engine hangs off the plane while mounted');
    assert.ok(
      document.getElementById('pretui-dashboard-engine-css'),
      'stylesheet present',
    );

    toggle.shown = false;
    await settled();

    assert.strictEqual(
      document.querySelectorAll('[data-test-pretui-dashboard-item]').length,
      0,
      'the cells are gone',
    );
    assert.notOk(
      plane.gridstack,
      'destroy(false) severed the engine ↔ element link',
    );
    assert.notOk(
      document.getElementById('pretui-dashboard-engine-css'),
      'the refcounted stylesheet was released on the last teardown',
    );
  });
});
