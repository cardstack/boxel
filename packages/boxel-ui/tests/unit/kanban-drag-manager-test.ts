import {
  type KanbanColumnConfig,
  type KanbanPlacement,
  KanbanDragManager,
} from '@cardstack/boxel-ui/components';
import { settled } from '@ember/test-helpers';
import { module, test } from 'qunit';

import { delay } from '#tests/helpers';

function stubRect(
  element: Element,
  rect: {
    height: number;
    left: number;
    top: number;
    width: number;
  },
): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: rect.left,
      y: rect.top,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      toJSON() {
        return this;
      },
    }),
  });
}

const COL_A = 'col-a';
const COL_B = 'col-b';
const COL_C = 'col-c';

const COLUMNS_AB: KanbanColumnConfig[] = [
  {
    key: COL_A,
    label: 'A',
    color: null,
    wipLimit: null,
    collapsed: false,
    sortOrder: 1,
  },
  {
    key: COL_B,
    label: 'B',
    color: null,
    wipLimit: null,
    collapsed: false,
    sortOrder: 2,
  },
];

const COLUMNS_ABC: KanbanColumnConfig[] = [
  ...COLUMNS_AB,
  {
    key: COL_C,
    label: 'C',
    color: null,
    wipLimit: null,
    collapsed: false,
    sortOrder: 3,
  },
];

// Two cards in col-a (sortOrder 1 & 2), one card in col-b (sortOrder 1).
function makeMultiBoard(): {
  container: HTMLElement;
  placements: KanbanPlacement[];
} {
  let container = document.createElement('div');
  let col0 = document.createElement('div');
  let col1 = document.createElement('div');
  let body0 = document.createElement('div');
  let body1 = document.createElement('div');
  let card0 = document.createElement('div');
  let card1 = document.createElement('div');
  let card2 = document.createElement('div');

  col0.setAttribute('data-kanban-column', COL_A);
  col1.setAttribute('data-kanban-column', COL_B);
  body0.setAttribute('data-kanban-col-body', '');
  body1.setAttribute('data-kanban-col-body', '');
  card0.setAttribute('data-card-index', '0');
  card1.setAttribute('data-card-index', '1');
  card2.setAttribute('data-card-index', '2');

  stubRect(col0, { left: 0, top: 0, width: 200, height: 400 });
  stubRect(col1, { left: 220, top: 0, width: 200, height: 400 });
  stubRect(body0, { left: 0, top: 0, width: 200, height: 400 });
  stubRect(body1, { left: 220, top: 0, width: 200, height: 400 });
  stubRect(card0, { left: 8, top: 10, width: 184, height: 80 });
  stubRect(card2, { left: 8, top: 98, width: 184, height: 80 });
  stubRect(card1, { left: 228, top: 10, width: 184, height: 80 });

  body0.append(card0, card2);
  body1.append(card1);
  col0.append(body0);
  col1.append(body1);
  container.append(col0, col1);

  return {
    container,
    placements: [
      { index: 0, columnId: COL_A, sortOrder: 1 },
      { index: 2, columnId: COL_A, sortOrder: 2 },
      { index: 1, columnId: COL_B, sortOrder: 1 },
    ],
  };
}

function makeBoard(): HTMLElement {
  let container = document.createElement('div');
  let column0 = document.createElement('div');
  let column1 = document.createElement('div');
  let body0 = document.createElement('div');
  let body1 = document.createElement('div');
  let card0 = document.createElement('div');
  let card1 = document.createElement('div');

  column0.setAttribute('data-kanban-column', COL_A);
  column1.setAttribute('data-kanban-column', COL_B);
  body0.setAttribute('data-kanban-col-body', '');
  body1.setAttribute('data-kanban-col-body', '');
  card0.setAttribute('data-card-index', '0');
  card1.setAttribute('data-card-index', '1');

  stubRect(column0, { left: 0, top: 0, width: 200, height: 400 });
  stubRect(column1, { left: 220, top: 0, width: 200, height: 400 });
  stubRect(body0, { left: 0, top: 0, width: 200, height: 400 });
  stubRect(body1, { left: 220, top: 0, width: 200, height: 400 });
  stubRect(card0, { left: 8, top: 10, width: 184, height: 170 });
  stubRect(card1, { left: 228, top: 10, width: 184, height: 170 });

  body0.append(card0);
  body1.append(card1);
  column0.append(body0);
  column1.append(body1);
  container.append(column0, column1);

  return container;
}

module('Unit | kanban-drag-manager', function (hooks) {
  let container: HTMLElement;
  let placements: KanbanPlacement[];

  hooks.beforeEach(function () {
    container = makeBoard();
    placements = [
      { index: 0, columnId: COL_A, sortOrder: 1 },
      { index: 1, columnId: COL_B, sortOrder: 1 },
    ];
  });

  hooks.afterEach(function () {
    container.remove();
    document.body.style.userSelect = '';
    (
      document.body.style as CSSStyleDeclaration & { webkitUserSelect?: string }
    ).webkitUserSelect = '';
  });

  test('pointer tap selects and opens a card without entering drag mode', function (assert) {
    let selected: number | null | undefined;
    let opened: number | null = null;

    let manager = new KanbanDragManager({
      placements,
      columnCount: 2,
      columns: COLUMNS_AB,
      isColumnVisible: () => true,
      onChange: () => assert.step('change'),
      onSelect: (index: number | null) => {
        selected = index;
      },
      onOpen: (index: number) => {
        opened = index;
      },
    });

    container.setPointerCapture = () => {};
    container.releasePointerCapture = () => {};
    manager.registerContainer(container);

    let card = container.querySelector('[data-card-index="0"]') as HTMLElement;

    manager.onPointerDown({
      button: 0,
      pointerId: 1,
      clientX: 20,
      clientY: 20,
      target: card,
    } as unknown as PointerEvent);
    manager.onPointerUp({
      pointerId: 1,
    } as unknown as PointerEvent);

    assert.strictEqual(selected, 0);
    assert.strictEqual(opened, 0);
    assert.strictEqual(manager.interactionMode, 'idle');
    assert.verifySteps([]);
  });

  test('moving beyond threshold activates drag and dropping emits updated placements', async function (assert) {
    let changedPlacements: KanbanPlacement[] | undefined;

    let manager = new KanbanDragManager({
      placements,
      columnCount: 2,
      columns: COLUMNS_AB,
      isColumnVisible: () => true,
      onChange: (nextPlacements: KanbanPlacement[]) => {
        changedPlacements = nextPlacements;
      },
    });

    container.setPointerCapture = () => {};
    container.releasePointerCapture = () => {};
    manager.registerContainer(container);
    (manager as any).measureSettlePosition = () => {};

    let card = container.querySelector('[data-card-index="0"]') as HTMLElement;

    manager.onPointerDown({
      button: 0,
      pointerId: 2,
      clientX: 20,
      clientY: 20,
      target: card,
    } as unknown as PointerEvent);
    manager.onPointerMove({
      pointerId: 2,
      clientX: 260,
      clientY: 30,
    } as unknown as PointerEvent);

    assert.strictEqual(manager.interactionMode, 'drag');
    assert.strictEqual(manager.activeDragIndex, 0);
    assert.strictEqual(manager.dragGhostWidth, 184);
    assert.deepEqual(manager.insertion, {
      columnId: COL_B,
      insertBeforeIndex: -1,
      position: 2,
    });

    manager.onPointerUp({
      pointerId: 2,
      clientX: 260,
      clientY: 30,
    } as unknown as PointerEvent);

    await delay(350);

    assert.deepEqual(changedPlacements, [
      { index: 0, columnId: COL_B, sortOrder: 2 },
      { index: 1, columnId: COL_B, sortOrder: 1 },
    ]);
  });

  test('escape during drag restores the snapshot placements', function (assert) {
    let changes: KanbanPlacement[][] = [];

    let manager = new KanbanDragManager({
      placements,
      columnCount: 2,
      columns: COLUMNS_AB,
      isColumnVisible: () => true,
      onChange: (nextPlacements: KanbanPlacement[]) => {
        changes.push(nextPlacements);
      },
    });

    container.setPointerCapture = () => {};
    container.releasePointerCapture = () => {};
    manager.registerContainer(container);

    let card = container.querySelector('[data-card-index="0"]') as HTMLElement;
    manager.onPointerDown({
      button: 0,
      pointerId: 3,
      clientX: 20,
      clientY: 20,
      target: card,
    } as unknown as PointerEvent);
    manager.onPointerMove({
      pointerId: 3,
      clientX: 260,
      clientY: 30,
    } as unknown as PointerEvent);

    let prevented = false;
    manager.onKeyDown({
      key: 'Escape',
      preventDefault() {
        prevented = true;
      },
    } as unknown as KeyboardEvent);

    assert.true(prevented);
    assert.deepEqual(changes, [placements]);
    assert.strictEqual(manager.interactionMode, 'idle');
    assert.strictEqual(manager.activeDragIndex, null);
  });

  test('hold-delay activates drag without pointer movement', async function (assert) {
    let manager = new KanbanDragManager({
      placements,
      columnCount: 2,
      columns: COLUMNS_AB,
      isColumnVisible: () => true,
      onChange: () => {},
    });

    container.setPointerCapture = () => {};
    container.releasePointerCapture = () => {};
    manager.registerContainer(container);

    let card = container.querySelector('[data-card-index="0"]') as HTMLElement;

    manager.onPointerDown({
      button: 0,
      pointerId: 4,
      clientX: 20,
      clientY: 20,
      target: card,
    } as unknown as PointerEvent);

    assert.strictEqual(manager.interactionMode, 'pending');

    await delay(250);

    assert.strictEqual(manager.interactionMode, 'drag');
    assert.strictEqual(manager.activeDragIndex, 0);
    assert.strictEqual(manager.dragGhostWidth, 184);
    assert.strictEqual(manager.pointerClientX, 20);
    assert.strictEqual(manager.pointerClientY, 20);
    assert.strictEqual(manager.dragOffsetX, 12);
    assert.strictEqual(manager.dragOffsetY, 10);

    manager.onPointerUp({ pointerId: 4 } as unknown as PointerEvent);
    await delay(350);
  });

  test('pointer cancel resets drag state and restores body selection', function (assert) {
    let manager = new KanbanDragManager({
      placements,
      columnCount: 2,
      columns: COLUMNS_AB,
      isColumnVisible: () => true,
      onChange: () => {},
    });

    container.setPointerCapture = () => {};
    container.releasePointerCapture = () => {};
    manager.registerContainer(container);

    let card = container.querySelector('[data-card-index="0"]') as HTMLElement;
    manager.onPointerDown({
      button: 0,
      pointerId: 5,
      clientX: 20,
      clientY: 20,
      target: card,
    } as unknown as PointerEvent);
    manager.onPointerMove({
      pointerId: 5,
      clientX: 260,
      clientY: 30,
    } as unknown as PointerEvent);

    assert.strictEqual(manager.interactionMode, 'drag');
    assert.strictEqual(document.body.style.userSelect, 'none');

    manager.onPointerCancel({ pointerId: 5 } as unknown as PointerEvent);

    assert.strictEqual(manager.interactionMode, 'idle');
    assert.strictEqual(manager.activeDragIndex, null);
    assert.strictEqual(document.body.style.userSelect, '');
    assert.strictEqual(
      (
        document.body.style as CSSStyleDeclaration & {
          webkitUserSelect?: string;
        }
      ).webkitUserSelect,
      '',
    );
  });

  test('normal drop ignores the lostpointercapture caused by releasing capture', async function (assert) {
    let changedPlacements: KanbanPlacement[] | undefined;

    let manager = new KanbanDragManager({
      placements,
      columnCount: 2,
      columns: COLUMNS_AB,
      isColumnVisible: () => true,
      onChange: (nextPlacements: KanbanPlacement[]) => {
        changedPlacements = nextPlacements;
      },
    });

    container.setPointerCapture = () => {};
    container.releasePointerCapture = (pointerId: number) => {
      manager.onLostPointerCapture({ pointerId } as unknown as PointerEvent);
    };
    manager.registerContainer(container);
    (manager as any).measureSettlePosition = () => {};

    let card = container.querySelector('[data-card-index="0"]') as HTMLElement;

    manager.onPointerDown({
      button: 0,
      pointerId: 6,
      clientX: 20,
      clientY: 20,
      target: card,
    } as unknown as PointerEvent);
    manager.onPointerMove({
      pointerId: 6,
      clientX: 260,
      clientY: 30,
    } as unknown as PointerEvent);
    manager.onPointerMove({
      pointerId: 6,
      clientX: 260,
      clientY: 30,
    } as unknown as PointerEvent);

    manager.onPointerUp({
      pointerId: 6,
      clientX: 260,
      clientY: 30,
    } as unknown as PointerEvent);

    assert.true(manager.isSettling);
    assert.strictEqual(manager.activeDragIndex, 0);
    assert.strictEqual(manager.interactionMode, 'drag');

    await delay(350);

    assert.deepEqual(changedPlacements, [
      { index: 0, columnId: COL_B, sortOrder: 2 },
      { index: 1, columnId: COL_B, sortOrder: 1 },
    ]);
    assert.strictEqual(manager.interactionMode, 'idle');
  });

  test('dragging from the card edge still switches columns as soon as the pointer enters the next lane', function (assert) {
    let manager = new KanbanDragManager({
      placements,
      columnCount: 2,
      columns: COLUMNS_AB,
      isColumnVisible: () => true,
      onChange: () => {},
    });

    container.setPointerCapture = () => {};
    container.releasePointerCapture = () => {};
    manager.registerContainer(container);

    let card = container.querySelector('[data-card-index="0"]') as HTMLElement;

    manager.onPointerDown({
      button: 0,
      pointerId: 7,
      clientX: 188,
      clientY: 20,
      target: card,
    } as unknown as PointerEvent);
    manager.onPointerMove({
      pointerId: 7,
      clientX: 230,
      clientY: 30,
    } as unknown as PointerEvent);

    assert.strictEqual(manager.interactionMode, 'drag');
    assert.deepEqual(manager.insertion, {
      columnId: COL_B,
      insertBeforeIndex: -1,
      position: 2,
    });
  });

  test('escape while idle clears selection without calling preventDefault', function (assert) {
    let deselected = false;

    let manager = new KanbanDragManager({
      placements,
      columnCount: 2,
      columns: COLUMNS_AB,
      isColumnVisible: () => true,
      onChange: () => {},
      onSelect: (index: number | null) => {
        if (index === null) {
          deselected = true;
        }
      },
    });

    manager.select(0);
    assert.strictEqual(manager.selectedIndex, 0);

    let prevented = false;
    manager.onKeyDown({
      key: 'Escape',
      preventDefault() {
        prevented = true;
      },
    } as unknown as KeyboardEvent);

    assert.false(prevented);
    assert.strictEqual(manager.selectedIndex, null);
    assert.true(deselected);
  });

  test('select() sets selectedIndex and calls onSelect', function (assert) {
    let lastSelected: number | null | undefined;

    let manager = new KanbanDragManager({
      placements,
      columnCount: 2,
      columns: COLUMNS_AB,
      isColumnVisible: () => true,
      onChange: () => {},
      onSelect: (index: number | null) => {
        lastSelected = index;
      },
    });

    manager.select(1);
    assert.strictEqual(manager.selectedIndex, 1);
    assert.strictEqual(lastSelected, 1);

    manager.select(null);
    assert.strictEqual(manager.selectedIndex, null);
    assert.strictEqual(lastSelected, null);
  });

  test('destroy() clears the hold-timer so drag is never activated', async function (assert) {
    let dragActivated = false;

    let manager = new KanbanDragManager({
      placements,
      columnCount: 2,
      columns: COLUMNS_AB,
      isColumnVisible: () => true,
      onChange: () => {
        dragActivated = true;
      },
    });

    container.setPointerCapture = () => {};
    manager.registerContainer(container);

    let card = container.querySelector('[data-card-index="0"]') as HTMLElement;

    manager.onPointerDown({
      button: 0,
      pointerId: 5,
      clientX: 20,
      clientY: 20,
      target: card,
    } as unknown as PointerEvent);

    assert.strictEqual(document.body.style.userSelect, 'none');
    assert.strictEqual(manager.interactionMode, 'pending');

    manager.destroy();

    assert.strictEqual(document.body.style.userSelect, '');

    await delay(250);

    assert.false(dragActivated, 'onChange was not called after destroy');
    assert.strictEqual(manager.interactionMode, 'pending');
  });

  module('keyboard interactions', function (kbHooks) {
    let mc: HTMLElement;
    let mp: KanbanPlacement[];

    kbHooks.beforeEach(function () {
      const board = makeMultiBoard();
      mc = board.container;
      mp = board.placements;
    });

    function makeKbManager(
      opts: {
        columns?: KanbanColumnConfig[];
        isColumnVisible?: (columnId: string) => boolean;
        onChange?: (p: KanbanPlacement[]) => void;
        onSelect?: (i: number | null) => void;
      } = {},
    ) {
      const mgr = new KanbanDragManager({
        placements: mp,
        columnCount: 2,
        columns: opts.columns ?? COLUMNS_AB,
        isColumnVisible: opts.isColumnVisible ?? (() => true),
        onChange: opts.onChange ?? (() => {}),
        onSelect: opts.onSelect,
      });
      mgr.registerContainer(mc);
      return mgr;
    }

    function keyEvent(
      key: string,
      target: Element | null = null,
    ): { event: KeyboardEvent; prevented: () => boolean } {
      let prevented = false;
      const event = {
        key,
        target: target ?? document.body,
        preventDefault() {
          prevented = true;
        },
      } as unknown as KeyboardEvent;
      return { event, prevented: () => prevented };
    }

    test('Space or Enter on a focused card enters kb-drag mode', function (assert) {
      const mgr = makeKbManager();
      const card0 = mc.querySelector('[data-card-index="0"]')!;

      const { event: spaceEvent, prevented: spacePrevent } = keyEvent(
        ' ',
        card0,
      );
      mgr.onKeyDown(spaceEvent);
      assert.true(spacePrevent());
      assert.strictEqual(mgr.interactionMode, 'kb-drag');
      assert.strictEqual(mgr.activeDragIndex, 0);
      assert.strictEqual(mgr.kbGrabIndex, 0);
      assert.true(mgr.announcement.startsWith('Grabbed'));

      // Enter also enters kb-drag
      mgr.onKeyDown(keyEvent('Escape').event);
      mgr.onKeyDown(keyEvent('Enter', card0).event);
      assert.strictEqual(mgr.interactionMode, 'kb-drag');
      assert.strictEqual(mgr.activeDragIndex, 0);
    });

    test('Space outside a card in idle mode does nothing', function (assert) {
      const mgr = makeKbManager();
      mgr.onKeyDown(keyEvent(' ').event);
      assert.strictEqual(mgr.interactionMode, 'idle');
      assert.strictEqual(mgr.activeDragIndex, null);
    });

    test('initial insertion points before the card immediately below the grabbed card', function (assert) {
      const mgr = makeKbManager();
      const card0 = mc.querySelector('[data-card-index="0"]')!;
      mgr.onKeyDown(keyEvent(' ', card0).event);
      assert.deepEqual(mgr.insertion, {
        columnId: COL_A,
        insertBeforeIndex: 2,
        position: 2,
      });
    });

    test('ArrowDown in kb-drag moves insertion down; stops at column boundary', function (assert) {
      const mgr = makeKbManager();
      const card0 = mc.querySelector('[data-card-index="0"]')!;
      mgr.onKeyDown(keyEvent(' ', card0).event);
      mgr.onKeyDown(keyEvent('ArrowDown').event);
      assert.deepEqual(mgr.insertion, {
        columnId: COL_A,
        insertBeforeIndex: -1,
        position: 3,
      });
      assert.strictEqual(mgr.announcement, 'Position 2 of 2.');

      // already at end — another ArrowDown should not change insertion
      const before = mgr.insertion;
      mgr.onKeyDown(keyEvent('ArrowDown').event);
      assert.deepEqual(mgr.insertion, before);
    });

    test('ArrowUp in kb-drag moves insertion earlier in the column', function (assert) {
      const mgr = makeKbManager();
      // Start with card2 (last) so there is room to move up
      const card2 = mc.querySelector('[data-card-index="2"]')!;
      mgr.onKeyDown(keyEvent(' ', card2).event);
      // initial: end of column (insertBeforeIndex -1)
      mgr.onKeyDown(keyEvent('ArrowUp').event);
      // Should now be before card0 (the only remaining card)
      assert.deepEqual(mgr.insertion, {
        columnId: COL_A,
        insertBeforeIndex: 0,
        position: 1,
      });
    });

    test('ArrowRight and ArrowLeft in kb-drag move insertion across columns', function (assert) {
      const mgr = makeKbManager();
      const card0 = mc.querySelector('[data-card-index="0"]')!;
      mgr.onKeyDown(keyEvent(' ', card0).event);
      mgr.onKeyDown(keyEvent('ArrowRight').event);
      assert.strictEqual(mgr.insertion?.columnId, COL_B);
      assert.true(mgr.announcement.startsWith('Column 2'));
      mgr.onKeyDown(keyEvent('ArrowLeft').event);
      assert.strictEqual(mgr.insertion?.columnId, COL_A);
    });

    test('keyboard drag skips hidden columns', function (assert) {
      mp = [
        { index: 0, columnId: COL_A, sortOrder: 1 },
        { index: 1, columnId: COL_B, sortOrder: 1 },
        { index: 2, columnId: COL_C, sortOrder: 1 },
      ];
      const mgr = new KanbanDragManager({
        placements: mp,
        columnCount: 3,
        columns: COLUMNS_ABC,
        isColumnVisible: (columnId: string) => columnId !== COL_B,
        onChange: () => {},
      });
      mgr.registerContainer(mc);

      const card0 = mc.querySelector('[data-card-index="0"]')!;
      mgr.onKeyDown(keyEvent(' ', card0).event);
      mgr.onKeyDown(keyEvent('ArrowRight').event);

      assert.strictEqual(mgr.insertion?.columnId, COL_C);
    });

    test('Space or Enter in kb-drag commits the drop and fires onChange', function (assert) {
      let changed: KanbanPlacement[] | undefined;
      const mgr = makeKbManager({ onChange: (p) => (changed = p) });
      const card0 = mc.querySelector('[data-card-index="0"]')!;
      mgr.onKeyDown(keyEvent(' ', card0).event);
      mgr.onKeyDown(keyEvent('ArrowRight').event);
      mgr.onKeyDown(keyEvent(' ').event);
      assert.strictEqual(mgr.interactionMode, 'idle');
      assert.strictEqual(mgr.activeDragIndex, null);
      assert.notStrictEqual(changed, undefined);
      assert.strictEqual(
        changed!.find((p) => p.index === 0)?.columnId,
        COL_B,
        'card 0 should land in col-b',
      );
      assert.strictEqual(mgr.announcement, 'Card dropped.');

      // Enter also commits
      changed = undefined;
      const mgr2 = makeKbManager({ onChange: (p) => (changed = p) });
      mgr2.onKeyDown(keyEvent(' ', card0).event);
      mgr2.onKeyDown(keyEvent('ArrowRight').event);
      mgr2.onKeyDown(keyEvent('Enter').event);
      assert.strictEqual(mgr2.interactionMode, 'idle');
      assert.notStrictEqual(changed, undefined);
    });

    test('no-op drop announces "returned to original position" and does not fire onChange', function (assert) {
      let changed = false;
      const mgr = makeKbManager({ onChange: () => (changed = true) });
      const card0 = mc.querySelector('[data-card-index="0"]')!;
      // grab and immediately drop without moving
      mgr.onKeyDown(keyEvent(' ', card0).event);
      mgr.onKeyDown(keyEvent(' ').event);
      assert.false(changed);
      assert.strictEqual(
        mgr.announcement,
        'Card returned to original position.',
      );
      assert.strictEqual(mgr.interactionMode, 'idle');
    });

    test('Escape in kb-drag cancels and restores snapshot via onChange', function (assert) {
      let changes: KanbanPlacement[][] = [];
      const mgr = makeKbManager({ onChange: (p) => changes.push(p) });
      const card0 = mc.querySelector('[data-card-index="0"]')!;
      mgr.onKeyDown(keyEvent(' ', card0).event);
      mgr.onKeyDown(keyEvent('ArrowRight').event);
      const { event, prevented } = keyEvent('Escape');
      mgr.onKeyDown(event);
      assert.true(prevented());
      assert.strictEqual(mgr.interactionMode, 'idle');
      assert.strictEqual(mgr.activeDragIndex, null);
      assert.deepEqual(changes, [mp], 'snapshot placements are restored');
      assert.strictEqual(mgr.announcement, 'Movement cancelled.');
    });

    test('idle navigation moves selection across rows and columns', function (assert) {
      let lastSelected: number | null | undefined;
      const mgr = makeKbManager({ onSelect: (i) => (lastSelected = i) });

      // no selection → ArrowDown selects first card
      const { event: downNoSel, prevented: downNoSelPrev } =
        keyEvent('ArrowDown');
      mgr.onKeyDown(downNoSel);
      assert.true(downNoSelPrev(), 'ArrowDown prevents default');
      assert.strictEqual(
        mgr.interactionMode,
        'idle',
        'navigation does not change interactionMode',
      );
      assert.strictEqual(mgr.selectedIndex, 0, 'selects first card');

      // ArrowDown moves to next card in column
      mgr.onKeyDown(keyEvent('ArrowDown').event);
      assert.strictEqual(mgr.selectedIndex, 2, 'card2 is next in col-a');
      assert.strictEqual(lastSelected, 2);

      // ArrowUp at top of column keeps selection unchanged
      mgr.select(0);
      const { event: upAtTop, prevented: upPrev } = keyEvent('ArrowUp');
      mgr.onKeyDown(upAtTop);
      assert.true(upPrev(), 'ArrowUp prevents default');
      assert.strictEqual(mgr.selectedIndex, 0, 'stays at top');

      // ArrowRight moves to adjacent column
      const { event: rightEvent, prevented: rightPrev } =
        keyEvent('ArrowRight');
      mgr.onKeyDown(rightEvent);
      assert.true(rightPrev(), 'ArrowRight prevents default');
      assert.strictEqual(mgr.selectedIndex, 1, 'card1 is in col-b');
      assert.strictEqual(lastSelected, 1);

      // ArrowLeft moves back
      mgr.select(1);
      const { event: leftEvent, prevented: leftPrev } = keyEvent('ArrowLeft');
      mgr.onKeyDown(leftEvent);
      assert.true(leftPrev(), 'ArrowLeft prevents default');
      assert.strictEqual(mgr.selectedIndex, 0);
    });

    test('idle keyboard navigation skips hidden columns', function (assert) {
      mp = [
        { index: 0, columnId: COL_A, sortOrder: 1 },
        { index: 1, columnId: COL_B, sortOrder: 1 },
        { index: 2, columnId: COL_C, sortOrder: 1 },
      ];
      const mgr = new KanbanDragManager({
        placements: mp,
        columnCount: 3,
        columns: COLUMNS_ABC,
        isColumnVisible: (columnId: string) => columnId !== COL_B,
        onChange: () => {},
      });
      mgr.registerContainer(mc);

      mgr.select(0);
      mgr.onKeyDown(keyEvent('ArrowRight').event);

      assert.strictEqual(mgr.selectedIndex, 2);
    });
  });

  test('dropping outside all columns when insertion is null does not call onChange', async function (assert) {
    let changed = false;

    let manager = new KanbanDragManager({
      placements,
      columnCount: 2,
      columns: COLUMNS_AB,
      isColumnVisible: () => true,
      onChange: () => {
        changed = true;
      },
    });

    container.setPointerCapture = () => {};
    container.releasePointerCapture = () => {};
    manager.registerContainer(container);
    (manager as any).measureSettlePosition = () => {};

    let card = container.querySelector('[data-card-index="0"]') as HTMLElement;

    manager.onPointerDown({
      button: 0,
      pointerId: 6,
      clientX: 20,
      clientY: 20,
      target: card,
    } as unknown as PointerEvent);
    // move beyond threshold to activate drag
    manager.onPointerMove({
      pointerId: 6,
      clientX: 30,
      clientY: 20,
    } as unknown as PointerEvent);
    // move far outside all columns so insertion becomes null
    manager.onPointerMove({
      pointerId: 6,
      clientX: 9999,
      clientY: 20,
    } as unknown as PointerEvent);

    await settled();
    assert.strictEqual(manager.insertion, null);
    assert.strictEqual(manager.interactionMode, 'drag');

    manager.onPointerUp({ pointerId: 6 } as unknown as PointerEvent);

    await delay(350);

    assert.false(
      changed,
      'onChange must not fire when dropped outside the board',
    );
    assert.strictEqual(manager.interactionMode, 'idle');
  });

  test('dropping outside the board commits the last visible insertion target', async function (assert) {
    let changedPlacements: KanbanPlacement[] | undefined;
    const expected = [
      { index: 0, columnId: COL_B, sortOrder: 2 },
      { index: 1, columnId: COL_B, sortOrder: 1 },
    ];

    function makeManager() {
      changedPlacements = undefined;
      const mgr = new KanbanDragManager({
        placements,
        columnCount: 2,
        columns: COLUMNS_AB,
        isColumnVisible: () => true,
        onChange: (next: KanbanPlacement[]) => {
          changedPlacements = next;
        },
      });
      container.setPointerCapture = () => {};
      container.releasePointerCapture = () => {};
      mgr.registerContainer(container);
      (mgr as any).measureSettlePosition = () => {};
      return mgr;
    }

    const card = container.querySelector(
      '[data-card-index="0"]',
    ) as HTMLElement;

    // off-screen X
    let mgr = makeManager();
    mgr.onPointerDown({
      button: 0,
      pointerId: 7,
      clientX: 20,
      clientY: 20,
      target: card,
    } as unknown as PointerEvent);
    mgr.onPointerMove({
      pointerId: 7,
      clientX: 260,
      clientY: 30,
    } as unknown as PointerEvent);
    mgr.onPointerUp({
      pointerId: 7,
      clientX: 9999,
      clientY: 30,
    } as unknown as PointerEvent);
    await delay(350);
    assert.deepEqual(changedPlacements, expected, 'commits with off-screen X');
    assert.strictEqual(mgr.interactionMode, 'idle');

    // off-screen Y
    mgr = makeManager();
    mgr.onPointerDown({
      button: 0,
      pointerId: 8,
      clientX: 20,
      clientY: 20,
      target: card,
    } as unknown as PointerEvent);
    mgr.onPointerMove({
      pointerId: 8,
      clientX: 260,
      clientY: 30,
    } as unknown as PointerEvent);
    mgr.onPointerUp({
      pointerId: 8,
      clientX: 260,
      clientY: 9999,
    } as unknown as PointerEvent);
    await delay(350);
    assert.deepEqual(changedPlacements, expected, 'commits with off-screen Y');
    assert.strictEqual(mgr.interactionMode, 'idle');
  });
});
