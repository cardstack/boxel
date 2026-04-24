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
});
