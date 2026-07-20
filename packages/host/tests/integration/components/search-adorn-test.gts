import { render } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { rri, type RenderableSearchEntryLike } from '@cardstack/runtime-common';

import SearchResultTile from '@cardstack/host/components/search/result-tile';
import type { NewCardArgs } from '@cardstack/host/utils/search/types';

import { setupRenderingTest } from '../../helpers/setup';

import type { ComponentLike } from '@glint/template';

// Stand-in for a search result's `entry.component` (the `HydratableCard`
// that paints inert prerendered HTML or a live card).
const StubComponent: ComponentLike<{ Args: {}; Element: Element }> = <template>
  <div data-test-stub-card>Authenticated Image Tester preview</div>
</template>;

// A minimal `RenderableSearchEntryLike`. The Adorn type-label now reads its
// name / icon straight from the view-model (`displayName` / `iconHtml`), so the
// tile no longer scrapes them out of the rendered card DOM.
function entry(
  overrides: Partial<RenderableSearchEntryLike> = {},
): RenderableSearchEntryLike {
  return {
    id: 'http://test/Foo/1',
    realmUrl: 'http://test/',
    name: 'Foo/1',
    isError: false,
    component: StubComponent,
    ...overrides,
  };
}

const baseEntry = entry();
const namedEntry = entry({ displayName: 'Authenticated Image Tester' });
const iconEntry = entry({
  displayName: 'Authenticated Image Tester',
  iconHtml: '<svg data-test-type-icon></svg>',
});

const noop = () => {};
const newCardItem: NewCardArgs = {
  ref: { module: rri('http://test/foo.gts'), name: 'Foo' },
  relativeTo: undefined,
  realmURL: rri('http://test/'),
};

module('Integration | search/result-tile (adorn)', function (hooks) {
  setupRenderingTest(hooks);

  test('passes through the adorn class when @adorn is true', async function (assert) {
    await render(
      <template>
        <SearchResultTile
          @newCard={{newCardItem}}
          @isSelected={{false}}
          @onSelect={{noop}}
          @adorn={{true}}
        />
      </template>,
    );
    assert
      .dom('.item-button.adorn')
      .exists('the item-button carries the adorn class');
  });

  test('does not add the adorn class when @adorn is omitted', async function (assert) {
    await render(
      <template>
        <SearchResultTile
          @newCard={{newCardItem}}
          @isSelected={{false}}
          @onSelect={{noop}}
        />
      </template>,
    );
    assert.dom('.item-button').exists();
    assert
      .dom('.item-button.adorn')
      .doesNotExist('the legacy treatment is unchanged without @adorn');
  });

  test('does not apply the Adorn stroke class when @adorn is false', async function (assert) {
    // The results pane wraps every tile in an AdornContext and threads its
    // strokeClass down even to non-adorn callers (e.g. Card Catalog), so the
    // class must stay gated on @adorn or those tiles would pick up the teal
    // outline.
    await render(
      <template>
        <SearchResultTile
          @newCard={{newCardItem}}
          @isSelected={{false}}
          @onSelect={{noop}}
          @adornStrokeClass='adorn-stroke'
        />
      </template>,
    );
    assert
      .dom('.item-button.adorn-stroke')
      .doesNotExist(
        'a non-adorn tile does not receive the Adorn outline class',
      );
  });

  test('renders the teal adorn select chip when adorn + multi-select + selected', async function (assert) {
    await render(
      <template>
        <SearchResultTile
          @entry={{baseEntry}}
          @isSelected={{true}}
          @multiSelect={{true}}
          @onSelect={{noop}}
          @adorn={{true}}
        />
      </template>,
    );

    assert
      .dom('[data-test-adorn-selected]')
      .exists('the teal adorn selection chip is rendered');
    assert
      .dom('.selection-indicator')
      .doesNotExist('the legacy grey selection circle is suppressed');
  });

  test('hover type-label tab reflects the entry display name', async function (assert) {
    await render(
      <template>
        <SearchResultTile
          @entry={{namedEntry}}
          @isSelected={{false}}
          @onSelect={{noop}}
          @adorn={{true}}
        />
      </template>,
    );

    assert
      .dom('[data-test-adorn-label]')
      .containsText(
        'Authenticated Image Tester',
        'the type-label tab reflects the entry view-model displayName',
      );
  });

  test('renders the type icon from the entry iconHtml', async function (assert) {
    await render(
      <template>
        <SearchResultTile
          @entry={{iconEntry}}
          @isSelected={{false}}
          @onSelect={{noop}}
          @adorn={{true}}
        />
      </template>,
    );

    assert
      .dom('[data-test-adorn-label] [data-test-type-icon]')
      .exists('the type icon is rendered in the label icon slot');
  });
});
