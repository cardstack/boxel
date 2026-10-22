import { type Filter, FilterList } from '@cardstack/boxel-ui/components';
import { click, find, focus, render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { module, test } from 'qunit';

import { setupRenderingTest } from '../../helpers';

const BUTTON = (name: string) =>
  `[data-test-boxel-filter-list-button="${name}"]`;
const COUNT = '[data-test-filter-list-count]';

class RailState {
  @tracked filters: Filter[] = [
    { id: 'all', displayName: 'Everything', count: 12 },
    { id: 'cards', displayName: 'Cards', count: 0 },
    { id: 'files', displayName: 'Files' },
  ];
  @tracked activeFilter: Filter = this.filters[0]!;
  changes: Filter[] = [];

  select = (filter: Filter) => {
    this.changes.push(filter);
    this.activeFilter = filter;
  };
}

module('Integration | Component | filter-list', function (hooks) {
  setupRenderingTest(hooks);

  test('shows a count for every filter that has one, zero included', async function (assert) {
    let state = new RailState();
    await render(
      <template>
        <FilterList
          @filters={{state.filters}}
          @activeFilter={{state.activeFilter}}
          @onChanged={{state.select}}
        />
      </template>,
    );

    assert.dom(`${BUTTON('Everything')} ${COUNT}`).hasText('12');
    assert
      .dom(`${BUTTON('Cards')} ${COUNT}`)
      .hasText('0', 'zero is a real count, not a missing one');
    assert
      .dom(`${BUTTON('Files')} ${COUNT}`)
      .doesNotExist('no count element without a count');
  });

  test('clicking a row reports that filter and marks it selected', async function (assert) {
    let state = new RailState();
    await render(
      <template>
        <FilterList
          @filters={{state.filters}}
          @activeFilter={{state.activeFilter}}
          @onChanged={{state.select}}
        />
      </template>,
    );

    await click(BUTTON('Cards'));

    assert.deepEqual(
      state.changes.map((f) => f.id),
      ['cards'],
      'onChanged receives the clicked filter',
    );
    assert.dom('[data-test-selected-filter="Cards"]').exists();
    assert.dom('[data-test-selected-filter="Everything"]').doesNotExist();
  });

  test("the action block renders once per row with that row's filter", async function (assert) {
    let state = new RailState();
    await render(
      <template>
        <FilterList
          @filters={{state.filters}}
          @activeFilter={{state.activeFilter}}
          @onChanged={{state.select}}
        >
          <:action as |filter|>
            <button type='button' data-test-add={{filter.id}}>New
              {{filter.displayName}}</button>
          </:action>
        </FilterList>
      </template>,
    );

    assert.dom('[data-test-add]').exists({ count: 3 });
    assert
      .dom(`[data-test-filter-list-item="Cards"] [data-test-add="cards"]`)
      .hasText('New Cards', 'each control sits in its own row');
  });

  // A caller that rebuilds its filter objects on every refresh (the Workspace
  // rail does, from the realm's type inventory) must not have the focused row
  // replaced under the keyboard user.
  test('rows keep their DOM node, and focus, when the filter objects are rebuilt', async function (assert) {
    let state = new RailState();
    await render(
      <template>
        <FilterList
          @filters={{state.filters}}
          @activeFilter={{state.activeFilter}}
          @onChanged={{state.select}}
        />
      </template>,
    );

    await focus(BUTTON('Cards'));
    let before = find(BUTTON('Cards'));

    state.filters = state.filters.map((filter) => ({ ...filter }));
    await settled();

    assert.strictEqual(
      find(BUTTON('Cards')),
      before,
      'the same element is still in the list',
    );
    assert.dom(BUTTON('Cards')).isFocused();
  });
});
