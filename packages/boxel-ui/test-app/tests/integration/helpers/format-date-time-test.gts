import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { hash } from '@ember/helper';
import { formatDateTime } from '@cardstack/boxel-ui/helpers';

module('Integration | helpers | formatDateTime', function (hooks) {
  setupRenderingTest(hooks);

  test('basic date formatting', async function (assert) {
    const testDate = new Date('2024-03-15T15:45:00.000Z');

    await render(<template>{{formatDateTime testDate}}</template>);
    assert.dom().hasText('Mar 15, 2024', 'formats basic date');
  });

  test('date size variants', async function (assert) {
    const testDate = new Date('2024-03-15T15:45:00.000Z');
    const today = new Date();
    const todayAtThreeFortyFive = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      15,
      45,
    );

    await render(<template>
      {{formatDateTime todayAtThreeFortyFive size='tiny'}}
    </template>);
    assert.dom().hasText('3:45 PM', 'tiny size shows time for today');

    await render(<template>{{formatDateTime testDate size='tiny'}}</template>);
    assert.dom().hasText('3/15', 'tiny size shows date for other days');

    await render(<template>{{formatDateTime today size='short'}}</template>);
    assert.dom().hasText('Today', 'short size uses relative terms for today');

    await render(<template>
      {{formatDateTime testDate size='medium'}}
    </template>);
    assert.dom().hasText('Mar 15, 2024', 'medium size standard format');

    await render(<template>{{formatDateTime testDate size='long'}}</template>);
    assert
      .dom()
      .hasText('Friday, March 15, 2024', 'long size includes day of week');
  });

  test('relative time formatting', async function (assert) {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    await render(<template>
      {{formatDateTime twoHoursAgo relative=true}}
    </template>);
    assert.dom().hasText('2 hours ago', 'shows relative time');
  });

  test('custom format strings', async function (assert) {
    const testDate = new Date('2024-03-15T15:45:00.000Z');

    await render(<template>
      {{formatDateTime testDate format='YYYY-MM-DD'}}
    </template>);
    assert.dom().hasText('2024-03-15', 'uses custom format string');

    await render(<template>
      {{formatDateTime testDate format='MMM D, YYYY'}}
    </template>);
    assert.dom().hasText('Mar 15, 2024', 'uses another custom format');
  });

  test('Excel serial date parsing', async function (assert) {
    const excelSerial = 45365; // Represents 2024-03-14

    await render(<template>
      {{formatDateTime excelSerial parse=(hash serialOrigin='excel1900')}}
    </template>);
    assert.dom().hasText('Mar 14, 2024', 'parses Excel 1900 serial dates');

    await render(<template>
      {{formatDateTime excelSerial parse=(hash serialOrigin='excel1904')}}
    </template>);
    assert.dom().hasText('Mar 15, 2028', 'parses Excel 1904 serial dates');
  });

  test('date edge cases', async function (assert) {
    await render(<template>
      {{formatDateTime null fallback='No date'}}
    </template>);
    assert.dom().hasText('No date', 'uses fallback for null');

    await render(<template>
      {{formatDateTime 'invalid' fallback='Invalid date'}}
    </template>);
    assert.dom().hasText('Invalid date', 'uses fallback for invalid dates');

    await render(<template>
      {{formatDateTime undefined fallback='No date set'}}
    </template>);
    assert.dom().hasText('No date set', 'uses fallback for undefined');
  });

  test('date localization', async function (assert) {
    const testDate = new Date('2024-03-15T15:45:00.000Z');

    await render(<template>
      {{formatDateTime testDate size='long' locale='es-ES'}}
    </template>);
    assert.dom().hasText('viernes, 15 de marzo de 2024', 'Spanish date format');

    await render(<template>
      {{formatDateTime testDate size='medium' locale='fr-FR'}}
    </template>);
    assert.dom().hasText('15 mars 2024', 'French date format');
  });

  test('extreme dates', async function (assert) {
    const farFuture = new Date('2038-01-19T03:14:07.000Z'); // Y2038 problem date

    await render(<template>
      {{formatDateTime farFuture size='medium'}}
    </template>);
    assert.dom().hasText('Jan 19, 2038', 'handles Year 2038 problem date');
  });

  test('invalid format handling', async function (assert) {
    const testDate = new Date('2024-03-15T15:45:00.000Z');

    await render(<template>
      {{formatDateTime
        testDate
        format='invalid-format'
        fallback='Format error'
      }}
    </template>);
    assert.dom().hasText('Format error', 'handles invalid format string');

    await render(<template>
      {{formatDateTime testDate format='' fallback='Empty format'}}
    </template>);
    assert.dom().hasText('Empty format', 'handles empty format string');
  });

  module('JavaScript function usage', function () {
    test('formatDateTime function can be called directly', async function (assert) {
      const testDate = new Date('2024-03-15T15:45:00.000Z');

      const result = formatDateTime(testDate, { size: 'medium' });
      assert.strictEqual(
        result,
        'Mar 15, 2024',
        'function returns formatted date',
      );

      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const relativeResult = formatDateTime(twoHoursAgo, {
        relative: true,
        fallback: 'No date',
      });
      assert.strictEqual(
        relativeResult,
        '2 hours ago',
        'function handles relative formatting',
      );
    });
  });
});
