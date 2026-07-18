import { get } from '@ember/helper';
import { click, render, waitFor } from '@ember/test-helpers';

import { module, test } from 'qunit';

import {
  SORT_OPTIONS,
  VIEW_OPTIONS,
} from '@cardstack/host/components/card-search/constants';
import SearchResultHeader from '@cardstack/host/components/card-search/search-result-header';
import type { SelectedSearchItem } from '@cardstack/host/utils/card-search/types';

import { setupRenderingTest } from '../../helpers/setup';

const noop = () => {};

const card = (id: string): SelectedSearchItem => ({ id, kind: 'card' });
const selectedTwo: SelectedSearchItem[] = [card('a'), card('b')];
const allThree: SelectedSearchItem[] = [card('a'), card('b'), card('c')];
const noSelection: SelectedSearchItem[] = [];

module(
  'Integration | card-search/search-result-header (selection menu)',
  function (hooks) {
    setupRenderingTest(hooks);

    test('the "N Selected" trigger renders the Adorn teal checkmark treatment', async function (assert) {
      await render(
        <template>
          <SearchResultHeader
            @summaryText='2 results across 1 realm'
            @viewOptions={{VIEW_OPTIONS}}
            @activeViewId='grid'
            @activeSort={{get SORT_OPTIONS 0}}
            @sortOptions={{SORT_OPTIONS}}
            @onChangeView={{noop}}
            @onChangeSort={{noop}}
            @multiSelect={{true}}
            @selectedCards={{selectedTwo}}
            @allCards={{allThree}}
            @onSelectAll={{noop}}
            @onDeselectAll={{noop}}
          />
        </template>,
      );

      assert
        .dom('[data-test-selection-dropdown-trigger]')
        .hasText('2', 'trigger shows the selected count only');
      assert
        .dom('[data-test-selection-dropdown-trigger]')
        .hasAttribute(
          'aria-label',
          'Selection menu, 2 cards selected',
          'trigger spells out the control and count for assistive tech',
        );
      assert
        .dom('[data-test-selection-dropdown-trigger] svg circle')
        .exists('trigger renders the dark-circle-with-teal-check icon');
    });

    test('the selection menu opens with an inert "N Selected" header above Select/Deselect All', async function (assert) {
      let selectAllArg: SelectedSearchItem[] | undefined;
      let deselectedAll = false;
      const onSelectAll = (cards: SelectedSearchItem[]) =>
        (selectAllArg = cards);
      const onDeselectAll = () => (deselectedAll = true);

      await render(
        <template>
          <SearchResultHeader
            @summaryText='3 results across 1 realm'
            @viewOptions={{VIEW_OPTIONS}}
            @activeViewId='grid'
            @activeSort={{get SORT_OPTIONS 0}}
            @sortOptions={{SORT_OPTIONS}}
            @onChangeView={{noop}}
            @onChangeSort={{noop}}
            @multiSelect={{true}}
            @selectedCards={{selectedTwo}}
            @allCards={{allThree}}
            @onSelectAll={{onSelectAll}}
            @onDeselectAll={{onDeselectAll}}
          />
        </template>,
      );

      await click('[data-test-selection-dropdown-trigger]');
      await waitFor('[data-test-boxel-menu-item-text="2 Selected"]');

      assert
        .dom('[data-test-boxel-menu-item-header]')
        .exists({ count: 1 }, 'the menu has exactly one inert header item');
      assert
        .dom('[data-test-boxel-menu-item-header]')
        .hasText('2 Selected', 'the header echoes the selected count');
      assert
        .dom('[data-test-boxel-menu-item-text="Select All"]')
        .exists('Select All item is present');
      assert
        .dom('[data-test-boxel-menu-item-text="Deselect All"]')
        .exists('Deselect All item is present');

      await click('[data-test-boxel-menu-item-text="Select All"]');
      assert.deepEqual(
        selectAllArg,
        [card('a'), card('b'), card('c')],
        'Select All forwards every card',
      );

      await click('[data-test-selection-dropdown-trigger]');
      await waitFor('[data-test-boxel-menu-item-text="Deselect All"]');
      await click('[data-test-boxel-menu-item-text="Deselect All"]');
      assert.true(deselectedAll, 'Deselect All clears the selection');
    });

    test('the selection menu is hidden when no cards are selected', async function (assert) {
      await render(
        <template>
          <SearchResultHeader
            @summaryText='2 results across 1 realm'
            @viewOptions={{VIEW_OPTIONS}}
            @activeViewId='grid'
            @activeSort={{get SORT_OPTIONS 0}}
            @sortOptions={{SORT_OPTIONS}}
            @onChangeView={{noop}}
            @onChangeSort={{noop}}
            @multiSelect={{true}}
            @selectedCards={{noSelection}}
            @allCards={{allThree}}
            @onSelectAll={{noop}}
            @onDeselectAll={{noop}}
          />
        </template>,
      );

      assert.dom('[data-test-selection-dropdown-trigger]').doesNotExist();
    });

    test('the selection menu is hidden when not in multi-select mode', async function (assert) {
      await render(
        <template>
          <SearchResultHeader
            @summaryText='2 results across 1 realm'
            @viewOptions={{VIEW_OPTIONS}}
            @activeViewId='grid'
            @activeSort={{get SORT_OPTIONS 0}}
            @sortOptions={{SORT_OPTIONS}}
            @onChangeView={{noop}}
            @onChangeSort={{noop}}
          />
        </template>,
      );

      assert.dom('[data-test-selection-dropdown-trigger]').doesNotExist();
    });
  },
);
