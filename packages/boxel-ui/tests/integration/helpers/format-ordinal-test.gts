import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { formatOrdinal } from '@cardstack/boxel-ui/helpers';

module('Integration | helpers | formatOrdinal', function (hooks) {
  setupRenderingTest(hooks);

  test('ordinal number formatting', async function (assert) {
    await render(<template>{{formatOrdinal 1}}</template>);
    assert.dom().hasText('1st', 'formats first');

    await render(<template>{{formatOrdinal 2}}</template>);
    assert.dom().hasText('2nd', 'formats second');

    await render(<template>{{formatOrdinal 3}}</template>);
    assert.dom().hasText('3rd', 'formats third');

    await render(<template>{{formatOrdinal 4}}</template>);
    assert.dom().hasText('4th', 'formats fourth');

    await render(<template>{{formatOrdinal 21}}</template>);
    assert.dom().hasText('21st', 'formats twenty-first');

    await render(<template>{{formatOrdinal 22}}</template>);
    assert.dom().hasText('22nd', 'formats twenty-second');

    await render(<template>{{formatOrdinal 23}}</template>);
    assert.dom().hasText('23rd', 'formats twenty-third');

    await render(<template>{{formatOrdinal 101}}</template>);
    assert.dom().hasText('101st', 'formats hundred-first');
  });

  test('ordinal edge cases', async function (assert) {
    await render(<template>{{formatOrdinal 0}}</template>);
    assert.dom().hasText('0th', 'handles zero');

    await render(<template>{{formatOrdinal -1}}</template>);
    assert.dom().hasText('-1st', 'handles negative numbers');

    await render(
      <template>{{formatOrdinal null fallback='No position'}}</template>,
    );
    assert.dom().hasText('No position', 'uses fallback for null');

    await render(
      <template>{{formatOrdinal undefined fallback='No ordinal'}}</template>,
    );
    assert.dom().hasText('No ordinal', 'uses fallback for undefined');
  });

  test('special ordinal cases', async function (assert) {
    // Test teens - they all end in 'th'
    await render(<template>{{formatOrdinal 11}}</template>);
    assert.dom().hasText('11th', 'formats eleventh');

    await render(<template>{{formatOrdinal 12}}</template>);
    assert.dom().hasText('12th', 'formats twelfth');

    await render(<template>{{formatOrdinal 13}}</template>);
    assert.dom().hasText('13th', 'formats thirteenth');

    // Test boundary conditions
    await render(<template>{{formatOrdinal 111}}</template>);
    assert.dom().hasText('111th', 'formats hundred-eleventh');

    await render(<template>{{formatOrdinal 112}}</template>);
    assert.dom().hasText('112th', 'formats hundred-twelfth');

    await render(<template>{{formatOrdinal 113}}</template>);
    assert.dom().hasText('113th', 'formats hundred-thirteenth');
  });

  test('large ordinal numbers', async function (assert) {
    await render(<template>{{formatOrdinal 1001}}</template>);
    assert.dom().hasText('1001st', 'formats large ordinals');

    await render(<template>{{formatOrdinal 2022}}</template>);
    assert.dom().hasText('2022nd', 'formats year-like ordinals');

    await render(<template>{{formatOrdinal 1000000}}</template>);
    assert.dom().hasText('1000000th', 'formats millionth');
  });

  test('localization', async function (assert) {
    await render(<template>{{formatOrdinal 1 locale='en-US'}}</template>);
    assert.dom().hasText('1st', 'English first');

    await render(<template>{{formatOrdinal 2 locale='es-ES'}}</template>);
    assert.dom().hasText('2º', 'Spanish second');

    await render(<template>{{formatOrdinal 3 locale='fr-FR'}}</template>);
    assert.dom().hasText('3e', 'French third');

    await render(<template>{{formatOrdinal 4 locale='de-DE'}}</template>);
    assert.dom().hasText('4.', 'German fourth');
  });

  test('invalid number handling', async function (assert) {
    await render(
      <template>
        {{! @glint-expect-error: invalid input type }}
        {{formatOrdinal 'not-a-number' fallback='Invalid ordinal'}}
      </template>,
    );
    assert.dom().hasText('Invalid ordinal', 'handles non-numeric input');

    await render(
      <template>{{formatOrdinal 123.45 fallback='Decimal ordinal'}}</template>,
    );
    assert.dom().hasText('Decimal ordinal', 'handles decimal numbers');

    let PosInfinity = Number.POSITIVE_INFINITY;
    await render(
      <template>
        {{formatOrdinal PosInfinity fallback='Infinite ordinal'}}
      </template>,
    );
    assert.dom().hasText('Infinite ordinal', 'handles infinity');
  });

  test('boundary ordinal conditions', async function (assert) {
    // Test twenty boundary cases specifically
    await render(<template>{{formatOrdinal 20}}</template>);
    assert.dom().hasText('20th', 'formats twentieth');

    await render(<template>{{formatOrdinal 21}}</template>);
    assert.dom().hasText('21st', 'handles twenty boundary (21st)');

    await render(<template>{{formatOrdinal 30}}</template>);
    assert.dom().hasText('30th', 'formats thirtieth');

    await render(<template>{{formatOrdinal 31}}</template>);
    assert.dom().hasText('31st', 'formats thirty-first');
  });

  test('RTL locale support', async function (assert) {
    await render(<template>{{formatOrdinal 1 locale='ar-SA'}}</template>);
    assert.dom().hasText('١.', 'Arabic ordinal formatting');

    await render(<template>{{formatOrdinal 2 locale='he-IL'}}</template>);
    assert.dom().hasText('2.', 'Hebrew ordinal formatting');
  });

  module('JavaScript function usage', function () {
    test('formatOrdinal function can be called directly', async function (assert) {
      const result = formatOrdinal(21, { locale: 'en-US' });
      assert.strictEqual(result, '21st', 'function returns formatted ordinal');

      const fallbackResult = formatOrdinal(null, {
        fallback: 'No position',
      });
      assert.strictEqual(
        fallbackResult,
        'No position',
        'function handles fallback',
      );
    });
  });
});
