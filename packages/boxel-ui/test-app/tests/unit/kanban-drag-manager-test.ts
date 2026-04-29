import { module, test } from 'qunit';
import {
  KanbanDragManager,
  type KanbanPlacement,
} from '@cardstack/boxel-ui/components';
import { delay } from 'test-app/tests/helpers';

function stubRect(
  element: Element,
  rect: {
    left: number;
    top: number;
    width: number;
    height: number;
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

// Two cards in column 0 (sortOrder 1 & 2), one card in column 1 (sortOrder 1).
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

  col0.setAttribute('data-kanban-column', '0');
  col1.setAttribute('data-kanban-column', '1');
  body0.className = 'col-body';
  body1.className = 'col-body';
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
      { index: 0, column: 0, sortOrder: 1 },
      { index: 2, column: 0, sortOrder: 2 },
      { index: 1, column: 1, sortOrder: 1 },
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

  column0.setAttribute('data-kanban-column', '0');
  column1.setAttribute('data-kanban-column', '1');
  body0.className = 'col-body';
  body1.className = 'col-body';
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
      { index: 0, column: 0, sortOrder: 1 },
      { index: 1, column: 1, sortOrder: 1 },
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
      placements: () => placements,
      columnCount: () => 2,
      containerElement: () => container,
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
      placements: () => placements,
      columnCount: () => 2,
      containerElement: () => container,
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
    manager.onPointerMove({
      pointerId: 2,
      clientX: 260,
      clientY: 30,
    } as unknown as PointerEvent);

    assert.strictEqual(manager.interactionMode, 'drag');
    assert.strictEqual(manager.activeDragIndex, 0);
    assert.strictEqual(manager.dragGhostWidth, 184);
    assert.deepEqual(manager.insertion, {
      column: 1,
      insertBeforeIndex: 1,
      position: 1,
    });

    manager.onPointerUp({
      pointerId: 2,
    } as unknown as PointerEvent);

    await delay(350);

    assert.deepEqual(changedPlacements, [
      { index: 0, column: 1, sortOrder: 1 },
      { index: 1, column: 1, sortOrder: 2 },
    ]);
  });

  test('escape during drag restores the snapshot placements', function (assert) {
    let changes: KanbanPlacement[][] = [];

    let manager = new KanbanDragManager({
      placements: () => placements,
      columnCount: () => 2,
      containerElement: () => container,
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
      placements: () => placements,
      columnCount: () => 2,
      containerElement: () => container,
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
      placements: () => placements,
      columnCount: () => 2,
      containerElement: () => container,
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
      placements: () => placements,
      columnCount: () => 2,
      containerElement: () => container,
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

    manager.onPointerUp({ pointerId: 6 } as unknown as PointerEvent);

    assert.true(manager.isSettling);
    assert.strictEqual(manager.activeDragIndex, 0);
    assert.strictEqual(manager.interactionMode, 'drag');

    await delay(350);

    assert.deepEqual(changedPlacements, [
      { index: 0, column: 1, sortOrder: 1 },
      { index: 1, column: 1, sortOrder: 2 },
    ]);
    assert.strictEqual(manager.interactionMode, 'idle');
  });

  test('escape while idle clears selection without calling preventDefault', function (assert) {
    let deselected = false;

    let manager = new KanbanDragManager({
      placements: () => placements,
      columnCount: () => 2,
      containerElement: () => container,
      onChange: () => {},
      onSelect: (index: number | null) => {
        if (index === null) deselected = true;
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
      placements: () => placements,
      columnCount: () => 2,
      containerElement: () => container,
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
      placements: () => placements,
      columnCount: () => 2,
      containerElement: () => container,
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
        onChange?: (p: KanbanPlacement[]) => void;
        onSelect?: (i: number | null) => void;
      } = {},
    ) {
      const mgr = new KanbanDragManager({
        placements: () => mp,
        columnCount: () => 2,
        containerElement: () => mc,
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

    test('Space on a focused card enters kb-drag mode', function (assert) {
      const mgr = makeKbManager();
      const card0 = mc.querySelector('[data-card-index="0"]')!;
      const { event, prevented } = keyEvent(' ', card0);
      mgr.onKeyDown(event);
      assert.true(prevented());
      assert.strictEqual(mgr.interactionMode, 'kb-drag');
      assert.strictEqual(mgr.activeDragIndex, 0);
      assert.strictEqual(mgr.kbGrabIndex, 0);
      assert.true(mgr.announcement.startsWith('Grabbed'));
    });

    test('Enter on a focused card also enters kb-drag mode', function (assert) {
      const mgr = makeKbManager();
      const card0 = mc.querySelector('[data-card-index="0"]')!;
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
      // card0 is sortOrder 1; card2 is the next card (sortOrder 2) in col 0
      assert.deepEqual(mgr.insertion, {
        column: 0,
        insertBeforeIndex: 2,
        position: 2,
      });
    });

    test('ArrowDown in kb-drag moves insertion to end of column', function (assert) {
      const mgr = makeKbManager();
      const card0 = mc.querySelector('[data-card-index="0"]')!;
      mgr.onKeyDown(keyEvent(' ', card0).event);
      mgr.onKeyDown(keyEvent('ArrowDown').event);
      assert.deepEqual(mgr.insertion, {
        column: 0,
        insertBeforeIndex: -1,
        position: 3,
      });
      assert.strictEqual(mgr.announcement, 'Position 2 of 2.');
    });

    test('ArrowDown at end of column does not change insertion', function (assert) {
      const mgr = makeKbManager();
      // card2 is last in col 0 (sortOrder 2)
      const card2 = mc.querySelector('[data-card-index="2"]')!;
      mgr.onKeyDown(keyEvent(' ', card2).event);
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
        column: 0,
        insertBeforeIndex: 0,
        position: 1,
      });
    });

    test('ArrowRight in kb-drag moves insertion to next column', function (assert) {
      const mgr = makeKbManager();
      const card0 = mc.querySelector('[data-card-index="0"]')!;
      mgr.onKeyDown(keyEvent(' ', card0).event);
      mgr.onKeyDown(keyEvent('ArrowRight').event);
      assert.strictEqual(mgr.insertion?.column, 1);
      assert.true(mgr.announcement.startsWith('Column 2'));
    });

    test('ArrowLeft after ArrowRight returns insertion to original column', function (assert) {
      const mgr = makeKbManager();
      const card0 = mc.querySelector('[data-card-index="0"]')!;
      mgr.onKeyDown(keyEvent(' ', card0).event);
      mgr.onKeyDown(keyEvent('ArrowRight').event);
      assert.strictEqual(mgr.insertion?.column, 1);
      mgr.onKeyDown(keyEvent('ArrowLeft').event);
      assert.strictEqual(mgr.insertion?.column, 0);
    });

    test('Space in kb-drag commits the drop and fires onChange', function (assert) {
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
        changed!.find((p) => p.index === 0)?.column,
        1,
        'card 0 should land in column 1',
      );
      assert.strictEqual(mgr.announcement, 'Card dropped.');
    });

    test('Enter in kb-drag also commits the drop', function (assert) {
      let changed: KanbanPlacement[] | undefined;
      const mgr = makeKbManager({ onChange: (p) => (changed = p) });
      const card0 = mc.querySelector('[data-card-index="0"]')!;
      mgr.onKeyDown(keyEvent(' ', card0).event);
      mgr.onKeyDown(keyEvent('ArrowRight').event);
      mgr.onKeyDown(keyEvent('Enter').event);
      assert.strictEqual(mgr.interactionMode, 'idle');
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

    test('ArrowDown in idle mode moves selectedIndex to the next card in column', function (assert) {
      let lastSelected: number | null | undefined;
      const mgr = makeKbManager({
        onSelect: (i) => (lastSelected = i),
      });
      mgr.select(0);
      mgr.onKeyDown(keyEvent('ArrowDown').event);
      assert.strictEqual(mgr.selectedIndex, 2, 'card2 is next in col 0');
      assert.strictEqual(lastSelected, 2);
    });

    test('ArrowUp in idle at top of column keeps selectedIndex unchanged', function (assert) {
      const mgr = makeKbManager();
      mgr.select(0);
      mgr.onKeyDown(keyEvent('ArrowUp').event);
      assert.strictEqual(mgr.selectedIndex, 0);
    });

    test('ArrowDown in idle with no selection selects the first card', function (assert) {
      const mgr = makeKbManager();
      assert.strictEqual(mgr.selectedIndex, null);
      mgr.onKeyDown(keyEvent('ArrowDown').event);
      assert.strictEqual(mgr.selectedIndex, 0);
    });

    test('ArrowRight in idle moves selectedIndex to adjacent column', function (assert) {
      let lastSelected: number | null | undefined;
      const mgr = makeKbManager({
        onSelect: (i) => (lastSelected = i),
      });
      mgr.select(0);
      mgr.onKeyDown(keyEvent('ArrowRight').event);
      assert.strictEqual(mgr.selectedIndex, 1, 'card1 is in col 1');
      assert.strictEqual(lastSelected, 1);
    });

    test('ArrowLeft in idle moves selectedIndex back to original column', function (assert) {
      const mgr = makeKbManager();
      mgr.select(1); // card1 is in col 1
      mgr.onKeyDown(keyEvent('ArrowLeft').event);
      // col 0 has card0 at sortOrder 1 — same row position
      assert.strictEqual(mgr.selectedIndex, 0);
    });

    test('arrow keys in idle mode always prevent default', function (assert) {
      const mgr = makeKbManager();
      for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
        const { event, prevented } = keyEvent(key);
        mgr.onKeyDown(event);
        assert.true(prevented(), `${key} prevents default`);
      }
    });

    test('arrow keys in idle do not change interactionMode', function (assert) {
      const mgr = makeKbManager();
      mgr.select(0);
      mgr.onKeyDown(keyEvent('ArrowDown').event);
      assert.strictEqual(mgr.interactionMode, 'idle');
    });
  });

  test('dropping outside all columns when insertion is null does not call onChange', async function (assert) {
    let changed = false;

    let manager = new KanbanDragManager({
      placements: () => placements,
      columnCount: () => 2,
      containerElement: () => container,
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
});
