import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { formatAge } from '@cardstack/boxel-ui/helpers';

module('Integration | helpers | formatAge', function (hooks) {
  setupRenderingTest(hooks);

  test('basic age formatting', async function (assert) {
    const almostTwentyFiveYearsAgo = new Date(
      Date.now() - 24.9 * 365 * 24 * 60 * 60 * 1000,
    );

    await render(<template>{{formatAge almostTwentyFiveYearsAgo}}</template>);
    assert.dom().hasText('24 years', 'formats basic age in years');
  });

  test('age unit options', async function (assert) {
    const almostTwoYearsAgo = new Date(
      Date.now() - 1.95 * 365 * 24 * 60 * 60 * 1000,
    );

    await render(
      <template>{{formatAge almostTwoYearsAgo unit='auto'}}</template>,
    );
    assert.dom().hasText('1 year', 'auto unit selects years');

    await render(
      <template>{{formatAge almostTwoYearsAgo unit='years'}}</template>,
    );
    assert.dom().hasText('1 year', 'explicit years unit');

    await render(
      <template>{{formatAge almostTwoYearsAgo unit='months'}}</template>,
    );
    assert.dom().hasText('23 months', 'explicit months unit');

    const almostSixMonthsAgo = new Date(
      Date.now() - 5.9 * 30 * 24 * 60 * 60 * 1000,
    );
    await render(
      <template>{{formatAge almostSixMonthsAgo unit='auto'}}</template>,
    );
    assert
      .dom()
      .hasText('5 months', 'auto unit selects months for younger age');
  });

  test('precise age formatting', async function (assert) {
    const almostOneYearThreeMonthsAgo = new Date(
      Date.now() - (365 + 89) * 24 * 60 * 60 * 1000,
    );

    await render(
      <template>
        {{formatAge almostOneYearThreeMonthsAgo precise=true}}
      </template>,
    );
    assert
      .dom()
      .hasText('1 year, 2 months', 'precise mode shows years and months');

    await render(
      <template>
        {{formatAge almostOneYearThreeMonthsAgo precise=false}}
      </template>,
    );
    assert.dom().hasText('1 year', 'non-precise mode shows primary unit only');
  });

  test('age edge cases', async function (assert) {
    const justBorn = new Date(Date.now() - 1000); // 1 second ago

    await render(<template>{{formatAge justBorn}}</template>);
    assert.dom().hasText('0 days', 'handles newborn age');

    await render(
      <template>{{formatAge null fallback='Age unknown'}}</template>,
    );
    assert.dom().hasText('Age unknown', 'uses fallback for null');

    await render(
      <template>{{formatAge undefined fallback='No birthdate'}}</template>,
    );
    assert.dom().hasText('No birthdate', 'uses fallback for undefined');
  });

  test('string date input', async function (assert) {
    const almostTwentyFiveYearsAgo = new Date(
      Date.now() - 24.9 * 365 * 24 * 60 * 60 * 1000,
    );
    const birthdateString = almostTwentyFiveYearsAgo
      .toISOString()
      .split('T')[0];
    await render(<template>{{formatAge birthdateString}}</template>);
    assert.dom().hasText('24 years', 'handles string date input');
  });

  test('boundary age conditions', async function (assert) {
    const justBorn = new Date(Date.now() - 1000); // 1 second ago
    const exactly1Year = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const leap4Years = new Date(Date.now() - 4 * 365.25 * 24 * 60 * 60 * 1000);
    const veryOld = new Date(Date.now() - 150 * 365 * 24 * 60 * 60 * 1000);

    await render(<template>{{formatAge justBorn}}</template>);
    assert.dom().hasText('0 days', 'handles newborn age');

    await render(<template>{{formatAge exactly1Year}}</template>);
    assert.dom().hasText('11 months', 'handles exactly one year');

    await render(<template>{{formatAge leap4Years}}</template>);
    assert.dom().hasText('4 years', 'handles leap year calculations');

    await render(<template>{{formatAge veryOld}}</template>);
    assert.dom().hasText('149 years', 'handles very old age');
  });

  test('localization', async function (assert) {
    const almostTwentyFiveYearsAgo = new Date(
      Date.now() - 24.95 * 365 * 24 * 60 * 60 * 1000,
    );

    await render(
      <template>
        {{formatAge almostTwentyFiveYearsAgo locale='en-US'}}
      </template>,
    );
    assert.dom().hasText('24 years', 'English age formatting');

    await render(
      <template>
        {{formatAge almostTwentyFiveYearsAgo locale='es-ES'}}
      </template>,
    );
    assert.dom().hasText('24 años', 'Spanish age formatting');

    await render(
      <template>
        {{formatAge almostTwentyFiveYearsAgo locale='fr-FR'}}
      </template>,
    );
    assert.dom().hasText('24 ans', 'French age formatting');

    await render(
      <template>
        {{formatAge almostTwentyFiveYearsAgo locale='zh-CN'}}
      </template>,
    );
    assert.dom().hasText('24岁', 'Chinese age formatting');
  });

  test('precise age with different locales', async function (assert) {
    const almostOneYearThreeMonthsAgo = new Date(
      Date.now() - (365 + 89) * 24 * 60 * 60 * 1000,
    );

    await render(
      <template>
        {{formatAge almostOneYearThreeMonthsAgo precise=true locale='es-ES'}}
      </template>,
    );
    assert.dom().hasText('1 año, 2 meses', 'Spanish precise age');

    await render(
      <template>
        {{formatAge almostOneYearThreeMonthsAgo precise=true locale='fr-FR'}}
      </template>,
    );
    assert.dom().hasText('1\u00A0an, 2\u00A0mois', 'French precise age');
  });

  test('invalid birthdate handling', async function (assert) {
    await render(
      <template>
        {{formatAge 'invalid-date' fallback='Invalid birthdate'}}
      </template>,
    );
    assert.dom().hasText('Invalid birthdate', 'handles invalid date strings');

    await render(
      <template>{{formatAge 'not-a-date' fallback='Bad date'}}</template>,
    );
    assert.dom().hasText('Bad date', 'handles non-date strings');
  });

  test('future birthdate handling', async function (assert) {
    const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    await render(
      <template>{{formatAge futureDate fallback='Future birthdate'}}</template>,
    );
    assert.dom().hasText('Future birthdate', 'handles future birthdates');
  });

  test('days unit formatting', async function (assert) {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    await render(<template>{{formatAge threeDaysAgo unit='days'}}</template>);
    assert.dom().hasText('3 days', 'explicit days unit');

    await render(<template>{{formatAge threeDaysAgo unit='auto'}}</template>);
    assert.dom().hasText('3 days', 'auto unit selects days for very young age');
  });

  module('JavaScript function usage', function () {
    test('formatAge function can be called directly', async function (assert) {
      const birthdate = new Date(
        Date.now() - 24.95 * 365 * 24 * 60 * 60 * 1000,
      );

      const result = formatAge(birthdate, { unit: 'years' });
      assert.strictEqual(result, '24 years', 'function returns formatted age');

      const preciseResult = formatAge(birthdate, {
        precise: true,
        fallback: 'No age',
      });
      assert.strictEqual(
        preciseResult,
        '24 years, 11 months',
        'function handles precise formatting',
      );
    });
  });
});
