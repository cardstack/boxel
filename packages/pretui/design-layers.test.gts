// Pretui — proof for design-layers.gts (LayerManager).
//
// Two halves, deliberately:
//
//  1. **The tree algebra, with no DOM.** `flattenLayers`, `moveLayer` and
//     `setLayerFlag` are the whole state change this component makes, and
//     the interesting cases — inheritance down a branch, a move that is
//     blocked, the fact that NOTHING is ever mutated in place — are all
//     arithmetic over records. A reorder implementation that can only be
//     checked by dragging is one that never gets checked.
//  2. **The keyboard contract, rendered.** The claim this component is built
//     on is that every pointer gesture has a keyboard twin, and that reorder
//     works ACROSS nesting levels without a pointer. That claim is asserted
//     here by driving the keys and reading the published tree.
//
// NOTE (realm harness): `boxel test` delivers no scoped stylesheet, so
// nothing here asserts a computed style. Structure, ARIA, and the emitted
// tree only.
//
// Run with `boxel test` from this directory; deployment leaves `*.test.gts`
// off the realm.
import { module, test } from 'qunit';
import { click, render, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';

import { LayerManager, branchLayerIds, flattenLayers, layerAnnouncement, moveLayer, setLayerFlag } from './components/layer-manager';
import type { LayerNode } from './components/layer-manager';
import { DEMOS_LAYER_MANAGER } from './components/layer-manager.usage';
import { DEMOS_DESIGN_LAYERS } from './demo-design-layers';

// Pages are looked up by component name through the merged loadable registry,
// so this test does not care which module a page lives in.
const PAGES: Record<string, unknown> = { ...DEMOS_LAYER_MANAGER, ...DEMOS_DESIGN_LAYERS };
const DEMOS_DESIGN_LAYERS_NAMES = ['LayerManager', 'LayerInheritance'];

// ── Fixture ──────────────────────────────────────────────────────────────
//
//   Hero            group, HIDDEN
//     Headline
//     Plate         locked
//   Guides          locked
//   Background
//
// Six rows once Hero is open; two kinds of inheritance in one shape.
const TREE: readonly LayerNode[] = [
  {
    id: 'hero',
    name: 'Hero',
    kind: 'frame',
    hidden: true,
    children: [
      { id: 'head', name: 'Headline', kind: 'text' },
      { id: 'plate', name: 'Plate', kind: 'image', locked: true },
    ],
  },
  { id: 'guides', name: 'Guides', kind: 'shape', locked: true },
  { id: 'bg', name: 'Background', kind: 'shape' },
];

const OPEN = new Set(['hero']);

function root(): HTMLElement {
  return document.querySelector('#ember-testing') as HTMLElement;
}

function rowIds(): string[] {
  return Array.from(
    root().querySelectorAll('[data-test-pretui-layer-row]'),
  ).map((el) => (el as HTMLElement).getAttribute('data-layer-id') ?? '');
}

function handleFor(id: string): HTMLElement {
  return root().querySelector(
    '[data-test-pretui-layer-handle][data-layer-id="' + id + '"]',
  ) as HTMLElement;
}

function nameCellFor(id: string): HTMLElement {
  return root().querySelector(
    '[data-test-pretui-layer-name][data-layer-id="' + id + '"]',
  ) as HTMLElement;
}

function eyeFor(id: string): HTMLElement {
  return root().querySelector(
    '[data-test-pretui-layer-visibility][data-layer-id="' + id + '"]',
  ) as HTMLElement;
}

function status(): string {
  const el = root().querySelector(
    '[data-test-pretui-layer-status]',
  ) as HTMLElement;
  return el?.textContent?.trim() ?? '';
}

/** Ids in tree order, so a published tree can be compared as a flat list. */
function shape(nodes: readonly LayerNode[]): string {
  return nodes
    .map((n) =>
      n.children && n.children.length > 0
        ? n.id + '(' + shape(n.children) + ')'
        : n.id,
    )
    .join(',');
}

// ═══════════════════════════════════════════════════════════════════════
// The tree algebra — no DOM
// ═══════════════════════════════════════════════════════════════════════

module('Pretui | design-layers | flattenLayers', function () {
  test('levels, positions and set sizes are 1-based and per-parent', function (assert) {
    const rows = flattenLayers(TREE, OPEN);
    assert.deepEqual(
      rows.map((r) => r.id),
      ['hero', 'head', 'plate', 'guides', 'bg'],
      'depth-first, expanded branches inlined',
    );
    const plate = rows[2];
    assert.strictEqual(plate.level, 2, 'aria-level counts from one');
    assert.strictEqual(plate.posinset, 2, 'and posinset from one');
    assert.strictEqual(
      plate.setsize,
      2,
      'set size is the SIBLING count, not the row count',
    );
    assert.strictEqual(plate.parentName, 'Hero', 'and the parent is named');
  });

  test('a collapsed branch hides its children without losing them', function (assert) {
    const rows = flattenLayers(TREE, new Set());
    assert.deepEqual(
      rows.map((r) => r.id),
      ['hero', 'guides', 'bg'],
      'three visible rows',
    );
    assert.true(rows[0].hasChildren, 'and the branch still says it is one');
    assert.false(rows[0].expanded, 'closed');
  });

  test('visibility and lock inherit down the branch without touching the flag', function (assert) {
    const rows = flattenLayers(TREE, OPEN);
    const head = rows[1];
    assert.false(head.hidden, 'the child carries no hidden flag of its own');
    assert.true(head.inheritedHidden, 'but an ancestor is hiding it');
    assert.true(
      head.effectiveHidden,
      'so what the reader sees on the canvas is nothing — which is what the row must say',
    );
    assert.false(head.effectiveLocked, 'lock does not leak across the axes');

    const plate = rows[2];
    assert.true(plate.locked, 'its own lock');
    assert.true(plate.effectiveHidden, 'plus the inherited hiding');
  });

  test('branchLayerIds finds every group, at any depth', function (assert) {
    assert.deepEqual(branchLayerIds(TREE), ['hero'], 'one group here');
    assert.deepEqual(branchLayerIds([]), [], 'and none in nothing');
  });
});

module('Pretui | design-layers | moveLayer', function () {
  test('raise and lower swap with a SIBLING, never across a boundary', function (assert) {
    const lowered = moveLayer(TREE, 'guides', 'lower');
    assert.true(lowered.moved, 'guides moved down');
    assert.strictEqual(
      shape(lowered.tree),
      'hero(head,plate),bg,guides',
      'past bg, at the top level',
    );

    const raised = moveLayer(TREE, 'plate', 'raise');
    assert.strictEqual(
      shape(raised.tree),
      'hero(plate,head),guides,bg',
      'and inside Hero the two children swap without leaving it',
    );
  });

  test('a blocked move changes nothing and says so', function (assert) {
    const first = moveLayer(TREE, 'hero', 'raise');
    assert.false(first.moved, 'already first');
    assert.strictEqual(shape(first.tree), shape(TREE), 'tree untouched');

    const last = moveLayer(TREE, 'bg', 'lower');
    assert.false(last.moved, 'already last');

    const outAtRoot = moveLayer(TREE, 'bg', 'outdent');
    assert.false(outAtRoot.moved, 'already at the top level');

    const noHost = moveLayer(TREE, 'hero', 'indent');
    assert.false(noHost.moved, 'nothing above it to nest into');
  });

  test('indent nests into the layer above, at the end of its children', function (assert) {
    const nested = moveLayer(TREE, 'guides', 'indent');
    assert.true(nested.moved, 'guides went inside Hero');
    assert.strictEqual(
      shape(nested.tree),
      'hero(head,plate,guides),bg',
      'appended after the existing children — adjacent to where it was standing, so nothing appears to jump',
    );
    assert.strictEqual(nested.level, 2, 'and it reports the new level');
    assert.strictEqual(nested.position, 3, 'and the new position');
    assert.strictEqual(nested.parentName, 'Hero', 'and who it is inside');
  });

  test('outdent lands just after the parent, which is the mirror of indent', function (assert) {
    const out = moveLayer(TREE, 'head', 'outdent');
    assert.true(out.moved, 'headline left the group');
    assert.strictEqual(
      shape(out.tree),
      'hero(plate),head,guides,bg',
      'immediately after Hero, at the top level',
    );
    assert.strictEqual(out.level, 1, 'reported level');
    assert.strictEqual(out.parentName, undefined, 'and no parent to name');
  });

  test('indent then outdent is a round trip', function (assert) {
    const there = moveLayer(TREE, 'guides', 'indent');
    const back = moveLayer(there.tree, 'guides', 'outdent');
    assert.strictEqual(
      shape(back.tree),
      shape(TREE),
      'the tree it started from',
    );
  });

  test('the caller’s tree is never mutated', function (assert) {
    const before = shape(TREE);
    moveLayer(TREE, 'guides', 'indent');
    moveLayer(TREE, 'plate', 'raise');
    setLayerFlag(TREE, 'bg', 'hidden', true);
    assert.strictEqual(
      shape(TREE),
      before,
      'three operations later, the input is byte-identical — mutating a caller’s array is what makes a Glimmer consumer stop re-rendering',
    );
  });
});

module('Pretui | design-layers | setLayerFlag', function () {
  test('sets one flag on one node, at any depth', function (assert) {
    const next = setLayerFlag(TREE, 'head', 'hidden', true);
    const rows = flattenLayers(next, OPEN);
    assert.true(rows[1].hidden, 'the child now carries its own flag');
    assert.false(
      flattenLayers(TREE, OPEN)[1].hidden,
      'and the original still does not',
    );
  });

  test('an unknown id is a no-op rather than a throw', function (assert) {
    const next = setLayerFlag(TREE, 'nope', 'locked', true);
    assert.strictEqual(shape(next), shape(TREE), 'nothing happened');
  });
});

module('Pretui | design-layers | layerAnnouncement', function () {
  test('every phase names the layer, the level and the position', function (assert) {
    const grab = layerAnnouncement('grab', 'Plate', 2, 2, 2, 'Hero');
    assert.true(grab.indexOf('Plate grabbed') === 0, 'names the layer first');
    assert.true(grab.indexOf('level 2') !== -1, 'level');
    assert.true(grab.indexOf('position 2 of 2') !== -1, 'position');
    assert.true(grab.indexOf('inside Hero') !== -1, 'and the parent');
    assert.true(grab.indexOf('Escape to cancel') !== -1, 'plus the key map');

    const top = layerAnnouncement('move', 'Guides', 1, 2, 3, undefined);
    assert.true(
      top.indexOf('at the top level') !== -1,
      'no parent is said out loud rather than left blank: ' + top,
    );

    assert.true(
      layerAnnouncement('blocked', 'Hero', 1, 1, 3).indexOf('cannot move') !==
        -1,
      'a blocked move is announced rather than silently doing nothing',
    );
    assert.true(
      layerAnnouncement('cancel', 'Hero', 1, 1, 3).indexOf(
        'Move cancelled',
      ) === 0,
      'and so is a cancel',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Rendered — the keyboard contract
// ═══════════════════════════════════════════════════════════════════════

module('Pretui | design-layers | LayerManager', function (hooks) {
  setupCardTest(hooks);

  test('it is a treegrid, with the ARIA a treegrid owes', async function (assert) {
    await render(
      <template><LayerManager @layers={{TREE}} @label='Artboard' /></template>,
    );
    const grid = root().querySelector(
      '[data-test-pretui-layer-grid]',
    ) as HTMLElement;
    assert.strictEqual(grid.getAttribute('role'), 'treegrid', 'treegrid');
    assert.strictEqual(grid.getAttribute('aria-label'), 'Artboard', 'named');
    assert.strictEqual(
      grid.getAttribute('aria-colcount'),
      '4',
      'handle, name, visibility, lock',
    );
    assert.ok(
      grid.getAttribute('aria-describedby'),
      'and it points at the key-map hint, so the move contract is discoverable',
    );

    assert.deepEqual(
      rowIds(),
      ['hero', 'head', 'plate', 'guides', 'bg'],
      'every branch starts open — a layers panel that hides the tree it exists to show is not a useful default',
    );

    const plateRow = root().querySelector(
      '[data-test-pretui-layer-row][data-layer-id="plate"]',
    ) as HTMLElement;
    assert.strictEqual(plateRow.getAttribute('role'), 'row', 'a row');
    assert.strictEqual(plateRow.getAttribute('aria-level'), '2', 'level');
    assert.strictEqual(plateRow.getAttribute('aria-posinset'), '2', 'posinset');
    assert.strictEqual(plateRow.getAttribute('aria-setsize'), '2', 'setsize');

    const heroRow = root().querySelector(
      '[data-test-pretui-layer-row][data-layer-id="hero"]',
    ) as HTMLElement;
    assert.strictEqual(
      heroRow.getAttribute('aria-expanded'),
      'true',
      'a branch reports its expansion',
    );
    assert.strictEqual(
      plateRow.getAttribute('aria-expanded'),
      null,
      'and a leaf omits it rather than claiming to be collapsed',
    );
  });

  test('exactly one tab stop, and the arrows walk cells then rows', async function (assert) {
    await render(<template><LayerManager @layers={{TREE}} /></template>);
    const stops = Array.from(
      root().querySelectorAll('[data-layer-cell]'),
    ).filter((el) => (el as HTMLElement).tabIndex === 0);
    assert.strictEqual(stops.length, 1, 'one, never zero and never two');
    assert.strictEqual(stops[0], handleFor('hero'), 'starting at the first handle');

    await triggerKeyEvent(handleFor('hero'), 'keydown', 'ArrowRight');
    assert.strictEqual(
      nameCellFor('hero').tabIndex,
      0,
      'right moved into the name cell',
    );

    await triggerKeyEvent(nameCellFor('hero'), 'keydown', 'ArrowDown');
    assert.strictEqual(
      nameCellFor('head').tabIndex,
      0,
      'down held the column and moved a row',
    );

    await triggerKeyEvent(nameCellFor('head'), 'keydown', 'End');
    assert.strictEqual(nameCellFor('bg').tabIndex, 0, 'End went to the last row');
    await triggerKeyEvent(nameCellFor('bg'), 'keydown', 'Home');
    assert.strictEqual(nameCellFor('hero').tabIndex, 0, 'Home came back');
  });

  test('left and right expand, collapse, and climb to the parent', async function (assert) {
    let opened: string[][] = [];
    let note = (ids: string[]) => {
      opened.push(ids.slice());
    };
    await render(
      <template>
        <LayerManager
          @layers={{TREE}}
          @reorderable={{false}}
          @onExpandedChange={{note}}
        />
      </template>,
    );
    // With no handle column the name cell is column 0, which is where the
    // treegrid's expand/collapse rule lives.
    await triggerKeyEvent(nameCellFor('hero'), 'keydown', 'ArrowLeft');
    assert.deepEqual(opened[0], [], 'left collapsed the open branch');
    assert.deepEqual(rowIds(), ['hero', 'guides', 'bg'], 'children gone');

    await triggerKeyEvent(nameCellFor('hero'), 'keydown', 'ArrowRight');
    assert.deepEqual(opened[1], ['hero'], 'right opened it again');
    assert.deepEqual(rowIds(), ['hero', 'head', 'plate', 'guides', 'bg']);

    await triggerKeyEvent(nameCellFor('plate'), 'keydown', 'ArrowLeft');
    assert.strictEqual(
      nameCellFor('hero').tabIndex,
      0,
      'and from a leaf, left climbs to the parent row',
    );
  });

  test('the visibility toggle is a real button that says what is true', async function (assert) {
    await render(<template><LayerManager @layers={{TREE}} /></template>);
    const hero = eyeFor('hero');
    assert.strictEqual(hero.tagName, 'BUTTON', 'a real button');
    assert.strictEqual(
      hero.getAttribute('type'),
      'button',
      'typed, so it cannot submit a form it happens to sit in',
    );
    assert.strictEqual(hero.getAttribute('aria-pressed'), 'true', 'hero is hidden');
    assert.strictEqual(
      hero.getAttribute('aria-label'),
      'Show Hero',
      'and the name says what pressing it does',
    );

    const head = eyeFor('head');
    assert.strictEqual(
      head.getAttribute('aria-pressed'),
      'false',
      'the child carries no flag of its own',
    );
    assert.strictEqual(
      head.getAttribute('aria-label'),
      'Show Headline — hidden by Hero',
      'but its name names the group actually doing the hiding, instead of reporting a flag with no effect',
    );
    assert.strictEqual(
      head.getAttribute('data-inherited'),
      'true',
      'and the inheritance is in a still frame too',
    );
  });

  test('the row carries hidden and locked as WORDS, not only a tint', async function (assert) {
    await render(<template><LayerManager @layers={{TREE}} /></template>);
    const plateRow = root().querySelector(
      '[data-test-pretui-layer-row][data-layer-id="plate"]',
    ) as HTMLElement;
    const text = plateRow.textContent ?? '';
    assert.true(text.indexOf('hidden') !== -1, 'inherited hiding is spelled out');
    assert.true(text.indexOf('locked') !== -1, 'and its own lock: ' + text);
  });

  test('a toggle publishes the whole next tree and the delta', async function (assert) {
    let trees: LayerNode[][] = [];
    let deltas: string[] = [];
    let takeTree = (next: LayerNode[]) => {
      trees.push(next);
    };
    let noteLock = (node: LayerNode, locked: boolean) => {
      deltas.push(node.name + ':' + String(locked));
    };
    await render(
      <template>
        <LayerManager
          @layers={{TREE}}
          @onLayersChange={{takeTree}}
          @onLockChange={{noteLock}}
        />
      </template>,
    );
    await click(
      '[data-test-pretui-layer-lock][data-layer-id="bg"]',
    );
    assert.strictEqual(trees.length, 1, 'one tree published');
    assert.strictEqual(
      shape(trees[0]),
      shape(TREE),
      'with the structure untouched',
    );
    assert.deepEqual(deltas, ['Background:true'], 'and the delta reported');
    assert.strictEqual(
      shape(TREE),
      'hero(head,plate),guides,bg',
      'and the input array is still the input array',
    );
  });

  test('REORDER WITHOUT A POINTER — grab, move, drop', async function (assert) {
    let published: LayerNode[][] = [];
    let takeTree = (next: LayerNode[]) => {
      published.push(next);
    };
    await render(
      <template>
        <LayerManager @layers={{TREE}} @onLayersChange={{takeTree}} />
      </template>,
    );
    const handle = handleFor('guides');
    await triggerKeyEvent(handle, 'keydown', 'Enter');
    assert.strictEqual(
      handleFor('guides').getAttribute('aria-pressed'),
      'true',
      'the handle reports that it is carrying the row',
    );
    assert.true(
      status().indexOf('Guides grabbed') === 0,
      'and the grab is announced with its key map: ' + status(),
    );

    await triggerKeyEvent(handleFor('guides'), 'keydown', 'ArrowUp');
    assert.deepEqual(
      rowIds(),
      ['guides', 'hero', 'head', 'plate', 'bg'],
      'the list visibly rearranged UNDER the arrow key, before any commit',
    );
    assert.strictEqual(published.length, 0, 'and nothing was published mid-move');

    await triggerKeyEvent(handleFor('guides'), 'keydown', 'Enter');
    assert.strictEqual(published.length, 1, 'drop published once');
    assert.strictEqual(
      shape(published[0]),
      'guides,hero(head,plate),bg',
      'with the row where the announcement said it was',
    );
    assert.true(
      status().indexOf('Guides dropped') === 0,
      'and the drop is announced: ' + status(),
    );
  });

  test('REORDER ACROSS NESTING LEVELS — right nests, left unnests', async function (assert) {
    let published: LayerNode[][] = [];
    let takeTree = (next: LayerNode[]) => {
      published.push(next);
    };
    await render(
      <template>
        <LayerManager @layers={{TREE}} @onLayersChange={{takeTree}} />
      </template>,
    );
    await triggerKeyEvent(handleFor('guides'), 'keydown', ' ');
    await triggerKeyEvent(handleFor('guides'), 'keydown', 'ArrowRight');
    assert.true(
      status().indexOf('inside Hero') !== -1,
      'the nesting is announced by name: ' + status(),
    );
    await triggerKeyEvent(handleFor('guides'), 'keydown', 'Enter');
    assert.strictEqual(
      shape(published[0]),
      'hero(head,plate,guides),bg',
      'a layer moved INTO a group with three key presses and no pointer — which is the thing four of the five audited implementations could not do at all',
    );
  });

  test('Escape restores the order the grab started from', async function (assert) {
    let published: LayerNode[][] = [];
    let takeTree = (next: LayerNode[]) => {
      published.push(next);
    };
    await render(
      <template>
        <LayerManager @layers={{TREE}} @onLayersChange={{takeTree}} />
      </template>,
    );
    await triggerKeyEvent(handleFor('bg'), 'keydown', 'Enter');
    await triggerKeyEvent(handleFor('bg'), 'keydown', 'ArrowUp');
    await triggerKeyEvent(handleFor('bg'), 'keydown', 'ArrowUp');
    assert.deepEqual(
      rowIds(),
      ['bg', 'hero', 'head', 'plate', 'guides'],
      'two raises moved it up among its siblings, past a whole open group in one step each — raising is a SIBLING swap, so an expanded branch is one position, not four',
    );

    await triggerKeyEvent(handleFor('bg'), 'keydown', 'Escape');
    assert.strictEqual(
      shape(published[0]),
      shape(TREE),
      'and Escape published the tree exactly as it stood before the grab',
    );
    assert.true(
      status().indexOf('Move cancelled') === 0,
      'said out loud: ' + status(),
    );
  });

  test('a blocked move is announced rather than silently ignored', async function (assert) {
    await render(<template><LayerManager @layers={{TREE}} /></template>);
    await triggerKeyEvent(handleFor('hero'), 'keydown', 'Enter');
    await triggerKeyEvent(handleFor('hero'), 'keydown', 'ArrowUp');
    assert.true(
      status().indexOf('cannot move any further') !== -1,
      'the reader is told why nothing happened: ' + status(),
    );
  });

  test('multi-select: every pointer gesture has its keyboard twin', async function (assert) {
    let picks: string[][] = [];
    let note = (ids: string[]) => {
      picks.push(ids.slice());
    };
    await render(
      <template>
        <LayerManager
          @layers={{TREE}}
          @selectionMode='multi'
          @onSelectionChange={{note}}
        />
      </template>,
    );
    await triggerKeyEvent(nameCellFor('head'), 'keydown', ' ');
    assert.deepEqual(picks[0], ['head'], 'Space is the twin of a plain click');

    await triggerKeyEvent(nameCellFor('head'), 'keydown', 'ArrowDown', {
      shiftKey: true,
    });
    assert.deepEqual(
      picks[1],
      ['head', 'plate'],
      'Shift with an arrow is the twin of a Shift-click',
    );

    await triggerKeyEvent(nameCellFor('plate'), 'keydown', 'ArrowDown', {
      shiftKey: true,
    });
    assert.deepEqual(
      picks[2],
      ['head', 'plate', 'guides'],
      'and it extends from the ANCHOR, not from wherever the cursor now is — crossing out of the group on the way',
    );

    await triggerKeyEvent(nameCellFor('guides'), 'keydown', 'A', {
      ctrlKey: true,
    });
    assert.deepEqual(
      picks[3],
      ['hero', 'head', 'plate', 'guides', 'bg'],
      'Ctrl+A takes the visible set',
    );

    await triggerKeyEvent(nameCellFor('guides'), 'keydown', 'Escape');
    assert.deepEqual(picks[4], [], 'and Escape clears it');
  });

  test('single-select never quietly takes the whole panel', async function (assert) {
    let picks: string[][] = [];
    let note = (ids: string[]) => {
      picks.push(ids.slice());
    };
    await render(
      <template>
        <LayerManager
          @layers={{TREE}}
          @selectionMode='single'
          @onSelectionChange={{note}}
        />
      </template>,
    );
    await triggerKeyEvent(nameCellFor('head'), 'keydown', 'A', {
      metaKey: true,
    });
    assert.strictEqual(picks.length, 0, 'Ctrl/Cmd+A does nothing in single');

    await triggerKeyEvent(nameCellFor('head'), 'keydown', ' ');
    await triggerKeyEvent(nameCellFor('plate'), 'keydown', ' ');
    assert.deepEqual(
      picks[1],
      ['plate'],
      'and a second pick replaces the first rather than adding to it',
    );
  });

  test('turning a column off does not strand the tab stop', async function (assert) {
    await render(
      <template>
        <LayerManager
          @layers={{TREE}}
          @reorderable={{false}}
          @showLock={{false}}
        />
      </template>,
    );
    const grid = root().querySelector(
      '[data-test-pretui-layer-grid]',
    ) as HTMLElement;
    assert.strictEqual(
      grid.getAttribute('aria-colcount'),
      '2',
      'name and visibility only',
    );
    assert.notOk(root().querySelector('[data-test-pretui-layer-handle]'), 'no handles');
    const stops = Array.from(
      root().querySelectorAll('[data-layer-cell]'),
    ).filter((el) => (el as HTMLElement).tabIndex === 0);
    assert.strictEqual(stops.length, 1, 'still exactly one tab stop');
    assert.strictEqual(stops[0], nameCellFor('hero'), 'now the name cell');
  });

  test('an empty tree lands on a deliberate empty state', async function (assert) {
    let none: readonly LayerNode[] = [];
    await render(<template><LayerManager @layers={{none}} /></template>);
    assert.notOk(
      root().querySelector('[data-test-pretui-layer-grid]'),
      'no treegrid with nothing in it',
    );
    assert.ok(
      root().querySelector('[data-test-pretui-empty]'),
      'an EmptyState instead — never a bare "no results"',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Demo pages — render proof
// ═══════════════════════════════════════════════════════════════════════

/* eslint-disable @typescript-eslint/no-explicit-any -- the DEMOS registries
   are Record<string, unknown> by contract; mounting one requires the cast. */
type AnyComponent = any;

module('Pretui | design-layers | demo pages', function (hooks) {
  setupCardTest(hooks);
  for (let name of DEMOS_DESIGN_LAYERS_NAMES) {
    test(name + ' mounts', async function (assert) {
      let Demo = PAGES[name] as AnyComponent;
      assert.ok(Demo, name + ' is in the registry');
      await render(<template><Demo /></template>);
      assert.ok(
        root().querySelector('.pretui-usage'),
        name + ' rendered its usage shell',
      );
    });
  }
});
