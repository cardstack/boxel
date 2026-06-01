import { render, settled, waitFor } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { rri } from '@cardstack/runtime-common';

import ItemButton from '@cardstack/host/components/card-search/item-button';
import type { NewCardArgs } from '@cardstack/host/utils/card-search/types';

import { setupRenderingTest } from '../../helpers/setup';

import type { ComponentLike } from '@glint/template';

// Stand-in for a prerendered card component. ItemButton extracts the
// type-label name from the rendered card DOM, where CardRenderer normally
// stamps it.
const PrerenderedStub: ComponentLike<{ Element: Element }> = <template>
  <div data-card-type-display-name='Authenticated Image Tester'>
    Authenticated Image Tester preview
  </div>
</template>;

// Same as above, but also carries the type-icon HTML the realm server
// stamps on prerendered cards — ItemButton renders it into the label's
// icon slot.
const PrerenderedStubWithIcon: ComponentLike<{ Element: Element }> = <template>
  <div
    data-card-type-display-name='Authenticated Image Tester'
    data-card-type-icon-html='<svg data-test-type-icon></svg>'
  >
    Authenticated Image Tester preview
  </div>
</template>;

const noop = () => {};
const newCardItem: NewCardArgs = {
  ref: { module: rri('http://test/foo.gts'), name: 'Foo' },
  relativeTo: undefined,
  realmURL: rri('http://test/'),
};

module('Integration | card-search/item-button (adorn)', function (hooks) {
  setupRenderingTest(hooks);

  test('passes through the adorn class when @adorn is true', async function (assert) {
    await render(
      <template>
        <ItemButton
          @item={{newCardItem}}
          @isSelected={{false}}
          @onSelect={{noop}}
          @adorn={{true}}
        />
      </template>,
    );
    assert
      .dom('.catalog-item.adorn')
      .exists('the catalog-item button carries the adorn class');
  });

  test('does not add the adorn class when @adorn is omitted', async function (assert) {
    await render(
      <template>
        <ItemButton
          @item={{newCardItem}}
          @isSelected={{false}}
          @onSelect={{noop}}
        />
      </template>,
    );
    assert.dom('.catalog-item').exists();
    assert
      .dom('.catalog-item.adorn')
      .doesNotExist('the legacy treatment is unchanged without @adorn');
  });

  test('renders the teal adorn select chip when adorn + multi-select + selected', async function (assert) {
    await render(
      <template>
        <ItemButton
          @item={{PrerenderedStub}}
          @itemId='http://test/Foo/1'
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

  test('hover type-label tab picks up the card type display name from the rendered card', async function (assert) {
    await render(
      <template>
        <ItemButton
          @item={{PrerenderedStub}}
          @itemId='http://test/Foo/1'
          @isSelected={{false}}
          @onSelect={{noop}}
          @adorn={{true}}
        />
      </template>,
    );
    await waitFor('[data-test-adorn-label]');
    await settled();

    assert
      .dom('[data-test-adorn-label]')
      .containsText(
        'Authenticated Image Tester',
        'the type-label tab reflects data-card-type-display-name from the inner card render',
      );
  });

  test('renders the type icon from data-card-type-icon-html and settles (no render loop)', async function (assert) {
    await render(
      <template>
        <ItemButton
          @item={{PrerenderedStubWithIcon}}
          @itemId='http://test/Foo/1'
          @isSelected={{false}}
          @onSelect={{noop}}
          @adorn={{true}}
        />
      </template>,
    );
    await waitFor('[data-test-adorn-label]');
    // `settled()` would never resolve if reading the icon HTML and
    // rendering it fed the capture MutationObserver in a loop.
    await settled();

    assert
      .dom('[data-test-adorn-label] [data-test-type-icon]')
      .exists('the type icon is rendered in the label icon slot');
  });
});
