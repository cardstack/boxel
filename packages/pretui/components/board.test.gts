// Pretui — Board unit tests. Board is a thin wrapper over boxel-ui's
// KanbanPlane; the drag engine is that package's to prove. Asserted here is
// the wrapper's contract: the args reach the plane, the board is named, and
// the card block receives each placement.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Board } from './board';
import type { KanbanColumnConfig, KanbanPlacement } from '@cardstack/boxel-ui/components';

const COLUMNS: KanbanColumnConfig[] = [
  { key: 'todo', label: 'To cup', sortOrder: 1, collapsed: null, color: null, wipLimit: null },
  { key: 'doing', label: 'Cupping', sortOrder: 2, collapsed: null, color: null, wipLimit: 2 },
  { key: 'done', label: 'Graded', sortOrder: 3, collapsed: null, color: null, wipLimit: null },
];
const PLACEMENTS: KanbanPlacement[] = [
  { columnId: 'todo', index: 0, sortOrder: 1 },
  { columnId: 'todo', index: 1, sortOrder: 2 },
  { columnId: 'doing', index: 2, sortOrder: 1 },
];

function board(): HTMLElement {
  return document.querySelector('[data-test-pretui-board]') as HTMLElement;
}
function plane(): HTMLElement {
  return board().querySelector('[data-test-kanban-board]') as HTMLElement;
}
function columns(): HTMLElement[] {
  return Array.from(plane().querySelectorAll('[role="group"]')) as HTMLElement[];
}

module('Pretui | components/board', function (hooks) {
  setupCardTest(hooks);

  test('names the board and renders one labelled column group per config, in order', async function (assert) {
    await render(
      <template>
        <Board @columns={{COLUMNS}} @placements={{PLACEMENTS}} @boardLabel='Cupping board'>
          <:card as |p|><span data-test-card>{{p.index}}</span></:card>
        </Board>
      </template>,
    );
    assert.ok(plane(), 'the plane is the engine; Board is the dress');
    assert.strictEqual(plane().getAttribute('aria-label'), 'Cupping board');
    assert.deepEqual(columns().map((c) => c.getAttribute('aria-label')), ['To cup', 'Cupping', 'Graded']);
  });

  test('hands the card block each placement, inside its column', async function (assert) {
    await render(
      <template>
        <Board @columns={{COLUMNS}} @placements={{PLACEMENTS}}>
          <:card as |p|><span data-test-card>{{p.columnId}}:{{p.index}}</span></:card>
        </Board>
      </template>,
    );
    let cards = Array.from(board().querySelectorAll('[data-test-card]')).map((c) => c.textContent);
    assert.deepEqual(cards.sort(), ['doing:2', 'todo:0', 'todo:1']);
    assert.strictEqual(columns()[0]?.querySelectorAll('[data-test-card]').length, 2, 'two cards in To cup');
    assert.strictEqual(columns()[2]?.querySelectorAll('[data-test-card]').length, 0);
    assert.ok(columns()[2]?.querySelector('[data-test-empty-column="done"]'), 'an empty column says so');
  });
});
