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
