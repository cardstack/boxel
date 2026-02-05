import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { array } from '@ember/helper';
import { formatList } from '@cardstack/boxel-ui/helpers';

module('Integration | helpers | formatList', function (hooks) {
  setupRenderingTest(hooks);

  test('basic list formatting', async function (assert) {
    const items = ['Apple', 'Banana', 'Cherry'];

    await render(<template>{{formatList items}}</template>);
    assert
      .dom()
      .hasText('Apple, Banana, and Cherry', 'formats with oxford comma');
  });

  test('list styles', async function (assert) {
    const items = ['Apple', 'Banana', 'Cherry'];

    await render(<template>{{formatList items style='long'}}</template>);
    assert
      .dom()
      .hasText('Apple, Banana, and Cherry', 'long style with oxford comma');

    await render(<template>{{formatList items style='short'}}</template>);
    assert
      .dom()
      .hasText('Apple, Banana, Cherry', 'short style without oxford comma');

    await render(<template>{{formatList items style='narrow'}}</template>);
    assert
      .dom()
      .hasText('Apple Banana Cherry', 'narrow style with spaces only');
  });

  test('list types', async function (assert) {
    const items = ['Apple', 'Banana', 'Cherry'];

    await render(<template>{{formatList items type='conjunction'}}</template>);
    assert.dom().hasText('Apple, Banana, and Cherry', 'conjunction uses "and"');

    await render(<template>{{formatList items type='disjunction'}}</template>);
    assert.dom().hasText('Apple, Banana, or Cherry', 'disjunction uses "or"');

    await render(<template>{{formatList items type='unit'}}</template>);
    assert.dom().hasText('Apple, Banana, Cherry', 'unit type with just commas');
  });

  test('list edge cases', async function (assert) {
    await render(<template>{{formatList (array)}}</template>);
    assert.dom().hasText('', 'handles empty array');

    await render(<template>{{formatList (array 'Single')}}</template>);
    assert.dom().hasText('Single', 'handles single item');

    await render(<template>{{formatList null fallback='No items'}}</template>);
    assert.dom().hasText('No items', 'uses fallback for null');

    await render(
      <template>{{formatList undefined fallback='No list'}}</template>,
    );
    assert.dom().hasText('No list', 'uses fallback for undefined');
  });

  test('two item lists', async function (assert) {
    const twoItems = ['Red', 'Blue'];

    await render(<template>{{formatList twoItems}}</template>);
    assert.dom().hasText('Red and Blue', 'formats two items with "and"');

    await render(
      <template>{{formatList twoItems type='disjunction'}}</template>,
    );
    assert.dom().hasText('Red or Blue', 'formats two items with "or"');
  });

  test('localization', async function (assert) {
    const items = ['Rouge', 'Bleu', 'Vert'];

    await render(<template>{{formatList items locale='fr-FR'}}</template>);
    assert.dom().hasText('Rouge, Bleu et Vert', 'French conjunction');

    await render(
      <template>
        {{formatList items type='disjunction' locale='es-ES'}}
      </template>,
    );
    assert.dom().hasText('Rouge, Bleu o Vert', 'Spanish disjunction');

    await render(<template>{{formatList items locale='zh-CN'}}</template>);
    assert.dom().hasText('Rouge、Bleu和Vert', 'Chinese conjunction');
  });

  test('invalid array handling', async function (assert) {
    const nestedArray = [['nested'], 'item'];

    await render(
      <template>
        {{! @glint-expect-error: invalid input type }}
        {{formatList nestedArray fallback='Invalid list'}}
      </template>,
    );
    assert.dom().hasText('Invalid list', 'handles nested arrays');

    await render(
      <template>
        {{! @glint-expect-error: invalid input type }}
        {{formatList 'not-an-array' fallback='Not an array'}}
      </template>,
    );
    assert.dom().hasText('Not an array', 'handles non-array input');
  });

  test('large lists', async function (assert) {
    const manyItems = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

    await render(<template>{{formatList manyItems}}</template>);
    assert
      .dom()
      .hasText('A, B, C, D, E, F, G, H, I, and J', 'handles many items');

    await render(<template>{{formatList manyItems style='short'}}</template>);
    assert
      .dom()
      .hasText('A, B, C, D, E, F, G, H, I, J', 'short style for many items');
  });

  test('special characters in items', async function (assert) {
    const specialItems = [
      'Item with spaces',
      'Item-with-dashes',
      'Item.with.dots',
    ];

    await render(<template>{{formatList specialItems}}</template>);
    assert
      .dom()
      .hasText(
        'Item with spaces, Item-with-dashes, and Item.with.dots',
        'handles special characters',
      );
  });

  module('JavaScript function usage', function () {
    test('formatList function can be called directly', async function (assert) {
      const items = ['A', 'B', 'C'];

      const result = formatList(items, { style: 'long' });
      assert.strictEqual(
        result,
        'A, B, and C',
        'function returns formatted list',
      );

      const disjunctionResult = formatList(items, {
        type: 'disjunction',
        style: 'short',
      });
      assert.strictEqual(
        disjunctionResult,
        'A, B, C',
        'function handles disjunction type',
      );
    });
  });
});
